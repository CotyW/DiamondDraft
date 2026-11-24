// Tests for static/position-tiers.js (the Position Tiers tab), run against a real analysis of
// data/players.json in a sandbox (tests/helpers/browser.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser, memoryStorage, pageHelpers, realPlayers, fakeHost, button } = require('./helpers/browser.js');

const hasData = fs.existsSync(path.join(__dirname, '..', 'data', 'players.json'));
const { esc, fmt } = pageHelpers();
const XSS = '<svg onload=alert(1)>';

let cached = null;
function analysis() {
    if (!cached) {
        const { players, year } = realPlayers();
        const ss = players.filter(p => /SS/.test(p.position) && !p.is_pitcher)
            .sort((a, b) => (b.stats[year].hr || 0) - (a.stats[year].hr || 0));
        ss[0].name = XSS;
        cached = browser(['valuation.js']).DDValuation.analyze(players, year, {});
    }
    return cached;
}

function tab({ storage = memoryStorage(), withTracker = false, adp = null } = {}) {
    const scripts = ['valuation.js', 'tiers.js', 'position-tiers.js'];
    if (withTracker) scripts.splice(1, 0, 'draft.js');
    if (withTracker) scripts.push('draft-tracker.js');
    const win = browser(scripts, { storage });
    const result = analysis();
    const host = fakeHost();
    let html = '';
    const ctx = { result, esc, fmt, adpOf: r => (adp ? adp[String(r.id)] || null : null),
        rerender: () => { html = win.DDPosTiers.render(ctx); } };
    win.DDPosTiers.init(host);
    ctx.rerender();
    return {
        win, result, storage, P: win.DDPosTiers,
        get html() { return html; },
        click(pt, extra = {}) { host.dispatch('click', button({ pt, ...extra })); },
        column(pos) {
            const start = html.indexOf(`<strong>${pos}</strong>`);
            const next = html.indexOf('<div class="pt-col">', start);
            return html.slice(start, next === -1 ? undefined : next);
        },
        tierCount(pos) { return this.P.compute(result).tiered[pos].count; },
    };
}

test('does nothing without tiers.js', () => {
    assert.equal(browser(['position-tiers.js']).DDPosTiers, undefined);
});

test('one column per position with players, each split into tiers', { skip: !hasData }, () => {
    const t = tab();
    const pt = t.P.compute(t.result);
    for (const pos of Object.keys(pt.tiered).filter(p => pt.tiered[p].entries.length)) {
        assert.ok(t.html.includes(`<strong>${pos}</strong>`), pos);
        assert.ok(pt.tiered[pos].count >= 1);
    }
    assert.match(t.column('SS'), /<span class="tier-pill tier-1">T1<\/span>/);
    assert.doesNotMatch(t.html, /Reset all positions/);
    // Tiers are numbered in order down each column
    const tiers = [...t.column('SS').matchAll(/tier-pill tier-\d+">T(\d+)</g)].map(m => Number(m[1]));
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
});

test('compute() is cached until the tiers change', { skip: !hasData }, () => {
    const t = tab();
    const a = t.P.compute(t.result);
    assert.equal(t.P.compute(t.result), a);
    t.click('more-tiers', { pos: 'SS' });
    assert.notEqual(t.P.compute(t.result), a);
});

test('keyOf: hitters by their value position, pitchers by role', { skip: !hasData }, () => {
    const t = tab();
    assert.equal(t.P.keyOf({ isPitcher: false, pos: 'SS' }), 'SS');
    assert.equal(t.P.keyOf({ isPitcher: false, pos: 'DH' }), 'DH');
    assert.equal(t.P.keyOf({ isPitcher: false, pos: 'UTIL' }), 'DH');
    const sp = t.result.rows.find(r => r.isPitcher && r.position === 'SP');
    assert.equal(t.P.keyOf(sp), 'SP');
});

test('more and fewer tiers, saved per position; reset to automatic', { skip: !hasData }, () => {
    const t = tab();
    const auto = t.tierCount('SS');
    t.click('more-tiers', { pos: 'SS' });
    assert.equal(t.tierCount('SS'), auto + 1);
    assert.deepEqual(JSON.parse(t.storage.items['dd-pos-tiers']), { SS: { count: auto + 1 } });
    assert.match(t.column('SS'), /custom · reset/);
    assert.match(t.html, /Reset all positions to automatic/);

    t.click('less', { pos: 'SS' });
    t.click('less', { pos: 'SS' });
    assert.equal(t.tierCount('SS'), auto - 1);

    t.click('auto', { pos: 'SS' });
    assert.equal(t.tierCount('SS'), auto);
    assert.deepEqual(JSON.parse(t.storage.items['dd-pos-tiers']), {});
});

test('cannot go below one tier', { skip: !hasData }, () => {
    const t = tab();
    for (let i = 0; i < 20; i++) t.click('less', { pos: 'C' });
    assert.equal(t.tierCount('C'), 1);
    assert.match(t.column('C'), /aria-label="Fewer C tiers" disabled/);
    assert.doesNotMatch(t.column('C'), /data-pt="merge"/);
});

test('split starts a new tier at a player; merge joins it back; hand-set tiers survive reloads', { skip: !hasData }, () => {
    const storage = memoryStorage();
    const t = tab({ storage });
    const before = t.P.compute(t.result).tiered['2B'];
    // Split inside the first tier, between its 1st and 2nd players
    assert.ok(before.entries[1].tier === 1, 'the first tier has at least two players');
    t.click('split', { pos: '2B', index: '1' });
    const after = t.P.compute(t.result).tiered['2B'];
    assert.equal(after.count, before.count + 1);
    assert.equal(after.entries[0].tier, 1);
    assert.equal(after.entries[1].tier, 2);
    assert.equal(after.manual, true);
    assert.match(t.column('2B'), /hand-set · reset/);
    // Saved by player id, so a reload gets the same tiers
    const saved = JSON.parse(storage.items['dd-pos-tiers'])['2B'];
    assert.ok(saved.starts.map(String).includes(String(before.entries[1].row.id)), 'split saved at that player');
    const reloaded = tab({ storage });
    assert.deepEqual([...reloaded.P.compute(reloaded.result).tiered['2B'].entries.map(e => e.tier)],
        [...after.entries.map(e => e.tier)]);

    t.click('merge', { pos: '2B', index: '1' });
    assert.equal(t.tierCount('2B'), before.count);
    assert.equal(t.P.compute(t.result).tiered['2B'].entries[1].tier, 1);
});

test('reset all clears every position', { skip: !hasData }, () => {
    const t = tab();
    t.click('more-tiers', { pos: 'SS' });
    t.click('less', { pos: 'OF' });
    t.click('reset-all');
    assert.deepEqual(JSON.parse(t.storage.items['dd-pos-tiers']), {});
    assert.doesNotMatch(t.html, /Reset all positions/);
});

test('show more adds rows to one column only', { skip: !hasData }, () => {
    const t = tab();
    const rows = pos => (t.column(pos).match(/class="pt-player/g) || []).length;
    const of = t.P.compute(t.result).tiered.OF.entries.length;
    assert.ok(of > 30, 'OF has more than one page of players');
    assert.equal(rows('OF'), 30);
    const ss = rows('SS');
    t.click('more', { pos: 'OF' });
    assert.equal(rows('OF'), Math.min(60, of));
    assert.equal(rows('SS'), ss);
    assert.equal(t.storage.items['dd-pos-tiers'], undefined, 'showing more is not a tier change');
});

test('unknown actions and clicks before the first render are ignored', { skip: !hasData }, () => {
    const win = browser(['valuation.js', 'tiers.js', 'position-tiers.js']);
    const host = fakeHost();
    win.DDPosTiers.init(host);
    host.dispatch('click', button({ pt: 'less', pos: 'SS' }));  // no render yet: no ctx
    assert.equal(win.localStorage.items['dd-pos-tiers'], undefined);
    const t = tab();
    t.click('bogus', { pos: 'SS' });
    assert.equal(t.storage.items['dd-pos-tiers'], undefined);
});

test('drafted players are struck through and tiers count what is left', { skip: !hasData }, () => {
    const t = tab({ withTracker: true, storage: memoryStorage() });
    const top = t.P.compute(t.result).tiered.SS.entries.filter(e => e.tier === 1);
    // Record picks the way the Live Draft tab stores them
    t.storage.items['dd-draft'] = JSON.stringify({ picks: top.map(e => ({ id: String(e.row.id), mine: false })) });
    const t2 = tab({ withTracker: true, storage: t.storage });
    const col = t2.column('SS');
    assert.match(col, new RegExp(`<div class="pt-tier empty">[\\s\\S]*?0 of ${top.length} left`));
    assert.equal((col.match(/class="pt-player picked"/g) || []).length, top.length);
});

test('ADP and auction values show beside players', { skip: !hasData }, () => {
    const first = analysis().board.find(r => r.pos === 'SS');
    const t = tab({ adp: { [first.id]: { adp: 7.4 } } });
    assert.match(t.column('SS'), /<span class="pt-adp" title="ADP">7<\/span>/);
});

test('player names are escaped, including in split-button labels', { skip: !hasData }, () => {
    const t = tab();
    assert.ok(t.result.rows.some(r => r.name === XSS));
    assert.ok(!t.html.includes('<svg'), 'no raw tag');
    assert.ok(t.html.includes('&lt;svg onload=alert(1)&gt;'));
});

test('corrupt saved tiers fall back to automatic', { skip: !hasData }, () => {
    for (const bad of ['{oops', 'null']) {
        const t = tab({ storage: memoryStorage({ 'dd-pos-tiers': bad }) });
        assert.ok(t.html.includes('<strong>SS</strong>'), bad);
        assert.doesNotMatch(t.html, /Reset all positions/, bad);
    }
});

// Tests for static/draft-tracker.js (the Live Draft tab), run against a real analysis of
// data/players.json. The tab is loaded in a sandbox (tests/helpers/browser.js); clicks and
// inputs are sent through its init() handlers the way the page sends them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser, memoryStorage, pageHelpers, realPlayers, fakeHost, button } = require('./helpers/browser.js');

const hasData = fs.existsSync(path.join(__dirname, '..', 'data', 'players.json'));
const SCRIPTS = ['valuation.js', 'draft.js', 'tiers.js', 'position-tiers.js', 'draft-tracker.js'];
const { esc, fmt } = pageHelpers();
const XSS = '<img src=x onerror=alert(1)>';

// One analysis per setting, shared by every test (analyze is the slow part)
const results = {};
function analysis(settings = {}) {
    const key = JSON.stringify(settings);
    if (!results[key]) {
        const { players, year } = realPlayers();
        const V = browser(['valuation.js']).DDValuation;
        // A top player with a hostile name, to prove names are escaped everywhere
        const sorted = [...players].sort((a, b) => (b.stats[year].hr || 0) - (a.stats[year].hr || 0));
        sorted[0].name = XSS;
        results[key] = V.analyze(players, year, settings);
    }
    return results[key];
}

/** A fresh Live Draft tab (its own storage), wired to a fake output element. */
function tab({ settings = {}, storage = memoryStorage(), adp = null, withPosTiers = false } = {}) {
    const win = browser(SCRIPTS, { storage });
    const result = analysis(settings);
    let renders = 0;
    let html = '';
    const available = { innerHTML: '' };
    const host = fakeHost({ '.dt': {}, '#dt-available': available });
    const ctx = {
        result, esc, fmt,
        adpOf: r => (adp ? adp[String(r.id)] || null : null),
        hasAdp: !!adp,
        posTiers: withPosTiers ? win.DDPosTiers.compute(result) : null,
        rerender: () => { renders++; html = win.DDTracker.render(ctx); },
    };
    win.DDTracker.init(host);
    ctx.rerender();
    const rowFor = (r, price) => ({
        dataset: { id: String(r.id) },
        querySelector: sel => (sel === '.dt-price' && price !== undefined ? price : null),
    });
    return {
        win, result, storage, host, available,
        get html() { return html; },
        get renders() { return renders; },
        T: win.DDTracker,
        click(dt, extra = {}, ancestors = {}) { host.dispatch('click', button({ dt, ...extra }, ancestors)); },
        pick(r, mine, price) { this.click(mine ? 'mine' : 'taken', {}, { tr: rowFor(r, price) }); },
        change(target) { host.dispatch('change', target); },
        input(target) { host.dispatch('input', target); },
    };
}

const saved = t => JSON.parse(t.storage.items['dd-draft']);

test('does nothing when its dependencies are missing', () => {
    const win = browser(['draft-tracker.js']);
    assert.equal(win.DDTracker, undefined);
});

test('empty snake draft: pick 1, no slot, nothing to undo', { skip: !hasData }, () => {
    const t = tab();
    assert.match(t.html, /<strong>Pick 1<\/strong> <span class="muted">round 1<\/span>/);
    assert.match(t.html, /Set your slot to see when you pick/);
    assert.match(t.html, /data-dt="undo" disabled/);
    assert.match(t.html, /data-dt="reset" disabled/);
    assert.match(t.html, /No picks yet/);
    assert.match(t.html, /Draft a player to see how your team stacks up/);
    assert.doesNotMatch(t.html, /Inflation breakdown/);
});

test('recording picks: mine and taken, saved, and off the available list', { skip: !hasData }, () => {
    const t = tab();
    const [first, second] = t.result.board;
    t.pick(first, true);
    t.pick(second, false);
    assert.deepEqual(saved(t).picks.map(p => [p.id, p.mine, p.price]),
        [[String(first.id), true, null], [String(second.id), false, null]]);
    assert.equal(t.T.pickOf(first.id).mine, true);
    assert.equal(t.T.pickOf(String(second.id)).mine, false);  // ids compare as strings
    assert.match(t.html, /<strong>Pick 3<\/strong>/);
    assert.match(t.html, /Picks <small>2 made, latest first<\/small>/);
    const starters = Object.values(t.result.settings.slots).reduce((a, b) => a + b, 0);
    assert.match(t.html, new RegExp(`My team <small>1 of ${starters} starters</small>`));
    // Neither is offered again
    const availableIds = [...t.html.matchAll(/<tr data-id="([^"]+)"/g)].map(m => m[1]);
    assert.ok(!availableIds.includes(String(first.id)));
    assert.ok(!availableIds.includes(String(second.id)));
    assert.match(t.html, /Category strength<\/h4>\s*<p class="analysis-note">/);
});

test('a player cannot be picked twice', { skip: !hasData }, () => {
    const t = tab();
    const r = t.result.board[0];
    t.pick(r, true);
    t.pick(r, false);
    assert.equal(t.T.picks.length, 1);
    assert.equal(t.T.picks[0].mine, true);
});

test('undo, remove one pick, and reset with confirmation', { skip: !hasData }, () => {
    const t = tab();
    t.result.board.slice(0, 4).forEach((r, i) => t.pick(r, i % 2 === 0));
    t.click('undo');
    assert.equal(t.T.picks.length, 3);
    t.click('remove', { index: '0' });
    assert.deepEqual([...t.T.picks.map(p => p.id)], [...t.result.board.slice(1, 3).map(r => String(r.id))]);

    t.click('reset');
    assert.match(t.html, /Yes, clear all picks/);
    assert.equal(t.T.picks.length, 2, 'asking is not clearing');
    t.click('reset-no');
    assert.doesNotMatch(t.html, /Yes, clear all picks/);
    assert.equal(t.T.picks.length, 2);
    t.click('reset');
    t.click('reset-yes');
    assert.equal(t.T.picks.length, 0);
    assert.deepEqual(saved(t).picks, []);
});

test('clicks outside the tab, or on nothing, are ignored', { skip: !hasData }, () => {
    const t = tab();
    const before = t.renders;
    t.host.children['.dt'] = null;  // another tab is showing
    t.click('undo');
    t.host.dispatch('click', { closest: () => null });
    assert.equal(t.renders, before);
});

test('draft slot: next pick in a snake draft', { skip: !hasData }, () => {
    const t = tab();
    t.change({ id: 'dt-slot', value: '1' });
    assert.match(t.html, /You're on the clock/);
    t.pick(t.result.board[0], true);
    // 12 teams, slot 1: picks 1, 24, 25, 48...; after pick 1 the next is 24, 22 picks away
    assert.match(t.html, /<strong>#24<\/strong> <span class="muted">round 2, 22 picks away<\/span>/);
    t.change({ id: 'dt-slot', value: '' });
    assert.equal(saved(t).slot, null);
    assert.match(t.html, /Set your slot/);
    t.change({ id: 'dt-slot', value: '-3' });
    assert.equal(saved(t).slot, null, 'a nonsense slot is not kept');
});

test('ADP: flags players likely gone before your next pick', { skip: !hasData }, () => {
    const board = analysis().board;
    const adp = { [board[5].id]: { adp: 3 }, [board[6].id]: { adp: 80 } };
    const t = tab({ adp });
    t.change({ id: 'dt-slot', value: '12' });  // next pick is #12
    const row = id => t.html.match(new RegExp(`<tr data-id="${id}">[\\s\\S]*?</tr>`))[0];
    assert.match(row(board[5].id), /3\.0 <span class="dt-flag gone"/);
    assert.doesNotMatch(row(board[6].id), /likely gone/);
    assert.match(t.html, /<th>ADP<\/th>/);
});

test('search finds undrafted players by name or team, and escapes what was typed', { skip: !hasData }, () => {
    const t = tab();
    const target = t.result.rows.find(r => !r.rank && r.name !== XSS);  // off the draft board
    t.input({ id: 'dt-search', value: target.name.toUpperCase() });
    assert.match(t.available.innerHTML, new RegExp(`data-id="${target.id}"`));
    assert.match(t.available.innerHTML, /title="Not on the draft board at these settings"/);

    t.input({ id: 'dt-search', value: 'zzzz no such player' });
    assert.match(t.available.innerHTML, /No undrafted player matches that search/);

    t.input({ id: 'dt-search', value: '"><script>x</script>' });
    t.click('undo');  // any re-render: the search box shows the text escaped
    assert.ok(t.html.includes('value="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
    assert.ok(!t.html.includes('<script>x'));

    // Recording a searched-for player clears the search
    t.input({ id: 'dt-search', value: target.name });
    t.pick(target, false);
    assert.match(t.html, /id="dt-search"[^>]*value=""/);
});

test('position filter, open-spot filter and show more', { skip: !hasData }, () => {
    const t = tab();
    t.change({ id: 'dt-pos', value: 'C' });
    const ids = [...t.available.innerHTML.matchAll(/<tr data-id="([^"]+)"/g)].map(m => m[1]);
    assert.ok(ids.length > 0);
    const rows = new Map(t.result.rows.map(r => [String(r.id), r]));
    assert.ok(ids.every(id => rows.get(id).elig.includes('C')));

    t.change({ id: 'dt-pos', value: 'all' });
    // Fill all nine P slots: with only hitter spots open, no pitcher fits
    t.result.board.filter(r => r.isPitcher).slice(0, t.result.settings.slots.P).forEach(r => t.pick(r, true));
    t.change({ id: 'dt-fits', checked: true });
    const fits = [...t.available.innerHTML.matchAll(/<tr data-id="([^"]+)"/g)].map(m => rows.get(m[1]));
    assert.ok(fits.length > 0);
    assert.ok(fits.every(r => !r.isPitcher), 'pitchers no longer fit');

    t.change({ id: 'dt-fits', checked: false });
    const count = () => (t.available.innerHTML.match(/<tr data-id=/g) || []).length;
    assert.equal(count(), 40);
    t.click('more');
    assert.equal(count(), 80);
});

test('auction: prices typed, defaulted, and clamped; money and inflation shown', { skip: !hasData }, () => {
    const t = tab({ settings: { draftType: 'auction' } });
    assert.match(t.html, /League money left<\/span><strong>\$3120<\/strong>/);
    assert.match(t.html, /Inflation<\/span><strong class="">—<\/strong>/);
    assert.match(t.html, /Inflation breakdown/);
    assert.match(t.html, /Record a few purchases/);

    const [a, b, c] = t.result.board;
    t.pick(a, true, { value: '45.6', placeholder: '40' });
    t.pick(b, false, { value: '', placeholder: '38' });
    t.pick(c, false, { value: '-5', placeholder: '30' });
    assert.deepEqual([...t.T.picks.map(p => p.price)], [46, 38, 0]);
    assert.match(t.html, /League money left<\/span><strong>\$3036<\/strong>/);  // 3120 - 84
    assert.match(t.html, /Your budget<\/span><strong>\$214<\/strong>/);         // 260 - 46
    assert.match(t.html, /By position/);
    assert.match(t.html, /By category/);
    assert.match(t.html, /<span class="muted">\$46<\/span>/);  // price on my roster
});

test('auction in a points league has no category breakdown', { skip: !hasData }, () => {
    const t = tab({ settings: { draftType: 'auction', format: 'points' } });
    t.pick(t.result.board[0], true, { value: '50', placeholder: '1' });
    assert.match(t.html, /By position/);
    assert.doesNotMatch(t.html, /By category/);
    assert.match(t.html, /Projected points<\/h4>/);
});

test('position tiers: chips and the last-in-tier flag', { skip: !hasData }, () => {
    const t = tab({ withPosTiers: true });
    assert.match(t.html, /<span class="dt-label">Position tiers<\/span>/);
    // Take players at one position until one is left in its top tier
    const pt = t.win.DDPosTiers.compute(t.result);
    const top = pt.tiered.SS.entries.filter(e => e.tier === 1);
    top.slice(0, -1).forEach(e => t.pick(e.row, false));
    const last = top[top.length - 1].row;
    assert.match(t.html, /class="dt-chip dt-last" title="SS: 1 left in tier 1"/);
    assert.match(t.html, new RegExp(`data-id="${last.id}">[\\s\\S]*?last SS in T1`));
});

test('player names are escaped everywhere they appear', { skip: !hasData }, () => {
    const t = tab();
    const evil = t.result.rows.find(r => r.name === XSS);
    assert.ok(evil.rank, 'the renamed player is on the board');
    t.pick(evil, true);
    // A saved pick of someone no longer in the data still shows (escaped) on my team
    t.T.picks.push({ id: 'gone-1', name: '<b>Retired</b>', mine: true, price: null });
    t.click('reset-no');  // re-render
    assert.ok(!t.html.includes('<img'), 'no raw tag');
    assert.ok(t.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(t.html.includes('&lt;b&gt;Retired&lt;/b&gt; <span class="muted">(no stats this season)'));
});

test('saved picks come back; corrupt or blocked storage does not break the tab', { skip: !hasData }, () => {
    const id = String(analysis().board[0].id);
    const t = tab({ storage: memoryStorage({ 'dd-draft': JSON.stringify({ picks: [{ id, mine: true }], slot: 4 }) }) });
    assert.equal(t.T.picks.length, 1);
    assert.match(t.html, /id="dt-slot"[^>]*value="4"/);

    for (const bad of ['{not json', 'null', '{"picks": "nope"}', '[]']) {
        const fresh = tab({ storage: memoryStorage({ 'dd-draft': bad }) });
        assert.equal(fresh.T.picks.length, 0, bad);
    }

    const blocked = tab({ storage: memoryStorage({}, { failWrites: true }) });
    blocked.pick(analysis().board[0], true);  // must not throw
    assert.equal(blocked.T.picks.length, 1);
});

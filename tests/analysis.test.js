// Tests for static/analysis.js (the Draft Analysis panel): settings, tabs, the draft board and
// the ADP comparison. The panel runs in a sandbox with a small fake of the few page elements
// it uses (see fakePage); valuation, tiers and the Live Draft scripts are the real ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser, memoryStorage, realPlayers } = require('./helpers/browser.js');

const hasData = fs.existsSync(path.join(__dirname, '..', 'data', 'players.json'));
const SCRIPTS = ['valuation.js', 'projection-upload.js', 'draft.js', 'tiers.js', 'position-tiers.js',
    'draft-tracker.js', 'analysis.js'];

let data = null;
const players = () => (data = data || realPlayers());

function element(extra = {}) {
    const listeners = {};
    const el = {
        innerHTML: '', textContent: '', value: '', dataset: {}, children: {},
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        dispatch(type, target) { (listeners[type] || []).forEach(fn => fn({ target })); },
        querySelector(sel) { return el.children[sel] || null; },
        ...extra,
    };
    return el;
}

/** The parts of the page analysis.js uses: its two containers, the tab buttons, downloads. */
function fakePage({ storage = memoryStorage(), state = null } = {}) {
    const settingsEl = element();
    settingsEl.children['#analysis-format'] = { value: '' };
    settingsEl.children['#analysis-draft'] = { value: '' };
    const outputEl = element();
    outputEl.children['.dt'] = {};
    outputEl.children['#dt-available'] = { innerHTML: '' };
    const tabs = ['categories', 'board', 'tiers', 'positions', 'live'].map(tab => {
        const t = element({ dataset: { tab }, active: false });
        t.classList = { toggle: (cls, on) => { t.active = on; } };
        return t;
    });
    const docListeners = {};
    const downloads = [];
    const document = {
        getElementById: id => ({ 'analysis-settings': settingsEl, 'analysis-output': outputEl }[id] || null),
        querySelectorAll: sel => (sel === '.analysis-tab' ? tabs : []),
        addEventListener: (type, fn) => { docListeners[type] = fn; },
        createElement: () => ({ click() { downloads.push({ href: this.href, download: this.download }); }, remove() {} }),
        body: { appendChild() {} },
    };
    const blobs = [];
    const URL = { createObjectURL: b => { blobs.push(b); return `blob:${blobs.length}`; }, revokeObjectURL() {} };
    class Blob { constructor(parts, opts) { this.text = parts.join(''); this.type = opts.type; } }
    const win = browser(SCRIPTS, { storage, globals: { document, URL, Blob, DDState: state } });
    return { win, settingsEl, outputEl, tabs, docListeners, downloads, blobs, storage,
        clickTab(name) { tabs.find(t => t.dataset.tab === name).dispatch('click', {}); },
        setting(target) { settingsEl.dispatch('change', { dataset: {}, ...target }); },
        click(target) { outputEl.dispatch('click', { closest: () => null, ...target }); },
        change(target) { outputEl.dispatch('change', target); },
        // recompute() waits 50ms before analysing; wait for it to land
        async settle() { await new Promise(r => setTimeout(r, 80)); },
    };
}

async function loadedPage(opts = {}) {
    const { players: list, year } = players();
    const page = fakePage({ ...opts, state: { players: list, year } });
    await page.settle();
    return page;
}

const csvFile = (name, text) => ({ name, text: () => Promise.resolve(text) });

test('does nothing on a page without the panel', () => {
    const win = browser(['valuation.js', 'analysis.js'], { globals: { document: { getElementById: () => null } } });
    assert.ok(win.DDValuation);
});

test('waits for player data, then analyses when main.js announces it', async () => {
    const page = fakePage();
    assert.match(page.settingsEl.innerHTML, /id="analysis-format"/);
    assert.equal(page.settingsEl.children['#analysis-format'].value, 'roto');
    page.docListeners['dd:players-updated']();
    await page.settle();
    assert.equal(page.outputEl.textContent, 'Waiting for player data...');
    if (!hasData) return;
    const { players: list, year } = players();
    page.win.DDState = { players: list, year };
    page.docListeners['dd:players-updated']();
    await page.settle();
    assert.match(page.outputEl.innerHTML, /Roto · 12 teams/);
});

test('every tab renders', { skip: !hasData }, async () => {
    const page = await loadedPage();
    assert.match(page.outputEl.innerHTML, /Batting<\/h3>/);
    page.clickTab('board');
    assert.match(page.outputEl.innerHTML, /analysis-table board/);
    assert.equal(page.tabs.find(t => t.dataset.tab === 'board').active, true);
    assert.equal(page.tabs.find(t => t.dataset.tab === 'categories').active, false);
    page.clickTab('tiers');
    assert.match(page.outputEl.innerHTML, /class="pt-grid"/);
    page.clickTab('positions');
    assert.match(page.outputEl.innerHTML, /League starters/);
    page.clickTab('live');
    assert.match(page.outputEl.innerHTML, /class="dt"/);
});

test('category view toggles between the table and the overlap matrix', { skip: !hasData }, async () => {
    const page = await loadedPage();
    assert.doesNotMatch(page.outputEl.innerHTML, /analysis-table corr/);
    page.click({ closest: sel => (sel === '[data-catview]' ? { dataset: { catview: 'bat:overlap' } } : null) });
    assert.match(page.outputEl.innerHTML, /analysis-table corr/);
});

test('settings: changes are clamped, saved, and re-analysed', { skip: !hasData }, async () => {
    const page = await loadedPage();
    const saved = () => JSON.parse(page.storage.items['dd-analysis-settings']);
    page.setting({ id: 'analysis-teams', value: '1' });
    assert.equal(saved().teams, 2);
    page.setting({ id: 'analysis-teams', value: 'abc' });
    assert.equal(saved().teams, 12);
    page.setting({ id: 'analysis-teams', value: '10' });
    page.setting({ dataset: { slot: 'C' }, value: '-1' });
    assert.equal(saved().slots.C, 0);
    page.setting({ dataset: { cat: 'bat:hr' }, checked: false });
    assert.ok(!saved().selected.bat.includes('hr'));
    await page.settle();
    assert.match(page.outputEl.innerHTML, /Roto · 10 teams/);

    page.setting({ id: 'analysis-format', value: 'h2h' });
    assert.match(page.settingsEl.innerHTML, /data-weight="runs"/);  // h2h shows category weights
    page.setting({ dataset: { weight: 'runs' }, value: 'x' });
    assert.equal(saved().catWeights.runs, 0);
    page.setting({ id: 'analysis-format', value: 'points' });
    assert.match(page.settingsEl.innerHTML, /Points format uses the Scoring Weights/);

    page.setting({ id: 'analysis-draft', value: 'auction' });
    assert.match(page.settingsEl.innerHTML, /id="analysis-budget"/);
    page.setting({ id: 'analysis-budget', value: '0' });
    assert.equal(saved().budget, 260);
    page.setting({ id: 'analysis-budget', value: '300' });
    page.setting({ id: 'analysis-hitter-share', value: '150' });
    assert.equal(saved().hitterShare, 100);
    page.setting({ id: 'analysis-hitter-share', value: '' });
    assert.equal(saved().hitterShare, null);

    const before = page.storage.items['dd-analysis-settings'];
    page.setting({ id: 'something-else' });
    assert.equal(page.storage.items['dd-analysis-settings'], before, 'unrelated inputs are ignored');
});

test('settings survive a reload; corrupt settings fall back to defaults', { skip: !hasData }, async () => {
    const storage = memoryStorage({ 'dd-analysis-settings': JSON.stringify({ format: 'h2h', teams: 15, draftType: 'auction', budget: 200, hitterShare: 65 }) });
    const page = await loadedPage({ storage });
    assert.match(page.outputEl.innerHTML, /Head-to-head categories · 15 teams/);
    assert.equal(page.settingsEl.children['#analysis-draft'].value, 'auction');
    assert.match(page.settingsEl.innerHTML, /id="analysis-hitter-share"[^>]*value="65"/);
    const broken = await loadedPage({ storage: memoryStorage({ 'dd-analysis-settings': '{nope' }) });
    assert.match(broken.outputEl.innerHTML, /Roto · 12 teams/);
});

test('settings changes still re-analyse when the browser blocks storage', { skip: !hasData }, async () => {
    const page = await loadedPage({ storage: memoryStorage({}, { failWrites: true }) });
    assert.doesNotThrow(() => page.setting({ id: 'analysis-teams', value: '8' }));
    await page.settle();
    assert.match(page.outputEl.innerHTML, /Roto · 8 teams/);
});

test('draft board: position filter, show more, auction dollars', { skip: !hasData }, async () => {
    const page = await loadedPage();
    page.clickTab('board');
    const rows = () => (page.outputEl.innerHTML.match(/<tr class="[^"]*"/g) || []).length;
    assert.equal(rows(), 60);
    page.click({ id: 'board-more' });
    assert.equal(rows(), 120);
    page.change({ id: 'board-pos', value: 'C' });
    assert.ok(rows() <= 60 && rows() > 0);
    page.setting({ id: 'analysis-draft', value: 'auction' });
    await page.settle();
    assert.match(page.outputEl.innerHTML, /<th title="Auction value">\$<\/th>/);
    assert.match(page.outputEl.innerHTML, /\$260 × 12 teams = \$3120/);
});

test('ADP: upload, match, columns, sorting, bargains and reaches, remove', { skip: !hasData }, async () => {
    const page = await loadedPage();
    page.clickTab('board');
    assert.match(page.outputEl.innerHTML, /Compare to ADP/);
    assert.doesNotMatch(page.outputEl.innerHTML, /<th[^>]*>ADP<\/th>/);

    // ADP in the reverse of our ranking, so there are big bargains and reaches
    // Our top 20 (two-way players left out: their two entries share one ADP)
    const byId = new Map(players().players.map(p => [String(p.id), p]));
    const ids = [...page.outputEl.innerHTML.matchAll(/data-player-id="([^"]+)"/g)].map(m => m[1])
        .filter(id => !byId.get(id).two_way).slice(0, 20);
    const lines = ids.map((id, i) => `${JSON.stringify(byId.get(id).name)},${20 - i},${id}`);
    page.change({ id: 'adp-file', files: [csvFile('nfbc.csv', `Name,ADP,MLBAMID\n${lines.join('\n')}\nNobody Atall,30,\n`)] });
    await page.settle();
    const out = page.outputEl.innerHTML;
    assert.match(out, /ADP: <strong>nfbc\.csv<\/strong> · \d+ matched/);
    assert.match(out, /of 21 players matched\. 1 isn&#39;t in our player list \(e\.g\. Nobody Atall\)/);
    assert.match(out, /<th title="Average draft position from your ADP file">ADP<\/th>/);
    assert.match(out, /Bargains <small>/);
    assert.match(out, /Reaches <small>/);
    // The board's row for a player (the highlights above the table link players too)
    const row = id => out.slice(out.indexOf('<tbody>')).split('</tr>').find(r => r.includes(`data-player-id="${id}"`));
    const rank = id => Number(row(id).match(/<td>(\d+)<\/td>/)[1]);
    const vsAdp = id => row(id).match(/<td class="(\w*)">([+−]\d+)<\/td>/).slice(1);
    // ADP 20 for our best: a bargain of 20 - his rank; ADP 1 for our 20th: a reach
    assert.deepEqual(vsAdp(ids[0]), ['zhi', `+${20 - rank(ids[0])}`]);
    assert.deepEqual(vsAdp(ids[19]), ['zlo', `−${rank(ids[19]) - 1}`]);
    assert.ok(page.storage.items['dd-adp'], 'kept in this browser');

    page.change({ id: 'board-sort', value: 'adp' });
    const firstByAdp = page.outputEl.innerHTML.match(/<tr class="[^"]*"[^>]*>\s*<td>\d+<\/td>[\s\S]*?data-player-id="([^"]+)"/)[1];
    assert.equal(firstByAdp, ids[19], 'lowest ADP first');
    page.change({ id: 'board-sort', value: 'diff' });
    assert.match(page.outputEl.innerHTML, /<option value="diff" selected>/);

    page.click({ id: 'adp-remove' });
    assert.match(page.outputEl.innerHTML, /Compare to ADP/);
    assert.doesNotMatch(page.outputEl.innerHTML, /board-sort/);
    assert.equal(page.storage.items['dd-adp'], undefined);
});

test('ADP: a bad file shows an error, escaped, and changes nothing', { skip: !hasData }, async () => {
    const page = await loadedPage();
    page.clickTab('board');
    page.change({ id: 'adp-file', files: [csvFile('<img src=x>.csv', 'Foo,Bar\n1,2\n')] });
    await page.settle();
    const out = page.outputEl.innerHTML;
    assert.match(out, /class="adp-message error"/);
    assert.ok(out.includes('&lt;img src=x&gt;.csv:'));
    assert.ok(!out.includes('<img src=x>'));
    assert.equal(page.storage.items['dd-adp'], undefined);

    page.change({ id: 'adp-file', files: [csvFile('none.csv', 'Name,ADP\nNobody Atall,1\n')] });
    await page.settle();
    assert.match(page.outputEl.innerHTML, /No rows matched our players/);
    page.change({ id: 'adp-file', files: [] });  // dialog cancelled
});

test('ADP: the file name is escaped, a saved file reloads, and the template downloads', { skip: !hasData }, async () => {
    const { players: list } = players();
    const p = list.find(x => !x.is_pitcher);
    const storage = memoryStorage();
    const page = await loadedPage({ storage });
    page.clickTab('board');
    page.change({ id: 'adp-file', files: [csvFile('"><b>x</b>.csv', `Name,ADP,MLBAMID\n${JSON.stringify(p.name)},5,${p.id}\n`)] });
    await page.settle();
    assert.ok(page.outputEl.innerHTML.includes('&quot;&gt;&lt;b&gt;x&lt;/b&gt;.csv'));
    assert.ok(!page.outputEl.innerHTML.includes('<b>x</b>'));

    const again = await loadedPage({ storage });
    again.clickTab('board');
    assert.match(again.outputEl.innerHTML, /Replace ADP/);

    again.click({ id: 'adp-template' });
    assert.equal(again.downloads[0].download, 'adp-template.csv');
    assert.match(again.blobs[0].text, /^Name/);
});

test('board marks players drafted in the Live Draft tab', { skip: !hasData }, async () => {
    const page = await loadedPage();
    page.clickTab('board');
    const firstId = page.outputEl.innerHTML.match(/data-player-id="([^"]+)"/)[1];
    page.win.DDTracker.picks.push({ id: firstId, mine: true });
    page.clickTab('board');
    assert.match(page.outputEl.innerHTML, /<tr class="[^"]*picked" title="On your team">/);
});

test('a season with nobody qualified says so', { skip: !hasData }, async () => {
    const empty = players().players.map(p => ({ ...p, stats_by_season: {} }));
    const page = fakePage({ state: { players: empty, year: '2026' } });
    await page.settle();
    assert.match(page.outputEl.innerHTML, /No players with enough playing time/);
});

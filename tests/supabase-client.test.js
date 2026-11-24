// Tests for static/supabase-client.js: loading data/*.json, choosing which projection system's
// line a player shows, and the optional Supabase data source. Network calls are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.js');

const META = { timestamp: '2026-11-12T18:09:33', seasons: [2026, 2024, 2025], projection_year: 2027 };

const judge = {
    id: 592450, name: 'Aaron Judge', is_pitcher: false, projection_source: 'steamer',
    stats: { 2026: { hr: 50 }, 2027: { hr: 45 } },                 // 2027 = Steamer, the default
    projections: { marcel: { hr: 40 }, zips: { hr: 47 } },
};
const marcelOnly = { id: 1, name: 'Marcel Guy', is_pitcher: false, stats: { 2026: { hr: 10 }, 2027: { hr: 11 } } };
const arm = { id: '660271-P', name: 'Two Way', is_pitcher: true, projection_source: 'zips',
    stats: { 2026: { era: 3 }, 2027: { era: 3.2 } }, projections: { marcel: { era: 3.5 } } };

function jsonResponse(body, status = 200) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

/** The data client in a sandbox. routes: {url: body | Error | (() => response)} for fetch. */
function client(routes = {}, { supabase } = {}) {
    const calls = [];
    const errors = [];
    const fetch = url => {
        calls.push(url);
        const r = routes[url];
        if (r === undefined) return jsonResponse({ error: 'not found' }, 404);
        if (r instanceof Error) return Promise.reject(r);
        if (typeof r === 'function') return r();
        return jsonResponse(r);
    };
    const loaded = [];
    const win = browser(['supabase-client.js'], { globals: {
        fetch, supabase,
        console: { log() {}, warn() {}, error: (...a) => errors.push(a) },
        document: { addEventListener: (type, fn) => loaded.push(fn) },
    } });
    const call = name => vm.runInContext(name, win);
    return { win, calls, errors, call, onLoad: () => Promise.all(loaded.map(fn => fn())) };
}

const staticRoutes = (players = [judge, marcelOnly, arm]) => ({
    'data/players.json': players, 'data/last_updated.json': META,
});

test('projectionLabel: known systems, short and long unknown names, Marcel by default', () => {
    const label = client().call('projectionLabel');
    assert.equal(label('thebatx'), 'THE BAT X');
    assert.equal(label('zips'), 'ZiPS');
    assert.equal(label('upload'), 'Your upload');
    assert.equal(label('pod'), 'POD');
    assert.equal(label('mysystem'), 'Mysystem');
    assert.equal(label(null), 'Marcel');
    assert.equal(label(''), 'Marcel');
});

test('projectionFor: each player defaults to their own system', () => {
    const c = client();
    const forP = c.call('projectionFor');
    assert.deepEqual(JSON.parse(JSON.stringify(forP(judge, '2027'))), [{ hr: 45 }, 'steamer']);
    assert.deepEqual(JSON.parse(JSON.stringify(forP(marcelOnly, '2027'))), [{ hr: 11 }, 'marcel']);
});

test('projectionFor: a chosen system, with Marcel for players it does not cover', () => {
    const c = client();
    const forP = (p) => JSON.parse(JSON.stringify(c.call('projectionFor')(p, '2027')));
    c.call('setProjectionSource')('zips');
    assert.deepEqual(forP(judge), [{ hr: 47 }, 'zips']);
    assert.deepEqual(forP(marcelOnly), [{ hr: 11 }, 'marcel']);
    c.call('setProjectionSource')('marcel');
    assert.deepEqual(forP(judge), [{ hr: 40 }, 'marcel']);    // Marcel moved into projections
    assert.deepEqual(forP(arm), [{ era: 3.5 }, 'marcel']);
    c.call('setProjectionSource')('atc');                      // nobody has ATC
    assert.deepEqual(forP(judge), [{ hr: 40 }, 'marcel']);
    c.call('setProjectionSource')('');                         // back to defaults
    assert.deepEqual(forP(judge), [{ hr: 45 }, 'steamer']);
});

test('projectionFor: uploaded lines by player id, Marcel when the upload misses a player', () => {
    const c = client();
    const forP = (p) => JSON.parse(JSON.stringify(c.call('projectionFor')(p, '2027')));
    c.call('setUploadedProjections')({ 592450: { hr: 60 }, '660271-P': { era: 2.0 } });
    c.call('setProjectionSource')('upload');
    assert.deepEqual(forP(judge), [{ hr: 60 }, 'upload']);
    assert.deepEqual(forP(arm), [{ era: 2.0 }, 'upload']);
    assert.deepEqual(forP(marcelOnly), [{ hr: 11 }, 'marcel']);
    c.call('setUploadedProjections')(null);                    // upload removed
    assert.deepEqual(forP(judge), [{ hr: 40 }, 'marcel']);
});

test('static data: only the projection season switches systems; filters work', async () => {
    const c = client(staticRoutes());
    c.call('setProjectionSource')('zips');
    const all = await c.call('fetchPlayersWithStats')('all', [2026, 2027]);
    const j = all.find(p => p.id === 592450);
    assert.equal(j.player_id, 592450);
    assert.equal(j.stats_by_season[2026].batting.hr, 50);      // actual season untouched
    assert.equal(j.stats_by_season[2027].batting.hr, 47);
    assert.equal(j.projection_source, 'zips');
    assert.equal(all.find(p => p.id === 1).projection_source, 'marcel');

    assert.deepEqual([...(await c.call('fetchPlayersWithStats')('batter', [2026])).map(p => p.id)], [592450, 1]);
    assert.deepEqual([...(await c.call('fetchPlayersWithStats')('pitcher', [2026])).map(p => p.id)], ['660271-P']);
    // players.json and the config are fetched once and reused
    assert.equal(c.calls.filter(u => u === 'data/players.json').length, 1);
    assert.equal(c.calls.filter(u => u === 'api/supabase-config').length, 1);
});

test('static data: a season the player has no line for is empty, not an error', async () => {
    const c = client(staticRoutes([{ id: 5, name: 'Rookie', is_pitcher: false, stats: {} }]));
    const [p] = await c.call('fetchPlayersWithStats')('all', [2024]);
    assert.deepEqual(JSON.parse(JSON.stringify(p.stats_by_season[2024])), { batting: {}, pitching: {} });
});

test('static data: still loads when last_updated.json is missing', async () => {
    const c = client({ 'data/players.json': [judge] });
    const [p] = await c.call('fetchPlayersWithStats')('all', [2027]);
    assert.equal(p.stats_by_season[2027].batting.hr, 45);       // no projection year known: stored line
});

test('static data: a failed players.json load gives an empty list and logs why', async () => {
    const c = client({ 'data/last_updated.json': META });
    assert.equal((await c.call('fetchPlayersWithStats')('all', [2026])).length, 0);
    assert.match(String(c.errors[0][1]), /players\.json: HTTP 404/);
});

test('no Flask server (GitHub Pages): the missing config means static data', async () => {
    const routes = staticRoutes();
    routes['api/supabase-config'] = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new SyntaxError('HTML')) });
    const c = client(routes);
    assert.equal((await c.call('fetchPlayersWithStats')('all', [2026])).length, 3);
    const offline = client({ ...staticRoutes(), 'api/supabase-config': new TypeError('Failed to fetch') });
    assert.equal((await offline.call('fetchPlayersWithStats')('all', [2026])).length, 3);
});

test('getSeasonConfig: seasons as sorted numbers; no seasons is an error', async () => {
    const c = client(staticRoutes());
    const cfg = await c.call('getSeasonConfig')();
    assert.deepEqual([...cfg.seasons], [2024, 2025, 2026]);
    assert.equal(cfg.projectionYear, 2027);
    const empty = client({ 'data/last_updated.json': { seasons: [] } });
    await assert.rejects(empty.call('getSeasonConfig')(), /lists no seasons/);
    const noProjection = client({ 'data/last_updated.json': { seasons: ['2025'] } });
    assert.equal((await noProjection.call('getSeasonConfig')()).projectionYear, null);
    const missing = client({});
    await assert.rejects(missing.call('getSeasonConfig')(), /last_updated\.json: HTTP 404/);
});

test('getLastUpdated: the time in last_updated.json', async () => {
    const c = client(staticRoutes());
    const d = await c.call('getLastUpdated')();
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 12);
});

// ---- Supabase data source ----

/** A stand-in for supabase-js: from(table).select().in()/eq()/order()/limit()/single(). */
function fakeSupabase(tables, { failOn } = {}) {
    const created = [];
    return {
        created,
        createClient(url, key) {
            created.push([url, key]);
            return {
                from(table) {
                    let rows = tables[table] || [];
                    const q = {
                        select: () => q,
                        in: (col, vals) => { rows = rows.filter(r => vals.includes(r[col])); return q; },
                        eq: (col, val) => { rows = rows.filter(r => r[col] === val); return q; },
                        order: (col, { ascending = true } = {}) => {
                            const key = r => r[col] ?? '';  // created_at defaults to now() in the schema, so no nulls in practice
                            rows = [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (ascending ? 1 : -1));
                            return q;
                        },
                        limit: n => { rows = rows.slice(0, n); return q; },
                        single: () => { rows = rows[0] || null; return q; },
                        then: (ok, bad) => Promise.resolve(failOn === table
                            ? { data: null, error: new Error(`${table} failed`) }
                            : { data: rows, error: null }).then(ok, bad),
                    };
                    return q;
                },
            };
        },
    };
}

const SB_TABLES = {
    players: [
        { player_id: '1', name: 'Hitter', team: 'NYY', position: 'RF' },
        { player_id: '2', full_name: 'Pitcher', team_name: 'LAD', primary_position: 'SP' },
    ],
    actual_stats: [
        { player_id: '1', season: 2026, stat_type: 'batting', home_runs: 30, stolen_bases: 5, at_bats: 500 },
        { player_id: '2', season: 2026, stat_type: 'pitching', wins: 12, strikeouts_pitched: 200, walks_allowed: 40, created_at: '2026-10-01T00:00:00Z' },
        { player_id: '2', season: 2024, stat_type: 'pitching', wins: 99 },
    ],
};

async function supabaseClient(tables = SB_TABLES, opts) {
    const sb = fakeSupabase(tables, opts);
    const c = client({ 'api/supabase-config': { data_source: 'supabase', url: 'https://x.supabase.co', key: 'anon' } }, { supabase: sb });
    await c.onLoad();  // the page initializes the client on DOMContentLoaded
    return { c, sb };
}

test('supabase: client created once from the server config', async () => {
    const { c, sb } = await supabaseClient();
    await c.call('initializeSupabase')();
    assert.deepEqual(sb.created, [['https://x.supabase.co', 'anon']]);
});

test('supabase: players joined to their stats, column names mapped, pitchers detected', async () => {
    const { c } = await supabaseClient();
    const all = await c.call('fetchPlayersWithStats')('all', [2026]);
    const [h, p] = all;
    assert.equal(h.name, 'Hitter');
    assert.equal(h.is_pitcher, false);
    assert.equal(h.stats_by_season[2026].batting.hr, 30);
    assert.equal(h.stats_by_season[2026].batting.steals, 5);
    assert.equal(p.name, 'Pitcher');
    assert.equal(p.team, 'LAD');
    assert.equal(p.position, 'SP');
    assert.equal(p.is_pitcher, true);
    assert.equal(p.stats_by_season[2026].pitching.strikeouts, 200);
    assert.equal(p.stats_by_season[2026].pitching.walks, 40);
    assert.equal(p.stats_by_season[2026].pitching.wins, 12);    // not 2024's 99
    assert.deepEqual([...(await c.call('fetchPlayersWithStats')('pitcher', [2026])).map(x => x.id)], ['2']);
    assert.deepEqual([...(await c.call('fetchPlayersWithStats')('batter', [2026])).map(x => x.id)], ['1']);
});

test('supabase: query errors and empty tables give an empty list', async () => {
    for (const failOn of ['players', 'actual_stats']) {
        const { c } = await supabaseClient(SB_TABLES, { failOn });
        assert.equal((await c.call('fetchPlayersWithStats')('all', [2026])).length, 0, failOn);
    }
    const { c } = await supabaseClient({ players: [], actual_stats: [] });
    assert.equal((await c.call('fetchPlayersWithStats')('all', [2026])).length, 0);
});

test('supabase: one player by id, and the latest update time', async () => {
    const { c } = await supabaseClient();
    const p = await c.call('fetchPlayerById')('2');
    assert.equal(p.full_name, 'Pitcher');
    assert.equal(p.stats.length, 2);
    const d = await c.call('getLastUpdated')();
    assert.equal(d.toISOString(), '2026-10-01T00:00:00.000Z');
    const { c: broken } = await supabaseClient(SB_TABLES, { failOn: 'players' });
    assert.equal(await broken.call('fetchPlayerById')('2'), null);
});

test('supabase calls without a client fail soft', async () => {
    const c = client(staticRoutes());
    assert.equal(await c.call('fetchPlayerById')('1'), null);
    assert.equal(await c.call('initializeSupabase')(), null);   // static source: no client
});

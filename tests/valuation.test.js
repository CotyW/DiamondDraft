// Tests for static/valuation.js. Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../static/valuation.js');

const YEAR = '2026';

// ---- Builders for made-up players, in the shape the page passes to analyze() ----

let nextId = 1;
function batter(position, stats, extra = {}) {
    const s = { runs: 70, hr: 20, rbi: 70, steals: 8, hits: 140, ab: 520, avg: 140 / 520, ...stats };
    return { id: nextId++, name: `B${nextId}`, team: 'T', position, is_pitcher: false,
             stats_by_season: { [YEAR]: { batting: s, pitching: {} } }, ...extra };
}
function pitcher(position, stats, extra = {}) {
    const s = { wins: 10, saves: 0, strikeouts: 150, era: 4.0, ip: 160, walks: 50, hits_allowed: 150,
                runs_scored: 75, ...stats };
    return { id: nextId++, name: `P${nextId}`, team: 'T', position, is_pitcher: true,
             stats_by_season: { [YEAR]: { batting: {}, pitching: s } }, ...extra };
}

// A full league's worth of players: `perPos` batters at each position and `pitchers` pitchers,
// each group spread from good to bad so allocation has real choices to make.
function league({ perPos = 6, pitchers = 40 } = {}) {
    const out = [];
    ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'DH'].forEach(pos => {
        for (let i = 0; i < perPos; i++) {
            const k = 1 - i / perPos;
            out.push(batter(pos, { runs: 50 + 50 * k, hr: 10 + 25 * k, rbi: 50 + 50 * k,
                                   steals: 2 + 15 * k, hits: 120 + 50 * k, ab: 550 }));
        }
    });
    for (let i = 0; i < pitchers; i++) {
        const k = 1 - i / pitchers;
        const rp = i % 4 === 0;
        out.push(pitcher(rp ? 'RP' : 'SP', {
            wins: rp ? 3 : 6 + 10 * k, saves: rp ? 5 + 30 * k : 0, strikeouts: 60 + 150 * k,
            era: 5.0 - 2.0 * k, ip: rp ? 65 : 120 + 80 * k, walks: 60 - 20 * k, hits_allowed: 160 - 40 * k
        }));
    }
    return out;
}

const byId = (result, player) => result.rows.find(r => r.id === player.id);
const SMALL = { teams: 2, slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 2, RP: 1, P: 2 } };

// ---- Position eligibility ----

test('eligibleSlots: multi-position batters fill each position plus UTIL', () => {
    assert.deepEqual(V.eligibleSlots('2B/SS', false), ['2B', 'SS', 'UTIL']);
    assert.deepEqual(V.eligibleSlots('3b, 1b', false), ['3B', '1B', 'UTIL']);
});

test('eligibleSlots: LF, CF and RF all count as OF, once', () => {
    assert.deepEqual(V.eligibleSlots('LF/CF/RF', false), ['OF', 'UTIL']);
});

test('eligibleSlots: DH and unknown batter positions only fill UTIL', () => {
    assert.deepEqual(V.eligibleSlots('DH', false), ['UTIL']);
    assert.deepEqual(V.eligibleSlots('TWP', false), ['UTIL']);
    assert.deepEqual(V.eligibleSlots('', false), ['UTIL']);
});

test('eligibleSlots: pitchers fill their role plus P; plain P counts as both roles', () => {
    assert.deepEqual(V.eligibleSlots('SP', true), ['SP', 'P']);
    assert.deepEqual(V.eligibleSlots('RP', true), ['RP', 'P']);
    assert.deepEqual(V.eligibleSlots('P', true), ['SP', 'RP', 'P']);
});

test('normalizePosition: first real position, DH for UTIL-only batters', () => {
    assert.equal(V.normalizePosition('2B/SS', false), '2B');
    assert.equal(V.normalizePosition('CF', false), 'OF');
    assert.equal(V.normalizePosition('DH', false), 'DH');
    assert.equal(V.normalizePosition('RP', true), 'RP');
});

// ---- Who qualifies ----

test('playing-time minimums: too few AB or IP are left out', () => {
    const regular = batter('1B', { ab: 500 });
    const benchBat = batter('1B', { ab: 60, hits: 15 });
    const starter = pitcher('SP', { ip: 150 });
    const cupOfCoffee = pitcher('SP', { ip: 8, strikeouts: 9 });
    const r = V.analyze([regular, benchBat, starter, cupOfCoffee], YEAR);
    const ids = r.rows.map(x => x.id);
    assert.ok(ids.includes(regular.id) && ids.includes(starter.id));
    assert.ok(!ids.includes(benchBat.id) && !ids.includes(cupOfCoffee.id));
});

test('players with no stats for the year are skipped', () => {
    const p = batter('1B', {});
    p.stats_by_season = { 2025: p.stats_by_season[YEAR] };
    assert.equal(V.analyze([p], YEAR).rows.length, 0);
});

test('Supabase column names (at_bats, innings_pitched) are read', () => {
    const b = batter('1B', {});
    const s = b.stats_by_season[YEAR].batting;
    s.at_bats = s.ab; delete s.ab;
    const p = pitcher('SP', {});
    const ps = p.stats_by_season[YEAR].pitching;
    ps.innings_pitched = ps.ip; delete ps.ip;
    const r = V.analyze([b, p], YEAR);
    assert.equal(byId(r, b).s.ab, 520);
    assert.equal(byId(r, p).s.ip, 160);
});

test('missing, null, empty and numeric-string stats are handled', () => {
    const b = batter('1B', { hr: '25', rbi: null, steals: '', runs: undefined });
    const r = V.analyze([b, ...league()], YEAR);
    const row = byId(r, b);
    assert.equal(row.s.hr, 25);
    assert.equal(row.s.rbi, 0);
    assert.equal(row.s.steals, 0);
    assert.ok(r.rows.every(x => Number.isFinite(x.raw) && Number.isFinite(x.vorp)));
});

// ---- Category scoring ----

test('roto: a batter better in every category scores higher', () => {
    const good = batter('1B', { runs: 100, hr: 35, rbi: 100, steals: 20, hits: 170, ab: 550 });
    const bad = batter('1B', { runs: 60, hr: 12, rbi: 55, steals: 3, hits: 125, ab: 550 });
    const r = V.analyze([good, bad, ...league()], YEAR);
    assert.ok(byId(r, good).raw > byId(r, bad).raw);
    for (const k of ['runs', 'hr', 'rbi', 'steals', 'avg']) assert.ok(byId(r, good).z[k] > byId(r, bad).z[k], k);
});

test('roto: lower ERA and WHIP are better', () => {
    const ace = pitcher('SP', { era: 2.5, hits_allowed: 120, walks: 35 });
    const meh = pitcher('SP', { era: 5.0, hits_allowed: 190, walks: 70 });
    const r = V.analyze([ace, meh, ...league()], YEAR);
    assert.ok(byId(r, ace).z.era > byId(r, meh).z.era);
    assert.ok(byId(r, ace).z.whip > byId(r, meh).z.whip);
    assert.ok(byId(r, ace).raw > byId(r, meh).raw);
});

test('roto: AVG is weighted by at-bats', () => {
    // Same .320 average; more at-bats moves a team's average more
    const full = batter('1B', { hits: 192, ab: 600 });
    const part = batter('1B', { hits: 64, ab: 200 });
    const r = V.analyze([full, part, ...league()], YEAR);
    assert.ok(byId(r, full).z.avg > byId(r, part).z.avg);
});

test('roto: ERA is weighted by innings', () => {
    const workhorse = pitcher('SP', { era: 2.8, ip: 200 });
    const spot = pitcher('SP', { era: 2.8, ip: 60 });
    const r = V.analyze([workhorse, spot, ...league()], YEAR);
    assert.ok(byId(r, workhorse).z.era > byId(r, spot).z.era);
});

test('roto: only selected categories count', () => {
    const r = V.analyze(league(), YEAR, { selected: { bat: ['hr'], pit: ['strikeouts'] } });
    const b = r.rows.find(x => !x.isPitcher);
    assert.deepEqual(Object.keys(b.z), ['hr']);
    assert.ok(Math.abs(b.raw - b.z.hr) < 1e-9);
});

test('WHIP is dropped when the data has no hits allowed', () => {
    const players = league();
    players.filter(p => p.is_pitcher).forEach(p => { p.stats_by_season[YEAR].pitching.hits_allowed = 0; });
    const r = V.analyze(players, YEAR);
    const p = r.rows.find(x => x.isPitcher);
    assert.ok(!('whip' in p.z));
    assert.ok('era' in p.z);
});

test('h2h: a category weighted 0 is punted', () => {
    const speedy = batter('1B', { steals: 45 });
    const slow = batter('1B', { steals: 0 });
    const r = V.analyze([speedy, slow, ...league()], YEAR, { format: 'h2h', catWeights: { steals: 0 } });
    assert.ok(Math.abs(byId(r, speedy).raw - byId(r, slow).raw) < 1e-9);
});

test('h2h: doubling a category weight doubles its share of value', () => {
    const players = league();
    const one = V.analyze(players, YEAR, { format: 'h2h', selected: { bat: ['hr'], pit: ['wins'] } });
    const two = V.analyze(players, YEAR, { format: 'h2h', selected: { bat: ['hr'], pit: ['wins'] }, catWeights: { hr: 2 } });
    const id = one.rows.find(r => !r.isPitcher).id;
    const a = one.rows.find(r => r.id === id), b = two.rows.find(r => r.id === id);
    assert.ok(Math.abs(b.raw - 2 * a.raw) < 1e-9);
});

test('points: value comes from the points the page computed', () => {
    const hi = batter('1B', {}, { points: 500 });
    const lo = batter('1B', {}, { points: 100 });
    const r = V.analyze([hi, lo], YEAR, { format: 'points' });
    assert.equal(byId(r, hi).raw, 500);
    assert.equal(byId(r, lo).raw, 100);
});

// ---- Draft pool, replacement level and value ----

test('the board holds exactly one player per starting slot in the league', () => {
    const r = V.analyze(league(), YEAR, SMALL);
    const slots = Object.values(SMALL.slots).reduce((a, b) => a + b, 0);
    assert.equal(r.board.length, slots * SMALL.teams);
    assert.ok(r.board.every(x => x.drafted));
});

test('replacement level is the best undrafted player at the slot', () => {
    const r = V.analyze(league(), YEAR, SMALL);
    const undraftedC = r.rows.filter(x => x.elig.includes('C') && !x.drafted).sort((a, b) => b.raw - a.raw);
    assert.equal(r.meta.replacement.C, undraftedC[0].raw);
});

test('value is raw minus replacement level at the best slot the player can fill', () => {
    const r = V.analyze(league(), YEAR, SMALL);
    for (const row of r.rows) {
        const options = row.elig.filter(s => r.meta.replacement[s] !== undefined).map(s => row.raw - r.meta.replacement[s]);
        assert.ok(Math.abs(row.vorp - Math.max(...options)) < 1e-9, row.name);
    }
});

test('scarcity: a catcher can outrank a better hitter at a deep position', () => {
    // Two catchers in a 2-team league with 1 C slot each: the replacement catcher is awful
    const players = league({ perPos: 8 }).filter(p => p.position !== 'C');
    const c1 = batter('C', { runs: 70, hr: 20, rbi: 70, steals: 3, hits: 140, ab: 520 });
    const c2 = batter('C', { runs: 65, hr: 18, rbi: 65, steals: 2, hits: 135, ab: 520 });
    const c3 = batter('C', { runs: 30, hr: 3, rbi: 25, steals: 0, hits: 105, ab: 450 });
    const ofBetter = batter('OF', { runs: 75, hr: 22, rbi: 75, steals: 6, hits: 145, ab: 520 });
    const r = V.analyze([...players, c1, c2, c3, ofBetter], YEAR, SMALL);
    assert.ok(byId(r, ofBetter).raw > byId(r, c1).raw);
    assert.ok(byId(r, c1).vorp > byId(r, ofBetter).vorp);
});

test('a multi-position player is listed at the slot where they are worth most', () => {
    const flex = batter('2B/SS', { runs: 90, hr: 25, rbi: 85, steals: 15, hits: 160, ab: 560 });
    const r = V.analyze([flex, ...league()], YEAR, SMALL);
    const want = ['2B', 'SS', 'UTIL'].sort((a, b) => r.meta.replacement[a] - r.meta.replacement[b])[0];
    assert.equal(byId(r, flex).slot, want);
});

test('a two-way player is valued separately as a batter and as a pitcher', () => {
    const bat = batter('DH', { runs: 120, hr: 45, rbi: 110, steals: 20, hits: 170, ab: 600 }, { id: 660271, two_way: true });
    const pit = pitcher('SP', { wins: 12, strikeouts: 190, era: 2.6, ip: 150, hits_allowed: 110, walks: 40 },
                        { id: '660271-P', two_way: true });
    const r = V.analyze([bat, pit, ...league()], YEAR, SMALL);
    assert.equal(byId(r, bat).pos, 'DH');
    assert.equal(byId(r, pit).pos, 'SP');
    assert.ok(byId(r, bat).drafted && byId(r, pit).drafted);
    // The default league has only generic P slots, so pitchers are listed as P there
    assert.equal(byId(V.analyze([bat, pit, ...league()], YEAR), pit).pos, 'P');
});

// ---- Newer categories (OBP, SLG, OPS, K, holds, K/9, ...) ----

const FULL_BAT = { pa: 600, ab: 540, hits: 140, doubles: 28, triples: 2, hr: 20, bb: 50, hbp: 5, sf: 5, so: 130, tb: 232, ops: 0.75 };
const fullBatter = (pos, stats) => batter(pos, { ...FULL_BAT, ...stats });
const fullLeague = () => league().map(p => {
    if (p.is_pitcher) Object.assign(p.stats_by_season[YEAR].pitching, { holds: 5, losses: 8 });
    else Object.assign(p.stats_by_season[YEAR].batting, FULL_BAT);
    return p;
});

test('OBP rewards walks; it is weighted by plate appearances', () => {
    const patient = fullBatter('1B', { bb: 100 });
    const hacker = fullBatter('1B', { bb: 15 });
    const sel = { selected: { bat: ['obp'], pit: ['era'] } };
    const r = V.analyze([patient, hacker, ...fullLeague()], YEAR, sel);
    assert.ok(byId(r, patient).z.obp > byId(r, hacker).z.obp);
});

test('batter strikeouts count against a player', () => {
    const contact = fullBatter('1B', { so: 60 });
    const whiffs = fullBatter('1B', { so: 200 });
    const r = V.analyze([contact, whiffs, ...fullLeague()], YEAR, { selected: { bat: ['so'], pit: ['era'] } });
    assert.ok(byId(r, contact).z.so > byId(r, whiffs).z.so);
});

test('SLG, OPS and total bases favor the slugger', () => {
    const slugger = fullBatter('1B', { tb: 330, ops: 0.95 });
    const slap = fullBatter('1B', { tb: 180, ops: 0.62 });
    const r = V.analyze([slugger, slap, ...fullLeague()], YEAR, { selected: { bat: ['slg', 'ops', 'tb'], pit: ['era'] } });
    for (const k of ['slg', 'ops', 'tb']) assert.ok(byId(r, slugger).z[k] > byId(r, slap).z[k], k);
});

test('SV+HLD credits setup men; K/9 is a rate weighted by innings', () => {
    const setup = pitcher('RP', { ip: 65, saves: 2, holds: 30, strikeouts: 80 });
    const mopup = pitcher('RP', { ip: 65, saves: 0, holds: 1, strikeouts: 50 });
    const r = V.analyze([setup, mopup, ...fullLeague()], YEAR, { selected: { bat: ['hr'], pit: ['svhd', 'k9'] } });
    assert.ok(byId(r, setup).z.svhd > byId(r, mopup).z.svhd);
    assert.ok(byId(r, setup).z.k9 > byId(r, mopup).z.k9);
});

test('losses count against a pitcher', () => {
    const a = pitcher('SP', { losses: 4 }), b = pitcher('SP', { losses: 15 });
    const r = V.analyze([a, b, ...fullLeague()], YEAR, { selected: { bat: ['hr'], pit: ['losses'] } });
    assert.ok(byId(r, a).z.losses > byId(r, b).z.losses);
});

test('a category is dropped when the data lacks the stats it needs', () => {
    // league() has no PA, walks or holds, as in older data
    const r = V.analyze(league(), YEAR, { selected: { bat: ['hr', 'obp', 'ops'], pit: ['wins', 'holds'] } });
    const b = r.rows.find(x => !x.isPitcher), p = r.rows.find(x => x.isPitcher);
    assert.deepEqual(Object.keys(b.z), ['hr']);
    assert.deepEqual(Object.keys(p.z), ['wins']);
    assert.ok(r.rows.every(x => Number.isFinite(x.raw)));
});

test('points format: drivers use the per-group Scoring Weights', () => {
    const players = league().map((p, i) => ({ ...p, points: 100 + i }));
    const r = V.analyze(players, YEAR, { format: 'points', pointWeights: { bat: { hr: 4 }, pit: { wins: 5 } } });
    const hr = r.categories.bat.find(c => c.key === 'hr');
    const runs = r.categories.bat.find(c => c.key === 'runs');
    assert.equal(hr.inLeague, true);
    assert.equal(runs.inLeague, false);
    assert.equal(r.categories.pit.find(c => c.key === 'wins').inLeague, true);
});

// ---- Board ordering and tiers ----

test('board is ranked 1..n by value, highest first', () => {
    const r = V.analyze(league(), YEAR);
    r.board.forEach((row, i) => {
        assert.equal(row.rank, i + 1);
        if (i) assert.ok(r.board[i - 1].vorp >= row.vorp);
    });
});

test('tiers start at 1, never go down the board, stay within the limit and hold 3+ players', () => {
    for (const tiers of [1, 5, 10]) {
        const r = V.analyze(league({ perPos: 10, pitchers: 80 }), YEAR, { tiers });
        assert.equal(r.board[0].tier, 1);
        const sizes = {};
        r.board.forEach((row, i) => {
            if (i) assert.ok(row.tier === r.board[i - 1].tier || row.tier === r.board[i - 1].tier + 1);
            sizes[row.tier] = (sizes[row.tier] || 0) + 1;
        });
        assert.ok(Object.keys(sizes).length <= tiers, `tiers=${tiers}`);
        assert.ok(Object.values(sizes).every(n => n >= 3), `tiers=${tiers}`);
    }
});

test('the biggest drop in value becomes a tier break', () => {
    // 6 stars, then a cliff, then 6 regulars, in a pool where only these 12 are drafted
    const stars = Array.from({ length: 6 }, (_, i) => batter('OF', {}, { points: 1000 - i }));
    const regs = Array.from({ length: 6 }, (_, i) => batter('OF', {}, { points: 500 - i }));
    const r = V.analyze([...stars, ...regs, batter('OF', {}, { points: 0 })], YEAR,
                        { format: 'points', teams: 1, tiers: 2, slots: { OF: 12, UTIL: 0, P: 0 } });
    assert.ok(stars.every(p => byId(r, p).tier === 1));
    assert.ok(regs.every(p => byId(r, p).tier === 2));
});

// ---- Edge cases ----

test('no players: empty result, no errors', () => {
    const r = V.analyze([], YEAR);
    assert.deepEqual(r.board, []);
    assert.equal(r.meta.candidates, 0);
});

test('fewer players than slots: everyone is drafted and values are finite', () => {
    const r = V.analyze([batter('1B', {}), pitcher('SP', {})], YEAR);
    assert.equal(r.board.length, 2);
    assert.ok(r.board.every(x => Number.isFinite(x.vorp)));
});

test('analyze does not change DEFAULT_SETTINGS', () => {
    const before = JSON.stringify(V.DEFAULT_SETTINGS);
    V.analyze(league(), YEAR, { teams: 8, slots: { C: 2 }, selected: { bat: ['hr'] }, catWeights: { hr: 3 } });
    assert.equal(JSON.stringify(V.DEFAULT_SETTINGS), before);
});

// ---- The real data file ----

const dataPath = path.join(__dirname, '..', 'data', 'players.json');
const metaPath = path.join(__dirname, '..', 'data', 'last_updated.json');

test('real data: every season and format runs cleanly', { skip: !fs.existsSync(dataPath) }, () => {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const players = JSON.parse(fs.readFileSync(dataPath, 'utf8')).map(p => {
        const sbs = {};
        for (const y in p.stats) sbs[y] = { batting: { ...p.stats[y] }, pitching: { ...p.stats[y] } };
        return { ...p, stats_by_season: sbs, points: (p.stats[String(meta.projection_year)] || {}).hr || 0 };
    });
    const years = [...meta.seasons, meta.projection_year].map(String);
    const starters = Object.values(V.DEFAULT_SETTINGS.slots).reduce((a, b) => a + b, 0) * V.DEFAULT_SETTINGS.teams;
    for (const year of years) {
        for (const format of ['roto', 'h2h', 'points']) {
            const r = V.analyze(players, year, { format });
            assert.equal(r.board.length, starters, `${year} ${format}`);
            assert.ok(r.rows.every(x => Number.isFinite(x.raw) && Number.isFinite(x.vorp)), `${year} ${format}`);
            assert.equal(new Set(r.board.map(x => String(x.id))).size, r.board.length, `duplicate ids ${year} ${format}`);
        }
    }
});

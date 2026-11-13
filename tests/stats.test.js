// Tests for static/stats.js. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../static/stats.js');

test('stat keys are unique within each group', () => {
    for (const g of ['bat', 'pit']) {
        const keys = S.groups[g].map(s => s.key);
        assert.equal(new Set(keys).size, keys.length, g);
    }
});

test('default weights keep the original scoring', () => {
    const w = S.defaultWeights();
    assert.deepEqual({ hits: w.bat.hits, runs: w.bat.runs, rbi: w.bat.rbi, steals: w.bat.steals, hr: w.bat.hr },
                     { hits: 1, runs: 1, rbi: 1, steals: 1, hr: 1 });
    assert.deepEqual({ wins: w.pit.wins, strikeouts: w.pit.strikeouts, saves: w.pit.saves },
                     { wins: 7, strikeouts: 1, saves: 3 });
    // Newly added stats start at 0 so existing rankings don't move
    for (const k of ['doubles', 'triples', 'tb', 'bb', 'so', 'cs', 'hbp']) assert.equal(w.bat[k], 0, k);
    for (const k of ['ip', 'losses', 'holds', 'walks', 'er', 'hits_allowed', 'hr_allowed', 'runs_scored']) assert.equal(w.pit[k], 0, k);
});

test('points: stat times weight, using only the player\'s own group', () => {
    const w = S.defaultWeights();
    w.bat.so = -1;
    const batter = { hits: 150, runs: 90, rbi: 80, steals: 10, hr: 25, so: 120, strikeouts: 999 };
    assert.equal(S.points(batter, 'bat', w), 150 + 90 + 80 + 10 + 25 - 120);
    w.pit.er = -2; w.pit.ip = 3;
    const pitcher = { wins: 12, strikeouts: 200, saves: 0, er: 60, ip: 180.3, hr: 999 };
    assert.equal(S.points(pitcher, 'pit', w), Math.round((12 * 7 + 200 - 120 + 3 * 180.3) * 100) / 100);
});

test('points: missing stats count as 0', () => {
    assert.equal(S.points({}, 'bat', S.defaultWeights()), 0);
    assert.equal(S.points(null, 'pit', S.defaultWeights()), 0);
});

test('columns: full set for one group, core stats of both in the All view', () => {
    const batCols = S.columns('batter');
    assert.ok(batCols.every(c => c.group === 'bat' && c.table !== false));
    assert.ok(batCols.some(c => c.key === 'ops'));
    assert.ok(!batCols.some(c => c.key === 'babip'));    // card only
    const all = S.columns('all');
    assert.deepEqual(all.map(c => c.key), ['runs', 'hr', 'rbi', 'steals', 'avg', 'wins', 'saves', 'strikeouts', 'era', 'whip']);
});

test('format: decimals, box-score averages, missing values', () => {
    const avg = S.bat.find(s => s.key === 'avg'), ops = S.bat.find(s => s.key === 'ops'), era = S.pit.find(s => s.key === 'era');
    assert.equal(S.format(0.2857, avg), '.286');
    assert.equal(S.format(1.014, ops), '1.014');
    assert.equal(S.format(3.1, era), '3.10');
    assert.equal(S.format(42, { dec: 0 }), '42');
    assert.equal(S.format(undefined, avg), '-');
    assert.equal(S.format('n/a', era), '-');
});

test('qualifies: rate-stat sorting needs 100 PA or 20 IP', () => {
    assert.equal(S.qualifies({ pa: 99 }, 'bat'), false);
    assert.equal(S.qualifies({ pa: 100 }, 'bat'), true);
    assert.equal(S.qualifies({ ab: 150 }, 'bat'), true);   // older data without PA
    assert.equal(S.qualifies({ ip: 16.7 }, 'pit'), false);
    assert.equal(S.qualifies({ ip: 20 }, 'pit'), true);
    assert.equal(S.qualifies(null, 'bat'), false);
});

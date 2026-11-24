// Tests for static/tiers.js. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../static/tiers.js');
const V = require('../static/valuation.js');

test('auto tiers split at the biggest drops, keeping tiers at least 2 players', () => {
    //            0   1   2   3   4   5   6   7
    const vals = [20, 19, 12, 11, 10, 4, 3, 2.5];
    assert.deepEqual(T.autoBreaks(vals, 3), [2, 5]);    // drops of 7 and 6
    assert.deepEqual(T.autoBreaks(vals, 1), []);
    // A huge drop after the first player can't make a 1-player tier
    assert.deepEqual(T.autoBreaks([50, 10, 9, 8, 7], 2), [2]);
});

test('default tier count is about one per 6 players, 2 to 8', () => {
    assert.equal(T.defaultCount(1), 1);
    assert.equal(T.defaultCount(6), 2);
    assert.equal(T.defaultCount(30), 5);
    assert.equal(T.defaultCount(100), 8);
});

const list = vals => vals.map((v, i) => ({ row: { id: 'p' + i }, v }));

test('applyTiers: automatic, a set count, and hand-set starts by player id', () => {
    const l = list([20, 19, 12, 11, 10, 4, 3, 2.5]);
    const auto3 = T.applyTiers(l, { count: 3 });
    assert.deepEqual(auto3.entries.map(e => e.tier), [1, 1, 2, 2, 2, 3, 3, 3]);
    assert.equal(auto3.manual, false);
    const two = T.applyTiers(l, { count: 2 });
    assert.equal(two.count, 2);
    const hand = T.applyTiers(l, { starts: ['p4', 'p7', 'gone'] });   // unknown ids are ignored
    assert.deepEqual(hand.entries.map(e => e.tier), [1, 1, 1, 1, 2, 2, 2, 3]);
    assert.equal(hand.manual, true);
});

test('toggleStart adds and removes a break, returning player ids', () => {
    const l = list([5, 4, 3, 2, 1]);
    assert.deepEqual(T.toggleStart(l, [2], 4), ['p2', 'p4']);
    assert.deepEqual(T.toggleStart(l, [2, 4], 2), ['p4']);
    assert.deepEqual(T.toggleStart(l, [2], 0), ['p2']);               // can't break before the first
});

test('position lists from a real analysis: eligibility, DH, pitcher roles, value order', () => {
    const p = (id, position, isPitcher, s) => ({ id, name: id, position, is_pitcher: isPitcher, stats_by_season: { 2027: isPitcher ? { pitching: s } : { batting: s } } });
    const bat = (hr, sb) => ({ ab: 500, pa: 560, hits: 140, hr, steals: sb, runs: 70 + hr, rbi: 60 + hr, bb: 50, tb: 220 });
    const pit = (k, sv) => ({ ip: sv ? 65 : 170, strikeouts: k, wins: sv ? 3 : 12, saves: sv, era: 3.5, hits_allowed: 140, walks: 50 });
    const players = [
        p('ss-2b', 'SS/2B', false, bat(30, 20)), p('ss', 'SS', false, bat(20, 10)), p('c', 'C', false, bat(18, 1)),
        p('dh', 'DH', false, bat(40, 0)), p('of', 'LF', false, bat(25, 25)), p('2b', '2B', false, bat(10, 5)),
        p('sp', 'SP', true, pit(220, 0)), p('rp', 'RP', true, pit(80, 35)), p('swing', 'P', true, pit(120, 2)),
    ];
    const result = V.analyze(players, 2027, { teams: 2, slots: { C: 1, '1B': 0, '2B': 1, '3B': 0, SS: 1, OF: 1, UTIL: 1, SP: 0, RP: 0, P: 2 } });
    const lists = T.positionLists(result);
    const ids = pos => lists[pos].map(e => e.row.id);
    assert.deepEqual(ids('SS'), ['ss-2b', 'ss']);
    assert.ok(ids('2B').includes('ss-2b') && ids('2B').includes('2b'));   // multi-position: both columns
    assert.deepEqual(ids('DH'), ['dh']);                                  // DH only, no fielders
    assert.deepEqual(ids('SP').sort(), ['sp', 'swing']);
    assert.deepEqual(ids('RP').sort(), ['rp', 'swing']);
    lists.SS.forEach((e, i) => { if (i) assert.ok(lists.SS[i - 1].v >= e.v); });
    // Two shortstops can't make two tiers of 2+ players; a hand-set break can
    assert.equal(T.applyTiers(lists.SS, { count: 2 }).count, 1);
    const idx = T.tierIndex({ SS: T.applyTiers(lists.SS, { starts: ['ss'] }), DH: T.applyTiers(lists.DH) });
    assert.deepEqual(idx['ss-2b'], { SS: 1 });
    assert.deepEqual(idx.ss, { SS: 2 });
    assert.deepEqual(idx.dh, { DH: 1 });
});

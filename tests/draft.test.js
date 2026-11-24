// Tests for static/draft.js. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../static/draft.js');
const V = require('../static/valuation.js');

test('snake picks reverse every other round', () => {
    assert.deepEqual(D.snakePicks(1, 12, 4), [1, 24, 25, 48]);
    assert.deepEqual(D.snakePicks(12, 12, 3), [12, 13, 36]);
    assert.deepEqual(D.snakePicks(5, 10, 3), [5, 16, 25]);
});

test('next pick counts the picks before yours', () => {
    assert.deepEqual(D.nextPick(5, 12, 0), { pick: 5, round: 1, away: 4 });
    assert.deepEqual(D.nextPick(5, 12, 4), { pick: 5, round: 1, away: 0 });  // on the clock
    assert.deepEqual(D.nextPick(5, 12, 5), { pick: 20, round: 2, away: 14 });
    assert.equal(D.nextPick(0, 12, 0), null);
    assert.equal(D.nextPick(13, 12, 0), null);
});

const row = (id, elig, vorp, extra = {}) => ({ id, elig, vorp, isPitcher: elig.includes('P'), s: {}, z: {}, ...extra });

test('roster fills the narrowest open slot, best players first', () => {
    const slots = { C: 1, SS: 1, OF: 2, UTIL: 1, P: 2 };
    const r = D.fillRoster([
        row('ss-of', ['SS', 'OF', 'UTIL'], 5),
        row('ss', ['SS', 'UTIL'], 4),
        row('of', ['OF', 'UTIL'], 3),
        row('of2', ['OF', 'UTIL'], 2),
        row('of3', ['OF', 'UTIL'], 1),
        row('p', ['SP', 'P'], 6),
    ], slots);
    const at = slot => r.lineup.filter(l => l.slot === slot).map(l => l.row && l.row.id);
    assert.deepEqual(at('SS'), ['ss-of']);
    assert.deepEqual(at('OF'), ['of', 'of2']);
    assert.deepEqual(at('UTIL'), ['ss']);
    assert.deepEqual(r.bench.map(b => b.id), ['of3']);
    assert.deepEqual(r.open, { C: 1, P: 1 });
    assert.ok(D.fitsOpen(row('c', ['C', 'UTIL'], 0), r.open));
    assert.ok(!D.fitsOpen(row('x', ['1B', 'UTIL'], 0), r.open));
});

test('inflation: cheap buys leave more money for the rest', () => {
    // 2 teams x $10 = $20 for 4 spots; pre-draft values add up to $20
    const board = [row('a', ['OF'], 0, { dollars: 9 }), row('b', ['OF'], 0, { dollars: 6 }),
        row('c', ['OF'], 0, { dollars: 4 }), row('d', ['OF'], 0, { dollars: 1 })];
    const byId = new Map(board.map(r => [r.id, r]));
    const settings = { teams: 2, budget: 10 };
    const none = D.inflation(board, [], byId, settings);
    assert.equal(none.factor, 1);
    assert.equal(none.price(board[1]), 6);
    // 'a' goes for $5 instead of $9: $15 left for 3 spots ($3 of floors), surplus 5+3+0 = 8
    const after = D.inflation(board, [{ id: 'a', price: 5 }], byId, settings);
    assert.equal(after.left, 15);
    assert.equal(after.spotsLeft, 3);
    assert.equal(after.factor, 12 / 8);
    assert.equal(after.price(board[1]), 1 + 5 * 1.5);
    // A pick with no price counts at its pre-draft value: no inflation
    assert.equal(D.inflation(board, [{ id: 'a' }], byId, settings).factor, 1);
});

test('my budget keeps $1 for every other open spot', () => {
    const byId = new Map([['a', { dollars: 30 }], ['b', { dollars: 12 }]]);
    const b = D.myBudget([{ id: 'a', mine: true, price: 40 }, { id: 'b', mine: false, price: 12 }], byId, { budget: 260 }, 23);
    assert.deepEqual(b, { spent: 40, left: 220, open: 22, maxBid: 199 });
});

test('team categories sum z-scores and project totals and rates', () => {
    const cats = [{ key: 'hr', label: 'HR', g: 'bat' }, { key: 'avg', label: 'AVG', g: 'bat' }, { key: 'era', label: 'ERA', g: 'pit' }];
    const rows = [
        row('a', ['OF'], 0, { s: { hr: 30, hits: 150, ab: 500 }, z: { hr: 1.5, avg: 0.5 } }),
        row('b', ['OF'], 0, { s: { hr: 10, hits: 120, ab: 500 }, z: { hr: -0.5, avg: -0.2 } }),
    ];
    const out = D.teamCategories(rows, cats, V.CATS);
    assert.equal(out[0].total, 40);
    assert.equal(out[0].z, 1);
    assert.equal(out[1].total, 0.27);
    assert.ok(Math.abs(out[1].z - 0.3) < 1e-9);
    assert.equal(out[2].total, null);  // no pitchers yet
    assert.equal(out[2].players, 0);
});

test('market by position compares prices with value, and prices what is left', () => {
    const board = [
        row('c1', ['C', 'UTIL'], 0, { pos: 'C', dollars: 20 }), row('c2', ['C', 'UTIL'], 0, { pos: 'C', dollars: 10 }),
        row('ss', ['SS', 'UTIL'], 0, { pos: 'SS', dollars: 30 }), row('p', ['SP', 'P'], 0, { pos: 'SP', dollars: 20 }),
    ];
    const byId = new Map(board.map(r => [r.id, r]));
    const picks = [{ id: 'c1', price: 30 }, { id: 'p', price: 10 }];
    const infl = D.inflation(board, picks, byId, { teams: 1, budget: 80 });
    const m = D.marketByPosition(picks, byId, board, infl);
    assert.deepEqual(m.map(x => x.pos), ['C', 'SS', 'SP']);  // the pitcher by role
    const c = m[0];
    assert.equal(c.bought, 1);
    assert.equal(c.paid, 30);
    assert.equal(c.premium, 0.5);                  // $30 for a $20 player
    assert.equal(c.left, 1);
    assert.equal(c.leftPrice, infl.price(board[1]));
    assert.equal(m[2].premium, -0.5);              // $10 for a $20 pitcher
    assert.equal(m[1].premium, null);              // nothing bought at SS
});

test('market by category splits prices by z-score share and prices units', () => {
    const cats = [{ key: 'hr', label: 'HR', g: 'bat' }, { key: 'steals', label: 'SB', g: 'bat' }, { key: 'avg', label: 'AVG', g: 'bat' }];
    const slugger = row('a', ['OF'], 0, { dollars: 20, s: { hr: 40, steals: 2, hits: 140, ab: 520 }, z: { hr: 3, steals: -1, avg: 1 } });
    const speed = row('b', ['OF'], 0, { dollars: 20, s: { hr: 5, steals: 40, hits: 150, ab: 520 }, z: { hr: -1, steals: 3, avg: 1 } });
    const board = [slugger, speed];
    const byId = new Map(board.map(r => [r.id, r]));
    const m = D.marketByCategory([{ id: 'a', price: 40 }], byId, board, cats, V.CATS);
    const [hr, sb, avg] = m;
    assert.equal(hr.paid, 30);                     // 3/4 of $40
    assert.equal(hr.value, 15);                    // 3/4 of $20
    assert.equal(hr.premium, 1);
    assert.equal(avg.paid, 10);
    assert.equal(sb.paid, 0);
    assert.equal(hr.perUnitPaid, 30 / 40);
    assert.equal(sb.perUnitPaid, 0);               // his 2 steals came free
    assert.equal(avg.perUnitPaid, null);           // rate stat: no per-unit cost
    // Still available: the speedster's 40 of 42 steals, 5 of 45 home runs
    assert.equal(sb.leftShare, 40 / 42);
    assert.equal(hr.leftShare, 5 / 45);
    assert.equal(avg.leftShare, null);
});

test('market positions group pitchers by role', () => {
    assert.equal(D.marketPos({ isPitcher: true, elig: ['SP', 'P'], pos: 'P' }), 'SP');
    assert.equal(D.marketPos({ isPitcher: true, elig: ['RP', 'P'], pos: 'P' }), 'RP');
    assert.equal(D.marketPos({ isPitcher: true, elig: ['SP', 'RP', 'P'], pos: 'P' }), 'P');
    assert.equal(D.marketPos({ isPitcher: false, elig: ['SS', 'UTIL'], pos: 'SS' }), 'SS');
});

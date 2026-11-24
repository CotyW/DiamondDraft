/**
 * Live draft tracking (pure functions, no DOM). The page records each pick as
 * { id, mine, price } in order; these functions work out what that means.
 *
 * Player values stay the pre-draft values from valuation.js, the usual approach for draft
 * tools: a player's worth doesn't change because someone else was taken. What changes is who
 * is left, how many are left in each tier and position, your roster, and in auctions the
 * money left, which inflates or deflates every remaining price (see inflation).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DDDraft = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const num = v => (v === null || v === undefined || v === '' || isNaN(v) ? 0 : Number(v));
    const sum = a => a.reduce((x, y) => x + y, 0);

    /** Overall pick numbers for draft slot `slot` (1-based) in a snake draft. */
    function snakePicks(slot, teams, rounds) {
        const out = [];
        for (let round = 1; round <= rounds; round++) {
            out.push(round % 2 ? (round - 1) * teams + slot : round * teams - slot + 1);
        }
        return out;
    }

    /**
     * Your next pick in a snake draft after `made` picks in total, as
     * { pick, round, away } (away = picks before yours; 0 = you're on the clock), or null.
     */
    function nextPick(slot, teams, made, rounds = 60) {
        if (!(slot >= 1 && slot <= teams)) return null;
        const pick = snakePicks(slot, teams, rounds).find(p => p > made);
        if (!pick) return null;
        return { pick, round: Math.ceil(pick / teams), away: pick - made - 1 };
    }

    // Same order as valuation.allocate: narrow slots first, so flexible ones take what is left
    const FILL_ORDER = ['C', 'SS', '2B', '3B', '1B', 'OF', 'SP', 'RP', 'UTIL', 'P'];

    /**
     * Put your players (valuation rows, each with elig and vorp) into lineup slots: best value
     * first, narrowest open slot that fits. Returns { lineup: [{slot, row|null}], bench, open }
     * where open is {slot: count still empty}.
     */
    function fillRoster(rows, slots) {
        const lineup = [];
        FILL_ORDER.forEach(slot => {
            for (let i = 0; i < (slots[slot] || 0); i++) lineup.push({ slot, row: null });
        });
        const bench = [];
        [...rows].sort((a, b) => num(b.vorp) - num(a.vorp)).forEach(r => {
            const spot = lineup.find(l => !l.row && r.elig.includes(l.slot));
            if (spot) spot.row = r;
            else bench.push(r);
        });
        const open = {};
        lineup.filter(l => !l.row).forEach(l => { open[l.slot] = (open[l.slot] || 0) + 1; });
        return { lineup, bench, open };
    }

    /** True if the row could fill one of the open slots. */
    function fitsOpen(row, open) {
        return row.elig.some(slot => open[slot] > 0);
    }

    /**
     * Auction inflation. Prices so far take money and roster spots out of the league; the money
     * left, minus $1 for every spot still to fill, is spread over the surplus value (dollars
     * above $1) of the best remaining players, the ones expected to fill those spots. A factor
     * above 1 means teams have more money than the remaining talent is worth on paper, so
     * prices run higher. Picks without a price count at the player's pre-draft value.
     *
     * board: valuation board rows (with dollars). picks: [{id, mine, price}]. byId: Map of
     * every row by id (picked players may be off the board). Returns { total, spent, left,
     * spotsLeft, factor, price(row) }.
     */
    function inflation(board, picks, byId, settings) {
        const total = num(settings.teams) * num(settings.budget);
        const picked = new Set(picks.map(p => String(p.id)));
        const paid = p => (p.price !== null && p.price !== undefined && p.price !== ''
            ? num(p.price) : Math.max(1, num((byId.get(String(p.id)) || {}).dollars) || 1));
        const spent = sum(picks.map(paid));
        const spotsLeft = Math.max(0, board.length - picks.length);
        const expected = board.filter(r => !picked.has(String(r.id)))
            .sort((a, b) => num(b.dollars) - num(a.dollars)).slice(0, spotsLeft);
        const surplus = sum(expected.map(r => Math.max(0, num(r.dollars) - 1)));
        const left = total - spent;
        const factor = surplus > 0 ? Math.max(0, (left - spotsLeft) / surplus) : 1;
        return {
            total, spent, left, spotsLeft, factor,
            price: r => 1 + Math.max(0, num(r.dollars) - 1) * factor
        };
    }

    /**
     * Your money: { spent, left, open, maxBid }. open = roster spots still to fill (starters);
     * the max bid leaves $1 for each of the others.
     */
    function myBudget(picks, byId, settings, starters) {
        const mine = picks.filter(p => p.mine);
        const spent = sum(mine.map(p => (p.price !== null && p.price !== undefined && p.price !== ''
            ? num(p.price) : Math.max(1, Math.round(num((byId.get(String(p.id)) || {}).dollars)) || 1))));
        const left = num(settings.budget) - spent;
        const open = Math.max(0, starters - mine.length);
        return { spent, left, open, maxBid: open ? Math.max(0, left - (open - 1)) : 0 };
    }

    /**
     * Your team's strength per category: the sum of your players' z-scores. The average drafted
     * player scores 0, so above 0 means ahead of an average team with the same number of
     * players, below 0 behind. Also returns the team's projected total (counting stats) or
     * rate. cats: [{key, label, g}] in the league; defs: valuation CATS.
     */
    function teamCategories(rows, cats, defs) {
        return cats.map(c => {
            const def = defs[c.g][c.key];
            const group = rows.filter(r => (c.g === 'pit') === r.isPitcher);
            let total = null;
            if (def && group.length) {
                if (def.rate) {
                    const den = sum(group.map(r => def.den(r.s)));
                    total = den ? sum(group.map(r => def.num(r.s))) / den : null;
                } else {
                    total = sum(group.map(r => def.get(r.s)));
                }
            }
            return { ...c, rate: !!(def && def.rate), total, z: sum(group.map(r => num(r.z[c.key]))), players: group.length };
        });
    }

    const priceOf = (p, row) => (p.price !== null && p.price !== undefined && p.price !== ''
        ? num(p.price) : Math.max(1, num(row && row.dollars) || 1));
    const valueOf = row => Math.max(1, num(row && row.dollars) || 1);  // off the board = a $1 player
    const premium = (paid, value) => (value > 0 ? paid / value - 1 : null);

    // Position for the market table: a batter's value position; a pitcher's role (SP, RP, or P
    // for swingmen), since leagues with generic P slots count every pitcher's value at P
    function marketPos(row) {
        if (!row) return '?';
        if (!row.isPitcher) return row.pos;
        const sp = row.elig.includes('SP'), rp = row.elig.includes('RP');
        return sp && !rp ? 'SP' : rp && !sp ? 'RP' : 'P';
    }

    /**
     * Auction market by position: for players bought so far at each position (where their value
     * counts), the price paid against their pre-draft value, and what is left there on the
     * board at current prices. premium = paid / value - 1 (+0.2 = the room pays 20% over value).
     * Returns rows in position order, only positions with something bought or left.
     */
    function marketByPosition(picks, byId, board, infl) {
        const picked = new Set(picks.map(p => String(p.id)));
        const out = {};
        const at = pos => (out[pos] = out[pos] || { pos, bought: 0, paid: 0, value: 0, left: 0, leftPrice: 0 });
        picks.forEach(p => {
            const row = byId.get(String(p.id));
            const o = at(marketPos(row));
            o.bought++;
            o.paid += priceOf(p, row);
            o.value += valueOf(row);
        });
        board.filter(r => !picked.has(String(r.id))).forEach(r => {
            const o = at(marketPos(r));
            o.left++;
            o.leftPrice += infl ? infl.price(r) : valueOf(r);
        });
        const order = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP', 'P', '?'];
        return order.filter(pos => out[pos]).map(pos => ({ ...out[pos], premium: premium(out[pos].paid, out[pos].value) }));
    }

    /**
     * Auction market by category. Each player's dollars are split across the league's
     * categories in proportion to his positive z-scores there (times the category weight), so a
     * $30 player whose value is two-thirds steals puts $20 into SB. For players bought so far
     * this gives dollars paid and pre-draft value per category. For counting stats it also
     * gives the dollars per unit (per HR, per SB) paid so far, and the share of the category's
     * units (the board's plus any bought off it) still on the board: a category running out
     * faster than the others is getting scarce. cats: [{key, label, g, weight}]; defs: CATS.
     */
    function marketByCategory(picks, byId, board, cats, defs) {
        const share = row => {
            const parts = cats.map(c => ((c.g === 'pit') === row.isPitcher ? Math.max(0, num(row.z[c.key]) * num(c.weight === undefined ? 1 : c.weight)) : 0));
            const total = sum(parts);
            return total > 0 ? parts.map(x => x / total) : null;
        };
        const units = (c, row) => {
            const def = defs[c.g] && defs[c.g][c.key];
            return def && !def.rate && (c.g === 'pit') === row.isPitcher ? num(def.get(row.s)) : 0;
        };
        const res = cats.map(c => {
            const def = defs[c.g] && defs[c.g][c.key];
            return { ...c, rate: !!(def && def.rate), dir: (def && def.dir) || 1, paid: 0, value: 0, unitsBought: 0, unitsLeft: 0 };
        });
        const picked = new Set(picks.map(p => String(p.id)));
        picks.forEach(p => {
            const row = byId.get(String(p.id));
            if (!row) return;
            const sh = share(row);
            if (!sh) return;
            const paid = priceOf(p, row), value = valueOf(row);
            res.forEach((o, i) => {
                o.paid += paid * sh[i];
                o.value += value * sh[i];
                o.unitsBought += units(o, row);
            });
        });
        board.filter(r => !picked.has(String(r.id))).forEach(r => {
            res.forEach(o => { o.unitsLeft += units(o, r); });
        });
        // Cost per unit: dollars put into the category over every unit bought (a slugger's few
        // steals came free, and count). Only for counting stats where more is better.
        return res.map(o => ({
            ...o,
            premium: premium(o.paid, o.value),
            perUnitPaid: !o.rate && o.dir > 0 && o.unitsBought ? o.paid / o.unitsBought : null,
            leftShare: !o.rate && o.dir > 0 && o.unitsBought + o.unitsLeft
                ? o.unitsLeft / (o.unitsBought + o.unitsLeft) : null
        }));
    }

    return { snakePicks, nextPick, fillRoster, fitsOpen, inflation, myBudget, teamCategories,
        marketByPosition, marketByCategory, marketPos, FILL_ORDER };
});

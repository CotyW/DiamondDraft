/**
 * Position tiers (pure functions, no DOM): each position's players, best first, split into
 * tiers. A position's tiers are automatic (split at the biggest drops in value, as many tiers
 * as asked for) or set by hand (tiers start at chosen players, saved by player id so they
 * survive value changes). The Position Tiers tab, the Draft Board and the Live Draft tab all
 * read tiers from here.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DDTiers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'];
    const MIN_TIER_SIZE = 2;

    /**
     * Where tiers start (indexes, never 0) in values sorted best first: the count - 1 biggest
     * drops between neighbours, keeping every tier at least minSize players.
     */
    function autoBreaks(values, count, minSize = MIN_TIER_SIZE) {
        const n = values.length;
        const gaps = [];
        for (let i = 0; i < n - 1; i++) gaps.push({ at: i + 1, g: values[i] - values[i + 1] });
        gaps.sort((a, b) => b.g - a.g || a.at - b.at);
        const starts = [];
        for (const { at } of gaps) {
            if (starts.length >= count - 1) break;
            if (at < minSize || n - at < minSize) continue;
            if (starts.every(s => Math.abs(s - at) >= minSize)) starts.push(at);
        }
        return starts.sort((a, b) => a - b);
    }

    /** The automatic tier count for a list of n players: about one tier per 6, 2 to 8. */
    function defaultCount(n) {
        return Math.max(1, Math.min(8, Math.max(2, Math.round(n / 6)), n));
    }

    // The column a pitcher belongs in: SP or RP by role; a swingman (both) shows in both
    function pitcherColumns(row) {
        const sp = row.elig.includes('SP'), rp = row.elig.includes('RP');
        return sp && rp ? ['SP', 'RP'] : sp ? ['SP'] : rp ? ['RP'] : ['SP', 'RP'];
    }

    /**
     * Players per position, best first, from a valuation result (rows with elig, raw, vorp;
     * meta.replacement per slot). Batters appear at every position they're eligible for; DH
     * lists batters with no fielding position. Value at a position is raw value minus that
     * slot's replacement level (the generic P slot's for pitchers when SP/RP have none), or
     * the player's own value when there is no replacement level. Each list keeps the players
     * worth drafting there: twice the league's starters at the position, at least 2 per team.
     */
    function positionLists(result) {
        const s = result.settings;
        const rep = result.meta.replacement || {};
        const teams = s.teams || 12;
        const starters = pos => {
            const slots = s.slots || {};
            if (pos === 'SP' || pos === 'RP') {
                const own = slots[pos] || 0;
                return teams * (own + (slots.P || 0) * (pos === 'SP' ? 0.6 : 0.4));
            }
            if (pos === 'DH') return teams * (slots.UTIL || 0);
            return teams * (slots[pos] || 0);
        };
        const lists = {};
        POSITIONS.forEach(pos => { lists[pos] = []; });
        result.rows.forEach(r => {
            const cols = r.isPitcher ? pitcherColumns(r)
                : (r.elig.filter(e => e !== 'UTIL').length ? r.elig.filter(e => e !== 'UTIL' && lists[e]) : ['DH']);
            cols.forEach(pos => {
                const slot = pos === 'DH' ? 'UTIL' : pos;
                const base = rep[slot] !== undefined ? rep[slot] : r.isPitcher && rep.P !== undefined ? rep.P : null;
                lists[pos].push({ row: r, v: base === null ? r.vorp : r.raw - base });
            });
        });
        Object.keys(lists).forEach(pos => {
            const limit = Math.max(teams * 2, Math.ceil(starters(pos) * 2));
            lists[pos] = lists[pos].sort((a, b) => b.v - a.v).slice(0, limit);
        });
        return lists;
    }

    /**
     * Tier each entry of a position list (sorted best first). custom: { count } for automatic
     * tiers with that many tiers, { starts: [playerId] } for tiers set by hand, or nothing for
     * the default. Returns { entries: [{row, v, tier}], starts: [index], count, manual }.
     */
    function applyTiers(list, custom) {
        const c = custom || {};
        let starts;
        let manual = false;
        if (Array.isArray(c.starts)) {
            const want = new Set(c.starts.map(String));
            starts = list.map((e, i) => (i > 0 && want.has(String(e.row.id)) ? i : -1)).filter(i => i > 0);
            manual = true;
        } else {
            const count = c.count || defaultCount(list.length);
            starts = autoBreaks(list.map(e => e.v), count);
        }
        let tier = 1, k = 0;
        const entries = list.map((e, i) => {
            if (k < starts.length && i === starts[k]) { tier++; k++; }
            return { ...e, tier };
        });
        return { entries, starts, count: starts.length + 1, manual };
    }

    /** Hand-set tier starts with a break added at index i (or removed, if one is there). */
    function toggleStart(list, starts, i) {
        if (i <= 0 || i >= list.length) return starts.map(j => String(list[j].row.id));
        const set = new Set(starts);
        if (set.has(i)) set.delete(i); else set.add(i);
        return [...set].sort((a, b) => a - b).map(j => String(list[j].row.id));
    }

    /**
     * { playerId: {pos, tier} } for every list, so other views can show a player's tier at the
     * position his value counts at (pitchers at their role).
     */
    function tierIndex(tiered) {
        const out = {};
        Object.keys(tiered).forEach(pos => {
            tiered[pos].entries.forEach(e => {
                const id = String(e.row.id);
                (out[id] = out[id] || {})[pos] = e.tier;
            });
        });
        return out;
    }

    return { POSITIONS, autoBreaks, defaultCount, positionLists, applyTiers, toggleStart, tierIndex, pitcherColumns };
});

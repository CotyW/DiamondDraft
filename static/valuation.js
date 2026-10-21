/**
 * Draft valuation engine (pure functions, no DOM).
 *
 * Formats:
 *  - roto:   every selected category counts equally (z-score per category, summed)
 *  - h2h:    same as roto but each category has a user weight (use 0 to punt)
 *  - points: uses the Points already computed by the page from the scoring weights
 *
 * Value = raw value minus the raw value of the best undrafted ("replacement") player at that
 * position, so a scarce position gets credit for what it saves you versus a waiver pickup.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DDValuation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const num = v => (v === null || v === undefined || v === '' || isNaN(v) ? 0 : Number(v));

    const BAT_CATS = {
        runs:   { label: 'Runs',  get: s => s.runs,   pointKey: 'runs' },
        hr:     { label: 'HR',    get: s => s.hr,     pointKey: 'hr' },
        rbi:    { label: 'RBI',   get: s => s.rbi,    pointKey: 'rbi' },
        steals: { label: 'SB',    get: s => s.steals, pointKey: 'steals' },
        hits:   { label: 'Hits',  get: s => s.hits,   pointKey: 'hits' },
        avg:    { label: 'AVG',   rate: true, num: s => s.hits, den: s => s.ab }
    };
    const PIT_CATS = {
        wins:        { label: 'Wins',  get: s => s.wins,        pointKey: 'wins' },
        saves:       { label: 'Saves', get: s => s.saves,       pointKey: 'saves' },
        strikeouts:  { label: 'K',     get: s => s.strikeouts,  pointKey: 'strikeouts' },
        era:         { label: 'ERA',   rate: true, dir: -1, num: s => s.era * s.ip / 9, den: s => s.ip / 9 },
        whip:        { label: 'WHIP',  rate: true, dir: -1, num: s => s.hits_allowed + s.walks, den: s => s.ip },
        walks:       { label: 'BB',    get: s => s.walks,       dir: -1, pointKey: 'walks' },
        runs_scored: { label: 'Runs allowed', get: s => s.runs_scored, dir: -1, pointKey: 'runs_scored' }
    };
    const CATS = { bat: BAT_CATS, pit: PIT_CATS };

    const DEFAULT_SETTINGS = {
        format: 'roto',
        teams: 12,
        slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 0, RP: 0, P: 9 },
        selected: {
            bat: ['runs', 'hr', 'rbi', 'steals', 'avg'],
            pit: ['wins', 'saves', 'strikeouts', 'era', 'whip']
        },
        catWeights: {},      // h2h: category key -> weight (default 1)
        pointWeights: {},    // points: scoring input id -> weight (used for the driver column)
        tiers: 10,
        minAB: 100,
        minIP: 20
    };

    const FIELD_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'OF'];
    const ALL_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL', 'SP', 'RP', 'P'];
    const DISPLAY = { UTIL: 'DH' };

    // Lineup slots a player can fill. A "2B/SS" player fills either; every batter can fill UTIL
    // and every pitcher can fill the generic P slot. A plain "P" (role unknown) counts as SP or RP.
    function eligibleSlots(position, isPitcher) {
        const tokens = String(position || '').toUpperCase().split(/[\s,/|-]+/).filter(Boolean);
        const out = new Set();
        if (isPitcher) {
            tokens.forEach(t => { if (t === 'SP' || t === 'RP') out.add(t); });
            if (!out.size) { out.add('SP'); out.add('RP'); }
            out.add('P');
        } else {
            tokens.forEach(t => {
                if (['LF', 'CF', 'RF', 'OF'].includes(t)) out.add('OF');
                else if (FIELD_SLOTS.includes(t)) out.add(t);
            });
            out.add('UTIL');
        }
        return Array.from(out);
    }

    function normalizePosition(pos, isPitcher) {
        const slots = eligibleSlots(pos, isPitcher);
        const first = slots.find(s => s !== 'UTIL' && s !== 'P') || slots[0];
        return DISPLAY[first] || first;
    }

    function readStats(player, year, isPitcher) {
        const season = player.stats_by_season && player.stats_by_season[year];
        const raw = season && (isPitcher ? season.pitching : season.batting);
        if (!raw) return null;
        const s = {};
        Object.keys(raw).forEach(k => { s[k] = num(raw[k]); });
        if (isPitcher) {
            s.ip = num(raw.ip ?? raw.innings_pitched);
            s.hits_allowed = num(raw.hits_allowed);
        } else {
            s.ab = num(raw.ab ?? raw.at_bats);
        }
        return s;
    }

    function buildCandidates(players, year, settings) {
        const rows = [];
        players.forEach(player => {
            const isPitcher = !!player.is_pitcher;
            const s = readStats(player, year, isPitcher);
            if (!s) return;
            const qualifies = isPitcher
                ? (s.ip ? s.ip >= settings.minIP : s.strikeouts >= 25)
                : (s.ab ? s.ab >= settings.minAB : s.hits >= settings.minAB / 4);
            if (!qualifies) return;
            rows.push({
                player, id: player.id, name: player.name, team: player.team,
                position: player.position, pos: normalizePosition(player.position, isPitcher),
                elig: eligibleSlots(player.position, isPitcher),
                isPitcher, s, z: {}, raw: 0, vorp: 0, tier: null, posTier: null
            });
        });
        return rows;
    }

    const sum = a => a.reduce((x, y) => x + y, 0);
    const mean = a => (a.length ? sum(a) / a.length : 0);
    function sd(a) {
        if (a.length < 2) return 0;
        const m = mean(a);
        return Math.sqrt(mean(a.map(x => (x - m) * (x - m))));
    }
    function correlation(x, y) {
        const sx = sd(x), sy = sd(y);
        if (!sx || !sy) return 0;
        const mx = mean(x), my = mean(y);
        return mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (sx * sy);
    }

    function activeCategories(group, rows, settings) {
        const defs = CATS[group];
        let keys = settings.selected[group].filter(k => defs[k]);
        if (!rows.length) return keys;
        // WHIP needs hits allowed, which Supabase data may not have
        if (group === 'pit' && !rows.some(r => r.s.hits_allowed > 0)) keys = keys.filter(k => k !== 'whip');
        return keys;
    }

    // Per-row contribution to a category, measured against the pool's rate for rate stats
    function contributions(rows, pool, group, key) {
        const def = CATS[group][key];
        const dir = def.dir || 1;
        if (def.rate) {
            const den = sum(pool.map(r => def.den(r.s)));
            const poolRate = den ? sum(pool.map(r => def.num(r.s))) / den : 0;
            return rows.map(r => dir * (def.num(r.s) - poolRate * def.den(r.s)));
        }
        return rows.map(r => dir * def.get(r.s));
    }

    function scoreRoto(rows, pools, settings) {
        ['bat', 'pit'].forEach(group => {
            const groupRows = rows.filter(r => (group === 'pit') === r.isPitcher);
            const pool = pools[group] || groupRows;
            groupRows.forEach(r => { r.z = {}; r.raw = 0; });
            activeCategories(group, groupRows, settings).forEach(key => {
                const weight = settings.format === 'h2h' ? num(settings.catWeights[key] ?? 1) : 1;
                const poolVals = contributions(pool, pool, group, key);
                const m = mean(poolVals), s = sd(poolVals) || 1;
                const vals = contributions(groupRows, pool, group, key);
                groupRows.forEach((r, i) => {
                    r.z[key] = (vals[i] - m) / s;
                    r.raw += weight * r.z[key];
                });
            });
        });
    }

    function allocate(rows, settings) {
        const { teams, slots } = settings;
        const sorted = [...rows].sort((a, b) => b.raw - a.raw);
        const drafted = new Set();
        // Scarce, narrowly-eligible slots fill first so flexible slots (UTIL, P) take what is left
        const order = ['C', 'SS', '2B', '3B', '1B', 'OF', 'SP', 'RP', 'UTIL', 'P'];
        order.forEach(slot => {
            const n = (slots[slot] || 0) * teams;
            if (!n) return;
            sorted.filter(r => !drafted.has(r) && r.elig.includes(slot)).slice(0, n).forEach(r => drafted.add(r));
        });

        // Replacement level per slot: best undrafted player eligible there
        const replacement = {};
        ALL_SLOTS.filter(slot => (slots[slot] || 0) > 0).forEach(slot => {
            const eligible = sorted.filter(r => r.elig.includes(slot));
            const undrafted = eligible.filter(r => !drafted.has(r));
            replacement[slot] = undrafted.length ? undrafted[0].raw
                : (eligible.length ? eligible[eligible.length - 1].raw : 0);
        });
        return { drafted, replacement };
    }

    function assignTiers(sortedDesc, tierCount, minSize, field) {
        const n = sortedDesc.length;
        if (n === 0) return;
        const gaps = [];
        for (let i = 0; i < n - 1; i++) gaps.push({ i, g: sortedDesc[i].vorp - sortedDesc[i + 1].vorp });
        gaps.sort((a, b) => b.g - a.g);
        const cuts = [];
        for (const { i } of gaps) {
            if (cuts.length >= tierCount - 1) break;
            if (i + 1 < minSize || n - (i + 1) < minSize) continue;
            if (cuts.every(c => Math.abs(c - i) >= minSize)) cuts.push(i);
        }
        cuts.sort((a, b) => a - b);
        let tier = 1, ci = 0;
        sortedDesc.forEach((row, idx) => {
            row[field] = tier;
            if (ci < cuts.length && idx === cuts[ci]) { tier++; ci++; }
        });
    }

    function categoryLabel(def, cv) {
        if (def.rate) return 'Rate';
        if (cv >= 0.8) return 'Scarce';
        if (cv >= 0.4) return 'Moderate';
        return 'Deep';
    }

    function analyzeCategories(rows, pool, group, settings, allCandidates) {
        const defs = CATS[group];
        const groupPool = pool.filter(r => (group === 'pit') === r.isPitcher);
        const groupAll = allCandidates.filter(r => (group === 'pit') === r.isPitcher);
        const selected = new Set(activeCategories(group, groupAll, settings));
        const isPoints = settings.format === 'points';
        const out = [];
        const contribByKey = {};

        Object.keys(defs).forEach(key => {
            const def = defs[key];
            if (isPoints && !def.pointKey) return;
            if (!groupPool.length) return;
            const dir = def.dir || 1;
            const values = def.rate
                ? groupPool.map(r => def.den(r.s) ? def.num(r.s) / def.den(r.s) : 0)
                : groupPool.map(r => def.get(r.s));
            const oriented = values.map(v => dir * v).sort((a, b) => b - a);
            const m = mean(values), s = sd(values);
            const median = oriented[Math.floor(oriented.length / 2)];
            const cv = !def.rate && m ? s / Math.abs(m) : null;
            const total = sum(values.filter(v => v > 0));
            const top20 = [...values].sort((a, b) => b - a).slice(0, Math.max(1, Math.round(values.length * 0.2)));
            const concentration = !def.rate && dir > 0 && total ? sum(top20) / total : null;
            const topGap = s ? (oriented[Math.min(11, oriented.length - 1)] - median) / s : 0;

            let contrib;
            if (isPoints) {
                const w = num(settings.pointWeights[def.pointKey]);
                contrib = groupPool.map(r => w * def.get(r.s));
                if (!w) contrib = null;
            } else if (selected.has(key)) {
                const w = settings.format === 'h2h' ? num(settings.catWeights[key] ?? 1) : 1;
                contrib = groupPool.map(r => w * (r.z[key] || 0));
            } else {
                contrib = null;
            }
            const driver = contrib && sd(contrib) ? correlation(contrib, groupPool.map(r => r.raw)) : null;
            if (contrib) contribByKey[key] = contrib;

            out.push({
                key, label: def.label, rate: !!def.rate, inLeague: isPoints ? !!contrib : selected.has(key),
                mean: m, sd: s, cv, topGap, concentration, driver,
                label2: categoryLabel(def, cv)
            });
        });

        const keys = Object.keys(contribByKey);
        const matrix = keys.map(a => keys.map(b => correlation(contribByKey[a], contribByKey[b])));
        return { categories: out, correlations: { keys: keys.map(k => defs[k].label), matrix } };
    }

    function analyzePositions(rows, drafted, settings, replacement) {
        const res = [];
        ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P'].forEach(pos => {
            if (!(settings.slots[pos] > 0) || replacement[pos] === undefined) return;
            // Value at this slot, for everyone eligible there (multi-position players count at each)
            const list = rows.filter(r => r.elig.includes(pos))
                .map(r => ({ r, v: r.raw - replacement[pos] })).sort((a, b) => b.v - a.v);
            const starters = settings.slots[pos] * settings.teams;
            if (!list.length) return;
            const last = list[Math.min(starters, list.length) - 1] || list[list.length - 1];
            res.push({
                pos, starters,
                best: list[0].v,
                topN: mean(list.slice(0, settings.teams).map(x => x.v)),
                lastStarter: last.v,
                spread: list[0].v - last.v,
                drafted: list.filter(x => drafted.has(x.r)).length
            });
        });
        return res.sort((a, b) => b.spread - a.spread);
    }

    function analyze(players, year, userSettings) {
        const settings = Object.assign({}, DEFAULT_SETTINGS, userSettings || {});
        settings.slots = Object.assign({}, DEFAULT_SETTINGS.slots, (userSettings || {}).slots);
        settings.selected = Object.assign({}, DEFAULT_SETTINGS.selected, (userSettings || {}).selected);
        const rows = buildCandidates(players, year, settings);
        const isPoints = settings.format === 'points';

        let alloc;
        if (isPoints) {
            rows.forEach(r => { r.raw = num(r.player.points); });
            alloc = allocate(rows, settings);
        } else {
            let pools = {};
            scoreRoto(rows, pools, settings);
            alloc = allocate(rows, settings);
            for (let i = 0; i < 3; i++) {
                pools = {
                    bat: rows.filter(r => !r.isPitcher && alloc.drafted.has(r)),
                    pit: rows.filter(r => r.isPitcher && alloc.drafted.has(r))
                };
                scoreRoto(rows, pools, settings);
                alloc = allocate(rows, settings);
            }
        }

        // A player's value is measured at the slot where it is highest among those they're eligible for
        rows.forEach(r => {
            let best = null;
            r.elig.forEach(slot => {
                if (alloc.replacement[slot] === undefined) return;
                const v = r.raw - alloc.replacement[slot];
                if (best === null || v > best.v) best = { v, slot };
            });
            r.vorp = best ? best.v : r.raw;
            r.slot = best ? best.slot : null;
            r.pos = best ? (DISPLAY[best.slot] || best.slot) : normalizePosition(r.position, r.isPitcher);
            r.drafted = alloc.drafted.has(r);
        });
        const board = rows.filter(r => r.drafted).sort((a, b) => b.vorp - a.vorp);
        board.forEach((r, i) => { r.rank = i + 1; });
        assignTiers(board, settings.tiers, 3, 'tier');
        ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP', 'P'].forEach(pos => {
            const list = board.filter(r => r.pos === pos);
            assignTiers(list, Math.max(1, Math.min(5, Math.floor(list.length / 4))), 2, 'posTier');
        });

        const pool = board;
        const bat = analyzeCategories(rows, pool, 'bat', settings, rows);
        const pit = analyzeCategories(rows, pool, 'pit', settings, rows);

        return {
            settings, rows, board,
            categories: { bat: bat.categories, pit: pit.categories },
            correlations: { bat: bat.correlations, pit: pit.correlations },
            positions: analyzePositions(rows, alloc.drafted, settings, alloc.replacement),
            meta: { candidates: rows.length, drafted: board.length, replacement: alloc.replacement }
        };
    }

    return { analyze, DEFAULT_SETTINGS, CATS, normalizePosition, eligibleSlots };
});

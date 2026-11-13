/**
 * The one list of stats the page knows about. The rankings table, player card, comparison view
 * and Scoring Weights inputs are all built from it, so adding a stat here adds it everywhere.
 * The keys match data/players.json (written by fetch_data.py / projections.py).
 *
 *  key     data key                       label   short column header
 *  name    longer label (card, inputs)    dec     decimal places
 *  lower   lower is better (ERA, K, ...)  core    shown in the "All Players" view
 *  table   false = card only, no column   points  default Scoring Weight; omit if not scorable
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DDStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const bat = [
        { key: 'pa',      label: 'PA',    name: 'Plate Appearances', dec: 0 },
        { key: 'runs',    label: 'R',     name: 'Runs',              dec: 0, core: true, points: 1 },
        { key: 'hr',      label: 'HR',    name: 'Home Runs',         dec: 0, core: true, points: 1 },
        { key: 'rbi',     label: 'RBI',   name: 'RBI',               dec: 0, core: true, points: 1 },
        { key: 'steals',  label: 'SB',    name: 'Stolen Bases',      dec: 0, core: true, points: 1 },
        { key: 'avg',     label: 'AVG',   name: 'Average',           dec: 3, core: true },
        { key: 'obp',     label: 'OBP',   name: 'On-Base Pct',       dec: 3 },
        { key: 'slg',     label: 'SLG',   name: 'Slugging Pct',      dec: 3 },
        { key: 'ops',     label: 'OPS',   name: 'OPS',               dec: 3 },
        { key: 'hits',    label: 'H',     name: 'Hits',              dec: 0, points: 1 },
        { key: 'doubles', label: '2B',    name: 'Doubles',           dec: 0, points: 0, table: false },
        { key: 'triples', label: '3B',    name: 'Triples',           dec: 0, points: 0, table: false },
        { key: 'tb',      label: 'TB',    name: 'Total Bases',       dec: 0, points: 0, table: false },
        { key: 'bb',      label: 'BB',    name: 'Walks',             dec: 0, points: 0 },
        { key: 'so',      label: 'K',     name: 'Strikeouts',        dec: 0, points: 0, lower: true },
        { key: 'cs',      label: 'CS',    name: 'Caught Stealing',   dec: 0, points: 0, lower: true, table: false },
        { key: 'hbp',     label: 'HBP',   name: 'Hit by Pitch',      dec: 0, points: 0, table: false },
        { key: 'babip',   label: 'BABIP', name: 'BABIP',             dec: 3, table: false }
    ];

    const pit = [
        { key: 'ip',           label: 'IP',   name: 'Innings',           dec: 1, points: 0 },
        { key: 'wins',         label: 'W',    name: 'Wins',              dec: 0, core: true, points: 7 },
        { key: 'losses',       label: 'L',    name: 'Losses',            dec: 0, points: 0, lower: true },
        { key: 'saves',        label: 'SV',   name: 'Saves',             dec: 0, core: true, points: 3 },
        { key: 'holds',        label: 'HLD',  name: 'Holds',             dec: 0, points: 0 },
        { key: 'strikeouts',   label: 'K',    name: 'Strikeouts',        dec: 0, core: true, points: 1 },
        { key: 'walks',        label: 'BB',   name: 'Walks',             dec: 0, points: 0, lower: true },
        { key: 'era',          label: 'ERA',  name: 'ERA',               dec: 2, core: true, lower: true },
        { key: 'whip',         label: 'WHIP', name: 'WHIP',              dec: 2, core: true, lower: true },
        { key: 'fip',          label: 'FIP',  name: 'FIP',               dec: 2, lower: true },
        { key: 'k9',           label: 'K/9',  name: 'K per 9',           dec: 1 },
        { key: 'bb9',          label: 'BB/9', name: 'BB per 9',          dec: 1, lower: true, table: false },
        { key: 'g',            label: 'G',    name: 'Games',             dec: 0, table: false },
        { key: 'gs',           label: 'GS',   name: 'Games Started',     dec: 0, table: false },
        { key: 'hits_allowed', label: 'H',    name: 'Hits Allowed',      dec: 0, points: 0, lower: true, table: false },
        { key: 'hr_allowed',   label: 'HR',   name: 'HR Allowed',        dec: 0, points: 0, lower: true, table: false },
        { key: 'runs_scored',  label: 'R',    name: 'Runs Allowed',      dec: 0, points: 0, lower: true, table: false },
        { key: 'er',           label: 'ER',   name: 'Earned Runs',       dec: 0, points: 0, lower: true, table: false },
        { key: 'hbp',          label: 'HBP',  name: 'Hit Batters',       dec: 0, points: 0, lower: true, table: false }
    ];

    const groups = { bat, pit };

    // Playing time needed to rank on a rate stat (AVG, ERA, ...), so a 2-PA 1.500 OPS doesn't
    // top the list. Matches the valuation engine's minimums. Older data without PA uses AB.
    const QUALIFY = { bat: 100, pit: 20 };
    function qualifies(stats, group) {
        if (!stats) return false;
        if (group === 'pit') return (Number(stats.ip) || 0) >= QUALIFY.pit;
        return (Number(stats.pa) || Number(stats.ab) || 0) >= QUALIFY.bat;
    }
    const groupOf = player => (player && player.is_pitcher ? 'pit' : 'bat');

    // Columns for a rankings view: everything in a batter/pitcher view, the core stats in "all"
    function columns(view) {
        if (view === 'batter') return bat.filter(s => s.table !== false).map(s => ({ group: 'bat', ...s }));
        if (view === 'pitcher') return pit.filter(s => s.table !== false).map(s => ({ group: 'pit', ...s }));
        return [...bat.filter(s => s.core).map(s => ({ group: 'bat', ...s })),
                ...pit.filter(s => s.core).map(s => ({ group: 'pit', ...s }))];
    }

    const scorable = group => groups[group].filter(s => s.points !== undefined);

    function defaultWeights() {
        const w = { bat: {}, pit: {} };
        ['bat', 'pit'].forEach(g => scorable(g).forEach(s => { w[g][s.key] = s.points; }));
        return w;
    }

    // Fantasy points: each scorable stat times its weight, for the player's own group
    function points(stats, group, weights) {
        let total = 0;
        scorable(group).forEach(s => { total += (Number(stats && stats[s.key]) || 0) * (weights[group][s.key] || 0); });
        return Math.round(total * 100) / 100;
    }

    function format(value, def) {
        const n = Number(value);
        if (value === null || value === undefined || value === '' || isNaN(n)) return '-';
        if (def.dec === 3 && Math.abs(n) < 1) return n.toFixed(3).replace(/^0/, '');  // .285, like a box score
        return n.toFixed(def.dec);
    }

    return { bat, pit, groups, groupOf, columns, scorable, defaultWeights, points, format, qualifies, QUALIFY };
});

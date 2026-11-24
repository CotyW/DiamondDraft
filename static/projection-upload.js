/**
 * Projections a visitor uploads as CSV: reading the file, matching rows to our players, and
 * turning counting stats into full stat lines. Everything happens in the browser; the files
 * are never sent anywhere. The column rules match projection_csv.py, which does the same for
 * the CSVs built into data/, and battingLine / pitchingLine match projections.py.
 *
 * Accepted columns (header names are case-insensitive; rate columns like AVG or ERA are
 * ignored because rates are calculated from the counts):
 *   batters:  Name, PA, AB, H, HR required; 2B, 3B, R, RBI, SB, CS, BB, SO, HBP, SF optional
 *   pitchers: Name, IP, SO (or K), BB, ER required; G, GS, W, L, SV, HLD, H, HR, R, HBP optional
 *   both:     MLBAMID (MLB player id) optional, matched first; otherwise players match by name
 *
 * ADP files (readAdpFile / matchAdp): Name (or Player) and ADP required; MLBAMID, Team, POS,
 * and Min / Max pick optional. "Last, First" names and tab-separated files (NFBC) are fine.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DDUpload = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Our stat key -> CSV column
    const BAT_COLUMNS = { pa: 'PA', ab: 'AB', hits: 'H', doubles: '2B', triples: '3B', hr: 'HR',
        runs: 'R', rbi: 'RBI', steals: 'SB', cs: 'CS', bb: 'BB', so: 'SO', hbp: 'HBP', sf: 'SF' };
    const PIT_COLUMNS = { ip: 'IP', g: 'G', gs: 'GS', wins: 'W', losses: 'L', saves: 'SV',
        holds: 'HLD', strikeouts: 'SO', walks: 'BB', hbp: 'HBP', hits_allowed: 'H', hr_allowed: 'HR',
        runs_scored: 'R', er: 'ER' };
    const REQUIRED = { batters: ['PA', 'AB', 'H', 'HR'], pitchers: ['IP', 'SO', 'BB', 'ER'] };
    const ALIASES = { SO: ['K'], NAME: ['PLAYERNAME', 'PLAYER'],
        MLBAMID: ['XMLBAMID', 'MLBID', 'MLBAM_ID', 'MLB_ID'] };
    const BAT_COUNTS = Object.keys(BAT_COLUMNS);
    const PIT_COUNTS = Object.keys(PIT_COLUMNS);
    const DEFAULT_FIP_CONSTANT = 3.10;

    // Example files for the instructions
    const TEMPLATES = {
        adp: 'Name,MLBAMID,Team,POS,ADP,Min Pick,Max Pick\n'
            + 'Aaron Judge,592450,NYY,OF,2.4,1,5\n',
        batters: 'Name,MLBAMID,PA,AB,H,2B,3B,HR,R,RBI,SB,CS,BB,SO,HBP,SF\n'
            + 'Aaron Judge,592450,650,530,150,25,1,48,115,118,8,2,105,165,8,5\n',
        pitchers: 'Name,MLBAMID,IP,G,GS,W,L,SV,HLD,SO,BB,HBP,H,HR,R,ER\n'
            + 'Emmanuel Clase,661403,68,68,0,4,3,38,0,65,15,2,55,4,22,20\n'
    };

    /**
     * CSV text -> rows of cells. Handles quoted cells, "" inside quotes, CRLF and a BOM. The
     * delimiter is a comma, or a tab when the first line has tabs and no commas.
     */
    function parseCsv(text) {
        const rows = [];
        let row = [], cell = '', quoted = false;
        const s = String(text || '').replace(/^﻿/, '');
        const firstLine = s.split(/\r?\n/, 1)[0];
        const sep = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (quoted) {
                if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === sep) { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && s[i + 1] === '\n') i++;
                row.push(cell); rows.push(row); row = []; cell = '';
            } else cell += ch;
        }
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.some(c => c.trim() !== ''));
    }

    function number(value) {
        const n = parseFloat(String(value === undefined ? '' : value).replace(/,/g, '').trim());
        return isNaN(n) ? 0 : n;
    }

    /**
     * A projection CSV -> { kind: 'batters' | 'pitchers', rows: [{ mlbId, name, counts }] }.
     * The kind comes from the columns: an IP column means pitchers. Throws an Error that says
     * what is missing when the file can't be used.
     */
    function readProjectionFile(text) {
        const table = parseCsv(text);
        if (table.length < 2) throw new Error('The file has no player rows (it needs a header row, then one row per player).');
        const header = table[0].map(h => h.trim().toUpperCase());
        const column = name => {
            for (const n of [name, ...(ALIASES[name] || [])]) {
                const i = header.indexOf(n);
                if (i !== -1) return i;
            }
            return -1;
        };
        const kind = column('IP') !== -1 ? 'pitchers' : 'batters';
        const missing = [...REQUIRED[kind], 'NAME'].filter(c => column(c) === -1);
        if (missing.length) {
            const hint = kind === 'batters' && column('PA') === -1
                ? ' A pitchers file needs an IP column; a batters file needs PA.' : '';
            throw new Error(`Missing column${missing.length > 1 ? 's' : ''} ${missing.map(m => (m === 'NAME' ? 'Name' : m)).join(', ')} for a ${kind} file.${hint}`);
        }
        const columns = kind === 'pitchers' ? PIT_COLUMNS : BAT_COLUMNS;
        const idCol = column('MLBAMID');
        const nameCol = column('NAME');
        const cols = Object.entries(columns).map(([key, name]) => [key, column(name)]);
        const rows = [];
        table.slice(1).forEach(r => {
            const name = (r[nameCol] || '').trim();
            if (!name) return;
            const rawId = idCol === -1 ? '' : (r[idCol] || '').trim();
            const counts = {};
            cols.forEach(([key, i]) => { counts[key] = i === -1 ? 0 : number(r[i]); });
            rows.push({ mlbId: /^\d+(\.0+)?$/.test(rawId) ? parseInt(rawId, 10) : null, name, counts });
        });
        if (!rows.length) throw new Error('The file has no rows with a player name.');
        return { kind, rows };
    }

    const div = (a, b, digits) => (b ? Number((a / b).toFixed(digits)) : 0);

    /** Counting stats -> full batting line, as projections.batting_line does. */
    function battingLine(c) {
        const line = {};
        BAT_COUNTS.forEach(k => { line[k] = Math.round(number(c[k])); });
        const { hits: h, ab, hr } = line;
        const tb = h + line.doubles + 2 * line.triples + 3 * hr;
        const obp = div(h + line.bb + line.hbp, ab + line.bb + line.hbp + line.sf, 3);
        const slg = div(tb, ab, 3);
        const babipDen = ab - line.so - hr + line.sf;
        return Object.assign(line, { avg: div(h, ab, 3), obp, slg, ops: Number((obp + slg).toFixed(3)),
            tb, babip: babipDen > 0 ? div(h - hr, babipDen, 3) : 0 });
    }

    /** Counting stats -> full pitching line, as projections.pitching_line does. */
    function pitchingLine(c, fipConstant = DEFAULT_FIP_CONSTANT) {
        const line = {};
        PIT_COUNTS.forEach(k => { if (k !== 'ip') line[k] = Math.round(number(c[k])); });
        const ip = Number(number(c.ip).toFixed(1));
        line.ip = ip;
        const fipRaw = 13 * line.hr_allowed + 3 * (line.walks + line.hbp) - 2 * line.strikeouts;
        return Object.assign(line, { era: div(9 * line.er, ip, 2), whip: div(line.walks + line.hits_allowed, ip, 2),
            fip: ip ? Number((fipRaw / ip + fipConstant).toFixed(2)) : 0,
            k9: div(9 * line.strikeouts, ip, 1), bb9: div(9 * line.walks, ip, 1) });
    }

    /** 'José Ramírez Jr.' -> 'jose ramirez', as projection_csv.normalize_name does. */
    function normalizeName(name) {
        return String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/-/g, ' ').replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
            .split(/\s+/).filter(Boolean).join(' ');
    }

    /**
     * Match a file's rows to our batters or pitchers: by MLB id, or by name when the row has
     * no id and the name is unique. Returns { lines: {playerId: statLine}, matched, unmatched }.
     */
    function matchRows(players, file, fipConstant) {
        const isPitcher = file.kind === 'pitchers';
        const group = players.filter(p => !!p.is_pitcher === isPitcher);
        const byId = new Map(group.map(p => [Number(p.mlb_id !== undefined ? p.mlb_id : p.id), p]));
        const byName = new Map();
        group.forEach(p => {
            const key = normalizeName(p.name);
            byName.set(key, [...(byName.get(key) || []), p]);
        });
        const lines = {};
        const unmatched = [];
        file.rows.forEach(row => {
            let player = row.mlbId !== null ? byId.get(row.mlbId) : null;
            if (!player && row.mlbId === null) {
                const candidates = byName.get(normalizeName(row.name)) || [];
                player = candidates.length === 1 ? candidates[0] : null;
            }
            if (!player || lines[String(player.id)]) { unmatched.push(row.name); return; }
            lines[String(player.id)] = isPitcher ? pitchingLine(row.counts, fipConstant) : battingLine(row.counts);
        });
        return { lines, matched: Object.keys(lines).length, unmatched };
    }

    // ---- ADP (average draft position) -------------------------------------------------

    // Our team names (data/players.json) -> the abbreviations ADP sites use
    const TEAM_CODES = {
        'Arizona Diamondbacks': ['ARI', 'AZ'], 'Athletics': ['ATH', 'OAK'], 'Atlanta Braves': ['ATL'],
        'Baltimore Orioles': ['BAL'], 'Boston Red Sox': ['BOS'], 'Chicago Cubs': ['CHC'],
        'Chicago White Sox': ['CHW', 'CWS'], 'Cincinnati Reds': ['CIN'], 'Cleveland Guardians': ['CLE'],
        'Colorado Rockies': ['COL'], 'Detroit Tigers': ['DET'], 'Houston Astros': ['HOU'],
        'Kansas City Royals': ['KC', 'KCR'], 'Los Angeles Angels': ['LAA', 'ANA'], 'Los Angeles Dodgers': ['LAD'],
        'Miami Marlins': ['MIA', 'FLA'], 'Milwaukee Brewers': ['MIL'], 'Minnesota Twins': ['MIN'],
        'New York Mets': ['NYM'], 'New York Yankees': ['NYY'], 'Philadelphia Phillies': ['PHI'],
        'Pittsburgh Pirates': ['PIT'], 'San Diego Padres': ['SD', 'SDP'], 'San Francisco Giants': ['SF', 'SFG'],
        'Seattle Mariners': ['SEA'], 'St. Louis Cardinals': ['STL'], 'Tampa Bay Rays': ['TB', 'TBR', 'TBA'],
        'Texas Rangers': ['TEX'], 'Toronto Blue Jays': ['TOR'], 'Washington Nationals': ['WSH', 'WSN', 'WAS']
    };
    const CODE_TO_TEAM = {};
    Object.entries(TEAM_CODES).forEach(([team, codes]) => codes.forEach(c => { CODE_TO_TEAM[c] = team; }));
    function sameTeam(ours, theirs) {
        const t = String(theirs || '').trim().toUpperCase();
        return !!t && (CODE_TO_TEAM[t] === ours || String(ours || '').toUpperCase() === t);
    }

    const PITCHER_POS = new Set(['SP', 'RP', 'P']);
    /** 'pitcher', 'batter', or null (both or unknown) from a POS cell like "SS,2B" or "DH/SP". */
    function roleFromPositions(text) {
        const list = String(text || '').toUpperCase().split(/[\s,/|]+/).filter(Boolean);
        if (!list.length) return null;
        const pitch = list.filter(p => PITCHER_POS.has(p)).length;
        if (pitch === list.length) return 'pitcher';
        return pitch ? null : 'batter';
    }

    /** "Judge, Aaron" -> "Aaron Judge"; drops a note like "(Batter)". Returns [name, role or null]. */
    function cleanAdpName(raw) {
        let name = String(raw || '').trim();
        let role = null;
        const note = name.match(/\(([^)]*)\)\s*$/);
        if (note) {
            const n = note[1].trim().toLowerCase();
            if (/pitch|^(p|sp|rp)$/.test(n)) role = 'pitcher';
            else if (/bat|hit/.test(n)) role = 'batter';
            name = name.slice(0, note.index).trim();
        }
        const comma = name.match(/^([^,]+),\s*(.+)$/);
        if (comma && !/^(jr|sr|ii|iii|iv)\.?$/i.test(comma[2])) name = `${comma[2]} ${comma[1]}`;
        return [name, role];
    }

    /**
     * An ADP file -> rows of { name, mlbId, team, role, adp, min, max }. Rows without a
     * usable ADP (blank, or under 1) are skipped. Throws an Error naming what is missing.
     */
    function readAdpFile(text) {
        const table = parseCsv(text);
        if (table.length < 2) throw new Error('The file has no player rows (it needs a header row, then one row per player).');
        const header = table[0].map(h => h.trim().toUpperCase());
        const find = names => names.map(n => header.indexOf(n)).find(i => i !== -1);
        const isProjections = header.includes('PA') || header.includes('IP');
        // "AVG" is batting average in a projections file, so only an ADP column counts there
        const adpCol = find(isProjections ? ['ADP'] : ['ADP', 'AVG PICK', 'AVG. PICK', 'AVERAGE PICK', 'AVG', 'AVERAGE', 'OVERALL ADP']);
        const nameCol = find(['NAME', 'PLAYER', 'PLAYERNAME', 'PLAYER NAME']);
        if (nameCol === undefined || adpCol === undefined) {
            const missing = [nameCol === undefined ? 'Name' : null, adpCol === undefined ? 'ADP' : null].filter(Boolean);
            const hint = isProjections && adpCol === undefined
                ? ' This looks like a projections file with no ADP column; projections go in Upload CSV under Player Rankings.' : '';
            throw new Error(`Missing column${missing.length > 1 ? 's' : ''} ${missing.join(' and ')}.${hint}`);
        }
        const idCol = find(['MLBAMID', 'XMLBAMID', 'MLBID', 'MLBAM_ID', 'MLB_ID']);
        const teamCol = find(['TEAM', 'TM']);
        const posCol = find(['POS', 'POSITION', 'POSITIONS', 'POSITION(S)', 'ELIGIBILITY']);
        const minCol = find(['MIN PICK', 'MIN', 'BEST', 'EARLIEST', 'MIN. PICK']);
        const maxCol = find(['MAX PICK', 'MAX', 'WORST', 'LATEST', 'MAX. PICK']);
        const cell = (r, i) => (i === undefined ? '' : (r[i] || '').trim());
        const rows = [];
        table.slice(1).forEach(r => {
            const adp = parseFloat(cell(r, adpCol));
            const [name, noteRole] = cleanAdpName(cell(r, nameCol));
            if (!name || !(adp >= 1)) return;
            const rawId = cell(r, idCol);
            const min = parseFloat(cell(r, minCol));
            const max = parseFloat(cell(r, maxCol));
            rows.push({
                name, adp,
                mlbId: /^\d+(\.0+)?$/.test(rawId) ? parseInt(rawId, 10) : null,
                team: cell(r, teamCol),
                role: noteRole || roleFromPositions(cell(r, posCol)),
                min: min >= 1 ? min : null,
                max: max >= 1 ? max : null
            });
        });
        if (!rows.length) throw new Error('No rows have both a player name and an ADP of 1 or more.');
        return rows;
    }

    /**
     * Match ADP rows to our players. A two-way player gets the same ADP on both entries unless
     * the row says batter or pitcher. A name that fits two different players is settled by team
     * when the file has one, else skipped. Returns { adp: {playerId: {adp, min, max}}, matched,
     * unmatched }, counting rows.
     */
    function matchAdp(players, rows) {
        const person = p => String(p.mlb_id !== undefined ? p.mlb_id : p.id);
        const byId = new Map();
        const byName = new Map();
        players.forEach(p => {
            byId.set(person(p), [...(byId.get(person(p)) || []), p]);
            const key = normalizeName(p.name);
            byName.set(key, [...(byName.get(key) || []), p]);
        });
        const adp = {};
        const unmatched = [];
        let matched = 0;
        rows.forEach(row => {
            let candidates = row.mlbId !== null ? (byId.get(String(row.mlbId)) || []) : (byName.get(normalizeName(row.name)) || []);
            if (row.role) {
                const fit = candidates.filter(p => !!p.is_pitcher === (row.role === 'pitcher'));
                if (fit.length) candidates = fit;
            }
            let people = new Set(candidates.map(person));
            if (people.size > 1 && row.team) {
                candidates = candidates.filter(p => sameTeam(p.team, row.team));
                people = new Set(candidates.map(person));
            }
            if (people.size !== 1) { unmatched.push(row.name); return; }
            matched++;
            // One row for both halves of a two-way player: mark it shared, so the page compares
            // it with his better-ranked entry instead of calling the other one a reach
            const shared = candidates.length > 1 ? [...people][0] : null;
            candidates.forEach(p => {
                // Files list players best ADP first, so a repeat row doesn't replace the first
                if (adp[String(p.id)]) return;
                adp[String(p.id)] = { adp: row.adp, min: row.min, max: row.max };
                if (shared) adp[String(p.id)].shared = shared;
            });
        });
        return { adp, matched, unmatched };
    }

    return { parseCsv, readProjectionFile, battingLine, pitchingLine, normalizeName, matchRows, TEMPLATES, REQUIRED,
        readAdpFile, matchAdp, cleanAdpName };
});

// Tests for static/projection-upload.js. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../static/projection-upload.js');

// Shaped like a FanGraphs export: BOM, quoted headers, extra columns, ids at the end
const BATTERS = '﻿"Name","Team","PA","AB","H","2B","3B","HR","R","RBI","BB","SO","HBP","SF","SB","CS","AVG","MLBAMID"\r\n'
    + '"Aaron Judge","NYY","650","530","150","25","1","48","115","118","105","165","8","5","8","2",".283","592450"\r\n'
    + '"Shohei Ohtani","LAD","680","590","165","30","5","45","120","105","85","170","6","4","20","4",".280","660271"\r\n'
    + '"Some Prospect","SEA","150","135","32","6","1","3","15","14","12","40","1","1","2","1",".237","999999"\r\n';
const PITCHERS = 'name,ip,k,bb,er,hr,h,hbp,sv,w,mlbamid\n'
    + 'Shohei Ohtani,140.5,170,40,50,15,115,5,0,9,660271\n'
    + 'Emmanuel Clase,68,65,15,20,4,55,2,38,4,661403\n';

const players = () => [
    { id: 592450, name: 'Aaron Judge', is_pitcher: false },
    { id: 660271, name: 'Shohei Ohtani', is_pitcher: false, mlb_id: 660271 },
    { id: '660271-P', name: 'Shohei Ohtani', is_pitcher: true, mlb_id: 660271 },
    { id: 661403, name: 'Emmanuel Clase', is_pitcher: true },
    { id: 100, name: 'José Ramírez', is_pitcher: false },
    { id: 1, name: 'Luis García', is_pitcher: false },
    { id: 2, name: 'Luis García', is_pitcher: false },
];

test('parseCsv handles quotes, escaped quotes, CRLF and blank lines', () => {
    assert.deepEqual(U.parseCsv('a,"b, c","say ""hi"""\r\n\r\n1,2,3'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
});

test('reads a FanGraphs-style batters export', () => {
    const file = U.readProjectionFile(BATTERS);
    assert.equal(file.kind, 'batters');
    assert.equal(file.rows.length, 3);
    assert.equal(file.rows[0].mlbId, 592450);
    assert.equal(file.rows[0].counts.hr, 48);
    assert.equal(file.rows[0].counts.so, 165);
});

test('an IP column makes it a pitchers file; K counts as SO; headers ignore case', () => {
    const file = U.readProjectionFile(PITCHERS);
    assert.equal(file.kind, 'pitchers');
    assert.equal(file.rows[1].counts.strikeouts, 65);
    assert.equal(file.rows[1].counts.saves, 38);
});

test('missing required columns are named in the error', () => {
    assert.throws(() => U.readProjectionFile('Name,PA,AB\nX,1,1\n'), /Missing columns H, HR for a batters file/);
    assert.throws(() => U.readProjectionFile('Name,IP,SO\nX,1,1\n'), /Missing columns BB, ER for a pitchers file/);
    assert.throws(() => U.readProjectionFile('Name,PA,AB,H,HR\n'), /no player rows/);
});

test('matches by MLB id, keeping two-way players apart', () => {
    const ps = players();
    const bat = U.matchRows(ps, U.readProjectionFile(BATTERS), 3.1);
    assert.equal(bat.matched, 2);
    assert.deepEqual(bat.unmatched, ['Some Prospect']);
    assert.equal(bat.lines['592450'].hr, 48);
    assert.equal(bat.lines['592450'].avg, Number((150 / 530).toFixed(3)));
    const pit = U.matchRows(ps, U.readProjectionFile(PITCHERS), 3.1);
    assert.equal(pit.lines['660271-P'].strikeouts, 170);  // Ohtani's pitching line on his pitcher entry
    assert.equal(pit.lines['660271-P'].ip, 140.5);
    assert.ok(!pit.lines['660271']);
});

test('without ids, matches unique names and skips ambiguous ones', () => {
    const csv = 'Name,PA,AB,H,HR\nJose Ramirez Jr.,650,580,165,30\nLuis Garcia,600,550,150,20\n';
    const result = U.matchRows(players(), U.readProjectionFile(csv), 3.1);
    assert.equal(result.lines['100'].hr, 30);
    assert.deepEqual(result.unmatched, ['Luis Garcia']);
});

test('stat lines match projections.py', () => {
    // Same inputs as tests/test_projections.py would use: rates from counts
    const b = U.battingLine({ pa: 600, ab: 500, hits: 150, doubles: 30, triples: 2, hr: 25, bb: 80, so: 120, hbp: 5, sf: 5 });
    assert.equal(b.tb, 150 + 30 + 4 + 75);
    assert.equal(b.avg, 0.3);
    assert.equal(b.obp, Number((235 / 590).toFixed(3)));
    assert.equal(b.slg, Number((259 / 500).toFixed(3)));
    const p = U.pitchingLine({ ip: 180, strikeouts: 200, walks: 50, hbp: 5, hr_allowed: 20, er: 70, hits_allowed: 150 }, 3.1);
    assert.equal(p.era, 3.5);
    assert.equal(p.whip, 1.11);
    assert.equal(p.fip, Number(((13 * 20 + 3 * 55 - 2 * 200) / 180 + 3.1).toFixed(2)));
    assert.equal(p.k9, 10);
});

test('templates are valid upload files', () => {
    assert.equal(U.readProjectionFile(U.TEMPLATES.batters).kind, 'batters');
    assert.equal(U.readProjectionFile(U.TEMPLATES.pitchers).kind, 'pitchers');
});

// ---- ADP ----
const adpPlayers = () => [
    { id: 592450, name: 'Aaron Judge', is_pitcher: false, team: 'New York Yankees' },
    { id: 660271, name: 'Shohei Ohtani', is_pitcher: false, mlb_id: 660271, team: 'Los Angeles Dodgers' },
    { id: '660271-P', name: 'Shohei Ohtani', is_pitcher: true, mlb_id: 660271, team: 'Los Angeles Dodgers' },
    { id: 1, name: 'Luis García', is_pitcher: false, team: 'Washington Nationals' },
    { id: 2, name: 'Luis García', is_pitcher: true, team: 'Los Angeles Angels' },
    { id: 3, name: 'Will Smith', is_pitcher: false, team: 'Los Angeles Dodgers' },
    { id: 4, name: 'Will Smith', is_pitcher: true, team: 'Kansas City Royals' },
    { id: 5, name: 'Bobby Witt Jr.', is_pitcher: false, team: 'Kansas City Royals' },
];

test('reads an NFBC-style tab-separated ADP file with "Last, First" names', () => {
    const tsv = 'Rank\tPlayer\tTeam\tPosition(s)\tADP\tMin Pick\tMax Pick\n'
        + '1\tOhtani, Shohei\tLAD\tDH,SP\t1.3\t1\t3\n'
        + '2\tJudge, Aaron\tNYY\tOF\t2.4\t1\t5\n'
        + '3\tWitt Jr., Bobby\tKC\tSS\t3.1\t2\t6\n';
    const rows = U.readAdpFile(tsv);
    assert.deepEqual(rows.map(r => r.name), ['Shohei Ohtani', 'Aaron Judge', 'Bobby Witt Jr.']);
    assert.equal(rows[0].role, null);       // DH and SP: both
    assert.equal(rows[1].role, 'batter');
    assert.equal(rows[1].min, 1);
    assert.equal(rows[1].max, 5);
    const m = U.matchAdp(adpPlayers(), rows);
    assert.equal(m.matched, 3);
    assert.equal(m.adp['660271'].adp, 1.3);  // two-way player: both entries
    assert.equal(m.adp['660271-P'].adp, 1.3);
    assert.equal(m.adp['660271'].shared, '660271');  // one ADP for both: marked shared
    assert.equal(m.adp['5'].adp, 3.1);
    assert.equal(m.adp['5'].shared, undefined);
});

test('batter / pitcher notes and positions keep two-way and same-name players apart', () => {
    const csv = 'Player,Team,POS,AVG\n'
        + 'Shohei Ohtani (Batter),LAD,DH,1.5\nShohei Ohtani (Pitcher),LAD,SP,80\n'
        + 'Will Smith,LAD,C,95\nWill Smith,KC,RP,400\nLuis Garcia,,SS,250\n';
    const m = U.matchAdp(adpPlayers(), U.readAdpFile(csv));
    assert.equal(m.adp['660271'].adp, 1.5);
    assert.equal(m.adp['660271-P'].adp, 80);
    assert.equal(m.adp['3'].adp, 95);       // C -> the batter
    assert.equal(m.adp['4'].adp, 400);      // RP -> the pitcher
    assert.equal(m.adp['1'].adp, 250);      // SS settles Luis García without a team
    assert.deepEqual(m.unmatched, []);
});

test('same name and role is settled by team, else skipped', () => {
    const players = [
        { id: 10, name: 'Luis Castillo', is_pitcher: true, team: 'Seattle Mariners' },
        { id: 11, name: 'Luis Castillo', is_pitcher: true, team: 'Washington Nationals' },
    ];
    const withTeam = U.matchAdp(players, U.readAdpFile('Name,Team,ADP\nLuis Castillo,SEA,90\n'));
    assert.equal(withTeam.adp['10'].adp, 90);
    const noTeam = U.matchAdp(players, U.readAdpFile('Name,ADP\nLuis Castillo,90\n'));
    assert.deepEqual(noTeam.unmatched, ['Luis Castillo']);
});

test('a FanGraphs projections export is read by its ADP column, not AVG', () => {
    const rows = U.readAdpFile(BATTERS.replace('"MLBAMID"', '"ADP","MLBAMID"').replace(/"(\d+)"\r\n/g, '"12.5","$1"\r\n'));
    assert.equal(rows[0].adp, 12.5);
    assert.equal(rows[0].mlbId, 592450);
    assert.throws(() => U.readAdpFile(BATTERS), /no ADP column/);
});

test('ADP rows without a usable ADP are dropped; the template is valid', () => {
    const rows = U.readAdpFile('Name,ADP\nA Player,\nB Player,0\nAaron Judge,2\n');
    assert.deepEqual(rows.map(r => r.name), ['Aaron Judge']);
    assert.throws(() => U.readAdpFile('Name,Team\nX,NYY\n'), /Missing column ADP/);
    assert.equal(U.readAdpFile(U.TEMPLATES.adp)[0].adp, 2.4);
});

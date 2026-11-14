"""Tests for steamer.py. Run with: python -m unittest discover tests"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import steamer  # noqa: E402

# Shaped like FanGraphs' projection exports: BOM, quoted headers, extra columns, ids at the end
BATTERS_CSV = '﻿"Name","Team","G","PA","AB","H","2B","3B","HR","R","RBI","BB","SO","HBP","SF","SB","CS","AVG","wOBA","PlayerId","MLBAMID"\n' \
    '"Aaron Judge","NYY","148","650","530","150","25","1","48","115","118","105","165","8","5","8","2",".283",".420","15640","592450"\n' \
    '"Shohei Ohtani","LAD","150","680","590","165","30","5","45","120","105","85","170","6","4","20","4",".280",".400","19755","660271"\n' \
    '"Some Prospect","SEA","40","150","135","32","6","1","3","15","14","12","40","1","1","2","1",".237",".290","sa123","999999"\n'

PITCHERS_CSV = '"Name","Team","W","L","ERA","G","GS","SV","HLD","IP","H","R","ER","HR","BB","HBP","SO","PlayerId","MLBAMID"\n' \
    '"Shohei Ohtani","LAD","9","5","3.20","24","24","0","0","140.5","115","55","50","15","40","5","170","19755","660271"\n' \
    '"Emmanuel Clase","CLE","4","3","2.60","68","0","38","0","68.0","55","22","20","4","15","2","65","21032","661403"\n'


def players():
    def p(pid, name, is_pitcher, **extra):
        return {'id': pid, 'name': name, 'is_pitcher': is_pitcher, 'stats': {'2027': {'marcel': True}}, **extra}
    return [
        p(592450, 'Aaron Judge', False),
        p(660271, 'Shohei Ohtani', False, two_way=True, mlb_id=660271),
        p('660271-P', 'Shohei Ohtani', True, two_way=True, mlb_id=660271),
        p(661403, 'Emmanuel Clase', True),
        p(100, 'José Ramírez', False),
    ]


class SteamerTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write(self, name, text):
        path = os.path.join(self.dir.name, name)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        return path

    def test_reads_fangraphs_export(self):
        rows = steamer.read_csv(self.write('b.csv', BATTERS_CSV), False)
        self.assertEqual(len(rows), 3)
        judge = rows[0]
        self.assertEqual(judge['mlb_id'], 592450)
        self.assertEqual(judge['counts']['hr'], 48)
        self.assertEqual(judge['counts']['so'], 165)

    def test_applies_by_mlb_id_including_two_way_players(self):
        ps = players()
        files = {False: self.write('b.csv', BATTERS_CSV), True: self.write('p.csv', PITCHERS_CSV)}
        result = steamer.apply_files(ps, 2027, 3.10, files)
        self.assertEqual(result, {'batters': 2, 'pitchers': 2})
        judge, ohtani_bat, ohtani_pit, clase, ramirez = ps
        self.assertEqual(judge['stats']['2027']['hr'], 48)
        self.assertEqual(judge['stats']['2027']['avg'], round(150 / 530, 3))  # rates from counts
        self.assertEqual(ohtani_bat['stats']['2027']['hr'], 45)
        self.assertEqual(ohtani_pit['stats']['2027']['strikeouts'], 170)  # pitching line, not batting
        self.assertEqual(ohtani_pit['stats']['2027']['ip'], 140.5)
        self.assertEqual(clase['stats']['2027']['saves'], 38)
        self.assertEqual(clase['projection_source'], 'steamer')
        self.assertEqual(ramirez['stats']['2027'], {'marcel': True})  # not in the CSV: Marcel kept
        self.assertNotIn('projection_source', ramirez)

    def test_unknown_players_are_reported_not_added(self):
        ps = players()
        rows = steamer.read_csv(self.write('b.csv', BATTERS_CSV), False)
        matched, unmatched = steamer.apply(ps, rows, False, 2027)
        self.assertEqual(matched, 2)
        self.assertEqual(unmatched, ['Some Prospect'])
        self.assertEqual(len(ps), 5)

    def test_name_match_when_no_id_column(self):
        csv_text = '"Name","PA","AB","H","HR","SO"\n"Jose Ramirez Jr.","650","580","165","30","80"\n'
        ps = players()
        matched, _ = steamer.apply(ps, steamer.read_csv(self.write('b.csv', csv_text), False), False, 2027)
        self.assertEqual(matched, 1)
        self.assertEqual(ps[4]['stats']['2027']['hr'], 30)

    def test_ambiguous_names_are_skipped(self):
        csv_text = '"Name","PA","AB","H","HR"\n"Luis Garcia","600","550","150","20"\n'
        ps = [{'id': i, 'name': 'Luis García', 'is_pitcher': False, 'stats': {}} for i in (1, 2)]
        matched, unmatched = steamer.apply(ps, steamer.read_csv(self.write('b.csv', csv_text), False), False, 2027)
        self.assertEqual((matched, unmatched), (0, ['Luis Garcia']))

    def test_wrong_file_is_rejected(self):
        with self.assertRaises(ValueError):
            steamer.read_csv(self.write('p.csv', PITCHERS_CSV), False)  # pitchers file as batters
        with self.assertRaises(ValueError):
            steamer.read_csv(self.write('b.csv', BATTERS_CSV), True)

    def test_missing_files_are_skipped(self):
        files = {False: os.path.join(self.dir.name, 'none.csv'), True: None}
        self.assertEqual(steamer.apply_files(players(), 2027, 3.1, files), {})

    def test_normalize_name(self):
        self.assertEqual(steamer.normalize_name('José Ramírez Jr.'), 'jose ramirez')
        self.assertEqual(steamer.normalize_name("Ke'Bryan Hayes"), 'kebryan hayes')
        self.assertEqual(steamer.normalize_name('Jazz Chisholm-Jr'), 'jazz chisholm')


if __name__ == '__main__':
    unittest.main()

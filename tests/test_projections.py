"""Tests for projections.py. Run with: python -m unittest discover tests"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import projections as P  # noqa: E402


def bat(**kw):
    c = dict(pa=600, ab=540, hits=140, doubles=28, triples=2, hr=20, runs=75, rbi=75, steals=8, cs=3,
             bb=50, so=130, hbp=5, sf=5)
    c.update(kw)
    return P.batting_line(c)


def pit(**kw):
    c = dict(ip=170.0, g=30, gs=30, wins=10, losses=9, saves=0, holds=0, strikeouts=170, walks=55,
             hbp=7, hits_allowed=160, hr_allowed=20, runs_scored=80, er=74)
    c.update(kw)
    return P.pitching_line(c)


def league_of(line, n=300):
    """League totals made of n copies of one line, so its rates are the league rates."""
    return {k: (line.get(k, 0) or 0) * n for k in line}


LG_BAT = league_of(bat())
LG_PIT = league_of(pit())


class StatLines(unittest.TestCase):
    def test_batting_rates(self):
        s = bat(ab=500, hits=150, doubles=30, triples=5, hr=25, bb=60, hbp=5, sf=5, so=100)
        self.assertEqual(s['avg'], 0.3)
        self.assertEqual(s['tb'], 150 + 30 + 10 + 75)
        self.assertEqual(s['slg'], round(265 / 500, 3))
        self.assertEqual(s['obp'], round((150 + 60 + 5) / (500 + 60 + 5 + 5), 3))
        self.assertEqual(s['ops'], round(s['obp'] + s['slg'], 3))
        self.assertEqual(s['babip'], round((150 - 25) / (500 - 100 - 25 + 5), 3))

    def test_pitching_rates(self):
        s = P.pitching_line(dict(ip=180.0, er=60, walks=50, hits_allowed=150, strikeouts=200,
                                 hr_allowed=20, hbp=5), fip_constant=3.0)
        self.assertEqual(s['era'], 3.0)
        self.assertEqual(s['whip'], round(200 / 180, 2))
        self.assertEqual(s['k9'], 10.0)
        self.assertEqual(s['fip'], round((13 * 20 + 3 * 55 - 2 * 200) / 180 + 3.0, 2))

    def test_no_playing_time_gives_zero_rates(self):
        self.assertEqual(P.batting_line({})['avg'], 0)
        self.assertEqual(P.pitching_line({})['era'], 0)

    def test_fip_constant_makes_league_fip_equal_league_era(self):
        totals = {'ip': 1000.0, 'er': 450, 'hr_allowed': 120, 'walks': 350, 'hbp': 40, 'strikeouts': 950}
        c = P.fip_constant(totals)
        lg_fip = (13 * 120 + 3 * 390 - 2 * 950) / 1000 + c
        self.assertAlmostEqual(lg_fip, 9 * 450 / 1000, places=2)


class Age(unittest.TestCase):
    def test_peak_is_neutral(self):
        self.assertEqual(P.age_factor(29), 1.0)
        self.assertEqual(P.age_factor(None), 1.0)

    def test_young_improve_faster_than_old_decline(self):
        self.assertAlmostEqual(P.age_factor(24), 1.03)
        self.assertAlmostEqual(P.age_factor(34), 0.985)


class BatterProjection(unittest.TestCase):
    def test_league_average_player_at_peak_stays_league_average(self):
        avg = bat()
        p = P.project_batter([avg, avg, avg], [LG_BAT] * 3, age=29)
        self.assertAlmostEqual(p['avg'], avg['avg'], places=2)
        self.assertAlmostEqual(p['hr'] / p['pa'], avg['hr'] / avg['pa'], delta=0.5 / p['pa'])  # HR is rounded

    def test_great_season_is_pulled_toward_league_average(self):
        great = bat(hr=45, hits=180)
        p = P.project_batter([great, great, great], [LG_BAT] * 3, age=29)
        lg_rate, own_rate = LG_BAT['hr'] / LG_BAT['pa'], great['hr'] / great['pa']
        self.assertTrue(lg_rate < p['hr'] / p['pa'] < own_rate)

    def test_less_history_means_more_regression(self):
        great = bat(hr=45)
        three = P.project_batter([great, great, great], [LG_BAT] * 3, age=29)
        one = P.project_batter([great], [LG_BAT], age=29)
        self.assertGreater(three['hr'] / three['pa'], one['hr'] / one['pa'])

    def test_recent_seasons_count_most(self):
        hot, cold = bat(hr=40), bat(hr=10)
        rising = P.project_batter([hot, cold, cold], [LG_BAT] * 3, age=29)
        falling = P.project_batter([cold, cold, hot], [LG_BAT] * 3, age=29)
        self.assertGreater(rising['hr'], falling['hr'])

    def test_age_moves_good_stats_and_strikeouts_opposite_ways(self):
        s = bat()
        young = P.project_batter([s, s, s], [LG_BAT] * 3, age=24)
        old = P.project_batter([s, s, s], [LG_BAT] * 3, age=36)
        self.assertGreater(young['hr'], old['hr'])
        self.assertLess(young['so'], old['so'])

    def test_playing_time(self):
        p = P.project_batter([bat(pa=600), bat(pa=500), bat(pa=400)], [LG_BAT] * 3)
        self.assertEqual(p['pa'], round(0.5 * 600 + 0.1 * 500 + 200))
        injured = P.project_batter([bat(pa=0, ab=0, hits=0), bat(pa=650)], [LG_BAT] * 2)
        self.assertEqual(injured['pa'], round(0.1 * 650 + 200))

    def test_no_history_gives_empty_line(self):
        none = P.batting_line({})
        p = P.project_batter([none, none, none], [LG_BAT] * 3)
        self.assertEqual(p['pa'], 0)
        self.assertEqual(p['hr'], 0)

    def test_output_is_internally_consistent(self):
        p = P.project_batter([bat(hr=35), bat(), bat(steals=30)], [LG_BAT] * 3, age=26)
        self.assertLessEqual(p['ab'], p['pa'])
        self.assertLessEqual(p['doubles'] + p['triples'] + p['hr'], p['hits'])
        self.assertEqual(p['avg'], round(p['hits'] / p['ab'], 3))


class PitcherProjection(unittest.TestCase):
    def test_great_era_is_pulled_toward_league_average(self):
        ace = pit(er=40, ip=200.0)
        p = P.project_pitcher([ace, ace, ace], [LG_PIT] * 3, age=29)
        self.assertTrue(ace['era'] < p['era'] < LG_PIT['er'] * 9 / LG_PIT['ip'])

    def test_starter_and_reliever_innings(self):
        sp = P.project_pitcher([pit(ip=180.0), pit(ip=170.0)], [LG_PIT] * 2)
        self.assertAlmostEqual(sp['ip'], 0.5 * 180 + 0.1 * 170 + 60, places=1)
        rp_line = pit(ip=65.0, g=65, gs=0, saves=30)
        rp = P.project_pitcher([rp_line, rp_line], [LG_PIT] * 2)
        self.assertAlmostEqual(rp['ip'], 0.5 * 65 + 0.1 * 65 + 25, places=1)

    def test_role_stats(self):
        lg = league_of(pit(saves=5, holds=5))  # league has some saves and holds
        sp = P.project_pitcher([pit(), pit(), pit()], [lg] * 3)
        self.assertEqual(sp['saves'], 0)       # starters aren't handed saves
        self.assertEqual(sp['holds'], 0)
        closer = pit(ip=65.0, g=65, gs=0, saves=35)
        rp = P.project_pitcher([closer, closer, closer], [lg] * 3)
        self.assertEqual(rp['gs'], 0)          # relievers aren't handed starts
        self.assertAlmostEqual(rp['saves'] / rp['ip'], 35 / 65, delta=0.02)  # closers keep their role

    def test_age_lowers_runs_allowed_for_young_pitchers(self):
        s = pit()
        young = P.project_pitcher([s, s, s], [LG_PIT] * 3, age=24)
        old = P.project_pitcher([s, s, s], [LG_PIT] * 3, age=36)
        self.assertLess(young['era'], old['era'])
        self.assertGreater(young['strikeouts'], old['strikeouts'])

    def test_fip_uses_given_constant(self):
        p1 = P.project_pitcher([pit()], [LG_PIT], fip_const=3.0)
        p2 = P.project_pitcher([pit()], [LG_PIT], fip_const=3.5)
        self.assertAlmostEqual(p2['fip'] - p1['fip'], 0.5, places=2)


if __name__ == '__main__':
    unittest.main()

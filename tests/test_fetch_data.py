"""Tests for fetch_data.py. The MLB API is mocked: nothing here touches the network.
Run with: python -m unittest discover tests"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import fetch_data as fd  # noqa: E402
import projection_csv  # noqa: E402

SEASONS = [2024, 2025, 2026]


# --- API-shaped fixtures -----------------------------------------------------------------

def split(season, stat, team='Yankees', num_teams=None, position=None):
    s = {'season': str(season), 'stat': stat, 'team': {'name': team} if team else {}}
    if num_teams:
        s['numTeams'] = num_teams
    if position:
        s['position'] = {'abbreviation': position}
    return s


def group(name, splits):
    return {'group': {'displayName': name}, 'splits': splits}


def bat_stat(pa=600, hr=30):
    return {'plateAppearances': pa, 'atBats': pa - 60, 'hits': 150, 'doubles': 30, 'triples': 2,
            'homeRuns': hr, 'runs': 90, 'rbi': 95, 'stolenBases': 10, 'caughtStealing': 3,
            'baseOnBalls': 50, 'strikeOuts': 140, 'hitByPitch': 5, 'sacFlies': 5}


def pit_stat(ip='180.1', games=30, starts=30, so=200):
    return {'gamesPitched': games, 'gamesPlayed': games, 'gamesStarted': starts, 'wins': 12,
            'losses': 8, 'saves': 0, 'holds': 0, 'strikeOuts': so, 'baseOnBalls': 50,
            'hitBatsmen': 6, 'hits': 160, 'homeRuns': 20, 'runs': 70, 'earnedRuns': 65,
            'inningsPitched': ip}


def batter_person(team='Yankees', birth='1995-03-10'):
    return {'birthDate': birth, 'stats': [
        group('hitting', [split(s, bat_stat(hr=20 + i), team) for i, s in enumerate(SEASONS)]),
        group('fielding', [split(2026, {'gamesPlayed': 120}, team, position='RF'),
                           split(2026, {'gamesPlayed': 25}, team, position='CF')]),
    ]}


def pitcher_person(starts=30, games=30, birth='1992-08-20'):
    return {'birthDate': birth, 'stats': [
        group('pitching', [split(s, pit_stat(games=games, starts=starts)) for s in SEASONS]),
    ]}


def two_way_person():
    p = batter_person(team='Dodgers', birth='1994-07-05')
    p['stats'].append(group('pitching', [split(s, pit_stat(ip='130.0', games=23, starts=23), 'Dodgers')
                                         for s in SEASONS]))
    return p


class FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


def quiet():
    return redirect_stdout(io.StringIO())


# --- Pure helpers ------------------------------------------------------------------------

class HelperTests(unittest.TestCase):
    def test_innings_to_float_reads_thirds(self):
        self.assertEqual(fd.innings_to_float('180.1'), 180 + 1 / 3)
        self.assertEqual(fd.innings_to_float('6.2'), 6 + 2 / 3)
        self.assertEqual(fd.innings_to_float('7'), 7)
        self.assertEqual(fd.innings_to_float(None), 0)
        self.assertEqual(fd.innings_to_float(''), 0)

    def test_combined_row_is_the_multi_team_row(self):
        self.assertTrue(fd.is_combined_row({'numTeams': 2}))
        self.assertFalse(fd.is_combined_row({'numTeams': 1}))
        self.assertFalse(fd.is_combined_row({}))
        self.assertFalse(fd.is_combined_row({'numTeams': None}))

    def test_age_in_uses_july_first(self):
        self.assertEqual(fd.age_in('1995-03-10', 2027), 32)
        self.assertEqual(fd.age_in('1995-07-01', 2027), 32)  # birthday on the cutoff counts
        self.assertEqual(fd.age_in('1995-07-02', 2027), 31)
        for bad in (None, '', 'not a date', '1995-07'):
            self.assertIsNone(fd.age_in(bad, 2027), bad)

    def test_season_counts_add_up_traded_players_rows(self):
        rows = [split(2025, bat_stat(pa=300, hr=10)), split(2025, bat_stat(pa=250, hr=8))]
        c = fd.season_counts(rows, is_pitcher=False)
        self.assertEqual(c['pa'], 550)
        self.assertEqual(c['hr'], 18)
        self.assertNotIn('ip', c)

    def test_season_counts_treat_missing_and_null_fields_as_zero(self):
        c = fd.season_counts([split(2025, {'homeRuns': None})], is_pitcher=False)
        self.assertEqual(c['hr'], 0)
        self.assertEqual(c['pa'], 0)

    def test_pitcher_season_counts_sum_innings_by_thirds(self):
        rows = [split(2025, pit_stat(ip='10.1')), split(2025, pit_stat(ip='5.2'))]
        self.assertAlmostEqual(fd.season_counts(rows, is_pitcher=True)['ip'], 16)

    def test_season_lines_skip_the_combined_row_and_fill_missed_seasons(self):
        person = {'stats': [group('hitting', [
            split(2026, bat_stat(pa=300, hr=10), 'Mets'),
            split(2026, bat_stat(pa=200, hr=5), 'Cubs'),
            split(2026, bat_stat(pa=500, hr=15), None, num_teams=2),  # the all-teams total
        ])]}
        lines = fd.season_lines(person, False, SEASONS)
        self.assertEqual(lines['2026']['pa'], 500)  # not 1000
        self.assertEqual(lines['2026']['hr'], 15)
        self.assertEqual(lines['2024']['pa'], 0)
        self.assertEqual(set(lines), {'2024', '2025', '2026'})

    def test_season_lines_read_only_the_right_group(self):
        person = two_way_person()
        self.assertIn('pa', fd.season_lines(person, False, SEASONS)['2026'])
        self.assertIn('ip', fd.season_lines(person, True, SEASONS)['2026'])

    def test_eligible_positions_need_enough_games_and_keep_roster_position(self):
        person = {'stats': [group('fielding', [
            split(2026, {'gamesPlayed': 100}, position='SS'),
            split(2026, {'gamesPlayed': 30}, position='2B'),
            split(2026, {'gamesPlayed': 10}, position='3B'),          # too few
            split(2025, {'gamesPlayed': 150}, position='1B'),         # wrong season
            split(2026, {'gamesPlayed': 140}, num_teams=2, position='C'),  # combined row
            split(2026, {'gamesPlayed': 50}, position='P'),           # not a fielding slot
        ])]}
        self.assertEqual(fd.eligible_positions(person, 2026, 'SS'), ['SS', '2B'])
        self.assertEqual(fd.eligible_positions(person, 2026, 'DH'), ['DH', 'SS', '2B'])

    def test_eligible_positions_add_up_games_across_teams(self):
        person = {'stats': [group('fielding', [
            split(2026, {'gamesPlayed': 12}, 'Mets', position='LF'),
            split(2026, {'gamesPlayed': 12}, 'Cubs', position='LF'),
        ])]}
        self.assertEqual(fd.eligible_positions(person, 2026, 'RF'), ['RF', 'LF'])

    def test_eligible_positions_never_empty(self):
        self.assertEqual(fd.eligible_positions({}, 2026, 'C'), ['C'])
        self.assertEqual(fd.eligible_positions({}, 2026, ''), [''])
        self.assertEqual(fd.eligible_positions({}, 2026, None), [''])

    def test_pitcher_role_from_latest_season_with_games(self):
        self.assertEqual(fd.pitcher_role(pitcher_person(starts=30, games=30), SEASONS), 'SP')
        self.assertEqual(fd.pitcher_role(pitcher_person(starts=0, games=60), SEASONS), 'RP')
        self.assertEqual(fd.pitcher_role(pitcher_person(starts=10, games=20), SEASONS), 'SP')  # exactly half
        self.assertEqual(fd.pitcher_role({}, SEASONS), 'P')
        # Converted to the bullpen in the latest season: that season decides
        person = {'stats': [group('pitching', [split(2025, pit_stat(games=30, starts=30)),
                                               split(2026, pit_stat(games=50, starts=0))])]}
        self.assertEqual(fd.pitcher_role(person, SEASONS), 'RP')
        # No 2026 games: falls back to 2025
        person = {'stats': [group('pitching', [split(2025, pit_stat(games=30, starts=30))])]}
        self.assertEqual(fd.pitcher_role(person, SEASONS), 'SP')

    def test_latest_team_is_the_last_split_in_the_season(self):
        person = {'stats': [group('hitting', [split(2026, {}, 'Mets'), split(2026, {}, 'Cubs'),
                                              split(2025, {}, 'Reds'), split(2026, {}, None)])]}
        self.assertEqual(fd.latest_team(person, 2026), 'Cubs')
        self.assertIsNone(fd.latest_team(person, 2024))

    def test_players_with_stats_counts_any_nonzero_stat(self):
        players = [{'stats': {'2026': {'pa': 0, 'hr': 0}}}, {'stats': {'2026': {'pa': 1}}}, {}]
        self.assertEqual(fd.players_with_stats(players, 2026), 1)


class BuildPlayersTests(unittest.TestCase):
    def test_batter_entry(self):
        info = {'id': 1, 'full_name': 'Al Bat', 'position': 'RF', 'team_name': 'Old Team'}
        [p] = fd.build_players(info, batter_person(team='Yankees'), SEASONS)
        self.assertEqual(p['id'], 1)
        self.assertFalse(p['is_pitcher'])
        self.assertEqual(p['team'], 'Yankees')  # from the stats, newer than the roster
        self.assertEqual(p['position'], 'RF/CF')
        self.assertEqual(p['primary_position'], 'RF')
        self.assertEqual(p['birth_date'], '1995-03-10')
        self.assertNotIn('two_way', p)
        self.assertEqual(set(p['stats']), {'2024', '2025', '2026'})

    def test_team_falls_back_to_roster(self):
        info = {'id': 1, 'full_name': 'New Guy', 'position': 'C', 'team_name': 'Roster Team'}
        [p] = fd.build_players(info, {'stats': []}, SEASONS)
        self.assertEqual(p['team'], 'Roster Team')
        self.assertEqual(p['stats']['2026']['pa'], 0)

    def test_pitcher_entry_gets_role(self):
        info = {'id': 2, 'full_name': 'Rhy Liever', 'position': 'P', 'team_name': 'Mets'}
        [p] = fd.build_players(info, pitcher_person(starts=0, games=60), SEASONS)
        self.assertTrue(p['is_pitcher'])
        self.assertEqual(p['position'], 'RP')

    def test_two_way_player_gets_two_entries(self):
        info = {'id': 660271, 'full_name': 'Two Way', 'position': 'TWP', 'team_name': 'Dodgers'}
        bat, pit = fd.build_players(info, two_way_person(), SEASONS)
        self.assertEqual(bat['id'], 660271)
        self.assertEqual(pit['id'], '660271-P')
        for p in (bat, pit):
            self.assertTrue(p['two_way'])
            self.assertEqual(p['mlb_id'], 660271)
        self.assertFalse(bat['is_pitcher'])
        self.assertTrue(pit['is_pitcher'])
        self.assertEqual(bat['primary_position'], 'DH')
        self.assertEqual(pit['position'], 'SP')
        self.assertGreater(bat['stats']['2026']['pa'], 0)
        self.assertGreater(pit['stats']['2026']['ip'], 0)


class SaveGuardTests(unittest.TestCase):
    def player(self, n_stats=1):
        return {'stats': {'2025': {'pa': n_stats}, '2026': {'pa': n_stats}}}

    def test_no_existing_data_is_always_fine(self):
        self.assertIsNone(fd.check_against_existing([self.player()], [], SEASONS))

    def test_player_count_drop_over_five_percent_is_refused(self):
        old = [self.player()] * 100
        self.assertIsNone(fd.check_against_existing([self.player()] * 95, old, SEASONS))
        self.assertIn('player count fell from 100 to 94',
                      fd.check_against_existing([self.player()] * 94, old, SEASONS))

    def test_players_coming_back_without_stats_is_refused(self):
        old = [self.player()] * 100
        new = [self.player()] * 90 + [self.player(0)] * 10
        self.assertEqual(fd.check_against_existing(new, old, SEASONS),
                         'players with 2025 stats fell from 100 to 90')

    def test_a_season_new_to_this_run_is_not_compared(self):
        old = [{'stats': {'2025': {'pa': 1}}}] * 10
        new = [{'stats': {'2025': {'pa': 1}, '2026': {'pa': 0}}}] * 10
        self.assertIsNone(fd.check_against_existing(new, old, SEASONS))


# --- Projections and saving --------------------------------------------------------------

def sample_players():
    out = []
    for i in range(6):
        out += fd.build_players({'id': 100 + i, 'full_name': f'Batter {i}', 'position': 'RF',
                                 'team_name': 'T'}, batter_person(), SEASONS)
        out += fd.build_players({'id': 200 + i, 'full_name': f'Pitcher {i}', 'position': 'P',
                                 'team_name': 'T'}, pitcher_person(), SEASONS)
    return out


class ProjectionTests(unittest.TestCase):
    def test_add_projections_fills_projection_year_and_fip(self):
        players = sample_players()
        league = fd.add_projections(players, SEASONS, 2027)
        self.assertEqual(set(league), {'2024', '2025', '2026'})
        for p in players:
            line = p['stats']['2027']
            self.assertIn('ip' if p['is_pitcher'] else 'pa', line)
            if p['is_pitcher']:
                self.assertIn('fip', p['stats']['2026'])

    def test_add_projections_clears_stale_projection_sources(self):
        players = sample_players()
        players[0]['projection_source'] = 'steamer'
        players[0]['projections'] = {'marcel': {}}
        fd.add_projections(players, SEASONS, 2027)
        self.assertNotIn('projection_source', players[0])
        self.assertNotIn('projections', players[0])

    def test_build_projections_reports_systems_from_csvs(self):
        players = sample_players()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'zips-batters.csv')
            with open(path, 'w', encoding='utf-8') as f:
                f.write('Name,PA,AB,H,HR,MLBAMID\nBatter 0,600,540,160,35,100\nNobody,10,9,1,0,999\n')
            files = {'zips': {False: path, True: None}}
            with mock.patch.object(projection_csv, 'find_files', return_value=files), quiet():
                league, systems = fd.build_projections(players, SEASONS, 2027)
        self.assertEqual(systems, [{'key': 'zips', 'label': 'ZiPS', 'players': 1}])
        b0 = next(p for p in players if p['id'] == 100)
        self.assertEqual(b0['projection_source'], 'zips')
        self.assertEqual(b0['stats']['2027']['hr'], 35)
        self.assertIn('marcel', b0['projections'])
        self.assertIn('fip_constant', league['2026'])

    def test_build_projections_with_no_csvs_is_marcel_only(self):
        players = sample_players()
        with mock.patch.object(projection_csv, 'find_files', return_value={}):
            _, systems = fd.build_projections(players, SEASONS, 2027)
        self.assertEqual(systems, [])
        self.assertTrue(all('projection_source' not in p for p in players))


class DataDirTestCase(unittest.TestCase):
    """Points fetch_data at a temporary data/ and keeps local projection CSVs out of it."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        for patcher in (mock.patch.object(fd, 'DATA_DIR', self.dir),
                        mock.patch.object(projection_csv, 'find_files', return_value={}),
                        mock.patch.object(fd.time, 'sleep')):
            patcher.start()
            self.addCleanup(patcher.stop)

    def load(self, name):
        with open(os.path.join(self.dir, name), encoding='utf-8') as f:
            return json.load(f)


class SaveDataTests(DataDirTestCase):
    def test_save_data_writes_all_files(self):
        players = sample_players()
        league, systems = fd.build_projections(players, SEASONS, 2027)
        with quiet() as out:
            fd.save_data(players, SEASONS, 2027, league, systems, timestamp='2026-11-01T00:00:00')
        self.assertEqual(len(self.load('players.json')), 12)
        self.assertEqual(len(self.load('batters.json')), 6)
        self.assertEqual(len(self.load('pitchers.json')), 6)
        meta = self.load('last_updated.json')
        self.assertEqual(meta['timestamp'], '2026-11-01T00:00:00')
        self.assertEqual(meta['seasons'], SEASONS)
        self.assertEqual(meta['projection_year'], 2027)
        self.assertEqual(meta['projection_method'], 'marcel')
        self.assertEqual(meta['projection_systems'], [])
        self.assertIn('12 Marcel only', out.getvalue())

    def test_projection_method_is_the_default_system(self):
        systems = [{'key': 'atc', 'label': 'ATC', 'players': 3}, {'key': 'zips', 'label': 'ZiPS', 'players': 1}]
        with quiet() as out:
            fd.save_data([], SEASONS, 2027, {}, systems)
        self.assertEqual(self.load('last_updated.json')['projection_method'], 'atc')
        self.assertIn('3 ATC, 1 ZiPS', out.getvalue())

    def test_rebuild_projections_keeps_stats_and_fetch_time(self):
        players = sample_players()
        league, systems = fd.build_projections(players, SEASONS, 2027)
        with quiet():
            fd.save_data(players, SEASONS, 2027, league, systems, timestamp='2026-01-01T00:00:00')
        before = self.load('players.json')
        with quiet():
            self.assertTrue(fd.rebuild_projections())
        after = self.load('players.json')
        self.assertEqual(self.load('last_updated.json')['timestamp'], '2026-01-01T00:00:00')
        self.assertEqual([p['stats']['2026'] for p in before], [p['stats']['2026'] for p in after])
        self.assertEqual([p['stats']['2027'] for p in before], [p['stats']['2027'] for p in after])


# --- Network: mocked MLB Stats API -------------------------------------------------------

class FetchPersonTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(fd.time, 'sleep')
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)

    def test_returns_the_person(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(200, {'people': [{'id': 1}]})):
            self.assertEqual(fd.fetch_person(1, 'h'), {'id': 1})

    def test_no_people_is_none(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(200, {'people': []})):
            self.assertIsNone(fd.fetch_person(1, 'h'))

    def test_client_errors_are_not_retried(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(404)) as get, quiet():
            self.assertIsNone(fd.fetch_person(1, 'h'))
        self.assertEqual(get.call_count, 1)

    def test_server_errors_rate_limits_and_network_errors_are_retried(self):
        responses = [FakeResponse(503), FakeResponse(429), FakeResponse(200, {'people': [{'id': 1}]})]
        with mock.patch.object(fd.requests, 'get', side_effect=responses) as get:
            self.assertEqual(fd.fetch_person(1, 'h'), {'id': 1})
        self.assertEqual(get.call_count, 3)
        self.assertEqual([c.args[0] for c in self.sleep.call_args_list], [2, 4])  # backs off

        errors = [requests.ConnectionError('reset')] * fd.FETCH_ATTEMPTS
        with mock.patch.object(fd.requests, 'get', side_effect=errors) as get, quiet() as out:
            self.assertIsNone(fd.fetch_person(1, 'h'))
        self.assertEqual(get.call_count, fd.FETCH_ATTEMPTS)
        self.assertIn('after 3 attempts: reset', out.getvalue())


class FakeApi:
    """Answers requests.get like the MLB Stats API, from dicts of teams, rosters and people."""

    def __init__(self, rosters, people, failing_rosters=()):
        self.rosters, self.people, self.failing = rosters, people, set(failing_rosters)
        self.urls = []

    def get(self, url, timeout=None):
        self.urls.append(url)
        assert timeout, 'every request needs a timeout'
        path = url.split('/api', 1)[1]
        if path.startswith('/v1/teams?'):
            return FakeResponse(200, {'teams': [{'id': t, 'name': f'Team {t}'} for t in self.rosters]})
        if path.startswith('/v1/teams/'):
            team = int(path.split('/')[3])
            if team in self.failing:
                return FakeResponse(500)
            return FakeResponse(200, {'roster': self.rosters[team]})
        if path.startswith('/v1/people/'):
            pid = int(path.split('/')[3].split('?')[0])
            person = self.people.get(pid)
            return FakeResponse(200, {'people': [person]}) if person else FakeResponse(404)
        raise AssertionError(f'unexpected URL {url}')


def roster_entry(pid, name, pos):
    return {'person': {'id': pid, 'fullName': name}, 'position': {'abbreviation': pos}}


class FetchRosterTests(unittest.TestCase):
    def test_one_entry_per_player_and_failed_teams_skipped(self):
        api = FakeApi({1: [roster_entry(10, 'A', 'RF'), roster_entry(11, 'B', 'P')],
                       2: [roster_entry(10, 'A', 'RF')],   # traded: on two rosters
                       3: [roster_entry(12, 'C', 'C')]},
                      {}, failing_rosters=[3])
        with mock.patch.object(fd.requests, 'get', side_effect=api.get), \
                mock.patch.object(fd.time, 'sleep'), quiet() as out:
            roster = fd.fetch_roster(2026)
        self.assertEqual(sorted(p['id'] for p in roster), [10, 11])
        self.assertEqual(next(p for p in roster if p['id'] == 10)['team_name'], 'Team 1')
        self.assertIn('Error fetching roster for team 3: 500', out.getvalue())

    def test_team_list_failure_raises(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(503)):
            with self.assertRaises(requests.HTTPError):
                fd.fetch_roster(2026)


class FetchPlayersDataTests(DataDirTestCase):
    def api(self, n=20, missing=()):
        roster = [roster_entry(i, f'Batter {i}', 'RF') for i in range(1, n + 1)]
        roster += [roster_entry(1000 + i, f'Pitcher {i}', 'P') for i in range(1, n + 1)]
        roster.append(roster_entry(5000, 'Two Way', 'TWP'))
        people = {i: batter_person() for i in range(1, n + 1)}
        people.update({1000 + i: pitcher_person() for i in range(1, n + 1)})
        people[5000] = two_way_person()
        for pid in missing:
            people.pop(pid)
        return FakeApi({1: roster}, people)

    def run_fetch(self, api, **kwargs):
        with mock.patch.object(fd.requests, 'get', side_effect=api.get), quiet() as out:
            ok = fd.fetch_players_data(SEASONS, **kwargs)
        return ok, out.getvalue()

    def test_full_run_writes_data(self):
        ok, _ = self.run_fetch(self.api())
        self.assertTrue(ok)
        players = self.load('players.json')
        self.assertEqual(len(players), 42)  # 20 + 20 + two entries for the two-way player
        self.assertIn('5000-P', [p['id'] for p in players])
        meta = self.load('last_updated.json')
        self.assertEqual(meta['projection_year'], 2027)
        self.assertTrue(all('2027' in p['stats'] for p in players))

    def test_players_who_left_rosters_are_kept(self):
        self.run_fetch(self.api())
        # Next run: batter 1 and the two-way player are off every roster but still in the API
        api = self.api()
        api.rosters[1] = [r for r in api.rosters[1] if r['person']['id'] not in (1, 5000)]
        ok, _ = self.run_fetch(api)
        self.assertTrue(ok)
        ids = [p['id'] for p in self.load('players.json')]
        self.assertEqual(len(ids), 42)
        self.assertIn(1, ids)
        self.assertIn('5000-P', ids)  # rebuilt as a two-way player, not a lone batter
        self.assertEqual(len(ids), len(set(ids)))

    def test_refuses_to_overwrite_after_many_failed_fetches(self):
        self.run_fetch(self.api())
        before = self.load('players.json')
        ok, out = self.run_fetch(self.api(missing=range(1, 11)))
        self.assertFalse(ok)
        self.assertIn('Not saving: player count fell from 42 to 32', out)
        self.assertEqual(self.load('players.json'), before)  # untouched

        ok, out = self.run_fetch(self.api(missing=range(1, 11)), force=True)
        self.assertTrue(ok)
        self.assertIn('Saving despite', out)
        self.assertEqual(len(self.load('players.json')), 32)

    def test_nothing_fetched_leaves_data_alone(self):
        ok, out = self.run_fetch(FakeApi({1: []}, {}))
        self.assertFalse(ok)
        self.assertIn('No players fetched', out)
        self.assertFalse(os.path.exists(os.path.join(self.dir, 'players.json')))

    def test_one_bad_player_does_not_stop_the_run(self):
        api = self.api()
        api.people[3] = {'stats': [{'group': {}}]}  # malformed record
        ok, out = self.run_fetch(api)
        self.assertTrue(ok)
        self.assertIn('Error processing player Batter 3', out)
        self.assertEqual(len(self.load('players.json')), 41)

    def test_roster_failure_returns_false(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(503)), quiet() as out:
            self.assertFalse(fd.fetch_players_data(SEASONS))
        self.assertIn('Error fetching players data', out.getvalue())

    def test_projection_year_defaults_to_the_year_after(self):
        self.run_fetch(self.api(n=3), projection_year=None)
        self.assertEqual(self.load('last_updated.json')['projection_year'], 2027)


class FetchPlayerByNameTests(unittest.TestCase):
    def test_returns_people(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(200, {'people': [{'id': 1}]})):
            self.assertEqual(fd.fetch_player_by_name('Judge'), [{'id': 1}])

    def test_name_is_sent_as_a_query_parameter(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(200, {})) as get:
            fd.fetch_player_by_name('A&B=C')
        _, kwargs = get.call_args
        self.assertEqual(kwargs.get('params'), {'names': 'A&B=C'})

    def test_failures_are_none(self):
        with mock.patch.object(fd.requests, 'get', return_value=FakeResponse(500)):
            self.assertIsNone(fd.fetch_player_by_name('x'))
        with mock.patch.object(fd.requests, 'get', side_effect=requests.Timeout('slow')), quiet():
            self.assertIsNone(fd.fetch_player_by_name('x'))


if __name__ == '__main__':
    unittest.main()

"""Fetch MLB stats and write data/*.json.

Each player gets a `stats` object keyed by season year, e.g. {"2024": {...}, "2025": {...}}.
The year after the last season holds the projection. data/last_updated.json records which
seasons are in the file and which year is the projection; the web page builds its season
tabs from that, so DEFAULT_SEASONS below is the only place the years are written down.

Batters' lines hold batting stats and pitchers' lines pitching stats (see projections.py for
the keys). The projection uses Steamer where projections/steamer-*.csv cover a player (steamer.py)
and the Marcel method (projections.py) for everyone else.

Existing players in data/players.json are kept and updated.

Usage: python fetch_data.py [--seasons YEAR ...] [--projection-year YEAR] [--force]
       python fetch_data.py --projections-only   # after adding Steamer CSVs (see steamer.py)
"""
import argparse
import json
import os
import time
from datetime import datetime

import requests

import projections as proj
import steamer

BASE_URL = "https://statsapi.mlb.com/api"
DATA_DIR = 'data'
# The one season setting: completed/current seasons to fetch. The projection is the year after.
# To roll over to a new season, add it here (and drop the oldest if you like).
DEFAULT_SEASONS = [2024, 2025, 2026]
PITCHER_POSITIONS = ['P', 'SP', 'RP', 'CL']
# Two-way players (Ohtani) get two entries: a batter keyed by MLB id and a pitcher keyed
# by "<id>-P", the way fantasy sites list them, since the page ranks batters and pitchers apart
TWO_WAY_POSITIONS = ['TWP']
ELIGIBILITY_GAMES = 20  # games at a position in the latest season to be eligible there
# Refuse to overwrite data/ when a run loses more than this share of players, or of players
# with stats in a season both files cover. Guards against a half-failed fetch; --force skips it.
MAX_DROP = 0.05
FETCH_ATTEMPTS = 3
SP_START_SHARE = 0.5    # share of appearances that are starts for a pitcher to count as SP
FIELDING_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF']


def innings_to_float(ip):
    whole, _, frac = str(ip or 0).partition('.')
    return int(whole or 0) + int(frac or 0) / 3


def is_combined_row(split):
    """True for the extra all-teams row the API adds when a player changed teams mid-season.

    A traded player's season comes back as one row per team plus a combined row (no team,
    numTeams > 1). Counting both doubles the season, so callers skip the combined row and
    add up the per-team rows.
    """
    return (split.get('numTeams') or 1) > 1


# API field -> our key, for adding up a season's per-team rows
BAT_FIELDS = {'plateAppearances': 'pa', 'atBats': 'ab', 'hits': 'hits', 'doubles': 'doubles',
              'triples': 'triples', 'homeRuns': 'hr', 'runs': 'runs', 'rbi': 'rbi',
              'stolenBases': 'steals', 'caughtStealing': 'cs', 'baseOnBalls': 'bb',
              'strikeOuts': 'so', 'hitByPitch': 'hbp', 'sacFlies': 'sf'}
PIT_FIELDS = {'gamesPitched': 'g', 'gamesStarted': 'gs', 'wins': 'wins', 'losses': 'losses',
              'saves': 'saves', 'holds': 'holds', 'strikeOuts': 'strikeouts', 'baseOnBalls': 'walks',
              'hitBatsmen': 'hbp', 'hits': 'hits_allowed', 'homeRuns': 'hr_allowed',
              'runs': 'runs_scored', 'earnedRuns': 'er'}


def season_counts(splits, is_pitcher):
    """Add up a season's per-team rows (several when a player was traded) into counting stats."""
    fields = PIT_FIELDS if is_pitcher else BAT_FIELDS
    totals = {key: 0 for key in fields.values()}
    ip = 0.0
    for s in splits:
        st = s['stat']
        for field, key in fields.items():
            totals[key] += int(st.get(field, 0) or 0)
        if is_pitcher:
            ip += innings_to_float(st.get('inningsPitched'))
    if is_pitcher:
        totals['ip'] = ip
    return totals


def season_lines(person, is_pitcher, seasons):
    """{season: stat line} for each requested season; zeros for seasons the player missed."""
    group = 'pitching' if is_pitcher else 'hitting'
    by_season = {}
    for stat_group in person.get('stats', []):
        if stat_group['group']['displayName'] != group:
            continue
        for split in stat_group.get('splits', []):
            if split.get('season') and 'stat' in split and not is_combined_row(split):
                by_season.setdefault(int(split['season']), []).append(split)
    lines = {}
    for season in sorted(seasons):
        if season not in by_season:
            lines[str(season)] = proj.empty_line(is_pitcher)
            continue
        counts = season_counts(by_season[season], is_pitcher)
        lines[str(season)] = proj.pitching_line(counts) if is_pitcher else proj.batting_line(counts)
    return lines


def age_in(birth_date, year):
    """Age during a season (as of July 1, the usual baseball convention), or None."""
    try:
        y, m, d = (int(x) for x in birth_date.split('-'))
    except (AttributeError, ValueError):
        return None
    return year - y - (1 if (m, d) > (7, 1) else 0)


def add_projections(players, seasons, projection_year):
    """Fill in each player's projection year, using league totals from all fetched players.

    Also sets every season's FIP with that season's own FIP constant.
    """
    seasons = sorted(seasons)
    recent = [str(s) for s in seasons[::-1]]  # newest first
    league = {}
    for season in map(str, seasons):
        bat = [p['stats'][season] for p in players if not p['is_pitcher']]
        pit = [p['stats'][season] for p in players if p['is_pitcher']]
        league[season] = {
            'bat': proj.league_totals(bat, proj.BAT_COUNTS),
            'pit': proj.league_totals(pit, proj.PIT_COUNTS),
        }
        league[season]['fip'] = proj.fip_constant(league[season]['pit'])

    for p in players:
        p.pop('projection_source', None)  # set again below if Steamer covers the player
        age = age_in(p.get('birth_date'), projection_year)
        history = [p['stats'][s] for s in recent]
        if p['is_pitcher']:
            for s in recent:
                p['stats'][s] = proj.pitching_line(p['stats'][s], league[s]['fip'])
            history = [p['stats'][s] for s in recent]
            p['stats'][str(projection_year)] = proj.project_pitcher(
                history, [league[s]['pit'] for s in recent], age, league[recent[0]]['fip'])
        else:
            p['stats'][str(projection_year)] = proj.project_batter(
                history, [league[s]['bat'] for s in recent], age)
    return {s: {'fip_constant': league[s]['fip']} for s in league}


def build_projections(players, seasons, projection_year):
    """Marcel for everyone, then Steamer for players in projections/steamer-*.csv.

    Returns (league, sources): FIP constants per season, and how many players each
    projection system covers.
    """
    league = add_projections(players, seasons, projection_year)
    steamer.apply_files(players, projection_year, league[str(max(seasons))]['fip_constant'])
    n_steamer = sum(1 for p in players if p.get('projection_source') == 'steamer')
    return league, {'steamer': n_steamer, 'marcel': len(players) - n_steamer}


def save_data(players, seasons, projection_year, league, sources):
    batters = [p for p in players if not p['is_pitcher']]
    pitchers = [p for p in players if p['is_pitcher']]
    for name, data in (('players', players), ('batters', batters), ('pitchers', pitchers)):
        with open(os.path.join(DATA_DIR, f'{name}.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f)
    with open(os.path.join(DATA_DIR, 'last_updated.json'), 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'total_players': len(players),
            'batters': len(batters),
            'pitchers': len(pitchers),
            'seasons': sorted(seasons),
            'projection_year': projection_year,
            'projection_method': 'steamer' if sources['steamer'] else 'marcel',
            'projection_sources': sources,
            'league': league,
        }, f)
    print(f"Saved {len(players)} players ({len(batters)} batters, {len(pitchers)} pitchers); "
          f"{projection_year} projections: {sources['steamer']} Steamer, {sources['marcel']} Marcel")


def rebuild_projections():
    """Recompute projections from the stats already in data/ (no MLB API calls), e.g. after
    adding or replacing the Steamer CSVs."""
    with open(os.path.join(DATA_DIR, 'last_updated.json')) as f:
        meta = json.load(f)
    with open(os.path.join(DATA_DIR, 'players.json'), encoding='utf-8') as f:
        players = json.load(f)
    seasons, projection_year = meta['seasons'], meta['projection_year']
    league, sources = build_projections(players, seasons, projection_year)
    save_data(players, seasons, projection_year, league, sources)
    return True


def eligible_positions(person, season, roster_position, min_games=ELIGIBILITY_GAMES):
    """Positions with at least min_games fielded in `season`, most games first.

    The roster position is always included so every player has at least one position.
    """
    games = {}
    for stat_group in person.get('stats', []):
        if stat_group['group']['displayName'] != 'fielding':
            continue
        for split in stat_group.get('splits', []):
            pos = split.get('position', {}).get('abbreviation')
            if is_combined_row(split):
                continue
            if split.get('season') == str(season) and pos in FIELDING_POSITIONS:
                games[pos] = games.get(pos, 0) + int(split.get('stat', {}).get('gamesPlayed', 0) or 0)
    eligible = [p for p, g in sorted(games.items(), key=lambda x: -x[1]) if g >= min_games]
    if roster_position and roster_position not in eligible:
        eligible.insert(0, roster_position)
    return eligible or [roster_position or '']


def pitcher_role(person, seasons):
    """'SP' or 'RP' from the most recent season with pitching appearances, else 'P'."""
    for season in sorted(seasons, reverse=True):
        games = starts = 0
        for stat_group in person.get('stats', []):
            if stat_group['group']['displayName'] != 'pitching':
                continue
            for split in stat_group.get('splits', []):
                if split.get('season') == str(season) and not is_combined_row(split):
                    st = split.get('stat', {})
                    games += int(st.get('gamesPlayed', 0) or 0)
                    starts += int(st.get('gamesStarted', 0) or 0)
        if games:
            return 'SP' if starts / games >= SP_START_SHARE else 'RP'
    return 'P'


def latest_team(person, season):
    """Most recent team name in a player's stat splits for a season, or None."""
    team = None
    for stat_group in person.get('stats', []):
        for split in stat_group.get('splits', []):
            if split.get('season') == str(season) and split.get('team', {}).get('name'):
                team = split['team']['name']
    return team


def fetch_roster(season):
    teams = requests.get(f"{BASE_URL}/v1/teams?sportId=1&season={season}", timeout=30)
    teams.raise_for_status()
    players = {}
    for team in teams.json()['teams']:
        url = f"{BASE_URL}/v1/teams/{team['id']}/roster?rosterType=fullSeason&season={season}"
        resp = requests.get(url, timeout=30)
        if resp.status_code != 200:
            print(f"Error fetching roster for team {team['id']}: {resp.status_code}")
            continue
        for p in resp.json().get('roster', []):
            # Players traded mid-season appear on several rosters; keep one entry per player
            players.setdefault(p['person']['id'], {
                'id': p['person']['id'],
                'full_name': p['person']['fullName'],
                'position': p.get('position', {}).get('abbreviation', ''),
                'team_name': team['name'],
            })
        time.sleep(0.05)
    return list(players.values())


def fetch_person(player_id, hydrate):
    """One player's record from the API, retrying transient failures. None if it can't be had."""
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            resp = requests.get(f"{BASE_URL}/v1/people/{player_id}?hydrate={hydrate}", timeout=30)
            if resp.status_code == 200:
                people = resp.json().get('people')
                return people[0] if people else None
            if resp.status_code < 500 and resp.status_code != 429:
                print(f"Skipping player {player_id}: HTTP {resp.status_code}")
                return None
            reason = f"HTTP {resp.status_code}"
        except requests.RequestException as e:
            reason = str(e)
        if attempt < FETCH_ATTEMPTS:
            time.sleep(2 * attempt)
    print(f"Skipping player {player_id} after {FETCH_ATTEMPTS} attempts: {reason}")
    return None


def players_with_stats(players, season):
    """How many players have any non-zero stat in a season."""
    return sum(1 for p in players if any(p.get('stats', {}).get(str(season), {}).values()))


def check_against_existing(players, existing, seasons):
    """A reason to refuse saving `players` over `existing`, or None if it looks complete.

    Players who leave a roster are carried over from the existing file, so a normal run never
    has fewer players than before; a drop means fetches failed. The per-season check catches
    a run where players came back but with empty stats.
    """
    if not existing:
        return None
    old, new = len(existing), len(players)
    if new < old * (1 - MAX_DROP):
        return f"player count fell from {old} to {new}"
    old_seasons = {s for p in existing for s in p.get('stats', {})}
    for season in sorted(seasons):
        if str(season) not in old_seasons:
            continue  # a season new to this run has nothing to compare against
        before = players_with_stats(existing, season)
        after = players_with_stats(players, season)
        if after < before * (1 - MAX_DROP):
            return f"players with {season} stats fell from {before} to {after}"
    return None


def build_players(info, person, seasons):
    """The data entries for one roster player: one, or two for a two-way player."""
    team = latest_team(person, max(seasons)) or info['team_name']
    two_way = info['position'] in TWO_WAY_POSITIONS
    if two_way:
        roles = [False, True]  # batter, then pitcher
    else:
        roles = [info['position'] in PITCHER_POSITIONS]

    entries = []
    for is_pitcher in roles:
        if is_pitcher:
            positions = [pitcher_role(person, seasons)]
        else:
            positions = eligible_positions(person, max(seasons), 'DH' if two_way else info['position'])
        player = {
            'id': f"{info['id']}-P" if two_way and is_pitcher else info['id'],
            'name': info['full_name'],
            'team': team,
            'position': '/'.join(positions),
            'primary_position': positions[0],
            'is_pitcher': is_pitcher,
            'birth_date': person.get('birthDate'),
        }
        if two_way:
            player['two_way'] = True
            player['mlb_id'] = info['id']
        player['stats'] = season_lines(person, is_pitcher, seasons)
        entries.append(player)
    return entries


def fetch_players_data(seasons=None, projection_year=None, force=False):
    """Fetch players and stats from the MLB Stats API and save as JSON files."""
    seasons = seasons or DEFAULT_SEASONS
    projection_year = projection_year or max(seasons) + 1
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        existing = {}
        path = os.path.join(DATA_DIR, 'players.json')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                existing = {p['id']: p for p in json.load(f)}

        print(f"Fetching rosters for {max(seasons)}...")
        roster = fetch_roster(max(seasons))
        print(f"Found {len(roster)} players")

        # Keep players from earlier data who are no longer on a roster
        roster_ids = {p['id'] for p in roster}
        for old in existing.values():
            pid = old.get('mlb_id', old['id'])  # a two-way pitcher entry's id is "<id>-P"
            if pid in roster_ids:
                continue
            roster_ids.add(pid)
            position = 'TWP' if old.get('two_way') else (
                old.get('primary_position') or old.get('position', '').split('/')[0])
            roster.append({'id': pid, 'full_name': old['name'], 'position': position,
                           'team_name': old.get('team', '')})

        hydrate = "stats(group=[hitting,pitching,fielding],type=[yearByYear])"
        players = []
        for idx, info in enumerate(roster):
            try:
                person = fetch_person(info['id'], hydrate)
                if person is None:
                    continue
                players.extend(build_players(info, person, seasons))
                if idx % 100 == 0:
                    print(f"Processed {idx}/{len(roster)} players...")
                time.sleep(0.05)
            except Exception as e:
                print(f"Error processing player {info['full_name']}: {e}")

        if not players:
            print("No players fetched; leaving existing data untouched")
            return False
        league, sources = build_projections(players, seasons, projection_year)
        problem = check_against_existing(players, list(existing.values()), seasons)
        if problem and not force:
            print(f"Not saving: {problem}. Existing data left untouched; use --force to save anyway.")
            return False
        if problem:
            print(f"Saving despite: {problem} (--force)")

        save_data(players, seasons, projection_year, league, sources)
        return True
    except Exception as e:
        print(f"Error fetching players data: {e}")
        return False


def fetch_player_by_name(player_name):
    """Search for a player by name in the MLB Stats API."""
    try:
        response = requests.get(f"{BASE_URL}/v1/people/search?names={player_name}", timeout=30)
        if response.status_code != 200:
            return None
        return response.json().get('people', [])
    except Exception as e:
        print(f"Error searching for player: {e}")
        return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Update player data from the MLB Stats API")
    parser.add_argument('--seasons', type=int, nargs='+', default=DEFAULT_SEASONS)
    parser.add_argument('--projection-year', type=int)
    parser.add_argument('--force', action='store_true',
                        help='save even if the run lost players or stats compared with data/')
    parser.add_argument('--projections-only', action='store_true',
                        help='recompute projections (Marcel + Steamer CSVs) from data/ without fetching')
    args = parser.parse_args()
    if args.projections_only:
        raise SystemExit(0 if rebuild_projections() else 1)
    raise SystemExit(0 if fetch_players_data(args.seasons, args.projection_year, args.force) else 1)

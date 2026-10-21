"""Fetch MLB stats and write data/*.json.

Output keys per player: stats_2024, stats_2025_actual, stats_2026_actual and
stats_2027_projected. Existing players in data/players.json are kept and updated.

Usage: python fetch_data.py [--seasons 2024 2025 2026] [--projection-year 2027]
"""
import argparse
import json
import os
import time
from datetime import datetime

import requests

BASE_URL = "https://statsapi.mlb.com/api"
DATA_DIR = 'data'
DEFAULT_SEASONS = [2024, 2025, 2026]
PITCHER_POSITIONS = ['P', 'SP', 'RP', 'CL']
ELIGIBILITY_GAMES = 20  # games at a position in the latest season to be eligible there
SP_START_SHARE = 0.5    # share of appearances that are starts for a pitcher to count as SP
FIELDING_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF']
FIP_CONSTANT = 3.10
# Newest season first; used to blend past seasons into the projection.
PROJECTION_WEIGHTS = [0.5, 0.3, 0.2]

BATTING_KEYS = ['avg', 'runs', 'rbi', 'steals', 'hr', 'hits', 'babip', 'ab']
PITCHING_KEYS = ['wins', 'era', 'strikeouts', 'walks', 'saves', 'runs_scored', 'fip', 'ip', 'hits_allowed']
# ab/ip/hits_allowed give volume for weighting AVG, ERA and WHIP in roto valuation
RATE_KEYS = {'avg': 3, 'babip': 3, 'era': 2, 'fip': 2, 'ip': 1}


def season_key(season, projection_year):
    if season == projection_year:
        return f'stats_{season}_projected'
    return 'stats_2024' if season == 2024 else f'stats_{season}_actual'


def empty_stats():
    stats = {k: 0 for k in BATTING_KEYS + PITCHING_KEYS}
    for k in RATE_KEYS:
        stats[k] = 0.0
    return stats


def innings_to_float(ip):
    whole, _, frac = str(ip or 0).partition('.')
    return int(whole or 0) + int(frac or 0) / 3


def batting_from_splits(splits):
    """Combine a season's splits (one per team when a player was traded)."""
    t = {k: 0 for k in ('ab', 'h', 'hr', 'so', 'sf', 'runs', 'rbi', 'sb')}
    for s in splits:
        st = s['stat']
        t['ab'] += int(st.get('atBats', 0) or 0)
        t['h'] += int(st.get('hits', 0) or 0)
        t['hr'] += int(st.get('homeRuns', 0) or 0)
        t['so'] += int(st.get('strikeOuts', 0) or 0)
        t['sf'] += int(st.get('sacFlies', 0) or 0)
        t['runs'] += int(st.get('runs', 0) or 0)
        t['rbi'] += int(st.get('rbi', 0) or 0)
        t['sb'] += int(st.get('stolenBases', 0) or 0)
    denom = t['ab'] - t['so'] - t['hr'] + t['sf']
    return {
        'avg': round(t['h'] / t['ab'], 3) if t['ab'] else 0.0,
        'runs': t['runs'], 'rbi': t['rbi'], 'steals': t['sb'], 'hr': t['hr'], 'hits': t['h'],
        'ab': t['ab'],
        'babip': round((t['h'] - t['hr']) / denom, 3) if denom > 0 else 0.0,
    }


def pitching_from_splits(splits):
    t = {k: 0 for k in ('w', 'er', 'k', 'bb', 'sv', 'r', 'hr', 'h')}
    ip = 0.0
    for s in splits:
        st = s['stat']
        t['w'] += int(st.get('wins', 0) or 0)
        t['er'] += int(st.get('earnedRuns', 0) or 0)
        t['k'] += int(st.get('strikeOuts', 0) or 0)
        t['bb'] += int(st.get('baseOnBalls', 0) or 0)
        t['sv'] += int(st.get('saves', 0) or 0)
        t['r'] += int(st.get('runs', 0) or 0)
        t['hr'] += int(st.get('homeRuns', 0) or 0)
        t['h'] += int(st.get('hits', 0) or 0)
        ip += innings_to_float(st.get('inningsPitched'))
    return {
        'ip': round(ip, 1), 'hits_allowed': t['h'],
        'wins': t['w'],
        'era': round(t['er'] * 9 / ip, 2) if ip else 0.0,
        'strikeouts': t['k'], 'walks': t['bb'], 'saves': t['sv'], 'runs_scored': t['r'],
        'fip': round((13 * t['hr'] + 3 * t['bb'] - 2 * t['k']) / ip + FIP_CONSTANT, 2) if ip else 0.0,
    }


def project_next_season(history, is_pitcher):
    """Weighted blend of recent seasons (newest first). Seasons with no activity are skipped."""
    keys = PITCHING_KEYS if is_pitcher else BATTING_KEYS
    active = [h for h in history if any(h.get(k) for k in keys)]
    weights = PROJECTION_WEIGHTS[:len(active)]
    total = sum(weights)
    proj = empty_stats()
    if not active:
        return proj
    for k in keys:
        value = sum(w * h.get(k, 0) for w, h in zip(weights, active)) / total
        proj[k] = round(value, RATE_KEYS[k]) if k in RATE_KEYS else int(round(value))
    return proj


def build_player_stats(person, is_pitcher, seasons, projection_year):
    group = 'pitching' if is_pitcher else 'hitting'
    by_season = {}
    for stat_group in person.get('stats', []):
        if stat_group['group']['displayName'] != group:
            continue
        for split in stat_group.get('splits', []):
            if split.get('season') and 'stat' in split:
                by_season.setdefault(int(split['season']), []).append(split)

    builder = pitching_from_splits if is_pitcher else batting_from_splits
    result, history = {}, []
    for season in sorted(seasons):
        stats = empty_stats()
        if season in by_season:
            stats.update(builder(by_season[season]))
        result[season_key(season, projection_year)] = stats
        history.append(stats)
    result[season_key(projection_year, projection_year)] = project_next_season(history[::-1], is_pitcher)
    return result


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
                if split.get('season') == str(season):
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


def fetch_players_data(seasons=None, projection_year=None):
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
        for pid, old in existing.items():
            if pid not in roster_ids:
                roster.append({'id': pid, 'full_name': old['name'],
                               'position': old.get('primary_position') or old.get('position', '').split('/')[0],
                               'team_name': old.get('team', '')})

        hydrate = "stats(group=[hitting,pitching,fielding],type=[yearByYear])"
        players = []
        for idx, info in enumerate(roster):
            try:
                resp = requests.get(f"{BASE_URL}/v1/people/{info['id']}?hydrate={hydrate}", timeout=30)
                if resp.status_code != 200 or not resp.json().get('people'):
                    print(f"Skipping player {info['id']}: HTTP {resp.status_code}")
                    continue
                person = resp.json()['people'][0]
                is_pitcher = info['position'] in PITCHER_POSITIONS
                if is_pitcher:
                    positions = [pitcher_role(person, seasons)]
                else:
                    positions = eligible_positions(person, max(seasons), info['position'])
                player = {
                    'id': info['id'],
                    'name': info['full_name'],
                    'team': latest_team(person, max(seasons)) or info['team_name'],
                    'position': '/'.join(positions),
                    'primary_position': positions[0],
                    'is_pitcher': is_pitcher,
                }
                player.update(build_player_stats(person, is_pitcher, seasons, projection_year))
                players.append(player)
                if idx % 100 == 0:
                    print(f"Processed {idx}/{len(roster)} players...")
                time.sleep(0.05)
            except Exception as e:
                print(f"Error processing player {info['full_name']}: {e}")

        if not players:
            print("No players fetched; leaving existing data untouched")
            return False

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
                'seasons': seasons,
                'projection_year': projection_year,
            }, f)
        print(f"Saved {len(players)} players ({len(batters)} batters, {len(pitchers)} pitchers)")
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
    args = parser.parse_args()
    raise SystemExit(0 if fetch_players_data(args.seasons, args.projection_year) else 1)

"""Load data/players.json into Supabase (tables defined in supabase_schema.sql).

Usage: python upload_static_to_supabase.py [--dry-run]
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
"""
import json
import os
import sys

from dotenv import load_dotenv

BATCH = 500


def build_records(players):
    player_rows, stat_rows = [], []
    for p in players:
        pid = str(p['id'])
        player_rows.append({
            'player_id': pid,
            'name': p['name'],
            'team': p.get('team'),
            'position': p.get('position'),
            'primary_position': p.get('position'),
        })
        # Every season in the file is uploaded, including the projection year
        for season, s in p.get('stats', {}).items():
            if not s:
                continue
            row = {'player_id': pid, 'season': int(season)}
            if p.get('is_pitcher'):
                row.update(stat_type='pitching', wins=s.get('wins', 0), era=s.get('era', 0),
                           fip=s.get('fip', 0), runs_scored=s.get('runs_scored', 0),
                           strikeouts_pitched=s.get('strikeouts', 0),
                           walks_allowed=s.get('walks', 0), saves=s.get('saves', 0),
                           innings_pitched=s.get('ip', 0), hits_allowed=s.get('hits_allowed', 0))
            else:
                row.update(stat_type='batting', hits=s.get('hits', 0), runs=s.get('runs', 0),
                           rbi=s.get('rbi', 0), home_runs=s.get('hr', 0), at_bats=s.get('ab', 0),
                           stolen_bases=s.get('steals', 0), avg=s.get('avg', 0),
                           babip=s.get('babip', 0))
            stat_rows.append(row)
    return player_rows, stat_rows


def main():
    load_dotenv()
    path = os.path.join(os.path.dirname(__file__), 'data', 'players.json')
    with open(path, encoding='utf-8') as f:
        player_rows, stat_rows = build_records(json.load(f))
    print(f'{len(player_rows)} players, {len(stat_rows)} stat rows')
    if '--dry-run' in sys.argv:
        return

    from supabase import create_client
    client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    for i in range(0, len(player_rows), BATCH):
        client.table('players').upsert(player_rows[i:i + BATCH]).execute()
    for i in range(0, len(stat_rows), BATCH):
        client.table('actual_stats').upsert(
            stat_rows[i:i + BATCH], on_conflict='player_id,season,stat_type').execute()
    print('Upload complete')


if __name__ == '__main__':
    main()

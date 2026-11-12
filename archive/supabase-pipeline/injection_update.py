"""
Scheduled Update Script for Baseball Stats
Run this daily/weekly to keep data fresh
"""

import os
import time
import socket
from urllib.parse import urlparse
from datetime import datetime, timedelta
from supabase import create_client
from pybaseball import batting_stats_range, pitching_stats_range
import requests
import pandas as pd
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

MLB_API_BASE = "https://statsapi.mlb.com/api/v1"


def supabase_dns_reachable(url: str | None) -> bool:
    """Check whether the Supabase hostname resolves via DNS."""
    if not url:
        return False
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        return False
    try:
        socket.getaddrinfo(host, None)
        return True
    except OSError:
        return False


class DailyStatsUpdater:
    """Updates stats on a daily basis"""

    @staticmethod
    def _lookup_mlb_id(fangraphs_id: str | None, name: str | None) -> str | None:
        """
        Resolve MLB ID using the player_id_mapping table. Prefer FanGraphs ID, fallback to name.
        Returns MLB ID as string, or None if not found.
        """
        try:
            if fangraphs_id:
                res = supabase.table('player_id_mapping').select('mlb_id').eq('fangraphs_id', str(fangraphs_id)).limit(1).execute()
                if res.data:
                    return str(res.data[0]['mlb_id'])
            if name:
                res2 = supabase.table('player_id_mapping').select('mlb_id').ilike('player_name', name).limit(1).execute()
                if res2.data:
                    return str(res2.data[0]['mlb_id'])
        except Exception:
            pass
        return None

    @staticmethod
    def _ensure_player(mlb_id: str | None, name: str | None):
        """Ensure a minimal player row exists to satisfy FK constraints."""
        player_key = mlb_id or name
        if not player_key:
            return
        safe_name = name or player_key
        try:
            supabase.table('players').upsert({
                'player_id': player_key,
                'name': safe_name,
                'active': True
            }).execute()
        except Exception:
            pass
    
    def get_games_today(self):
        """Check if there are games today"""
        today = datetime.now().strftime('%Y-%m-%d')
        url = f"{MLB_API_BASE}/schedule"
        params = {
            'sportId': 1,
            'date': today
        }
        
        response = requests.get(url, params=params)
        response.raise_for_status()
        
        data = response.json()
        games = data.get('dates', [])
        
        if games:
            return games[0].get('games', [])
        return []
    
    def update_recent_stats(self, days_back=7):
        """Update stats for the last N days with retry logic"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')
        
        print(f"Updating stats from {start_str} to {end_str}...")
        
        try:
            # Get batting stats with retry
            batting_df = self._fetch_with_retry(batting_stats_range, start_str, end_str)
            if batting_df is not None and not batting_df.empty:
                self._upsert_batting_stats(batting_df, datetime.now().year)
            
            # Get pitching stats with retry
            pitching_df = self._fetch_with_retry(pitching_stats_range, start_str, end_str)
            if pitching_df is not None and not pitching_df.empty:
                self._upsert_pitching_stats(pitching_df, datetime.now().year)
            
            print("✅ Recent stats updated successfully!")
            
        except Exception as e:
            print(f"❌ Error updating stats: {e}")

    def _fetch_with_retry(self, stat_func, start_date, end_date, max_retries=3):
        """Fetch stats range with exponential backoff retry."""
        for attempt in range(max_retries):
            try:
                print(f"  Fetching {start_date} to {end_date}... (attempt {attempt + 1})")
                df = stat_func(start_date, end_date)
                return df
            except IndexError:
                print("  No data available for this date range; skipping.")
                return None
            except Exception as e:
                wait_time = 2 ** attempt
                print(f"  Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
        print(f"  Failed to fetch after {max_retries} attempts.")
        return None
    
    def _upsert_batting_stats(self, df, season):
        """Helper to upsert batting stats"""
        records = []
        skipped_no_id = 0
        for _, row in df.iterrows():
            fg_id = row.get('IDfg') if 'IDfg' in row else None
            name = row.get('Name') if 'Name' in row else None
            mlb_id = self._lookup_mlb_id(str(int(fg_id)) if fg_id and not pd.isna(fg_id) else None,
                                         name if name and not pd.isna(name) else None)
            if not mlb_id:
                skipped_no_id += 1
                continue
            self._ensure_player(mlb_id, name if name and not pd.isna(name) else None)
            record = {
                'player_id': mlb_id or str(row.get('Name')),
                'season': season,
                'stat_type': 'batting',
                'games_played': int(row['G']) if 'G' in row and pd.notna(row['G']) else None,
                'at_bats': int(row['AB']) if 'AB' in row and pd.notna(row['AB']) else None,
                'runs': int(row['R']) if 'R' in row and pd.notna(row['R']) else None,
                'hits': int(row['H']) if 'H' in row and pd.notna(row['H']) else None,
                'doubles': int(row['2B']) if '2B' in row and pd.notna(row['2B']) else None,
                'triples': int(row['3B']) if '3B' in row and pd.notna(row['3B']) else None,
                'home_runs': int(row['HR']) if 'HR' in row and pd.notna(row['HR']) else None,
                'rbi': int(row['RBI']) if 'RBI' in row and pd.notna(row['RBI']) else None,
                'stolen_bases': int(row['SB']) if 'SB' in row and pd.notna(row['SB']) else None,
                'walks': int(row['BB']) if 'BB' in row and pd.notna(row['BB']) else None,
                'strikeouts': int(row['SO']) if 'SO' in row and pd.notna(row['SO']) else None,
                'avg': float(row['AVG']) if 'AVG' in row and pd.notna(row['AVG']) else None,
                'obp': float(row['OBP']) if 'OBP' in row and pd.notna(row['OBP']) else None,
                'slg': float(row['SLG']) if 'SLG' in row and pd.notna(row['SLG']) else None
            }
            records.append(record)
        
        # Batch upsert
        batch_size = 50
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            supabase.table('actual_stats').upsert(batch, on_conflict='player_id,season,stat_type').execute()
            time.sleep(0.5)  # Rate limiting
        if skipped_no_id:
            print(f"Skipped batting rows without MLB ID: {skipped_no_id}")
    
    def _upsert_pitching_stats(self, df, season):
        """Helper to upsert pitching stats"""
        records = []
        skipped_no_id = 0
        for _, row in df.iterrows():
            fg_id = row.get('IDfg') if 'IDfg' in row else None
            name = row.get('Name') if 'Name' in row else None
            mlb_id = self._lookup_mlb_id(str(int(fg_id)) if fg_id and not pd.isna(fg_id) else None,
                                         name if name and not pd.isna(name) else None)
            if not mlb_id:
                skipped_no_id += 1
                continue
            self._ensure_player(mlb_id, name if name and not pd.isna(name) else None)
            record = {
                'player_id': mlb_id or str(row.get('Name')),
                'season': season,
                'stat_type': 'pitching',
                'games_played': int(row['G']) if 'G' in row and pd.notna(row['G']) else None,
                'wins': int(row['W']) if 'W' in row and pd.notna(row['W']) else None,
                'losses': int(row['L']) if 'L' in row and pd.notna(row['L']) else None,
                'era': float(row['ERA']) if 'ERA' in row and pd.notna(row['ERA']) else None,
                'innings_pitched': float(row['IP']) if 'IP' in row and pd.notna(row['IP']) else None,
                'hits_allowed': int(row['H']) if 'H' in row and pd.notna(row['H']) else None,
                'earned_runs': int(row['ER']) if 'ER' in row and pd.notna(row['ER']) else None,
                'walks_allowed': int(row['BB']) if 'BB' in row and pd.notna(row['BB']) else None,
                'strikeouts_pitched': int(row['SO']) if 'SO' in row and pd.notna(row['SO']) else None,
                'saves': int(row['SV']) if 'SV' in row and pd.notna(row['SV']) else None,
                'whip': float(row['WHIP']) if 'WHIP' in row and pd.notna(row['WHIP']) else None
            }
            records.append(record)
        
        # Batch upsert
        batch_size = 50
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            supabase.table('actual_stats').upsert(batch, on_conflict='player_id,season,stat_type').execute()
            time.sleep(0.5)  # Rate limiting
        if skipped_no_id:
            print(f"Skipped pitching rows without MLB ID: {skipped_no_id}")
    
    def update_player_roster_changes(self):
        """Check for roster changes, trades, injuries"""
        print("Checking for roster updates...")
        
        url = f"{MLB_API_BASE}/sports/1/players"
        params = {'season': datetime.now().year}
        
        response = requests.get(url, params=params)
        response.raise_for_status()
        
        players = response.json().get('people', [])
        
        updates = []
        for player in players:
            update = {
                'player_id': str(player['id']),
                'team': player.get('currentTeam', {}).get('name'),
                'active': player.get('active', True),
                'updated_at': datetime.now().isoformat()
            }
            updates.append(update)
        
        # Batch update with retry (network/DNS failures can happen)
        batch_size = 100
        max_retries = 3
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i+batch_size]
            for attempt in range(max_retries):
                try:
                    supabase.table('players').upsert(batch).execute()
                    break
                except Exception as e:
                    wait_time = 2 ** attempt
                    print(f"Roster update batch failed: {e}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
            else:
                print("Roster update failed after retries; skipping remaining batches.")
                return
        
        print(f"✅ Updated {len(updates)} player records")


class ProjectionUpdater:
    """Updates projection scenarios"""
    
    def recalculate_fantasy_values(self, scenario_id, setting_id):
        """
        Recalculate fantasy values for a scenario
        This should be run whenever projections or settings change
        """
        print(f"Recalculating values for scenario {scenario_id}...")
        
        # Get projections
        projections = supabase.table('scenario_projections')\
            .select('*')\
            .eq('scenario_id', scenario_id)\
            .execute()
        
        # Get scoring settings
        settings = supabase.table('fantasy_settings')\
            .select('*')\
            .eq('setting_id', setting_id)\
            .execute()
        
        if not settings.data:
            print("No settings found")
            return
        
        scoring = settings.data[0]
        
        # Calculate values
        valuations = []
        for proj in projections.data:
            if proj['stat_type'] == 'batting':
                value = self._calculate_batting_value(proj, scoring)
            else:
                value = self._calculate_pitching_value(proj, scoring)
            
            valuations.append({
                'scenario_id': scenario_id,
                'setting_id': setting_id,
                'player_id': proj['player_id'],
                'calculated_value': value
            })
        
        # Sort and rank
        valuations.sort(key=lambda x: x['calculated_value'], reverse=True)
        for i, val in enumerate(valuations):
            val['rank_overall'] = i + 1
        
        # Upsert valuations
        supabase.table('player_valuations').upsert(valuations).execute()
        
        print(f"✅ Calculated {len(valuations)} player values")
    
    def _calculate_batting_value(self, proj, scoring):
        """Calculate fantasy points for batting projections"""
        if scoring['scoring_type'] != 'points':
            return 0  # Handle categories differently
        
        value = 0
        value += (proj.get('hits', 0) - proj.get('doubles', 0) - proj.get('triples', 0) - proj.get('home_runs', 0)) * (scoring.get('points_single') or 0)
        value += proj.get('doubles', 0) * (scoring.get('points_double') or 0)
        value += proj.get('triples', 0) * (scoring.get('points_triple') or 0)
        value += proj.get('home_runs', 0) * (scoring.get('points_hr') or 0)
        value += proj.get('rbi', 0) * (scoring.get('points_rbi') or 0)
        value += proj.get('runs', 0) * (scoring.get('points_run') or 0)
        value += proj.get('stolen_bases', 0) * (scoring.get('points_sb') or 0)
        value += proj.get('walks', 0) * (scoring.get('points_walk') or 0)
        value += proj.get('strikeouts', 0) * (scoring.get('points_strikeout') or 0)
        
        return round(value, 2)
    
    def _calculate_pitching_value(self, proj, scoring):
        """Calculate fantasy points for pitching projections"""
        if scoring['scoring_type'] != 'points':
            return 0
        
        value = 0
        value += proj.get('innings_pitched', 0) * (scoring.get('points_ip') or 0)
        value += proj.get('strikeouts_pitched', 0) * (scoring.get('points_k') or 0)
        value += proj.get('wins', 0) * (scoring.get('points_win') or 0)
        value += proj.get('saves', 0) * (scoring.get('points_save') or 0)
        value += proj.get('earned_runs', 0) * (scoring.get('points_er') or 0)
        value += proj.get('hits_allowed', 0) * (scoring.get('points_hit_allowed') or 0)
        
        return round(value, 2)


def run_daily_update():
    """Main function to run daily updates"""
    print(f"\n{'='*50}")
    print(f"Starting daily update: {datetime.now()}")
    print(f"{'='*50}\n")

    supabase_ok = supabase_dns_reachable(SUPABASE_URL)
    if not supabase_ok:
        print("Supabase DNS check failed; roster updates will be skipped.")
    
    updater = DailyStatsUpdater()
    
    # 1. Check if there are games today
    games = updater.get_games_today()
    print(f"Found {len(games)} games today")
    
    # 2. Update recent stats (last 7 days to catch any corrections)
    updater.update_recent_stats(days_back=7)
    
    # 3. Update player roster info
    if supabase_ok:
        updater.update_player_roster_changes()
    else:
        print("Skipping roster updates due to Supabase connectivity issues.")
    
    # 4. Recalculate fantasy values for all active scenarios
    # (You'd need to query for active scenarios first)
    
    print(f"\n{'='*50}")
    print(f"Daily update complete: {datetime.now()}")
    print(f"{'='*50}\n")


if __name__ == '__main__':
    run_daily_update()
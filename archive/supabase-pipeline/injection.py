"""
Baseball Statistics Data Ingestion Pipeline
Ingests data from MLB Stats API and pybaseball into Supabase
"""

import os
import requests
import logging
from datetime import datetime, date
from supabase import create_client, Client
from pybaseball import batting_stats, pitching_stats, playerid_lookup
import pandas as pd
from dotenv import load_dotenv
import time

# Configure logging early so pipeline emits structured diagnostics
# Keep the root logger at INFO to avoid noisy library debug output,
# but allow our 'ingestion' logger to use LOG_LEVEL (default DEBUG).
_root_level_name = os.getenv("ROOT_LOG_LEVEL", "INFO").upper()
_root_level = logging._nameToLevel.get(_root_level_name, logging.INFO)
logging.basicConfig(
    level=_root_level,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("ingestion")
_ingestion_level_name = os.getenv("LOG_LEVEL", "DEBUG").upper()
_ingestion_level = logging._nameToLevel.get(_ingestion_level_name, logging.DEBUG)
logger.setLevel(_ingestion_level)

# Silence verbose third-party libraries at WARNING
for _name in ("httpx", "httpcore", "hpack", "h2", "urllib3", "supabase"):
    logging.getLogger(_name).setLevel(logging.WARNING)

# Initialize Supabase client (server-side only; requires service role key for RLS writes)
load_dotenv()  # Load environment variables from .env
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is not set")

if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for ingestion (RLS bypass)")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# MLB Stats API Base URL
MLB_API_BASE = "https://statsapi.mlb.com/api/v1"


class MLBDataIngestion:
    """Handles data ingestion from MLB Stats API"""
    
    @staticmethod
    def extract_team_nickname(full_team_name):
        """
        Extract team nickname from full team name.
        E.g., "New York Yankees" -> "Yankees", "Los Angeles Dodgers" -> "Dodgers"
        """
        if not full_team_name:
            return ''
        parts = full_team_name.strip().split()
        # Usually the last word is the nickname (e.g., Yankees, Dodgers, Red Sox, Mets)
        # Special cases: "Boston Red Sox" -> "Red Sox"
        if len(parts) >= 2 and parts[-2].lower() in ['red', 'white', 'blue']:
            return ' '.join(parts[-2:])
        return parts[-1] if parts else full_team_name
    
    @staticmethod
    def get_all_players():
        """Fetch all active MLB players"""
        url = f"{MLB_API_BASE}/sports/1/players"
        params = {'season': datetime.now().year}
        
        response = requests.get(url, params=params)
        response.raise_for_status()
        
        players = response.json().get('people', [])
        return players
    
    @staticmethod
    def get_player_stats(player_id, season, stat_type='hitting'):
        """Fetch player stats for a specific season"""
        url = f"{MLB_API_BASE}/people/{player_id}/stats"
        params = {
            'stats': 'season',
            'season': season,
            'group': stat_type
        }
        
        response = requests.get(url, params=params)
        response.raise_for_status()
        
        data = response.json()
        if data.get('stats') and len(data['stats']) > 0:
            return data['stats'][0].get('splits', [])
        return []
    
    def ingest_players(self):
        """Ingest player data into Supabase"""
        logger.info("Fetching players from MLB API...")
        players = self.get_all_players()
        
        player_records = []
        missing_pos = 0
        missing_team = 0
        for player in players:
            full_team_name = player.get('currentTeam', {}).get('name')
            team_nickname = self.extract_team_nickname(full_team_name) if full_team_name else ''
            position_abbr = player.get('primaryPosition', {}).get('abbreviation') or 'Unknown'
            if not position_abbr:
                missing_pos += 1
            if not team_nickname:
                missing_team += 1
            
            record = {
                'player_id': str(player['id']),
                'name': player['fullName'],
                'team': team_nickname,  # Use extracted nickname
                'position': position_abbr,
                'primary_position': position_abbr,  # Also populate primary_position
                'mlb_debut': player.get('mlbDebutDate'),
                'birth_date': player.get('birthDate'),
                'bats': player.get('batSide', {}).get('code'),
                'throws': player.get('pitchHand', {}).get('code'),
                'active': player.get('active', True)
            }
            player_records.append(record)
        
        # Batch upsert to Supabase
        logger.info(f"Upserting {len(player_records)} players...")
        supabase.table('players').upsert(player_records).execute()
        logger.info(
            "Players ingested",
            extra={
                "total": len(player_records),
                "missing_position": missing_pos,
                "missing_team": missing_team,
            },
        )
        
        return player_records
    
    def ingest_player_stats(self, player_id, season):
        """Ingest stats for a specific player and season"""
        batting_rows = 0
        pitching_rows = 0
        # Get batting stats
        batting_splits = self.get_player_stats(player_id, season, 'hitting')
        if batting_splits:
            for split in batting_splits:
                stats = split.get('stat', {})
                record = {
                    'player_id': str(player_id),
                    'season': season,
                    'stat_type': 'batting',
                    'games_played': int(stats.get('gamesPlayed', 0) or 0),
                    'at_bats': int(stats.get('atBats', 0) or 0),
                    'runs': int(stats.get('runs', 0) or 0),
                    'hits': int(stats.get('hits', 0) or 0),
                    'doubles': int(stats.get('doubles', 0) or 0),
                    'triples': int(stats.get('triples', 0) or 0),
                    'home_runs': int(stats.get('homeRuns', 0) or 0),
                    'rbi': int(stats.get('rbi', 0) or 0),
                    'stolen_bases': int(stats.get('stolenBases', 0) or 0),
                    'walks': int(stats.get('baseOnBalls', 0) or 0),
                    'strikeouts': int(stats.get('strikeOuts', 0) or 0),
                    'avg': float(stats.get('avg') or 0.0),
                    'obp': float(stats.get('obp') or 0.0),
                    'slg': float(stats.get('slg') or 0.0)
                }
                supabase.table('actual_stats').upsert(record, on_conflict='player_id,season,stat_type').execute()
                batting_rows += 1
        
        # Get pitching stats
        pitching_splits = self.get_player_stats(player_id, season, 'pitching')
        if pitching_splits:
            for split in pitching_splits:
                stats = split.get('stat', {})
                record = {
                    'player_id': str(player_id),
                    'season': season,
                    'stat_type': 'pitching',
                    'games_played': int(stats.get('gamesPlayed', 0) or 0),
                    'wins': int(stats.get('wins', 0) or 0),
                    'losses': int(stats.get('losses', 0) or 0),
                    'era': float(stats.get('era') or 0.0),
                    'innings_pitched': float(stats.get('inningsPitched') or 0.0),
                    'hits_allowed': int(stats.get('hits', 0) or 0),
                    'earned_runs': int(stats.get('earnedRuns', 0) or 0),
                    'walks_allowed': int(stats.get('baseOnBalls', 0) or 0),
                    'strikeouts_pitched': int(stats.get('strikeOuts', 0) or 0),
                    'saves': int(stats.get('saves', 0) or 0),
                    'whip': float(stats.get('whip') or 0.0)
                }
                supabase.table('actual_stats').upsert(record, on_conflict='player_id,season,stat_type').execute()
                pitching_rows += 1

        logger.info(
            "Player stats ingested",
            extra={
                "player_id": str(player_id),
                "season": season,
                "batting_rows": batting_rows,
                "pitching_rows": pitching_rows,
            },
        )


class PybaseballIngestion:
    """Handles data ingestion from pybaseball"""
    
    def __init__(self):
        """Initialize with ID cache to prevent duplicate player creation."""
        self.id_cache = {}  # Cache MLB IDs by player name to avoid duplicates

    def _ensure_player(self, mlb_id: str | None, name: str | None, position: str | None = None):
        """Ensure a minimal player row exists to satisfy FK constraints."""
        player_key = mlb_id or name
        if not player_key:
            return
        safe_name = name or player_key
        record = {
            'player_id': player_key,
            'name': safe_name,
            'active': True
        }
        if position:
            record['primary_position'] = position
        try:
            supabase.table('players').upsert(record).execute()
        except Exception as e:
            logger.warning(f"Could not ensure player {player_key}: {e}")

    def _lookup_mlb_id(self, fangraphs_id: str | None, name: str | None) -> str | None:
        """
        Resolve MLB ID using multiple strategies to prevent duplicates:
        1. Check cache first
        2. Query player_id_mapping by FanGraphs ID (handle both "sa" prefix and numeric formats)
        3. Query player_id_mapping by player name
        4. Query players table by name (if already ingested from MLB API)
        Returns MLB ID as string, or None if not found.
        """
        # Check cache first
        cache_key = name or fangraphs_id
        if cache_key and cache_key in self.id_cache:
            return self.id_cache[cache_key]
        
        try:
            # Try FanGraphs ID first (handle both formats: "sa877505" and "877505")
            if fangraphs_id:
                fg_str = str(fangraphs_id).strip()
                # Try exact match first
                res = supabase.table('player_id_mapping').select('mlb_id').eq('fangraphs_id', fg_str).limit(1).execute()
                if res.data:
                    mlb_id = str(res.data[0]['mlb_id'])
                    if cache_key:
                        self.id_cache[cache_key] = mlb_id
                    return mlb_id
                
                # If it starts with "sa", try without the prefix
                if fg_str.lower().startswith('sa'):
                    numeric_fg = fg_str[2:]  # Strip "sa" prefix
                    res = supabase.table('player_id_mapping').select('mlb_id').eq('fangraphs_id', numeric_fg).limit(1).execute()
                    if res.data:
                        mlb_id = str(res.data[0]['mlb_id'])
                        if cache_key:
                            self.id_cache[cache_key] = mlb_id
                        return mlb_id
                
                # If it's numeric, try with "sa" prefix
                if fg_str.isdigit():
                    prefixed_fg = f"sa{fg_str}"
                    res = supabase.table('player_id_mapping').select('mlb_id').eq('fangraphs_id', prefixed_fg).limit(1).execute()
                    if res.data:
                        mlb_id = str(res.data[0]['mlb_id'])
                        if cache_key:
                            self.id_cache[cache_key] = mlb_id
                        return mlb_id
            
            # Try player name in mapping table
            if name:
                res2 = supabase.table('player_id_mapping').select('mlb_id').ilike('player_name', name).limit(1).execute()
                if res2.data:
                    mlb_id = str(res2.data[0]['mlb_id'])
                    self.id_cache[name] = mlb_id
                    return mlb_id
                
                # Try players table (for already-ingested MLB API data)
                res3 = supabase.table('players').select('player_id').ilike('name', name).limit(1).execute()
                if res3.data:
                    mlb_id = str(res3.data[0]['player_id'])
                    self.id_cache[name] = mlb_id
                    return mlb_id
        except Exception as e:
            logger.warning(f"ID lookup failed for {name} (FG: {fangraphs_id}): {e}")
        return None
    
    def _fetch_with_retry(self, stat_func, season, start_month, end_month, max_retries=3):
        """Fetch stats for a month range with exponential backoff retry."""
        for attempt in range(max_retries):
            try:
                logger.info(f"  Fetching {start_month}-{end_month}... (attempt {attempt + 1})")
                # Fetch full season; will be filtered by month in processing
                df = stat_func(season)
                return df
            except Exception as e:
                wait_time = 2 ** attempt
                logger.warning(f"  Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
        logger.error(f"  Failed to fetch after {max_retries} attempts.")
        return None

    def _process_batting_row(self, row, season):
        """Convert a pybaseball batting row into a stats record."""
        fg_id = row.get('IDfg')
        name = row.get('Name')
        pos = row.get('Pos', 'Unknown')
        
        # Handle FanGraphs ID: can be numeric or "saXXXXXX" format
        fg_id_str = None
        if pd.notna(fg_id):
            fg_id_str = str(fg_id).strip()
        
        mlb_id = self._lookup_mlb_id(fg_id_str, name if pd.notna(name) else None)
        if not mlb_id:
            logger.warning(f"Skipping batting row without MLB ID: {name}")
            return None
        self._ensure_player(mlb_id, name if pd.notna(name) else None, pos)
        return {
            'player_id': mlb_id,
            'season': season,
            'stat_type': 'batting',
            'games_played': int(row.get('G', 0) or 0),
            'at_bats': int(row.get('AB', 0) or 0),
            'runs': int(row.get('R', 0) or 0),
            'hits': int(row.get('H', 0) or 0),
            'doubles': int(row.get('2B', 0) or 0),
            'triples': int(row.get('3B', 0) or 0),
            'home_runs': int(row.get('HR', 0) or 0),
            'rbi': int(row.get('RBI', 0) or 0),
            'stolen_bases': int(row.get('SB', 0) or 0),
            'walks': int(row.get('BB', 0) or 0),
            'strikeouts': int(row.get('SO', 0) or 0),
            'avg': float(row.get('AVG') or 0.0),
            'babip': float(row.get('BABIP') or 0.0),
            'obp': float(row.get('OBP') or 0.0),
            'slg': float(row.get('SLG') or 0.0)
        }

    def ingest_batting_stats(self, season):
        """Ingest batting stats for entire league in monthly batches."""
        logger.info(f"Fetching batting stats for {season} from pybaseball (monthly batches)...")
        
        # Define monthly ranges
        months = [
            (3, 4, "March-April"),
            (5, 6, "May-June"),
            (7, 8, "July-August"),
            (9, 10, "Sept-Oct")
        ]
        
        total_records = 0
        skipped_no_id = 0
        total_rows = 0
        for start_m, end_m, label in months:
            logger.info(f"Processing {label} {season} data...")
            df = self._fetch_with_retry(batting_stats, season, start_m, end_m)
            if df is None or df.empty:
                logger.warning(f"  No data for {label}.")
                continue
            
            records = []
            for _, row in df.iterrows():
                try:
                    record = self._process_batting_row(row, season)
                    total_rows += 1
                    if record:
                        records.append(record)
                    else:
                        skipped_no_id += 1
                except Exception as e:
                    logger.warning(f"  Skipped row: {e}")
                    continue
            
            # Batch upsert for this month
            if records:
                logger.info(f"  Upserting {len(records)} batting records...")
                batch_size = 100
                for i in range(0, len(records), batch_size):
                    batch = records[i:i+batch_size]
                    try:
                        supabase.table('actual_stats').upsert(batch, on_conflict='player_id,season,stat_type').execute()
                    except Exception as e:
                        logger.error(f"    Batch insert failed: {e}")
                total_records += len(records)
            
            # Brief delay between month batches
            time.sleep(1)
        
        logger.info(
            "Batting stats ingested",
            extra={
                "season": season,
                "total_rows": total_rows,
                "ingested": total_records,
                "skipped_no_id": skipped_no_id,
            },
        )
    
    def _process_pitching_row(self, row, season):
        """Convert a pybaseball pitching row into a stats record."""
        fg_id = row.get('IDfg')
        name = row.get('Name')
        pos = 'RP'  # Default pitchers to RP
        
        # Handle FanGraphs ID: can be numeric or "saXXXXXX" format
        fg_id_str = None
        if pd.notna(fg_id):
            fg_id_str = str(fg_id).strip()
        
        mlb_id = self._lookup_mlb_id(fg_id_str, name if pd.notna(name) else None)
        if not mlb_id:
            logger.warning(f"Skipping pitching row without MLB ID: {name}")
            return None
        self._ensure_player(mlb_id, name if pd.notna(name) else None, pos)
        return {
            'player_id': mlb_id,
            'season': season,
            'stat_type': 'pitching',
            'games_played': int(row.get('G', 0) or 0),
            'wins': int(row.get('W', 0) or 0),
            'losses': int(row.get('L', 0) or 0),
            'era': float(row.get('ERA') or 0.0),
            'innings_pitched': float(row.get('IP') or 0.0),
            'hits_allowed': int(row.get('H', 0) or 0),
            'earned_runs': int(row.get('ER', 0) or 0),
            'walks_allowed': int(row.get('BB', 0) or 0),
            'strikeouts_pitched': int(row.get('SO', 0) or 0),
            'saves': int(row.get('SV', 0) or 0),
            'whip': float(row.get('WHIP') or 0.0),
            'fip': float(row.get('FIP') or 0.0)
        }

    def ingest_pitching_stats(self, season):
        """Ingest pitching stats for entire league in monthly batches."""
        logger.info(f"Fetching pitching stats for {season} from pybaseball (monthly batches)...")

        # Define monthly ranges
        months = [
            (3, 4, "March-April"),
            (5, 6, "May-June"),
            (7, 8, "July-August"),
            (9, 10, "Sept-Oct")
        ]

        total_records = 0
        skipped_no_id = 0
        total_rows = 0
        for start_m, end_m, label in months:
            logger.info(f"Processing {label} {season} data...")
            df = self._fetch_with_retry(pitching_stats, season, start_m, end_m)
            if df is None or df.empty:
                logger.warning(f"  No data for {label}.")
                continue

            records = []
            for _, row in df.iterrows():
                try:
                    record = self._process_pitching_row(row, season)
                    total_rows += 1
                    if record:
                        records.append(record)
                    else:
                        skipped_no_id += 1
                except Exception as e:
                    logger.warning(f"  Skipped row: {e}")
                    continue

            # Batch upsert for this month
            if records:
                logger.info(f"  Upserting {len(records)} pitching records...")
                batch_size = 100
                for i in range(0, len(records), batch_size):
                    batch = records[i:i+batch_size]
                    try:
                        supabase.table('actual_stats').upsert(batch, on_conflict='player_id,season,stat_type').execute()
                    except Exception as e:
                        logger.error(f"    Batch insert failed: {e}")
                total_records += len(records)

            # Brief delay between month batches
            time.sleep(1)

        logger.info(
            "Pitching stats ingested",
            extra={
                "season": season,
                "total_rows": total_rows,
                "ingested": total_records,
                "skipped_no_id": skipped_no_id,
            },
        )


class ProjectionIngestion:
    """Handles importing projection data (Steamer, ZiPS, etc.)"""
    def create_baseline_scenario(self, season, projection_source='steamer'):
        """Create baseline projection scenario"""
        scenario = {
            'name': f'{projection_source.upper()} {season} Projections',
            'base_season': season,  # Required by DB schema
            'is_baseline': True,
            'user_id': None  # System scenario
        }
        
        result = supabase.table('scenarios').insert(scenario).execute()
        scenario_id = result.data[0]['scenario_id']
        
        print(f"Created baseline scenario: {scenario_id}")
        return scenario_id
    
    def ingest_projections_from_csv(self, scenario_id, csv_path, stat_type):
        """
        Import projections from CSV file
        Expected CSV format: player_id, name, stat1, stat2, ...
        """
        df = pd.read_csv(csv_path)
        
        records = []
        for _, row in df.iterrows():
            record = {
                'scenario_id': scenario_id,
                'player_id': str(row['player_id']),
                'stat_type': stat_type,
                'games_played': int(row.get('G', 0)) if pd.notna(row.get('G')) else None,
                'at_bats': int(row.get('AB', 0)) if pd.notna(row.get('AB')) else None,
                'runs': int(row.get('R', 0)) if pd.notna(row.get('R')) else None,
                'hits': int(row.get('H', 0)) if pd.notna(row.get('H')) else None,
                'home_runs': int(row.get('HR', 0)) if pd.notna(row.get('HR')) else None,
                'rbi': int(row.get('RBI', 0)) if pd.notna(row.get('RBI')) else None,
                'stolen_bases': int(row.get('SB', 0)) if pd.notna(row.get('SB')) else None,
                # Add more fields as needed
            }
            records.append(record)
        
        # Batch insert
        batch_size = 100
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            supabase.table('scenario_projections').insert(batch).execute()
        
        print(f"Ingested {len(records)} projection records")


# Main execution script
def main():
    """Run the full ingestion pipeline"""
    current_year = datetime.now().year
    
    # 1. Ingest players from MLB API
    mlb = MLBDataIngestion()
    players = mlb.ingest_players()
    
    # 2. Ingest actual stats from pybaseball
    pyb = PybaseballIngestion()
    pyb.ingest_batting_stats(current_year)
    pyb.ingest_pitching_stats(current_year)
    
    # 3. Optionally ingest previous seasons
    for year in range(current_year - 2, current_year):
        print(f"\nIngesting {year} data...")
        pyb.ingest_batting_stats(year)
        pyb.ingest_pitching_stats(year)
    
    # 4. Create baseline projection scenario
    proj = ProjectionIngestion()
    scenario_id = proj.create_baseline_scenario(current_year + 1, 'steamer')
    
    # 5. Import projections (you'll need projection CSV files)
    # proj.ingest_projections_from_csv(scenario_id, 'steamer_batting.csv', 'batting')
    # proj.ingest_projections_from_csv(scenario_id, 'steamer_pitching.csv', 'pitching')
    
    print("\n✅ Data ingestion complete!")


if __name__ == '__main__':
    main()
import requests
import json
import time
from datetime import datetime
import os
import random
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('mlb_data_fetcher')

# Constants
MLB_API_BASE_URL = "https://statsapi.mlb.com/api"
DATA_DIR = 'data'
CURRENT_YEAR = datetime.now().year
PREVIOUS_YEAR = CURRENT_YEAR - 1
API_DELAY = 0.1  # seconds between API calls

def create_data_directory():
    """Create data directory if it doesn't exist"""
    os.makedirs(DATA_DIR, exist_ok=True)

def get_request(url, description="data"):
    """
    Make a GET request with error handling
    """
    try:
        response = requests.get(url)
        if response.status_code != 200:
            logger.error(f"Error fetching {description}: {response.status_code}")
            return None
        return response.json()
    except Exception as e:
        logger.error(f"Exception during request for {description}: {str(e)}")
        return None

def create_projections(stats_previous_year):
    """
    Create simple projections based on previous year's stats
    """
    if not stats_previous_year:
        return {}
        
    # Create random factor for projection variability
    factor = random.uniform(0.9, 1.1)  # ±10% variation
    era_factor = 2 - factor  # inverse factor for ERA and walks (lower is better)
    
    projections = {}
    
    # Handle batting stats
    for stat in ['avg', 'runs', 'rbi', 'steals', 'hr']:
        if stat in stats_previous_year:
            value = stats_previous_year.get(stat, 0) or 0
            if stat == 'avg':
                projections[stat] = round(value * factor, 3)
            else:
                projections[stat] = int(value * factor)
    
    # Handle pitching stats
    for stat in ['wins', 'strikeouts', 'saves']:
        if stat in stats_previous_year:
            value = stats_previous_year.get(stat, 0) or 0
            projections[stat] = int(value * factor)
    
    # Special handling for stats where lower is better
    for stat, use_factor in [('era', era_factor), ('walks', era_factor)]:
        if stat in stats_previous_year:
            value = stats_previous_year.get(stat, 0) or 0
            if stat == 'era':
                projections[stat] = round(value * use_factor, 2)
            else:
                projections[stat] = int(value * use_factor)
    
    return projections

def extract_batting_stats(stats):
    """
    Extract batting statistics from a stats object
    """
    return {
        'avg': float(stats.get('avg', 0)) or 0,
        'runs': int(stats.get('runs', 0)) or 0,
        'rbi': int(stats.get('rbi', 0)) or 0,
        'steals': int(stats.get('stolenBases', 0)) or 0,
        'hr': int(stats.get('homeRuns', 0)) or 0
    }

def extract_pitching_stats(stats):
    """
    Extract pitching statistics from a stats object
    """
    return {
        'wins': int(stats.get('wins', 0)) or 0,
        'era': float(stats.get('era', 0)) or 0,
        'strikeouts': int(stats.get('strikeOuts', 0)) or 0,
        'walks': int(stats.get('baseOnBalls', 0)) or 0,
        'saves': int(stats.get('saves', 0)) or 0
    }

def get_player_stats(player_id, year=None):
    """
    Get detailed stats for a player for a specific year
    """
    year_param = f"&season={year}" if year else ""
    url = f"{MLB_API_BASE_URL}/v1/people/{player_id}?hydrate=stats(group=[hitting,pitching],type=[yearByYear]){year_param}"
    return get_request(url, f"player {player_id} stats")

def process_player_data(player_info, player_data):
    """
    Process a player's data and return a structured player object
    """
    if not player_data or not player_data.get('people'):
        logger.warning(f"No data found for player {player_info['id']}")
        return None
        
    person = player_data['people'][0]
    player_id = player_info['id']
    is_pitcher = player_info['position'] in ['P', 'SP', 'RP', 'CL']
    
    # Initialize stats dictionaries with defaults
    batting_stats_2024 = {'avg': 0.0, 'runs': 0, 'rbi': 0, 'steals': 0, 'hr': 0}
    pitching_stats_2024 = {'wins': 0, 'era': 0.0, 'strikeouts': 0, 'walks': 0, 'saves': 0}
    batting_stats_2025_actual = {'avg': 0.0, 'runs': 0, 'rbi': 0, 'steals': 0, 'hr': 0}
    pitching_stats_2025_actual = {'wins': 0, 'era': 0.0, 'strikeouts': 0, 'walks': 0, 'saves': 0}
    
    # Extract stats if available
    if 'stats' in person:
        for stat_group in person['stats']:
            if stat_group['group']['displayName'] == 'hitting':
                for season_stat in stat_group['splits']:
                    stat_year = season_stat.get('season')
                    
                    # Get 2024 stats (previous year)
                    if stat_year == str(PREVIOUS_YEAR):
                        batting_stats_2024 = extract_batting_stats(season_stat['stat'])
                    
                    # Get 2025 stats (current year)
                    elif stat_year == str(CURRENT_YEAR):
                        batting_stats_2025_actual = extract_batting_stats(season_stat['stat'])
            
            if stat_group['group']['displayName'] == 'pitching':
                for season_stat in stat_group['splits']:
                    stat_year = season_stat.get('season')
                    
                    # Get 2024 stats (previous year)
                    if stat_year == str(PREVIOUS_YEAR):
                        pitching_stats_2024 = extract_pitching_stats(season_stat['stat'])
                    
                    # Get 2025 stats (current year)
                    elif stat_year == str(CURRENT_YEAR):
                        pitching_stats_2025_actual = extract_pitching_stats(season_stat['stat'])
    
    # Create projections based on previous year's data
    if is_pitcher:
        projected_stats = create_projections(pitching_stats_2024)
    else:
        projected_stats = create_projections(batting_stats_2024)
    
    # For batters - use empty pitching stats in the projection
    batter_defaults = {'avg': 0.0, 'runs': 0, 'rbi': 0, 'steals': 0, 'hr': 0}
    pitcher_defaults = {'wins': 0, 'era': 0.0, 'strikeouts': 0, 'walks': 0, 'saves': 0}
    
    # Combine all stats into a single player object
    return {
        'id': player_id,
        'name': player_info['full_name'],
        'team': player_info['team_name'],
        'position': player_info['position'],
        'is_pitcher': is_pitcher,
        'stats_2024': {
            **batting_stats_2024,
            **pitching_stats_2024
        },
        'stats_2025_projected': {
            **(batter_defaults if is_pitcher else batting_stats_2024),
            **(pitcher_defaults if not is_pitcher else pitching_stats_2024),
            **projected_stats
        },
        'stats_2025_actual': {
            **batting_stats_2025_actual,
            **pitching_stats_2025_actual
        }
    }

def fetch_players_data():
    """
    Fetch real MLB player data from the MLB Stats API and save as JSON files.
    Main function that coordinates the entire data collection process.
    """
    try:
        # Initialize
        create_data_directory()
        batters = []
        pitchers = []
        
        logger.info("Fetching active MLB players...")
        
        # Fetch all teams to get player IDs
        teams_data = get_request(f"{MLB_API_BASE_URL}/v1/teams?sportId=1", "teams")
        if not teams_data:
            return False
            
        # Collect player IDs from all teams
        all_player_ids = []
        for team in teams_data['teams']:
            team_id = team['id']
            roster_data = get_request(
                f"{MLB_API_BASE_URL}/v1/teams/{team_id}/roster/active", 
                f"team {team_id} roster"
            )
            
            if roster_data and 'roster' in roster_data:
                for player in roster_data['roster']:
                    all_player_ids.append({
                        'id': player['person']['id'],
                        'full_name': player['person']['fullName'],
                        'position': player.get('position', {}).get('abbreviation', ''),
                        'team_id': team_id,
                        'team_name': team['name']
                    })
            
            time.sleep(API_DELAY)  # Be nice to the API
        
        logger.info(f"Found {len(all_player_ids)} active players")
        
        # Process each player
        for idx, player_info in enumerate(all_player_ids):
            try:
                player_data = get_player_stats(player_info['id'])
                if not player_data:
                    continue
                    
                player_obj = process_player_data(player_info, player_data)
                if not player_obj:
                    continue
                
                # Add to appropriate list
                if player_obj['is_pitcher']:
                    pitchers.append(player_obj)
                else:
                    batters.append(player_obj)
                
                # Log progress
                if idx % 50 == 0:
                    logger.info(f"Processed {idx} players...")
                
                time.sleep(API_DELAY)  # Be nice to the API
                
            except Exception as e:
                logger.error(f"Error processing player {player_info['full_name']}: {str(e)}")
        
        # Create a combined player list
        all_players = batters + pitchers
        
        # Save data as JSON files
        save_data_to_files(all_players, batters, pitchers)
            
        logger.info(f"Saved {len(all_players)} players ({len(batters)} batters, {len(pitchers)} pitchers)")
        return True
        
    except Exception as e:
        logger.error(f"Error fetching players data: {str(e)}")
        return False

def save_data_to_files(all_players, batters, pitchers):
    """
    Save the collected data to JSON files
    """
    # Save players data
    with open(os.path.join(DATA_DIR, 'players.json'), 'w') as f:
        json.dump(all_players, f)
        
    with open(os.path.join(DATA_DIR, 'batters.json'), 'w') as f:
        json.dump(batters, f)
        
    with open(os.path.join(DATA_DIR, 'pitchers.json'), 'w') as f:
        json.dump(pitchers, f)
        
    # Save last updated timestamp
    with open(os.path.join(DATA_DIR, 'last_updated.json'), 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'total_players': len(all_players),
            'batters': len(batters),
            'pitchers': len(pitchers)
        }, f)

def fetch_player_by_name(player_name):
    """
    Search for a player by name in the MLB Stats API
    """
    try:
        search_url = f"{MLB_API_BASE_URL}/v1/people/search?names={player_name}"
        return get_request(search_url, f"player search for '{player_name}'")
    except Exception as e:
        logger.error(f"Error searching for player: {str(e)}")
        return None

if __name__ == "__main__":
    # This allows running this script directly for testing
    logger.info("Running fetch_data.py to update player data...")
    fetch_players_data()
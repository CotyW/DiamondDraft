import requests
import json
import time
from datetime import datetime
import os
import random

def fetch_players_data():
    """
    Fetch real MLB player data from the MLB Stats API and save as JSON files.
    """
    try:
        # Create data directory if it doesn't exist
        os.makedirs('data', exist_ok=True)
        
        # Lists to store batters and pitchers
        batters = []
        pitchers = []
        
        print("Fetching active MLB players...")
        
        # MLB Stats API base URL
        base_url = "https://statsapi.mlb.com/api"
        
        # First, get all teams to get player IDs
        teams_url = f"{base_url}/v1/teams?sportId=1"
        teams_response = requests.get(teams_url)
        
        if teams_response.status_code != 200:
            print(f"Error fetching teams: {teams_response.status_code}")
            return False
            
        teams_data = teams_response.json()
        all_player_ids = []
        
        # Collect player IDs from each team
        for team in teams_data['teams']:
            team_id = team['id']
            roster_url = f"{base_url}/v1/teams/{team_id}/roster/active"
            
            roster_response = requests.get(roster_url)
            if roster_response.status_code == 200:
                roster_data = roster_response.json()
                
                for player in roster_data.get('roster', []):
                    all_player_ids.append({
                        'id': player['person']['id'],
                        'full_name': player['person']['fullName'],
                        'position': player.get('position', {}).get('abbreviation', ''),
                        'team_id': team_id,
                        'team_name': team['name']
                    })
            else:
                print(f"Error fetching roster for team {team_id}: {roster_response.status_code}")
            
            # Be nice to the API with a small delay
            time.sleep(0.1)
        
        print(f"Found {len(all_player_ids)} active players")
        
        # Current year for stats
        current_year = datetime.now().year
        previous_year = current_year - 1
        
        # Process each player
        for idx, player_info in enumerate(all_player_ids):
            try:
                player_id = player_info['id']
                
                # Get detailed player info
                player_url = f"{base_url}/v1/people/{player_id}?hydrate=stats(group=[hitting,pitching],type=[yearByYear])"
                player_response = requests.get(player_url)
                
                if player_response.status_code != 200:
                    print(f"Error fetching player {player_id}: {player_response.status_code}")
                    continue
                    
                player_data = player_response.json()
                if not player_data.get('people'):
                    print(f"No data found for player {player_id}")
                    continue
                
                person = player_data['people'][0]
                
                # Determine if player is a pitcher based on position
                is_pitcher = player_info['position'] in ['P', 'SP', 'RP', 'CL']
                
                # Initialize stats dictionaries
                batting_stats_2024 = {
                    'avg': 0.0, 'runs': 0, 'rbi': 0, 'steals': 0, 'hr': 0, 'hits': 0, 'babip': 0.0
                }
                
                pitching_stats_2024 = {
                    'wins': 0, 'era': 0.0, 'strikeouts': 0, 'walks': 0, 'saves': 0, 'runs_scored': 0, 'fip': 0.0
                }
                
                # Initialize 2025 actual stats (will be populated from API)
                batting_stats_2025_actual = {
                    'avg': 0.0, 'runs': 0, 'rbi': 0, 'steals': 0, 'hr': 0, 'hits': 0, 'babip': 0.0
                }
                
                pitching_stats_2025_actual = {
                    'wins': 0, 'era': 0.0, 'strikeouts': 0, 'walks': 0, 'saves': 0, 'runs_scored': 0, 'fip': 0.0
                }
                
                # Make simple projections for 2025 based on 2024 data (or previous years)
                batting_stats_2025_projected = dict(batting_stats_2024)
                pitching_stats_2025_projected = dict(pitching_stats_2024)
                
                # Extract stats if available
                if 'stats' in person:
                    for stat_group in person['stats']:
                        if stat_group['group']['displayName'] == 'hitting':
                            for season_stat in stat_group['splits']:
                                stat_year = season_stat.get('season')
                                
                                # Get 2024 stats (previous year)
                                if stat_year == str(previous_year):
                                    stats = season_stat['stat']
                                    batting_stats_2024['avg'] = float(stats.get('avg', 0)) or 0
                                    batting_stats_2024['runs'] = int(stats.get('runs', 0)) or 0
                                    batting_stats_2024['rbi'] = int(stats.get('rbi', 0)) or 0
                                    batting_stats_2024['steals'] = int(stats.get('stolenBases', 0)) or 0
                                    batting_stats_2024['hr'] = int(stats.get('homeRuns', 0)) or 0
                                    batting_stats_2024['hits'] = int(stats.get('hits', 0)) or 0
                                    
                                    # Calculate BABIP
                                    at_bats = int(stats.get('atBats', 0)) or 1  # Avoid division by zero
                                    hits = int(stats.get('hits', 0)) or 0
                                    hr = int(stats.get('homeRuns', 0)) or 0
                                    strikeouts = int(stats.get('strikeOuts', 0)) or 0
                                    
                                    # BABIP = (H - HR) / (AB - K - HR + SF)
                                    # Note: SF (sacrifice flies) isn't always available, so we'll use an approximation
                                    denominator = at_bats - strikeouts - hr
                                    if denominator > 0:
                                        batting_stats_2024['babip'] = round((hits - hr) / denominator, 3)
                                    else:
                                        batting_stats_2024['babip'] = 0.0
                                    
                                    # Simple projection: last year + small random adjustment
                                    factor = random.uniform(0.9, 1.1)  # ±10% variation
                                    
                                    batting_stats_2025_projected['avg'] = round(batting_stats_2024['avg'] * factor, 3)
                                    batting_stats_2025_projected['runs'] = int(batting_stats_2024['runs'] * factor)
                                    batting_stats_2025_projected['rbi'] = int(batting_stats_2024['rbi'] * factor)
                                    batting_stats_2025_projected['steals'] = int(batting_stats_2024['steals'] * factor)
                                    batting_stats_2025_projected['hr'] = int(batting_stats_2024['hr'] * factor)
                                    batting_stats_2025_projected['hits'] = int(batting_stats_2024['hits'] * factor)
                                    batting_stats_2025_projected['babip'] = round(batting_stats_2024['babip'] * factor, 3)
                                
                                # Get 2025 stats (current year)
                                elif stat_year == str(current_year):
                                    stats = season_stat['stat']
                                    batting_stats_2025_actual['avg'] = float(stats.get('avg', 0)) or 0
                                    batting_stats_2025_actual['runs'] = int(stats.get('runs', 0)) or 0
                                    batting_stats_2025_actual['rbi'] = int(stats.get('rbi', 0)) or 0
                                    batting_stats_2025_actual['steals'] = int(stats.get('stolenBases', 0)) or 0
                                    batting_stats_2025_actual['hr'] = int(stats.get('homeRuns', 0)) or 0
                                    batting_stats_2025_actual['hits'] = int(stats.get('hits', 0)) or 0
                                    
                                    # Calculate BABIP for 2025
                                    at_bats = int(stats.get('atBats', 0)) or 1
                                    hits = int(stats.get('hits', 0)) or 0
                                    hr = int(stats.get('homeRuns', 0)) or 0
                                    strikeouts = int(stats.get('strikeOuts', 0)) or 0
                                    
                                    denominator = at_bats - strikeouts - hr
                                    if denominator > 0:
                                        batting_stats_2025_actual['babip'] = round((hits - hr) / denominator, 3)
                                    else:
                                        batting_stats_2025_actual['babip'] = 0.0
                                    
                        if stat_group['group']['displayName'] == 'pitching':
                            for season_stat in stat_group['splits']:
                                stat_year = season_stat.get('season')
                                
                                # Get 2024 stats (previous year)
                                if stat_year == str(previous_year):
                                    stats = season_stat['stat']
                                    pitching_stats_2024['wins'] = int(stats.get('wins', 0)) or 0
                                    pitching_stats_2024['era'] = float(stats.get('era', 0)) or 0
                                    pitching_stats_2024['strikeouts'] = int(stats.get('strikeOuts', 0)) or 0
                                    pitching_stats_2024['walks'] = int(stats.get('baseOnBalls', 0)) or 0
                                    pitching_stats_2024['saves'] = int(stats.get('saves', 0)) or 0
                                    pitching_stats_2024['runs_scored'] = int(stats.get('runs', 0)) or 0
                                    
                                    # Calculate FIP (Fielding Independent Pitching)
                                    hr_allowed = int(stats.get('homeRuns', 0)) or 0
                                    bb = int(stats.get('baseOnBalls', 0)) or 0
                                    so = int(stats.get('strikeOuts', 0)) or 0
                                    innings_pitched = float(stats.get('inningsPitched', 0)) or 1.0
                                    
                                    # FIP constant varies by year, but we'll use a standard approximation
                                    fip_constant = 3.10
                                    
                                    # FIP = ((13*HR) + (3*BB) - (2*K)) / IP + FIP_constant
                                    fip = ((13 * hr_allowed) + (3 * bb) - (2 * so)) / innings_pitched + fip_constant
                                    pitching_stats_2024['fip'] = round(fip, 2)
                                    
                                    # Simple projection: last year + small random adjustment
                                    factor = random.uniform(0.9, 1.1)  # ±10% variation
                                    
                                    pitching_stats_2025_projected['wins'] = int(pitching_stats_2024['wins'] * factor)
                                    # ERA is better when lower, so invert factor
                                    era_factor = 2 - factor  # This will be between 0.9 and 1.1
                                    pitching_stats_2025_projected['era'] = round(pitching_stats_2024['era'] * era_factor, 2)
                                    pitching_stats_2025_projected['strikeouts'] = int(pitching_stats_2024['strikeouts'] * factor)
                                    pitching_stats_2025_projected['walks'] = int(pitching_stats_2024['walks'] * era_factor)
                                    pitching_stats_2025_projected['saves'] = int(pitching_stats_2024['saves'] * factor)
                                    pitching_stats_2025_projected['runs_scored'] = int(pitching_stats_2024['runs_scored'] * factor)
                                    
                                    # FIP is better when lower, so invert factor like ERA
                                    pitching_stats_2025_projected['fip'] = round(pitching_stats_2024['fip'] * era_factor, 2)
                                
                                # Get 2025 stats (current year)
                                elif stat_year == str(current_year):
                                    stats = season_stat['stat']
                                    pitching_stats_2025_actual['wins'] = int(stats.get('wins', 0)) or 0
                                    pitching_stats_2025_actual['era'] = float(stats.get('era', 0)) or 0
                                    pitching_stats_2025_actual['strikeouts'] = int(stats.get('strikeOuts', 0)) or 0
                                    pitching_stats_2025_actual['walks'] = int(stats.get('baseOnBalls', 0)) or 0
                                    pitching_stats_2025_actual['saves'] = int(stats.get('saves', 0)) or 0
                                    pitching_stats_2025_actual['runs_scored'] = int(stats.get('runs', 0)) or 0
                                    
                                    # Calculate FIP for 2025
                                    hr_allowed = int(stats.get('homeRuns', 0)) or 0
                                    bb = int(stats.get('baseOnBalls', 0)) or 0
                                    so = int(stats.get('strikeOuts', 0)) or 0
                                    innings_pitched = float(stats.get('inningsPitched', 0)) or 1.0
                                    
                                    fip_constant = 3.10
                                    fip = ((13 * hr_allowed) + (3 * bb) - (2 * so)) / innings_pitched + fip_constant
                                    pitching_stats_2025_actual['fip'] = round(fip, 2)
                
                # Create player object
                player_obj = {
                    'id': player_id,
                    'name': player_info['full_name'],
                    'team': player_info['team_name'],
                    'position': player_info['position'],
                    'is_pitcher': is_pitcher,
                    'stats_2024': {
                        'avg': batting_stats_2024['avg'],
                        'runs': batting_stats_2024['runs'],
                        'rbi': batting_stats_2024['rbi'],
                        'steals': batting_stats_2024['steals'],
                        'hr': batting_stats_2024['hr'],
                        'hits': batting_stats_2024['hits'],
                        'babip': batting_stats_2024['babip'],
                        'wins': pitching_stats_2024['wins'],
                        'era': pitching_stats_2024['era'],
                        'strikeouts': pitching_stats_2024['strikeouts'],
                        'walks': pitching_stats_2024['walks'],
                        'saves': pitching_stats_2024['saves'],
                        'runs_scored': pitching_stats_2024['runs_scored'],
                        'fip': pitching_stats_2024['fip']
                    },
                    'stats_2025_projected': {
                        'avg': batting_stats_2025_projected['avg'],
                        'runs': batting_stats_2025_projected['runs'],
                        'rbi': batting_stats_2025_projected['rbi'],
                        'steals': batting_stats_2025_projected['steals'],
                        'hr': batting_stats_2025_projected['hr'],
                        'hits': batting_stats_2025_projected['hits'],
                        'babip': batting_stats_2025_projected['babip'],
                        'wins': pitching_stats_2025_projected['wins'],
                        'era': pitching_stats_2025_projected['era'],
                        'strikeouts': pitching_stats_2025_projected['strikeouts'],
                        'walks': pitching_stats_2025_projected['walks'],
                        'saves': pitching_stats_2025_projected['saves'],
                        'runs_scored': pitching_stats_2025_projected['runs_scored'],
                        'fip': pitching_stats_2025_projected['fip']
                    },
                    'stats_2025_actual': {
                        'avg': batting_stats_2025_actual['avg'],
                        'runs': batting_stats_2025_actual['runs'],
                        'rbi': batting_stats_2025_actual['rbi'],
                        'steals': batting_stats_2025_actual['steals'],
                        'hr': batting_stats_2025_actual['hr'],
                        'hits': batting_stats_2025_actual['hits'],
                        'babip': batting_stats_2025_actual['babip'],
                        'wins': pitching_stats_2025_actual['wins'],
                        'era': pitching_stats_2025_actual['era'],
                        'strikeouts': pitching_stats_2025_actual['strikeouts'],
                        'walks': pitching_stats_2025_actual['walks'],
                        'saves': pitching_stats_2025_actual['saves'],
                        'runs_scored': pitching_stats_2025_actual['runs_scored'],
                        'fip': pitching_stats_2025_actual['fip']
                    }
                }
                
                # Add to appropriate list
                if is_pitcher:
                    pitchers.append(player_obj)
                else:
                    batters.append(player_obj)
                
                # Log progress
                if idx % 50 == 0:
                    print(f"Processed {idx} players...")
                
                # Be nice to the API with a small delay
                time.sleep(0.1)
                
            except Exception as e:
                print(f"Error processing player {player_info['full_name']}: {str(e)}")
        
        # Create a combined player list
        all_players = batters + pitchers
        
        # Save data as JSON files
        with open('data/players.json', 'w') as f:
            json.dump(all_players, f)
            
        with open('data/batters.json', 'w') as f:
            json.dump(batters, f)
            
        with open('data/pitchers.json', 'w') as f:
            json.dump(pitchers, f)
            
        # Save last updated timestamp
        with open('data/last_updated.json', 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'total_players': len(all_players),
                'batters': len(batters),
                'pitchers': len(pitchers)
            }, f)
            
        print(f"Saved {len(all_players)} players ({len(batters)} batters, {len(pitchers)} pitchers)")
        return True
        
    except Exception as e:
        print(f"Error fetching players data: {str(e)}")
        return False

def fetch_player_by_name(player_name):
    """
    Search for a player by name in the MLB Stats API
    """
    try:
        search_url = f"https://statsapi.mlb.com/api/v1/people/search?names={player_name}"
        response = requests.get(search_url)
        
        if response.status_code != 200:
            return None
            
        data = response.json()
        return data.get('people', [])
    except Exception as e:
        print(f"Error searching for player: {str(e)}")
        return None

if __name__ == "__main__":
    # This allows running this script directly for testing
    print("Running fetch_data.py to update player data...")
    fetch_players_data()
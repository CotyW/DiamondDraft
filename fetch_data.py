import requests
import json
from database import db, Player
import time
from datetime import datetime

def fetch_players_data():
    """
    Fetch real MLB player data from the MLB Stats API and populate the database.
    """
    try:
        # Clear existing data
        db.session.query(Player).delete()
        db.session.commit()
        
        # Fetch active MLB players
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
                    'avg': 0.0, 'runs': 0, 'rbi': 0, 'steals': 0, 'hr': 0
                }
                
                pitching_stats_2024 = {
                    'wins': 0, 'era': 0.0, 'strikeouts': 0, 'walks': 0, 'saves': 0
                }
                
                # Make simple projections for 2025 based on 2024 data (or previous years)
                batting_stats_2025 = dict(batting_stats_2024)
                pitching_stats_2025 = dict(pitching_stats_2024)
                
                # Extract stats if available
                if 'stats' in person:
                    for stat_group in person['stats']:
                        if stat_group['group']['displayName'] == 'hitting':
                            for season_stat in stat_group['splits']:
                                stat_year = season_stat.get('season')
                                if stat_year == str(current_year - 1):  # Last year's stats (2024)
                                    stats = season_stat['stat']
                                    batting_stats_2024['avg'] = float(stats.get('avg', 0)) or 0
                                    batting_stats_2024['runs'] = int(stats.get('runs', 0)) or 0
                                    batting_stats_2024['rbi'] = int(stats.get('rbi', 0)) or 0
                                    batting_stats_2024['steals'] = int(stats.get('stolenBases', 0)) or 0
                                    batting_stats_2024['hr'] = int(stats.get('homeRuns', 0)) or 0
                                    
                                    # Simple projection: last year + small random adjustment
                                    import random
                                    factor = random.uniform(0.9, 1.1)  # ±10% variation
                                    
                                    batting_stats_2025['avg'] = round(batting_stats_2024['avg'] * factor, 3)
                                    batting_stats_2025['runs'] = int(batting_stats_2024['runs'] * factor)
                                    batting_stats_2025['rbi'] = int(batting_stats_2024['rbi'] * factor)
                                    batting_stats_2025['steals'] = int(batting_stats_2024['steals'] * factor)
                                    batting_stats_2025['hr'] = int(batting_stats_2024['hr'] * factor)
                                    break
                                    
                        if stat_group['group']['displayName'] == 'pitching':
                            for season_stat in stat_group['splits']:
                                stat_year = season_stat.get('season')
                                if stat_year == str(current_year - 1):  # Last year's stats (2024)
                                    stats = season_stat['stat']
                                    pitching_stats_2024['wins'] = int(stats.get('wins', 0)) or 0
                                    pitching_stats_2024['era'] = float(stats.get('era', 0)) or 0
                                    pitching_stats_2024['strikeouts'] = int(stats.get('strikeOuts', 0)) or 0
                                    pitching_stats_2024['walks'] = int(stats.get('baseOnBalls', 0)) or 0
                                    pitching_stats_2024['saves'] = int(stats.get('saves', 0)) or 0
                                    
                                    # Simple projection: last year + small random adjustment
                                    import random
                                    factor = random.uniform(0.9, 1.1)  # ±10% variation
                                    
                                    pitching_stats_2025['wins'] = int(pitching_stats_2024['wins'] * factor)
                                    # ERA is better when lower, so invert factor
                                    era_factor = 2 - factor  # This will be between 0.9 and 1.1
                                    pitching_stats_2025['era'] = round(pitching_stats_2024['era'] * era_factor, 2)
                                    pitching_stats_2025['strikeouts'] = int(pitching_stats_2024['strikeouts'] * factor)
                                    pitching_stats_2025['walks'] = int(pitching_stats_2024['walks'] * era_factor)
                                    pitching_stats_2025['saves'] = int(pitching_stats_2024['saves'] * factor)
                                    break
                
                # Create player record
                player = Player(
                    name=player_info['full_name'],
                    team=player_info['team_name'],
                    position=player_info['position'],
                    is_pitcher=is_pitcher,
                    
                    # 2024 stats
                    avg_2024=batting_stats_2024['avg'],
                    runs_2024=batting_stats_2024['runs'],
                    rbi_2024=batting_stats_2024['rbi'],
                    steals_2024=batting_stats_2024['steals'],
                    hr_2024=batting_stats_2024['hr'],
                    wins_2024=pitching_stats_2024['wins'],
                    era_2024=pitching_stats_2024['era'],
                    strikeouts_2024=pitching_stats_2024['strikeouts'],
                    walks_2024=pitching_stats_2024['walks'],
                    saves_2024=pitching_stats_2024['saves'],
                    
                    # 2025 projected stats
                    avg_2025=batting_stats_2025['avg'],
                    runs_2025=batting_stats_2025['runs'],
                    rbi_2025=batting_stats_2025['rbi'],
                    steals_2025=batting_stats_2025['steals'],
                    hr_2025=batting_stats_2025['hr'],
                    wins_2025=pitching_stats_2025['wins'],
                    era_2025=pitching_stats_2025['era'],
                    strikeouts_2025=pitching_stats_2025['strikeouts'],
                    walks_2025=pitching_stats_2025['walks'],
                    saves_2025=pitching_stats_2025['saves']
                )
                
                db.session.add(player)
                
                # Commit in batches to avoid memory issues
                if idx % 50 == 0:
                    db.session.commit()
                    print(f"Processed {idx} players...")
                
                # Be nice to the API with a small delay
                time.sleep(0.1)
                
            except Exception as e:
                print(f"Error processing player {player_info['full_name']}: {str(e)}")
        
        # Final commit for any remaining players
        db.session.commit()
        print("Database populated with real MLB player data")
        return True
        
    except Exception as e:
        db.session.rollback()
        print(f"Error populating database: {str(e)}")
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
    print("Running fetch_data.py directly")
    fetch_players_data()
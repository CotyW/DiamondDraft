from flask import Flask, render_template, request, jsonify, send_from_directory
from database import db, Player
import fetch_data
import os

app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///baseball_stats.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/players')
def get_players():
    year = request.args.get('year', '2025')  # Default to 2025 projected stats
    players = Player.query.all()
    return jsonify([player.to_dict() for player in players])

@app.route('/api/calculate', methods=['POST'])
def calculate_points():
    # Get the scoring weights from the request
    weights = request.json
    year = weights.get('year', '2025')
    
    # Get all players
    players = Player.query.all()
    result = []
    
    for player in players:
        player_dict = player.to_dict()
        stats = player_dict[f'stats_{year}']
        points = 0
        
        # Calculate points based on weights
        if not player.is_pitcher:  # Batter
            points += stats['avg'] * weights.get('avg', 0)
            points += stats['runs'] * weights.get('runs', 0)
            points += stats['rbi'] * weights.get('rbi', 0)
            points += stats['steals'] * weights.get('steals', 0)
            points += stats['hr'] * weights.get('hr', 0)
        else:  # Pitcher
            points += stats['wins'] * weights.get('wins', 0)
            # For ERA, lower is better, so we invert the weight
            if weights.get('era', 0) != 0:
                points += (5.0 - stats['era']) * weights.get('era', 0)  # 5.0 is a baseline ERA
            points += stats['strikeouts'] * weights.get('strikeouts', 0)
            # For walks, lower is better, so we invert the weight
            if weights.get('walks', 0) != 0:
                points += (100 - stats['walks']) * weights.get('walks', 0) / 100  # Normalize walks
            points += stats['saves'] * weights.get('saves', 0)
        
        # Add points to the result
        player_dict['points'] = round(points, 2)
        result.append(player_dict)
    
    return jsonify(result)

@app.route('/api/refresh-data')
def refresh_data():
    success = fetch_data.fetch_players_data()
    return jsonify({'success': success})

@app.route('/data/<path:filename>')
def data_files(filename):
    return send_from_directory('data', filename)

if __name__ == '__main__':
    # Create the database if it doesn't exist
    if not os.path.exists('instance/baseball_stats.db'):
        with app.app_context():
            db.create_all()
            fetch_data.fetch_players_data()  # Populate with sample data
    
    app.run(debug=True)
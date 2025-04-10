from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Player(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    team = db.Column(db.String(50))
    position = db.Column(db.String(20))
    
    # Batting stats - 2024 actual
    avg_2024 = db.Column(db.Float, default=0.0)
    runs_2024 = db.Column(db.Integer, default=0)
    rbi_2024 = db.Column(db.Integer, default=0)
    steals_2024 = db.Column(db.Integer, default=0)
    hr_2024 = db.Column(db.Integer, default=0)
    
    # Batting stats - 2025 projected
    avg_2025 = db.Column(db.Float, default=0.0)
    runs_2025 = db.Column(db.Integer, default=0)
    rbi_2025 = db.Column(db.Integer, default=0)
    steals_2025 = db.Column(db.Integer, default=0)
    hr_2025 = db.Column(db.Integer, default=0)
    
    # Pitching stats - 2024 actual
    wins_2024 = db.Column(db.Integer, default=0)
    era_2024 = db.Column(db.Float, default=0.0)
    strikeouts_2024 = db.Column(db.Integer, default=0)
    walks_2024 = db.Column(db.Integer, default=0)
    saves_2024 = db.Column(db.Integer, default=0)
    
    # Pitching stats - 2025 projected
    wins_2025 = db.Column(db.Integer, default=0)
    era_2025 = db.Column(db.Float, default=0.0)
    strikeouts_2025 = db.Column(db.Integer, default=0)
    walks_2025 = db.Column(db.Integer, default=0)
    saves_2025 = db.Column(db.Integer, default=0)
    
    # Flag to indicate if player is primarily a batter or pitcher
    is_pitcher = db.Column(db.Boolean, default=False)
    
    def __repr__(self):
        return f'<Player {self.name}>'
        
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'team': self.team,
            'position': self.position,
            'is_pitcher': self.is_pitcher,
            'stats_2024': {
                'avg': self.avg_2024,
                'runs': self.runs_2024,
                'rbi': self.rbi_2024,
                'steals': self.steals_2024,
                'hr': self.hr_2024,
                'wins': self.wins_2024,
                'era': self.era_2024,
                'strikeouts': self.strikeouts_2024,
                'walks': self.walks_2024,
                'saves': self.saves_2024
            },
            'stats_2025': {
                'avg': self.avg_2025,
                'runs': self.runs_2025,
                'rbi': self.rbi_2025,
                'steals': self.steals_2025,
                'hr': self.hr_2025,
                'wins': self.wins_2025,
                'era': self.era_2025,
                'strikeouts': self.strikeouts_2025,
                'walks': self.walks_2025,
                'saves': self.saves_2025
            }
        }
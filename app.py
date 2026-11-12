"""Local server for DiamondDraft: serves the page, data/*.json and the data-source config."""
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, send_from_directory

load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')

# Supabase credentials for frontend
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
# 'static' reads data/players.json; set DATA_SOURCE=supabase in .env to use Supabase
DATA_SOURCE = os.getenv('DATA_SOURCE', 'static').lower()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/supabase-config')
def get_supabase_config():
    """Return Supabase config for frontend"""
    return jsonify({
        'data_source': DATA_SOURCE,
        'url': SUPABASE_URL,
        'key': SUPABASE_KEY
    })


@app.route('/data/<path:filename>')
def data_files(filename):
    return send_from_directory('data', filename)


if __name__ == '__main__':
    app.run(debug=True)

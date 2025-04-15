# DiamondDraft - Baseball Stats Calculator

DiamondDraft is a web application for calculating and comparing baseball player values based on customizable scoring metrics. Perfect for fantasy baseball players, baseball analysts, and sports enthusiasts.

## Features

- Display and compare MLB player statistics (batters and pitchers)
- Customize scoring weights for different statistical categories
- Calculate player values based on your scoring system
- Toggle between actual (2024) and projected (2025) statistics
- Filter players by position (batters/pitchers)
- Search for specific players by name or team
- Sort players by any statistic or calculated value

## How It Works

DiamondDraft is a static web application hosted on GitHub Pages. Player data is automatically updated daily from the MLB Stats API using GitHub Actions. All calculations are performed client-side in your browser.

### Data Updates

Player statistics are updated daily at 5:00 UTC through an automated GitHub Action. This ensures you always have access to the latest player data without any manual intervention.

## Local Development

To work on this project locally:

1. Clone this repository
2. Run a local server (e.g., `python -m http.server` or use VSCode Live Server)
3. Open your browser to the local server address

### Updating Data Manually

If you need to update the player data manually:

1. Install Python and required packages: `pip install requests`
2. Run the data fetch script: `python fetch_json_data.py`
3. This will create/update JSON files in the `data/` directory

## Project Structure

- `index.html` - Main application page
- `static/styles.css` - Application styling
- `static/main.js` - Client-side logic and calculations
- `/templates/data/` - JSON files containing player statistics
- `fetch_data.py` - Script to fetch and process MLB player data
- `.github/workflows/update-data.yml` - GitHub Action for automatic data updates

## License

[MIT License](LICENSE)

## Acknowledgments

- Data provided by MLB Stats API
- Icons by [Font Awesome](https://fontawesome.com/)
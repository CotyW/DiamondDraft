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
2. Run the data fetch script: `python fetch_data.py`
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

## Contributing
DiamondDraft is an open project meant to help baseball enthusiasts analyze player statistics. I am new to development, so additions will come slow.  I am looking to implement various APIs so that users can select their preferred platform for projections and possibly even enter their own.  If you have ideas, there are two ways you can use or contribute to this project:

### Option 1: Contribute to this project
Have ideas for improvements? Found a bug? Want to add a feature? I welcome contributions!

- **Open an issue** describing what you'd like to change
- **Submit a pull request** with your improvements
- **Contact me directly** at coty1283@gmail.com with questions or suggestions

### Option 2: Create your own version
This project is designed to be easy to fork and customize:

1. Fork this repository to your own GitHub account
2. Modify it to fit your specific needs
3. Deploy using GitHub Pages for a free, no-hassle hosting solution

If you create your own version, I'd love to hear about it! Drop me an email at coty1283@gmail.com to share what you've built.

## Support
If you need help setting up or customizing this project, feel free to:
- Open an issue on GitHub
- Email me at coty1283@gmail.com

I'm happy to help fellow baseball enthusiasts get the most out of this tool!
# DiamondDraft - Baseball Stats Calculator
DiamondDraft is a web application for calculating and comparing baseball player values based on customizable scoring metrics. Perfect for fantasy baseball players, baseball analysts, and sports enthusiasts.

## Features
- Display and compare MLB player statistics (batters and pitchers)
- Season tabs for the last three seasons plus a projection for the next one
- Customize scoring weights for different statistical categories
- Filter by position and team, alone or together (e.g. 3B + Giants)
- Multi-position eligibility (20+ games at a position in the latest season) and SP/RP pitcher roles
- Search for players by name or team; sort by any statistic or calculated value
- **Draft Analysis panel** for roto, H2H categories or points leagues:
  - Category Impact: which categories are scarce or deep, and how much each is worth
  - Draft Board & Tiers: player values above replacement level, grouped into tiers
  - Position Scarcity: how steeply value drops at each position (including SP and RP)

## How It Works
DiamondDraft is a static web application (GitHub Pages or a local Flask server). Player data lives in `data/*.json`, refreshed daily from the MLB Stats API by a GitHub Action. All calculations run client-side in your browser.

The projection uses the Marcel method, a deliberately simple and widely used baseline (`projections.py`):
- The last three seasons are weighted 5/4/3 for batters and 3/2/1 for pitchers, newest heaviest.
- Every player is regressed toward league average by adding 1,200 plate appearances (batters) or 134 innings (pitchers) of league-average stats, so a player with little history moves the most.
- Rates rise slightly for players under 29 and fall for those over it.
- Playing time is half of last season plus a tenth of the season before, plus 200 PA (batters), 60 IP (starters) or 25 IP (relievers).

Marcel is a sanity baseline, not a forecast that competes with Steamer or ZiPS.

## Live Demo
[https://CotyW.github.io/DiamondDraft](https://CotyW.github.io/DiamondDraft)

## Local Development
1. Create a virtualenv and install dependencies: `pip install -r requirements.txt`
2. Start the app: `python app.py`
3. Open http://localhost:5000

By default the app reads `data/players.json` (`DATA_SOURCE=static`). No database is needed.

### Updating Data Manually
```
python fetch_data.py                                   # seasons from DEFAULT_SEASONS
python fetch_data.py --seasons 2024 2025 2026 --projection-year 2027
```
A full run makes about 1,800 API calls and takes roughly 15 minutes. It writes `data/players.json`, `batters.json`, `pitchers.json` and `last_updated.json`.

Failed requests are retried. If a run still comes back with more than 5% fewer players than `data/players.json`, or 5% fewer players with stats in any season both cover, it leaves the existing files alone and exits with an error, so the daily Action doesn't publish a half-failed fetch. Add `--force` to save anyway.

### Rolling Over to a New Season
The season years are set in one place: `DEFAULT_SEASONS` in `fetch_data.py`. Add the new season there (the projection is always the year after the last one) and run the fetch. The page builds its season tabs from `data/last_updated.json`, so nothing else needs editing.

### Running Tests
Tests live in `tests/`: the draft valuation engine and stat definitions (JavaScript) and the projections (Python). Run `npm test` for both; it needs Node 22+ and Python 3, with no packages to install. They also run on GitHub for every push.

### Publishing to GitHub Pages
The root `index.html` is generated from `templates/index.html`. After editing the template, run `python build_pages.py` and commit the result.

### Optional: Supabase storage
For long-term storage in Supabase:
1. Create a project and run `supabase_schema.sql` in its SQL editor.
2. Put `SUPABASE_URL` and keys in `.env` (never commit it).
3. Run `python upload_static_to_supabase.py` (use `--dry-run` first).
4. Set `DATA_SOURCE=supabase` in `.env`.

## Project Structure
- `app.py` - Flask server (serves the page, `/data/` and the config endpoint)
- `templates/index.html` - Page template; `index.html` is generated from it by `build_pages.py`
- `static/stats.js` - The list of stats: table columns, player card, comparison and Scoring Weights inputs are built from it
- `static/main.js` - Table, filters and calculator
- `static/valuation.js` - Draft valuation engine (z-scores, replacement level, tiers)
- `static/analysis.js`, `static/analysis.css` - Draft Analysis panel
- `static/supabase-client.js` - Loads data from static JSON or Supabase
- `fetch_data.py` - Fetches and processes MLB data
- `projections.py` - Season stat lines and the Marcel projection
- `upload_static_to_supabase.py`, `supabase_schema.sql` - Supabase setup
- `tests/` - Tests for the valuation engine, stat definitions and projections (`npm test`)
- `.github/workflows/update-data.yml` - Daily data update
- `.github/workflows/test.yml` - Runs the tests on every push
- `archive/supabase-pipeline/` - Unfinished FanGraphs-to-Supabase ingestion scripts, kept for reference (not used)

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
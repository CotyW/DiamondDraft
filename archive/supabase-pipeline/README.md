# Archived: Supabase ingestion pipeline

Unfinished work from Nov 2025 – Feb 2026, kept for reference. Nothing in the app uses it.
The project went with static JSON for player data (see the main README); these files are here
in case user accounts, cross-device sync or saved projection scenarios are added later.

## What's here
- `injection.py` – pulls FanGraphs season stats via pybaseball and upserts them into Supabase.
- `injection_update.py` – incremental date-range update. The fantasy-value recalculation step
  is a stub and categories scoring returns 0.
- `load_player_mapping.py` – loads `player_mapping.csv` into a `player_id_mapping` table.
- `player_mapping.csv` – public player ID map linking FanGraphs, MLB, Baseball-Reference, Yahoo,
  ESPN and other IDs. Useful on its own for matching FanGraphs projections to MLB player IDs.
- `injection_log.txt` – log of the one recorded run (UTF-16).

## Known problems
- Uses tables not defined in `supabase_schema.sql`: `player_id_mapping`, `scenarios`,
  `scenario_projections`, `fantasy_settings`, `player_valuations`.
- The logged run upserted the same record count for every two-month batch, so each batch
  likely overwrote the previous one instead of adding to it.
- The run crashed at the end printing an emoji to the Windows console (cp1252 encoding).

## Running it again
Needs `pandas`, `pybaseball` and `supabase` (`pip install pandas pybaseball supabase`), plus
`SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Run from the repo root.

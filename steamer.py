"""Steamer projections from FanGraphs CSV exports.

Download the Steamer batters and pitchers projections from FanGraphs ("Export Data") and save
them as projections/steamer-batters.csv and projections/steamer-pitchers.csv. fetch_data.py
then uses Steamer as the projection for every player it can match, and keeps the Marcel
projection for the rest. To apply new CSVs without refetching everything:

    python fetch_data.py --projections-only

Players are matched by MLB id (the export's MLBAMID column). If a file has no id column,
players are matched by name, and only when the name is unique among batters or pitchers.
"""
import csv
import os
import re
import unicodedata

import projections as proj

FILES = {False: os.path.join('projections', 'steamer-batters.csv'),
         True: os.path.join('projections', 'steamer-pitchers.csv')}

# Our stat key -> FanGraphs column (other spellings in ALIASES)
BAT_COLUMNS = {'pa': 'PA', 'ab': 'AB', 'hits': 'H', 'doubles': '2B', 'triples': '3B', 'hr': 'HR',
               'runs': 'R', 'rbi': 'RBI', 'steals': 'SB', 'cs': 'CS', 'bb': 'BB', 'so': 'SO',
               'hbp': 'HBP', 'sf': 'SF'}
PIT_COLUMNS = {'ip': 'IP', 'g': 'G', 'gs': 'GS', 'wins': 'W', 'losses': 'L', 'saves': 'SV',
               'holds': 'HLD', 'strikeouts': 'SO', 'walks': 'BB', 'hbp': 'HBP',
               'hits_allowed': 'H', 'hr_allowed': 'HR', 'runs_scored': 'R', 'er': 'ER'}
REQUIRED = {False: ['PA', 'AB', 'H', 'HR'], True: ['IP', 'SO', 'BB', 'ER']}
ALIASES = {'SO': ['K'], 'MLBAMID': ['XMLBAMID', 'MLBID', 'MLBAM_ID']}


def normalize_name(name):
    """'José Ramírez Jr.' -> 'jose ramirez', for matching names across sources."""
    s = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z ]', '', s.replace('-', ' '))
    s = re.sub(r'\b(jr|sr|ii|iii|iv)\b', '', s)
    return ' '.join(s.split())


def _number(value):
    try:
        return float(str(value).replace(',', '').strip())
    except ValueError:
        return 0.0


def read_csv(path, is_pitcher):
    """Rows of one Steamer export as [{'mlb_id', 'name', 'counts'}]. Raises ValueError if the
    file isn't a batters (or pitchers) projection export."""
    columns = PIT_COLUMNS if is_pitcher else BAT_COLUMNS
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        header = {h.strip().strip('"').upper(): h for h in (reader.fieldnames or [])}

        def column(name):
            for n in [name] + ALIASES.get(name, []):
                if n in header:
                    return header[n]
            return None

        kind = 'pitchers' if is_pitcher else 'batters'
        missing = [c for c in REQUIRED[is_pitcher] + ['NAME'] if column(c) is None]
        if missing:
            raise ValueError(f"{path} doesn't look like a Steamer {kind} export "
                             f"(no {', '.join(missing)} column)")
        id_col = column('MLBAMID')
        cols = {key: column(name) for key, name in columns.items()}
        rows = []
        for r in reader:
            name = (r.get(column('NAME')) or '').strip()
            if not name:
                continue
            raw_id = (r.get(id_col) or '').strip() if id_col else ''
            rows.append({
                'mlb_id': int(float(raw_id)) if re.fullmatch(r'\d+(\.0+)?', raw_id) else None,
                'name': name,
                'counts': {key: _number(r.get(col)) if col else 0.0 for key, col in cols.items()},
            })
        return rows


def apply(players, rows, is_pitcher, year, fip_constant=proj.DEFAULT_FIP_CONSTANT):
    """Set the projection year of each matched player (batters or pitchers) to Steamer's line.

    Returns (matched, unmatched): the number of players updated, and the names of CSV rows
    with no player in our data (mostly minor leaguers).
    """
    group = [p for p in players if p['is_pitcher'] == is_pitcher]
    by_id = {int(p.get('mlb_id', p['id'])): p for p in group}
    by_name = {}
    for p in group:
        by_name.setdefault(normalize_name(p['name']), []).append(p)

    matched, unmatched, used = 0, [], set()
    for row in rows:
        player = by_id.get(row['mlb_id']) if row['mlb_id'] is not None else None
        if player is None and row['mlb_id'] is None:
            candidates = by_name.get(normalize_name(row['name']), [])
            player = candidates[0] if len(candidates) == 1 else None
        if player is None or id(player) in used:
            unmatched.append(row['name'])
            continue
        used.add(id(player))
        c = row['counts']
        line = proj.pitching_line(c, fip_constant) if is_pitcher else proj.batting_line(c)
        player['stats'][str(year)] = line
        player['projection_source'] = 'steamer'
        matched += 1
    return matched, unmatched


def apply_files(players, year, fip_constant, files=None):
    """Apply whichever Steamer CSVs exist. Returns {'batters': n, 'pitchers': n} matched,
    or {} when there are no files."""
    files = files or FILES
    result = {}
    for is_pitcher, path in files.items():
        if not path or not os.path.exists(path):
            continue
        rows = read_csv(path, is_pitcher)
        matched, unmatched = apply(players, rows, is_pitcher, year, fip_constant)
        kind = 'pitchers' if is_pitcher else 'batters'
        print(f"Steamer {kind}: {matched} players matched from {len(rows)} rows in {path}"
              f" ({len(unmatched)} not in our data)")
        result[kind] = matched
    return result

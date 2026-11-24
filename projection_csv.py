"""Projection systems from CSV files: Steamer, ZiPS, ATC, THE BAT, or any other system.

Save each system's exports in projections/ as <system>-batters.csv and <system>-pitchers.csv,
e.g. projections/zips-batters.csv. The system name is the part before the dash: lowercase
letters and digits only. Either file may be missing. FanGraphs' "Export Data" files work as
they are; any other source works if it has the columns below (see projections/README.md).
To apply new or changed CSVs without refetching the stats:

    python fetch_data.py --projections-only

A player's projection-year stats use the first system in PREFERRED_ORDER that covers them
(Marcel if none does). The other systems' lines, Marcel's included, go in
player['projections'][system]. The page's Projections dropdown switches between them.

Players are matched by MLB id (the MLBAMID column). If a file has no id column, players are
matched by name, and only when the name is unique among batters or pitchers.
"""
import csv
import glob
import os
import re
import unicodedata

import projections as proj

PROJECTIONS_DIR = 'projections'
FILE_PATTERN = re.compile(r'^([a-z0-9]+)-(batters|pitchers)\.csv$')
# Names the page uses for its own options, so a CSV can't take them
RESERVED = {'marcel', 'upload'}
# Which system a player's default projection comes from when several cover them: blends first
PREFERRED_ORDER = ['atc', 'depthcharts', 'thebatx', 'thebat', 'steamer', 'zips', 'zipsdc', 'oopsy']
LABELS = {'steamer': 'Steamer', 'zips': 'ZiPS', 'zipsdc': 'ZiPS DC', 'atc': 'ATC',
          'thebat': 'THE BAT', 'thebatx': 'THE BAT X', 'depthcharts': 'Depth Charts',
          'oopsy': 'OOPSY', 'pecota': 'PECOTA', 'davenport': 'Davenport'}

# Our stat key -> CSV column (other spellings in ALIASES)
BAT_COLUMNS = {'pa': 'PA', 'ab': 'AB', 'hits': 'H', 'doubles': '2B', 'triples': '3B', 'hr': 'HR',
               'runs': 'R', 'rbi': 'RBI', 'steals': 'SB', 'cs': 'CS', 'bb': 'BB', 'so': 'SO',
               'hbp': 'HBP', 'sf': 'SF'}
PIT_COLUMNS = {'ip': 'IP', 'g': 'G', 'gs': 'GS', 'wins': 'W', 'losses': 'L', 'saves': 'SV',
               'holds': 'HLD', 'strikeouts': 'SO', 'walks': 'BB', 'hbp': 'HBP',
               'hits_allowed': 'H', 'hr_allowed': 'HR', 'runs_scored': 'R', 'er': 'ER'}
REQUIRED = {False: ['PA', 'AB', 'H', 'HR'], True: ['IP', 'SO', 'BB', 'ER']}
ALIASES = {'SO': ['K'], 'NAME': ['PLAYERNAME', 'PLAYER'],
           'MLBAMID': ['XMLBAMID', 'MLBID', 'MLBAM_ID', 'MLB_ID']}


def label(system):
    """Display name for a system key: 'thebatx' -> 'THE BAT X'."""
    return LABELS.get(system, system.upper() if len(system) <= 4 else system.capitalize())


def find_files(directory=PROJECTIONS_DIR):
    """{system: {False: batters path or None, True: pitchers path or None}} for the CSVs present."""
    systems = {}
    for path in sorted(glob.glob(os.path.join(directory, '*.csv'))):
        m = FILE_PATTERN.match(os.path.basename(path).lower())
        if not m:
            print(f"Skipping {path}: name it <system>-batters.csv or <system>-pitchers.csv")
            continue
        system, kind = m.groups()
        if system in RESERVED:
            print(f"Skipping {path}: '{system}' is reserved, pick another system name")
            continue
        systems.setdefault(system, {False: None, True: None})[kind == 'pitchers'] = path
    return systems


def order_systems(systems):
    """Systems in default-preference order: PREFERRED_ORDER first, then the rest by name."""
    known = [s for s in PREFERRED_ORDER if s in systems]
    return known + sorted(s for s in systems if s not in PREFERRED_ORDER)


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
    """Rows of one export as [{'mlb_id', 'name', 'counts'}]. Raises ValueError if the file
    isn't a batters (or pitchers) projection file."""
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
            raise ValueError(f"{path} doesn't look like a {kind} projection file "
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


def apply(players, rows, is_pitcher, system, fip_constant=proj.DEFAULT_FIP_CONSTANT):
    """Store the system's line for each matched player (batters or pitchers) in
    player['projections'][system].

    Returns (matched, unmatched): the number of players matched, and the names of CSV rows
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
        player.setdefault('projections', {})[system] = line
        matched += 1
    return matched, unmatched


def use_defaults(players, year, systems):
    """Make the first system in `systems` (already in preference order) that covers a player
    their projection-year stats, and record it in player['projection_source']. That line moves
    out of player['projections'], and the Marcel line it replaces moves in, so `projections`
    holds every other option for the player."""
    for p in players:
        covered = p.get('projections') or {}
        system = next((s for s in systems if s in covered), None)
        if system is None:
            continue
        covered['marcel'] = p['stats'].get(str(year))
        p['stats'][str(year)] = covered.pop(system)  # stored once, in stats
        p['projection_source'] = system


def apply_files(players, year, fip_constant, files=None):
    """Apply every system's CSVs (find_files() by default) and set each player's default.

    Returns {system: {'batters': n, 'pitchers': n}} matched, in preference order; {} when
    there are no files.
    """
    files = find_files() if files is None else files
    result = {}
    for system in order_systems(files):
        counts = {}
        for is_pitcher, path in files[system].items():
            if not path or not os.path.exists(path):
                continue
            rows = read_csv(path, is_pitcher)
            matched, unmatched = apply(players, rows, is_pitcher, system, fip_constant)
            kind = 'pitchers' if is_pitcher else 'batters'
            print(f"{label(system)} {kind}: {matched} players matched from {len(rows)} rows in {path}"
                  f" ({len(unmatched)} not in our data)")
            counts[kind] = matched
        if counts:
            result[system] = counts
    use_defaults(players, year, list(result))
    return result

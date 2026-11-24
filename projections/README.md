Put projection-system CSVs here as `<system>-batters.csv` and `<system>-pitchers.csv` (e.g.
`steamer-batters.csv`, `zips-pitchers.csv`, `atc-batters.csv`), then run
`python fetch_data.py --projections-only`. See "Using Projection Systems" in the main README.

The CSVs are git-ignored: FanGraphs does not allow republishing its data, so never commit them.

## File format

FanGraphs "Export Data" files work as they are. Files from anywhere else need a header row,
then one row per player, with these columns (not case-sensitive; other columns are ignored):

| File     | Required                            | Optional                                   |
|----------|-------------------------------------|--------------------------------------------|
| Batters  | `Name` `PA` `AB` `H` `HR`           | `2B` `3B` `R` `RBI` `SB` `CS` `BB` `SO` `HBP` `SF` |
| Pitchers | `Name` `IP` `SO` (or `K`) `BB` `ER` | `G` `GS` `W` `L` `SV` `HLD` `H` `HR` `R` `HBP` |
| Both     |                                     | `MLBAMID`: the MLB player id, for exact matching |

- Use season totals. Rates (AVG, OBP, SLG, ERA, WHIP, FIP, K/9) are calculated from the counts.
- Without `MLBAMID`, players are matched by name; names shared by two players are skipped.
- A missing optional stat counts as 0.

The same format works for the site's Upload CSV button, which reads the files in the visitor's
browser instead (`static/projection-upload.js`).

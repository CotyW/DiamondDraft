"""Season stat lines and Marcel-style projections.

A stat line is a dict of counting stats plus rate stats derived from them. Batting and pitching
lines use different keys (see BAT_COUNTS / PIT_COUNTS); a player stores only their own kind.

Projections follow the Marcel method (Tom Tango's deliberately simple baseline system):
  1. Weight the last three seasons, newest heaviest (5/4/3 for batters, 3/2/1 for pitchers).
  2. Regress toward league average by adding a fixed amount of league-average playing time
     (1200 PA for batters, 134 IP for pitchers). Players with little history move the most.
  3. Adjust for age: rates rise before 29 and fall after it.
  4. Project playing time from the last two seasons plus a baseline.
The point is a sane, explainable baseline, not a forecast to beat Steamer or ZiPS.
"""

BAT_COUNTS = ['pa', 'ab', 'hits', 'doubles', 'triples', 'hr', 'runs', 'rbi', 'steals', 'cs',
              'bb', 'so', 'hbp', 'sf']
BAT_RATES = ['avg', 'obp', 'slg', 'ops', 'babip', 'tb']
PIT_COUNTS = ['ip', 'g', 'gs', 'wins', 'losses', 'saves', 'holds', 'strikeouts', 'walks', 'hbp',
              'hits_allowed', 'hr_allowed', 'runs_scored', 'er']
PIT_RATES = ['era', 'whip', 'fip', 'k9', 'bb9']

DEFAULT_FIP_CONSTANT = 3.10

# Marcel settings
BAT_WEIGHTS = [5, 4, 3]          # newest season first
PIT_WEIGHTS = [3, 2, 1]
BAT_REGRESS_PA = 1200
PIT_REGRESS_IP = 134
PEAK_AGE = 29
YOUNG_GAIN, OLD_LOSS = 0.006, 0.003      # rate change per year of age away from the peak
BAT_PT = (0.5, 0.1, 200)         # projected PA = 0.5 * last season + 0.1 * the one before + 200
SP_PT, RP_PT = (0.5, 0.1, 60), (0.5, 0.1, 25)
# Age moves "good" stats up for young players and "bad" stats (strikeouts, runs allowed) down
BAT_AGE_UP = {'hits', 'doubles', 'triples', 'hr', 'runs', 'rbi', 'steals', 'bb'}
BAT_AGE_DOWN = {'so', 'cs'}
PIT_AGE_UP = {'wins', 'saves', 'holds', 'strikeouts'}
PIT_AGE_DOWN = {'losses', 'walks', 'hbp', 'hits_allowed', 'hr_allowed', 'runs_scored', 'er'}
# Role stats describe how a pitcher is used, not how good he is, so they come from his own
# recent rate per inning with no pull toward league average: a closer keeps projecting saves,
# and a starter is never handed saves or holds just because the league average has some.
# (Regressing them made top closers project ~23 saves, well short of how drafts value them.)
PIT_OWN_RATE = {'g', 'gs', 'saves', 'holds'}
PIT_SHRINK_TO_ZERO = set()


def _div(a, b, digits):
    return round(a / b, digits) if b else 0.0


def empty_line(is_pitcher):
    keys = (PIT_COUNTS + PIT_RATES) if is_pitcher else (BAT_COUNTS + BAT_RATES)
    return {k: 0 for k in keys}


def batting_line(c):
    """Counting stats -> full batting line with AVG, OBP, SLG, OPS, BABIP and total bases."""
    line = {k: int(round(c.get(k, 0) or 0)) for k in BAT_COUNTS}
    h, ab, hr = line['hits'], line['ab'], line['hr']
    tb = h + line['doubles'] + 2 * line['triples'] + 3 * hr
    obp_den = ab + line['bb'] + line['hbp'] + line['sf']
    obp = _div(h + line['bb'] + line['hbp'], obp_den, 3)
    slg = _div(tb, ab, 3)
    babip_den = ab - line['so'] - hr + line['sf']
    line.update(avg=_div(h, ab, 3), obp=obp, slg=slg, ops=round(obp + slg, 3), tb=tb,
                babip=_div(h - hr, babip_den, 3) if babip_den > 0 else 0.0)
    return line


def pitching_line(c, fip_constant=DEFAULT_FIP_CONSTANT):
    """Counting stats -> full pitching line with ERA, WHIP, FIP, K/9 and BB/9."""
    ip = round(float(c.get('ip', 0) or 0), 1)
    line = {k: int(round(c.get(k, 0) or 0)) for k in PIT_COUNTS if k != 'ip'}
    line['ip'] = ip
    fip_raw = 13 * line['hr_allowed'] + 3 * (line['walks'] + line['hbp']) - 2 * line['strikeouts']
    line.update(era=_div(9 * line['er'], ip, 2),
                whip=_div(line['walks'] + line['hits_allowed'], ip, 2),
                fip=round(fip_raw / ip + fip_constant, 2) if ip else 0.0,
                k9=_div(9 * line['strikeouts'], ip, 1), bb9=_div(9 * line['walks'], ip, 1))
    return line


def league_totals(lines, counts):
    """Sum counting stats over every player's line for one season."""
    total = {k: 0.0 for k in counts}
    for line in lines:
        for k in counts:
            total[k] += line.get(k, 0) or 0
    return total


def fip_constant(pitching_totals):
    """The season's FIP constant: the value that makes league FIP equal league ERA."""
    t = pitching_totals
    if not t.get('ip'):
        return DEFAULT_FIP_CONSTANT
    lg_era = 9 * t['er'] / t['ip']
    return round(lg_era - (13 * t['hr_allowed'] + 3 * (t['walks'] + t['hbp']) - 2 * t['strikeouts']) / t['ip'], 2)


def age_factor(age):
    if age is None:
        return 1.0
    gain = YOUNG_GAIN if age < PEAK_AGE else OLD_LOSS
    return 1 + (PEAK_AGE - age) * gain


def _marcel(history, league, counts, time_key, weights, regress, age, up, down, playing_time,
            own_rate=(), shrink_to_zero=()):
    """Shared Marcel arithmetic. history and league are newest first; returns projected counts."""
    weights = weights[:len(history)]
    weighted_time = sum(w * (h.get(time_key, 0) or 0) for w, h in zip(weights, history))
    if not weighted_time:
        return None
    lg_time = sum(w * (lg.get(time_key, 0) or 0) for w, lg in zip(weights, league))
    factor = age_factor(age)
    a, b, base = playing_time
    recent = [(h.get(time_key, 0) or 0) for h in history] + [0, 0]
    proj_time = a * recent[0] + b * recent[1] + base

    out = {time_key: proj_time}
    for k in counts:
        if k == time_key:
            continue
        own = sum(w * (h.get(k, 0) or 0) for w, h in zip(weights, history))
        if k in own_rate:
            rate = own / weighted_time
        else:
            lg_rate = 0 if k in shrink_to_zero or not lg_time else (
                sum(w * (lg.get(k, 0) or 0) for w, lg in zip(weights, league)) / lg_time)
            rate = (own + regress * lg_rate) / (weighted_time + regress)
        if k in up:
            rate *= factor
        elif k in down:
            rate /= factor
        out[k] = rate * proj_time
    return out


def project_batter(history, league, age=None):
    """Projected batting line from up to three seasons (newest first) and matching league totals."""
    c = _marcel(history, league, BAT_COUNTS, 'pa', BAT_WEIGHTS, BAT_REGRESS_PA, age,
                BAT_AGE_UP, BAT_AGE_DOWN, BAT_PT)
    return batting_line(c) if c else empty_line(False)


def project_pitcher(history, league, age=None, fip_const=DEFAULT_FIP_CONSTANT):
    """Projected pitching line. Starters (half or more of appearances are starts) get more innings."""
    games = sum(h.get('g', 0) or 0 for h in history[:len(PIT_WEIGHTS)])
    starts = sum(h.get('gs', 0) or 0 for h in history[:len(PIT_WEIGHTS)])
    starter = bool(games) and starts / games >= 0.5
    c = _marcel(history, league, PIT_COUNTS, 'ip', PIT_WEIGHTS, PIT_REGRESS_IP, age,
                PIT_AGE_UP, PIT_AGE_DOWN, SP_PT if starter else RP_PT, PIT_OWN_RATE, PIT_SHRINK_TO_ZERO)
    return pitching_line(c, fip_const) if c else empty_line(True)

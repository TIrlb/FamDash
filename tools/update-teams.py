#!/usr/bin/env python3
"""Regenerate data/teams/*.json from ESPN's team lists (their list endpoint has no CORS,
so the controller reads these static copies instead). Run from the repo root."""
import json, urllib.request, pathlib
LEAGUES = ['football/college-football', 'basketball/mens-college-basketball', 'basketball/womens-college-basketball',
           'football/nfl', 'basketball/nba', 'basketball/wnba', 'baseball/mlb']
out = pathlib.Path('data/teams'); out.mkdir(parents=True, exist_ok=True)
for lg in LEAGUES:
    with urllib.request.urlopen(f'https://site.api.espn.com/apis/site/v2/sports/{lg}/teams?limit=1000') as r:
        j = json.load(r)
    teams = sorted(({'id': t['team']['id'], 'name': t['team']['displayName'], 'abbr': t['team'].get('abbreviation', '')}
                    for t in j['sports'][0]['leagues'][0]['teams']), key=lambda t: t['name'])
    (out / (lg.replace('/', '_') + '.json')).write_text(json.dumps(teams, separators=(',', ':')))
    print(lg, len(teams))

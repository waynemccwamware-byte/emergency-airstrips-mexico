#!/usr/bin/env python3
"""Build site/data/navaids.json and site/data/us-airports.json from OurAirports (public domain).
Run: python3 tools/build-data.py   (downloads navaids.csv and airports.csv from the OurAirports GitHub mirror)
Navaids: every Mexican navaid, plus US navaids south of 37.5 N between 125 W and 93 W (routes that start or end in the US Southwest).
US airports: ICAO-identified (Kxxx) small/medium/large airports in CA, AZ, NM and TX."""
import csv, io, json, re, urllib.request, datetime, os
BASE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/'
def get(name): return list(csv.DictReader(io.StringIO(urllib.request.urlopen(BASE + name).read().decode('utf-8'))))
nav = []
for r in get('navaids.csv'):
    la, lo = float(r['latitude_deg']), float(r['longitude_deg'])
    if r['iso_country'] == 'MX' or (r['iso_country'] == 'US' and la < 37.5 and -125 < lo < -93):
        nav.append([r['ident'], r['name'], r['type'], round(la, 5), round(lo, 5), r['iso_country']])
us = []
for r in get('airports.csv'):
    if r['iso_region'] in ('US-CA', 'US-AZ', 'US-NM', 'US-TX') and re.fullmatch(r'K[A-Z0-9]{3}', r['ident']) and r['type'] in ('small_airport', 'medium_airport', 'large_airport'):
        us.append([r['ident'], r['name'], round(float(r['latitude_deg']), 5), round(float(r['longitude_deg']), 5)])
# longest open runway for each Mexican ICAO airport in site/data/mx-icao.json (v0.2: ICAO airports go through the same filters)
icao_codes = {a['code'] for a in json.load(open(os.path.join(os.path.dirname(__file__), '..', 'site', 'data', 'mx-icao.json')))['airports']}
rwy = {}
for r in get('runways.csv'):
    c = r['airport_ident']
    if c not in icao_codes or r['closed'] == '1': continue
    try: L = int(float(r['length_ft'] or 0))
    except ValueError: L = 0
    if c not in rwy or L > rwy[c][1]:
        rwy[c] = ['/'.join(x for x in (r['le_ident'], r['he_ident']) if x), L or None, (r['surface'] or '').upper()]
built = datetime.date.today().isoformat()
src = 'OurAirports (public domain), https://ourairports.com/data/ via github.com/davidmegginson/ourairports-data'
here = os.path.join(os.path.dirname(__file__), '..', 'site', 'data')
json.dump({'about': 'Navaids for route entry: [ident, name, type, lat, lon, country]', 'source': src, 'built': built, 'navaids': nav}, open(os.path.join(here, 'navaids.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'about': 'US airports (CA, AZ, NM, TX) for route entry: [ident, name, lat, lon]', 'source': src, 'built': built, 'airports': us}, open(os.path.join(here, 'us-airports.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'about': 'Longest open runway per Mexican ICAO airport: code -> [runway ids, length ft, OurAirports surface code]; airports missing here have no runway in OurAirports', 'source': src, 'built': built, 'runways': rwy}, open(os.path.join(here, 'mx-icao-runways.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(nav), 'navaids,', len(us), 'US airports,', len(rwy), 'ICAO runway summaries')

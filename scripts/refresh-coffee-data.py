"""Refresh the bundled Colorado coffee-shop snapshot from public Overture data.

Requires Python and duckdb (pip install duckdb). Run from any directory:
python scripts/refresh-coffee-data.py --release YYYY-MM-DD.N
Review changes and update attribution/licenses when adding a new data source.
"""
import argparse
import json
from pathlib import Path
import re
import duckdb

parser = argparse.ArgumentParser()
parser.add_argument('--release', required=True)
args = parser.parse_args()
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', args.release):
    parser.error('Use an Overture release such as 2026-09-23.1')
connection = duckdb.connect()
connection.execute('INSTALL httpfs; LOAD httpfs;')
source = f's3://overturemaps-us-west-2/release/{args.release}/theme=places/type=place/*'
rows = connection.execute(f'''SELECT id, names.primary AS name,
 (bbox.xmin + bbox.xmax)/2 AS lng, (bbox.ymin + bbox.ymax)/2 AS lat,
 addresses, sources, confidence
 FROM read_parquet('{source}')
 WHERE bbox.xmin >= -109.06 AND bbox.xmax <= -102.04 AND bbox.ymin >= 36.98 AND bbox.ymax <= 41.02
 AND confidence >= 0.95 AND coalesce(operating_status, 'open') NOT IN ('closed','permanently_closed','temporarily_closed')
 AND taxonomy.primary = 'coffee_shop'
 ORDER BY name''').fetchall()
columns = [entry[0] for entry in connection.description]
shops = []
for row in rows:
    place = dict(zip(columns, row))
    licenses = {source['license'] for source in place['sources']}
    if not licenses <= {'CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'}:
        raise ValueError(f'Review new licenses before publishing: {licenses}')
    address = next((a for a in place['addresses'] or [] if a.get('freeform')), {})
    shops.append({'id': place['id'], 'name': place['name'].strip(), 'lat': round(place['lat'], 6), 'lng': round(place['lng'], 6),
                  'confidence': round(place['confidence'], 5),
                  'address': ', '.join(str(address.get(key) or '').strip() for key in ['freeform', 'locality'] if address.get(key)),
                  'sources': sorted({source['dataset'] for source in place['sources'] if source['property'] == ''})})
if not shops:
    raise ValueError('No coffee shops returned; keep the existing data file')
payload = {'source': 'Overture Maps', 'release': args.release, 'dataDate': args.release.split('.')[0],
           'coverage': [-109.06, 36.98, -102.04, 41.02], 'attribution': 'https://docs.overturemaps.org/attribution/', 'shops': shops}
destination = Path(__file__).resolve().parents[1] / 'territories/coffee-shops-colorado.json'
destination.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Wrote {len(shops)} coffee shops to {destination}; update coffee-data-sources.html and the data cache version before publishing.')

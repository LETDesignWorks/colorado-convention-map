from pathlib import Path

source_path = Path('.github/scripts/fix_bulk_address_map_points.py')
source = source_path.read_text(encoding='utf-8')

obsolete = '''app = replace_once(
    app,
    "  const mapped = houses.filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)));",
    "  const mapped = houses.filter(house => validMapCoordinates(house));",
    'Hall boundary coordinate filter'
)
'''

if obsolete not in source:
    raise RuntimeError('The obsolete Hall-boundary replacement block was not found.')

source = source.replace(obsolete, '', 1)
exec(compile(source, str(source_path), 'exec'), {'__name__': '__main__'})

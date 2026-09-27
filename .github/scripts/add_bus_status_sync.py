from pathlib import Path
import re

ROOT = Path('.')
BRANDING_VERSION = 'bus-status-sync-20260927-1'
TERRITORY_VERSION = 'territories-20260927-2'


def write_if_changed(path: Path, text: str) -> bool:
    original = path.read_text(encoding='utf-8')
    if original == text:
        return False
    path.write_text(text, encoding='utf-8')
    print(f'updated {path}')
    return True


# Load the shared status module from the main branding module used by nearly
# every map page.
asset_branding = ROOT / 'assets' / 'branding.js'
text = asset_branding.read_text(encoding='utf-8')
status_import = f"import './bus-access-status-sync.js?v={BRANDING_VERSION}';"
if status_import not in text:
    lines = text.splitlines()
    insert_at = 1 if lines and 'denver-2027-circular-nav.js' in lines[0] else 0
    lines.insert(insert_at, status_import)
    text = '\n'.join(lines) + ('\n' if text.endswith('\n') else '')
write_if_changed(asset_branding, text)

# A few legacy map wrappers use the root branding module instead of the assets
# copy. Keep those pages connected to the same status source.
root_branding = ROOT / 'branding.js'
text = root_branding.read_text(encoding='utf-8')
root_status_import = f"import './assets/bus-access-status-sync.js?v={BRANDING_VERSION}';"
if root_status_import not in text:
    lines = text.splitlines()
    insert_at = 1 if lines and 'denver-2027-circular-nav.js' in lines[0] else 0
    lines.insert(insert_at, root_status_import)
    text = '\n'.join(lines) + ('\n' if text.endswith('\n') else '')
write_if_changed(root_branding, text)

# Bump every planning-page reference to branding.js so existing browsers do not
# continue using the cached module from the circular-navigation update.
asset_pattern = re.compile(r'(?P<prefix>(?:\.\./|\./)*)assets/branding\.js(?:\?v=[^\"\'\s<`)]+)?')
root_pattern = re.compile(r'(?<!assets/)branding\.js(?:\?v=[^\"\'\s<`)]+)?')

skip_roots = {'.git', 'operating-plan'}
for path in ROOT.rglob('*'):
    if not path.is_file() or path.suffix.lower() not in {'.html', '.js'}:
        continue
    if any(part in skip_roots for part in path.parts):
        continue
    if path in {asset_branding, root_branding, ROOT / 'assets' / 'bus-access-status-sync.js'}:
        continue
    if path.name == 'full-map-content.html':
        # The parent planning page applies the shared status module to this
        # same-origin iframe, avoiding a rewrite of the multi-megabyte map file.
        continue
    original = path.read_text(encoding='utf-8')
    updated = asset_pattern.sub(lambda match: f"{match.group('prefix')}assets/branding.js?v={BRANDING_VERSION}", original)
    updated = root_pattern.sub(lambda match: f"branding.js?v={BRANDING_VERSION}", updated)
    if updated != original:
        path.write_text(updated, encoding='utf-8')
        print(f'updated branding cache key in {path}')

# The Territory Planner is assembled through bootstrap.js, so give that loader
# its own new cache key as well.
bootstrap = ROOT / 'territories' / 'bootstrap.js'
text = bootstrap.read_text(encoding='utf-8')
text = re.sub(r"const version = '[^']+';", f"const version = '{TERRITORY_VERSION}';", text, count=1)
text = re.sub(
    r"import\('\.\./assets/branding\.js\?v=[^']+'\)",
    f"import('../assets/branding.js?v={BRANDING_VERSION}')",
    text,
    count=1,
)
write_if_changed(bootstrap, text)

territory_index = ROOT / 'territories' / 'index.html'
text = territory_index.read_text(encoding='utf-8')
text = re.sub(r'bootstrap\.js\?v=[^\"\']+', f'bootstrap.js?v={TERRITORY_VERSION}', text, count=1)
write_if_changed(territory_index, text)

# Fail loudly when a current planning page still points at an older branding
# cache key. The operating-plan build and huge embedded map are intentionally
# excluded above.
for path in ROOT.rglob('*'):
    if not path.is_file() or path.suffix.lower() not in {'.html', '.js'}:
        continue
    if any(part in skip_roots for part in path.parts) or path.name == 'full-map-content.html':
        continue
    if path in {asset_branding, root_branding, ROOT / 'assets' / 'bus-access-status-sync.js'}:
        continue
    source = path.read_text(encoding='utf-8')
    if 'assets/branding.js' in source and f'assets/branding.js?v={BRANDING_VERSION}' not in source:
        raise RuntimeError(f'old or unversioned assets/branding.js reference remains in {path}')

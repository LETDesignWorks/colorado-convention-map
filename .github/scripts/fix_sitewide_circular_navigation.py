from pathlib import Path
import re

ROOT = Path('.')
CIRCLE_VERSION = 'sitewide-circles-20260926-2'
TERRITORY_VERSION = 'territories-20260926-3'


def write_if_changed(path: Path, text: str) -> bool:
    original = path.read_text(encoding='utf-8')
    if original == text:
        return False
    path.write_text(text, encoding='utf-8')
    print(f'updated {path}')
    return True


# 1. Make the main shared branding module load the circular-navigation module
# with a fresh cache key.
branding_path = ROOT / 'assets' / 'branding.js'
branding = branding_path.read_text(encoding='utf-8')
import_line = f"import './denver-2027-circular-nav.js?v={CIRCLE_VERSION}';"
branding = re.sub(
    r"^import './denver-2027-circular-nav\.js\?v=[^']+';",
    import_line,
    branding,
    count=1,
    flags=re.MULTILINE,
)
if import_line not in branding:
    branding = import_line + '\n' + branding
write_if_changed(branding_path, branding)


# 2. Keep the older root branding module compatible with pages that still
# reference /branding.js instead of /assets/branding.js.
legacy_branding_path = ROOT / 'branding.js'
if legacy_branding_path.exists():
    legacy = legacy_branding_path.read_text(encoding='utf-8')
    legacy_import = f"import './assets/denver-2027-circular-nav.js?v={CIRCLE_VERSION}';"
    legacy = re.sub(
        r"^import './assets/denver-2027-circular-nav\.js\?v=[^']+';",
        legacy_import,
        legacy,
        count=1,
        flags=re.MULTILINE,
    )
    if legacy_import not in legacy:
        legacy = legacy_import + '\n' + legacy
    write_if_changed(legacy_branding_path, legacy)


# 3. Extend the circular-navigation detector to support simple full-screen
# map headers where the button is a direct child of <header class="nav">.
circle_path = ROOT / 'assets' / 'denver-2027-circular-nav.js'
circle = circle_path.read_text(encoding='utf-8')
old_find = """function findNavigationHosts() {
  const selectors = [
    'header .navlinks',
    'header .actions',
    'header .header-actions',
    'header .top-actions',
    '.topbar .navlinks',
    '.header-row .header-actions',
    'header.nav > .actions'
  ];

  return Array.from(document.querySelectorAll(selectors.join(',')));
}
"""
new_find = """function findNavigationHosts() {
  const selectors = [
    'header .navlinks',
    'header .actions',
    'header .header-actions',
    'header .top-actions',
    '.topbar .navlinks',
    '.header-row .header-actions',
    'header.nav > .actions'
  ];

  const hosts = Array.from(document.querySelectorAll(selectors.join(',')));

  /* Some full-screen map pages place one or more .btn links directly inside
     <header class="nav"> without a separate nav/actions wrapper. */
  document.querySelectorAll('header.nav').forEach(header => {
    if (Array.from(header.children).some(child => child.classList?.contains('btn'))) {
      hosts.push(header);
    }
  });

  return Array.from(new Set(hosts));
}
"""
if old_find in circle:
    circle = circle.replace(old_find, new_find, 1)
elif 'const hosts = Array.from(document.querySelectorAll(selectors.join' not in circle:
    raise RuntimeError('Could not locate the circular-navigation host detector.')

mobile_anchor = """      .${NAV_CLASS} > .btn {
        font-size: 9px !important;
        scroll-snap-align: start;
      }
    }
"""
mobile_replacement = """      .${NAV_CLASS} > .btn {
        font-size: 9px !important;
        scroll-snap-align: start;
      }

      /* A simple full-screen header can be both the header and navigation
         host. Keep its title and circular return button on one row. */
      .${HEADER_CLASS}.${NAV_CLASS} {
        display: flex !important;
        flex-wrap: nowrap !important;
        overflow: visible !important;
      }

      .${HEADER_CLASS}.${NAV_CLASS} > .brand {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        max-width: none !important;
      }
    }
"""
if mobile_anchor in circle and 'simple full-screen header can be both' not in circle:
    circle = circle.replace(mobile_anchor, mobile_replacement, 1)
write_if_changed(circle_path, circle)


# 4. Add or refresh the shared branding module on every conventional map page.
# The scan is intentionally limited to real HTML documents with a </head> and
# a recognized header-navigation pattern. Large embedded map content and the
# protected operating-plan build are not altered.
nav_markers = (
    'class="navlinks"',
    "class='navlinks'",
    'class="header-actions"',
    "class='header-actions'",
    'class="top-actions"',
    "class='top-actions'",
    '<nav class="actions"',
    "<nav class='actions'",
    '<header class="nav"',
    "<header class='nav'",
)

skip_paths = {
    Path('full-map-content.html'),
    Path('operating-plan/index.html'),
}

branding_pattern = re.compile(
    r'<script\s+type="module"\s+src="(?P<prefix>(?:\.\./)*)assets/branding\.js(?:\?v=[^"]*)?"\s*></script>',
    flags=re.IGNORECASE,
)

for html_path in ROOT.rglob('*.html'):
    relative = html_path.relative_to(ROOT)
    if relative in skip_paths or '.git' in relative.parts:
        continue
    text = html_path.read_text(encoding='utf-8')
    if '</head>' not in text.lower() or not any(marker in text for marker in nav_markers):
        continue

    depth = len(relative.parts) - 1
    prefix = '../' * depth
    script = f'<script type="module" src="{prefix}assets/branding.js?v={CIRCLE_VERSION}"></script>'

    if branding_pattern.search(text):
        text = branding_pattern.sub(script, text, count=1)
    else:
        text = re.sub(r'</head>', script + '\n</head>', text, count=1, flags=re.IGNORECASE)

    write_if_changed(html_path, text)


# 5. Refresh the dynamically assembled Territory Planner. Its static index
# loads bootstrap.js, and bootstrap imports branding.js after inserting the
# template, so both cache keys must be advanced.
territory_bootstrap = ROOT / 'territories' / 'bootstrap.js'
if territory_bootstrap.exists():
    text = territory_bootstrap.read_text(encoding='utf-8')
    text = re.sub(r"const version = '[^']+';", f"const version = '{TERRITORY_VERSION}';", text, count=1)
    text = re.sub(
        r"import\('\.\./assets/branding\.js\?v=[^']+'\)",
        f"import('../assets/branding.js?v={CIRCLE_VERSION}')",
        text,
        count=1,
    )
    write_if_changed(territory_bootstrap, text)

territory_index = ROOT / 'territories' / 'index.html'
if territory_index.exists():
    text = territory_index.read_text(encoding='utf-8')
    text = re.sub(
        r'bootstrap\.js\?v=[^"\']+',
        f'bootstrap.js?v={TERRITORY_VERSION}',
        text,
        count=1,
    )
    write_if_changed(territory_index, text)

print('Site-wide circular navigation repair complete.')

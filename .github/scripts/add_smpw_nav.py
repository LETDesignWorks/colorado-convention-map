from pathlib import Path

path = Path('assets/branding.js')
text = path.read_text(encoding='utf-8')

old_class = "if (path.includes('/routes/') || path.includes('/route-planner/') || path.includes('/activities/')) return `btn ghost ${extraClass}`;"
new_class = "if (path.includes('/routes/') || path.includes('/route-planner/') || path.includes('/activities/') || path.includes('/smpw/')) return `btn ghost ${extraClass}`;"
if old_class in text:
    text = text.replace(old_class, new_class, 1)

function_text = """function addSmpwLink() {
  if (location.pathname.includes('/smpw/')) return;
  if (document.querySelector('a[href*=\"smpw/\"]')) return;
  const nav = navHost();
  if (!nav) return;

  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('smpw-link');
  link.href = new URL('smpw/', siteHomeUrl).href;
  link.textContent = 'SMPW';
  link.setAttribute('aria-label', 'Open the SMPW cart location planner');
  insertBeforeRouteOrBus(nav, link);
}

"""
anchor = 'function applyDenver2027Branding() {'
if 'function addSmpwLink()' not in text:
    if anchor not in text:
        raise RuntimeError('Branding apply anchor not found')
    text = text.replace(anchor, function_text + anchor, 1)

old_calls = "  addSouthDtcRailLink();\n  addDelegateActivitiesLink();"
new_calls = "  addSouthDtcRailLink();\n  addSmpwLink();\n  addDelegateActivitiesLink();"
if '  addSmpwLink();' not in text:
    if old_calls not in text:
        raise RuntimeError('Branding call anchor not found')
    text = text.replace(old_calls, new_calls, 1)

path.write_text(text, encoding='utf-8')

from pathlib import Path

version = 'smpw-20260926-3'

app_path = Path('smpw/app.js')
app = app_path.read_text(encoding='utf-8')

map_anchor = "  map = L.map('map', { zoomControl:true, attributionControl:true }).setView([39.665, -104.95], 10);"
map_insert = map_anchor + "\n  window.__DENVER2027_SMPW_MAP__ = map;\n  window.dispatchEvent(new CustomEvent('denver2027-smpw-map-ready', { detail: { map } }));"
if 'window.__DENVER2027_SMPW_MAP__' not in app:
    if map_anchor not in app:
        raise RuntimeError('SMPW map initialization anchor was not found.')
    app = app.replace(map_anchor, map_insert, 1)

firebase_anchor = "  db = getFirestore(firebaseApp);"
firebase_insert = firebase_anchor + "\n  window.__DENVER2027_SMPW_FIREBASE__ = { app: firebaseApp, auth, db };\n  window.dispatchEvent(new CustomEvent('denver2027-smpw-firebase-ready', { detail: { app: firebaseApp, auth, db } }));"
if 'window.__DENVER2027_SMPW_FIREBASE__' not in app:
    if firebase_anchor not in app:
        raise RuntimeError('SMPW Firebase initialization anchor was not found.')
    app = app.replace(firebase_anchor, firebase_insert, 1)

app_path.write_text(app, encoding='utf-8')

index_path = Path('smpw/index.html')
index = index_path.read_text(encoding='utf-8')
index = index.replace('smpw-20260926-1', version).replace('smpw-20260926-2', version)
app_script = f'<script type="module" src="app.js?v={version}"></script>'
enhancement_script = f'<script type="module" src="enhancements.js?v={version}"></script>'
if enhancement_script not in index:
    if app_script not in index:
        raise RuntimeError('Versioned SMPW app script anchor was not found.')
    index = index.replace(app_script, app_script + '\n' + enhancement_script, 1)
index_path.write_text(index, encoding='utf-8')

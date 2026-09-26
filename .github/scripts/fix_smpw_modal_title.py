from pathlib import Path

app_path = Path('smpw/app.js')
app = app_path.read_text(encoding='utf-8')
wrong = 'els.smpwLocationModalTitle'
if wrong not in app:
    raise RuntimeError('The SMPW modal-title bug was not found.')
app = app.replace(wrong, 'els.locationModalTitle')
app_path.write_text(app, encoding='utf-8')

for path_string in ['smpw/index.html', 'index.html']:
    path = Path(path_string)
    text = path.read_text(encoding='utf-8')
    text = text.replace('smpw-20260926-1', 'smpw-20260926-2')
    path.write_text(text, encoding='utf-8')

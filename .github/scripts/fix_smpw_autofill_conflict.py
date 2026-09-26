from pathlib import Path

html_path = Path('smpw/index.html')
html = html_path.read_text(encoding='utf-8')
html = html.replace('id="locationModal"', 'id="smpwLocationModal"')
html = html.replace('id="locationForm"', 'id="smpwLocationForm"')
html_path.write_text(html, encoding='utf-8')

app_path = Path('smpw/app.js')
app = app_path.read_text(encoding='utf-8')
app = app.replace("'cancelLogin','resetPassword','locationModal','locationModalTitle','closeLocationModal','locationForm',", "'cancelLogin','resetPassword','smpwLocationModal','locationModalTitle','closeLocationModal','smpwLocationForm',")
app = app.replace('els.locationForm', 'els.smpwLocationForm')
app = app.replace('els.locationModal', 'els.smpwLocationModal')
app_path.write_text(app, encoding='utf-8')

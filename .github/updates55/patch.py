from pathlib import Path

def change(path,old,new):
    p=Path(path);s=p.read_text();assert s.count(old)==1,(path,old[:70],s.count(old));p.write_text(s.replace(old,new))

change('bus-access/app-v2.js',"import { DRIVE_TIME_AREA, driveTimeEstimateFor } from './drive-time-area.mjs?v=bus-drive-time-20261023-54';", "import { DRIVE_TIME_AREA, driveTimeEstimateFor } from './drive-time-area.mjs?v=bus-drive-time-20261023-54';\nimport { mountPlanningBoundary } from './rounded-boundary.mjs?v=bus-boundary-20261023-55';")
change('bus-access/app-v2.js',"boundaryLayer=L.geoJSON(DRIVE_TIME_AREA,{style:{color:'#0b4da2',weight:2,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.06},interactive:false}).addTo(map);", "boundaryLayer=mountPlanningBoundary(L,map,DRIVE_TIME_AREA,CONVENTION_CENTER.point,{selector:document.getElementById('boundaryDisplay'),note:document.getElementById('boundaryDisplayNote')});")
change('bus-access/app-v2.js','45-minute road-network driving estimate; no live traffic','45-minute reference point; rounded planning guide or detailed driving estimate available. No live traffic.')
change('bus-access/index.html','  <div class="stats" id="stats"></div>', '''  <label class="boundary-display-label" for="boundaryDisplay">Map boundary
    <select id="boundaryDisplay" aria-describedby="boundaryDisplayNote">
      <option value="rounded" selected>Rounded planning guide</option>
      <option value="detailed">Detailed driving estimate</option>
    </select>
  </label>
  <div class="stats" id="stats"></div>''')
old='The blue dashed area is a calculated 45-minute driving estimate FROM the Colorado Convention Center (Oct 23, 2026), using Valhalla / OpenStreetMap roads. No live traffic, loading time, or bus-clearance verification. Check each route and return time. Tap a marker for details.'
new='The solid blue outline is a rounded, approximate 45-minute planning guide around the Colorado Convention Center. Some places inside may take longer; some outside may be quicker. Switch to Detailed driving estimate for the road-shaped boundary. No live traffic, loading time, or bus-clearance verification.'
change('bus-access/index.html','<div class="map-note">'+old+'</div>','<div class="map-note" id="boundaryDisplayNote" aria-live="polite">'+new+'</div>')
change('bus-access/index.html','href="styles.css"','href="styles.css?v=bus-boundary-20261023-55"')
for path in ['bus-access/app.js','bus-access/index.html','tests/bus-traffic-ui.test.mjs','tests/bus-convention-center.test.mjs']:
    p=Path(path);s=p.read_text();assert 'bus-drive-time-20261023-54' in s; p.write_text(s.replace('bus-drive-time-20261023-54','bus-boundary-20261023-55'))
p=Path('bus-access/styles.css');p.write_text(p.read_text()+'''\n/* Keep the planning-view selector usable beside status filters and on phones. */
.boundary-display-label{display:flex;align-items:center;gap:7px;max-width:100%;font-size:12px;font-weight:700;color:#164b8b}
.toolbar .boundary-display-label select{min-width:0;max-width:100%;font-weight:500}
@media(max-width:460px){.boundary-display-label{width:100%;flex-wrap:wrap}.toolbar .boundary-display-label select{width:100%}}
''')
# The legacy init test still verifies the same reference point and source passed
# into the view. Dedicated new tests exercise the actual rounded/detailed layer.
change('tests/bus-convention-center.test.mjs','CONVENTION_CENTER,DRIVE_TIME_AREA,syncMarkers:',"CONVENTION_CENTER,DRIVE_TIME_AREA,document:{getElementById:()=>null},mountPlanningBoundary:(leaflet,map,area)=>leaflet.geoJSON(area).addTo(map),syncMarkers:")
change('tests/bus-convention-center.test.mjs','assert.match(html,/calculated 45-minute driving estimate FROM the Colorado Convention Center/);','assert.match(html,/rounded, approximate 45-minute planning guide around the Colorado Convention Center/);')
p=Path('bus-access/drive-time/README.md');p.write_text(p.read_text()+'''\n## Rounded planning display\nBus Review now defaults to a solid blue, rounded **approximate guide**. It samples the outer envelope around the Convention Center every two degrees, softens narrow road spikes with a ten-degree Gaussian window, blends 20% toward the mean radius, and adds 3% display padding. This display may include places beyond 45 minutes or omit narrow reachable corridors; it must not determine route eligibility. Use **Map boundary → Detailed driving estimate** for the unchanged road-network snapshot. Neither view uses live traffic, and the original hall estimates, approvals, and saved reviews are unchanged.\n''')

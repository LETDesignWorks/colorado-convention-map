from pathlib import Path
import re

VERSION = 'territories-20260927-3'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


# Add a prominent live counter over the map while a manual territory is drawn or edited.
template_path = Path('territories/template.html')
template = template_path.read_text(encoding='utf-8')
old_map = '''        <div id="map" role="application" aria-label="Kingdom Hall, congregation boundary, residential address and territory map"></div>
        <div class="map-legend">'''
new_map = '''        <div id="map" role="application" aria-label="Kingdom Hall, congregation boundary, residential address and territory map"></div>
        <div id="territoryBoundaryLiveCount" class="territory-boundary-live-count" hidden aria-live="polite" aria-atomic="true">
          <span id="territoryBoundaryLiveLabel">Manual territory</span>
          <strong id="territoryBoundaryLiveValue">0 addresses selected</strong>
          <small id="territoryBoundaryLiveDetail">Begin drawing the boundary to count the included addresses.</small>
        </div>
        <div class="map-legend">'''
template = replace_once(template, old_map, new_map, 'map counter')
template_path.write_text(template, encoding='utf-8')


# Add responsive styling for the map counter.
styles_path = Path('territories/styles.css')
styles = styles_path.read_text(encoding='utf-8')
styles += '''

/* Live address count while drawing or editing a manual territory boundary */
.territory-boundary-live-count{
  position:absolute;
  z-index:930;
  top:12px;
  left:50%;
  transform:translateX(-50%);
  min-width:260px;
  max-width:min(500px,calc(100% - 260px));
  padding:10px 14px;
  border:1px solid rgba(255,255,255,.82);
  border-radius:14px;
  background:rgba(8,63,115,.94);
  color:#fff;
  box-shadow:0 7px 22px rgba(0,28,58,.34);
  text-align:center;
  pointer-events:none;
  backdrop-filter:blur(4px);
}
.territory-boundary-live-count[data-mode="edit"]{background:rgba(89,58,157,.95)}
.territory-boundary-live-count>span{
  display:block;
  font-size:9px;
  line-height:1.2;
  font-weight:900;
  letter-spacing:.09em;
  text-transform:uppercase;
  opacity:.9;
}
.territory-boundary-live-count>strong{
  display:block;
  margin-top:3px;
  font-size:19px;
  line-height:1.18;
}
.territory-boundary-live-count>small{
  display:block;
  margin-top:4px;
  font-size:9.5px;
  line-height:1.35;
  color:rgba(255,255,255,.9);
}
@media(max-width:880px){
  .territory-boundary-live-count{top:70px;max-width:calc(100% - 24px);min-width:0;width:max-content;padding:9px 12px}
}
@media(max-width:600px){
  .territory-boundary-live-count{top:64px;width:calc(100% - 22px)}
  .territory-boundary-live-count>strong{font-size:16px}
  .territory-boundary-live-count>small{font-size:8.5px}
}
@media print{.territory-boundary-live-count{display:none!important}}
'''
styles_path.write_text(styles, encoding='utf-8')


app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')

# New live-count state.
app = replace_once(
    app,
    "let pendingTerritoryName = '';\nlet houseGroup;",
    "let pendingTerritoryName = '';\nlet liveTerritoryCountTimer = null;\nlet pendingLiveTerritoryCount = null;\nlet liveTerritoryCountContext = null;\nlet houseGroup;",
    'live count state'
)

# Register the new UI elements.
app = replace_once(
    app,
    "'markAvoidButton','restoreAvoidButton','selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryEditMessage','territoryList','houseSearch','houseList',",
    "'markAvoidButton','restoreAvoidButton','selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryEditMessage','territoryBoundaryLiveCount','territoryBoundaryLiveLabel','territoryBoundaryLiveValue','territoryBoundaryLiveDetail','territoryList','houseSearch','houseList',",
    'live count element registry'
)

helpers = r'''
function combinedGeometryFromFeatureGroup(group) {
  const collection = group?.toGeoJSON?.();
  const geometries = (collection?.features || []).map(feature => feature.geometry).filter(Boolean);
  if (!geometries.length) return null;
  if (geometries.length === 1) return geometries[0];
  const coordinates = geometries.flatMap(geometry => geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]);
  return { type: 'MultiPolygon', coordinates };
}
function draftGeometryFromDrawVertices(layers) {
  const latlngs = (layers?.getLayers?.() || []).map(layer => layer.getLatLng?.()).filter(Boolean);
  if (latlngs.length < 3) return { geometry: null, vertexCount: latlngs.length };
  try { return { geometry: L.polygon(latlngs).toGeoJSON().geometry, vertexCount: latlngs.length }; }
  catch { return { geometry: null, vertexCount: latlngs.length }; }
}
function includedAddressesInsideGeometry(geometry) {
  if (!geometry) return [];
  let feature;
  let bounds;
  try {
    feature = turf.feature(geometry);
    bounds = turf.bbox(feature);
  } catch {
    return [];
  }
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const inside = [];
  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    const lat = Number(house.lat), lng = Number(house.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    try {
      if (turf.booleanPointInPolygon(pointFeature(house), feature)) inside.push(house);
    } catch { /* ignore malformed points */ }
  }
  return inside;
}
function updateLiveTerritoryBoundaryCount({ mode, geometry = null, territoryId = '', vertexCount = 0 }) {
  liveTerritoryCountContext = { mode, territoryId };
  const box = els.territoryBoundaryLiveCount;
  if (!box) return;
  box.hidden = false;
  box.dataset.mode = mode;

  const territory = mode === 'edit' ? territories.find(item => item.id === territoryId) : null;
  const territoryName = territory?.name || pendingTerritoryName || nextTerritoryName();
  els.territoryBoundaryLiveLabel.textContent = mode === 'edit' ? `Editing ${territoryName}` : `Drawing ${territoryName}`;

  if (!geometry) {
    const remaining = Math.max(0, 3 - Number(vertexCount || 0));
    els.territoryBoundaryLiveValue.textContent = vertexCount
      ? `${vertexCount} boundary point${vertexCount === 1 ? '' : 's'}`
      : '0 addresses selected';
    els.territoryBoundaryLiveDetail.textContent = vertexCount
      ? `Add ${remaining} more point${remaining === 1 ? '' : 's'} before the address count can be calculated.`
      : 'Begin drawing the boundary to count included addresses.';
    if (els.territoryEditMessage) {
      els.territoryEditMessage.hidden = false;
      els.territoryEditMessage.textContent = `Drawing ${territoryName}. Add at least three boundary points; the address count will update as you continue drawing.`;
    }
    return;
  }

  const inside = includedAddressesInsideGeometry(geometry);
  const count = inside.length;
  els.territoryBoundaryLiveValue.textContent = `${count.toLocaleString()} address${count === 1 ? '' : 'es'} inside`;

  if (mode === 'edit' && territory) {
    const currentlyInside = inside.filter(house => house.territoryId === territory.id).length;
    const unassignedInside = inside.filter(house => !house.territoryId).length;
    const otherTerritoryInside = inside.filter(house => house.territoryId && house.territoryId !== territory.id).length;
    const currentlyAssigned = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).length;
    const currentlyOutside = Math.max(0, currentlyAssigned - currentlyInside);
    els.territoryBoundaryLiveDetail.textContent = `${currentlyInside} already in ${territory.name} • ${unassignedInside} unassigned • ${otherTerritoryInside} in other territories${currentlyOutside ? ` • ${currentlyOutside} current outside` : ''}`;
    if (els.territoryEditMessage) {
      els.territoryEditMessage.hidden = false;
      els.territoryEditMessage.textContent = `Editing ${territory.name}: ${count.toLocaleString()} included address${count === 1 ? '' : 'es'} are inside the proposed boundary. If you save the shape and then select Sync Homes, ${unassignedInside} unassigned address${unassignedInside === 1 ? '' : 'es'} and ${otherTerritoryInside} address${otherTerritoryInside === 1 ? '' : 'es'} from other territories would move in, while ${currentlyOutside} current address${currentlyOutside === 1 ? '' : 'es'} would move out. Avoid and excluded addresses are not counted.`;
    }
  } else {
    const unassigned = inside.filter(house => !house.territoryId).length;
    const alreadyAssigned = count - unassigned;
    els.territoryBoundaryLiveDetail.textContent = `${unassigned} unassigned will be added${alreadyAssigned ? ` • ${alreadyAssigned} already assigned elsewhere` : ''}`;
    if (els.territoryEditMessage) {
      els.territoryEditMessage.hidden = false;
      els.territoryEditMessage.textContent = `Drawing ${territoryName}: ${count.toLocaleString()} included address${count === 1 ? '' : 'es'} are inside the current boundary. ${unassigned} unassigned address${unassigned === 1 ? '' : 'es'} will be added when you close the shape${alreadyAssigned ? `; ${alreadyAssigned} already belong to other territories and will remain there` : ''}. Avoid and excluded addresses are not counted.`;
    }
  }
}
function scheduleLiveTerritoryBoundaryCount(payload, immediate = false) {
  pendingLiveTerritoryCount = payload;
  clearTimeout(liveTerritoryCountTimer);
  liveTerritoryCountTimer = setTimeout(() => {
    liveTerritoryCountTimer = null;
    const next = pendingLiveTerritoryCount;
    pendingLiveTerritoryCount = null;
    if (next) updateLiveTerritoryBoundaryCount(next);
  }, immediate ? 0 : 90);
}
function hideLiveTerritoryBoundaryCount() {
  clearTimeout(liveTerritoryCountTimer);
  liveTerritoryCountTimer = null;
  pendingLiveTerritoryCount = null;
  liveTerritoryCountContext = null;
  if (els.territoryBoundaryLiveCount) {
    els.territoryBoundaryLiveCount.hidden = true;
    delete els.territoryBoundaryLiveCount.dataset.mode;
  }
  if (els.territoryEditMessage) {
    els.territoryEditMessage.hidden = true;
    els.territoryEditMessage.textContent = '';
  }
}

'''
app = replace_once(app, 'function initMap() {', helpers + 'function initMap() {', 'live count helpers')

# Track the in-progress polygon and editable polygon.
old_created_to_edited = '''    }
    drawMode = null;
  });
  map.on(L.Draw.Event.EDITED, () => {'''
new_created_to_edited = '''    }
    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();
    drawMode = null;
  });
  map.on('draw:drawvertex', event => {
    if (drawMode !== 'territory-new') return;
    const draft = draftGeometryFromDrawVertices(event.layers);
    scheduleLiveTerritoryBoundaryCount({ mode: 'new', geometry: draft.geometry, vertexCount: draft.vertexCount });
  });
  map.on('draw:editvertex', () => {
    if (!activeTerritoryEditId) return;
    scheduleLiveTerritoryBoundaryCount({ mode: 'edit', geometry: combinedGeometryFromFeatureGroup(territoryEditGroup), territoryId: activeTerritoryEditId });
  });
  map.on('draw:editmove', () => {
    if (!activeTerritoryEditId) return;
    scheduleLiveTerritoryBoundaryCount({ mode: 'edit', geometry: combinedGeometryFromFeatureGroup(territoryEditGroup), territoryId: activeTerritoryEditId });
  });
  map.on(L.Draw.Event.EDITED, () => {'''
app = replace_once(app, old_created_to_edited, new_created_to_edited, 'draw and edit count events')

# Hide the counter cleanly after edit save/cancel or draw cancel.
app = replace_once(
    app,
    "  map.on(L.Draw.Event.EDITED, () => {\n    if (activeTerritoryEditId) {",
    "  map.on(L.Draw.Event.EDITED, () => {\n    if (activeTerritoryEditId) {\n      hideLiveTerritoryBoundaryCount();",
    'edit save hide'
)
app = replace_once(
    app,
    "  map.on(L.Draw.Event.EDITSTOP, () => {\n    if (!activeTerritoryEditId) return;",
    "  map.on(L.Draw.Event.EDITSTOP, () => {\n    if (liveTerritoryCountContext?.mode === 'edit') hideLiveTerritoryBoundaryCount();\n    if (!activeTerritoryEditId) return;",
    'edit stop hide'
)
app = replace_once(
    app,
    "  map.on(L.Draw.Event.DRAWSTOP, () => {\n    if (drawMode === 'territory-new') {",
    "  map.on(L.Draw.Event.DRAWSTOP, () => {\n    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();\n    if (drawMode === 'territory-new') {",
    'draw stop hide'
)

# Start the counter immediately when manual drawing begins.
app = replace_once(
    app,
    "  pendingTerritoryName = name;\n  drawMode = 'territory-new';\n  new L.Draw.Polygon(map, {",
    "  pendingTerritoryName = name;\n  drawMode = 'territory-new';\n  updateLiveTerritoryBoundaryCount({ mode: 'new', geometry: null, vertexCount: 0 });\n  new L.Draw.Polygon(map, {",
    'manual draw count start'
)

# Canceling an edit also clears the live counter.
app = replace_once(
    app,
    "function cancelTerritoryBoundaryEdit(showNotice = true) {\n  if (territoryEditToolbar) {",
    "function cancelTerritoryBoundaryEdit(showNotice = true) {\n  hideLiveTerritoryBoundaryCount();\n  if (territoryEditToolbar) {",
    'edit cancel count cleanup'
)

# Replace the static edit notice with the live count, while keeping the toolbar instruction in the toast.
old_edit_message = '''  if (els.territoryEditMessage) {
    els.territoryEditMessage.hidden = false;
    els.territoryEditMessage.textContent = `Editing ${territory.name}. Move the white handles, then use the map toolbar checkmark to save or X to cancel.`;
  }
  toast(`Editing ${territory.name}. Move the handles, then save with the map toolbar.`);'''
new_edit_message = '''  updateLiveTerritoryBoundaryCount({ mode: 'edit', geometry: geometry.geometry || geometry, territoryId: id });
  toast(`Editing ${territory.name}. The live address count will update as you move the handles; save with the map toolbar checkmark.`);'''
app = replace_once(app, old_edit_message, new_edit_message, 'live edit count')

app_path.write_text(app, encoding='utf-8')


# Refresh all Territory Planner resources in browsers.
bootstrap_path = Path('territories/bootstrap.js')
bootstrap = bootstrap_path.read_text(encoding='utf-8')
bootstrap = re.sub(r"const version = 'territories-[^']+';", f"const version = '{VERSION}';", bootstrap, count=1)
bootstrap = re.sub(r"app-main\.js\?v=territories-[^']+", f"app-main.js?v={VERSION}", bootstrap, count=1)
bootstrap_path.write_text(bootstrap, encoding='utf-8')

index_path = Path('territories/index.html')
index = index_path.read_text(encoding='utf-8')
index = re.sub(r'bootstrap\.js\?v=territories-[^"\']+', f'bootstrap.js?v={VERSION}', index, count=1)
index_path.write_text(index, encoding='utf-8')

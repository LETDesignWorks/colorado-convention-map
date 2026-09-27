from pathlib import Path
import re

VERSION = 'territories-20260927-4'
APP = Path('territories/app-main.js')
text = APP.read_text(encoding='utf-8')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f'{label} anchor was not found')
    return source.replace(old, new, 1)


text = replace_once(
    text,
    "let liveTerritoryCountContext = null;\nlet houseGroup;",
    "let liveTerritoryCountContext = null;\nlet activeManualTerritoryDrawer = null;\nlet houseGroup;",
    'active manual drawer variable'
)

helper_pattern = re.compile(
    r"function draftGeometryFromDrawVertices\(layers\) \{.*?\n\}\nfunction includedAddressesInsideGeometry\(geometry\) \{.*?\n\}\n(?=function updateLiveTerritoryBoundaryCount)",
    re.S,
)
helper_replacement = r"""function normalizeLeafletRing(value) {
  let current = value;
  while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) current = current[0];
  if (!Array.isArray(current)) return [];
  return current.map(item => {
    if (item && !Array.isArray(item) && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))) {
      return L.latLng(Number(item.lat), Number(item.lng));
    }
    if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
      return L.latLng(Number(item[0]), Number(item[1]));
    }
    return null;
  }).filter(Boolean);
}
function draftGeometryFromLatLngs(value) {
  const latlngs = normalizeLeafletRing(value);
  if (latlngs.length < 3) return { geometry: null, vertexCount: latlngs.length, latlngs };
  const coordinates = latlngs.map(point => [Number(point.lng), Number(point.lat)]);
  const first = coordinates[0], last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
  return { geometry: { type: 'Polygon', coordinates: [coordinates] }, vertexCount: latlngs.length, latlngs };
}
function currentManualTerritoryDraft(eventLayers) {
  const drawerLatLngs = normalizeLeafletRing(activeManualTerritoryDrawer?._poly?.getLatLngs?.());
  const eventLatLngs = normalizeLeafletRing(
    (eventLayers?.getLayers?.() || []).map(layer => layer.getLatLng?.()).filter(Boolean)
  );
  const latlngs = drawerLatLngs.length >= eventLatLngs.length ? drawerLatLngs : eventLatLngs;
  return draftGeometryFromLatLngs(latlngs);
}
function geometryObject(value) {
  return value?.type === 'Feature' ? value.geometry : value;
}
function pointOnCountSegment(lng, lat, a, b) {
  const ax = Number(a?.[0]), ay = Number(a?.[1]), bx = Number(b?.[0]), by = Number(b?.[1]);
  if (![ax, ay, bx, by, lng, lat].every(Number.isFinite)) return false;
  const cross = ((lng - ax) * (by - ay)) - ((lat - ay) * (bx - ax));
  const tolerance = 1e-9 * Math.max(1, Math.abs(bx - ax) + Math.abs(by - ay));
  if (Math.abs(cross) > tolerance) return false;
  const dot = ((lng - ax) * (bx - ax)) + ((lat - ay) * (by - ay));
  if (dot < -tolerance) return false;
  const squaredLength = ((bx - ax) ** 2) + ((by - ay) ** 2);
  return dot <= squaredLength + tolerance;
}
function pointInCountRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index], previousPoint = ring[previous];
    if (pointOnCountSegment(lng, lat, previousPoint, currentPoint)) return true;
    const xi = Number(currentPoint?.[0]), yi = Number(currentPoint?.[1]);
    const xj = Number(previousPoint?.[0]), yj = Number(previousPoint?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const crosses = ((yi > lat) !== (yj > lat)) &&
      (lng < (((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON)) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}
function pointInCountPolygon(lng, lat, polygonCoordinates) {
  if (!Array.isArray(polygonCoordinates) || !polygonCoordinates.length) return false;
  if (!pointInCountRing(lng, lat, polygonCoordinates[0])) return false;
  for (let index = 1; index < polygonCoordinates.length; index += 1) {
    if (pointInCountRing(lng, lat, polygonCoordinates[index])) return false;
  }
  return true;
}
function pointInsideCountGeometry(lng, lat, value) {
  const geometry = geometryObject(value);
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInCountPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).some(polygon => pointInCountPolygon(lng, lat, polygon));
  }
  return false;
}
function countGeometryBounds(value) {
  const geometry = geometryObject(value);
  const pairs = [];
  const collect = node => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
      pairs.push([Number(node[0]), Number(node[1])]);
      return;
    }
    node.forEach(collect);
  };
  collect(geometry?.coordinates);
  if (!pairs.length) return null;
  return [
    Math.min(...pairs.map(point => point[0])),
    Math.min(...pairs.map(point => point[1])),
    Math.max(...pairs.map(point => point[0])),
    Math.max(...pairs.map(point => point[1]))
  ];
}
function includedAddressesInsideGeometry(value) {
  const geometry = geometryObject(value);
  const bounds = countGeometryBounds(geometry);
  if (!geometry || !bounds) return [];
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const inside = [];
  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    const lat = Number(house.lat), lng = Number(house.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (pointInsideCountGeometry(lng, lat, geometry)) inside.push(house);
  }
  return inside;
}
"""
text, matches = helper_pattern.subn(helper_replacement, text, count=1)
if matches != 1:
    raise RuntimeError(f'live-count helper replacement expected one match, found {matches}')

text = replace_once(
    text,
    "  const territory = mode === 'edit' ? territories.find(item => item.id === territoryId) : null;\n  const territoryName = territory?.name || pendingTerritoryName || nextTerritoryName();",
    "  const territory = mode === 'edit' ? territories.find(item => item.id === territoryId) : null;\n  const territoryName = territory?.name || pendingTerritoryName || nextTerritoryName();\n  const eligibleTotal = houses.filter(house => house.included && !house.avoid).length;",
    'eligible total in counter'
)
text = replace_once(
    text,
    "    els.territoryBoundaryLiveDetail.textContent = vertexCount\n      ? `Add ${remaining} more point${remaining === 1 ? '' : 's'} before the address count can be calculated.`\n      : 'Begin drawing the boundary to count included addresses.';",
    "    els.territoryBoundaryLiveDetail.textContent = !eligibleTotal\n      ? 'No included addresses are loaded. Load or restore address points before drawing a territory.'\n      : vertexCount\n        ? `Add ${remaining} more point${remaining === 1 ? '' : 's'} before the address count can be calculated. ${eligibleTotal.toLocaleString()} included addresses are loaded.`\n        : `Begin drawing the boundary to count the ${eligibleTotal.toLocaleString()} included addresses currently loaded.`;",
    'pre-geometry count detail'
)
text = replace_once(
    text,
    "    els.territoryBoundaryLiveDetail.textContent = `${currentlyInside} already in ${territory.name} • ${unassignedInside} unassigned • ${otherTerritoryInside} in other territories${currentlyOutside ? ` • ${currentlyOutside} current outside` : ''}`;",
    "    els.territoryBoundaryLiveDetail.textContent = `${currentlyInside} already in ${territory.name} • ${unassignedInside} unassigned • ${otherTerritoryInside} in other territories${currentlyOutside ? ` • ${currentlyOutside} current outside` : ''} • ${eligibleTotal.toLocaleString()} included loaded`;",
    'edit count detail'
)
text = replace_once(
    text,
    "    els.territoryBoundaryLiveDetail.textContent = `${unassigned} unassigned will be added${alreadyAssigned ? ` • ${alreadyAssigned} already assigned elsewhere` : ''}`;",
    "    els.territoryBoundaryLiveDetail.textContent = `${unassigned} unassigned will be added${alreadyAssigned ? ` • ${alreadyAssigned} already assigned elsewhere` : ''} • ${eligibleTotal.toLocaleString()} included loaded`;",
    'new count detail'
)

text = replace_once(
    text,
    "      let assigned = 0;\n      let conflicts = 0;\n      for (const house of houses) {\n        if (!house.included || house.avoid) continue;\n        let inside = false;\n        try { inside = turf.booleanPointInPolygon(pointFeature(house), turf.feature(geometry)); } catch { inside = false; }\n        if (!inside) continue;",
    "      let assigned = 0;\n      let conflicts = 0;\n      for (const house of includedAddressesInsideGeometry(geometry)) {",
    'manual creation assignment'
)
text = replace_once(
    text,
    "    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();\n    drawMode = null;",
    "    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();\n    activeManualTerritoryDrawer = null;\n    drawMode = null;",
    'created cleanup'
)
text = replace_once(
    text,
    "  map.on('draw:drawvertex', event => {\n    if (drawMode !== 'territory-new') return;\n    const draft = draftGeometryFromDrawVertices(event.layers);\n    scheduleLiveTerritoryBoundaryCount({ mode: 'new', geometry: draft.geometry, vertexCount: draft.vertexCount });\n  });",
    "  map.on('draw:drawvertex', event => {\n    if (drawMode !== 'territory-new') return;\n    const draft = currentManualTerritoryDraft(event.layers);\n    scheduleLiveTerritoryBoundaryCount({ mode: 'new', geometry: draft.geometry, vertexCount: draft.vertexCount }, true);\n  });",
    'draw vertex listener'
)
text = replace_once(
    text,
    "  map.on(L.Draw.Event.DRAWSTOP, () => {\n    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();",
    "  map.on(L.Draw.Event.DRAWSTOP, () => {\n    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();\n    activeManualTerritoryDrawer = null;",
    'draw stop cleanup'
)

old_draw = """function drawManualTerritoryBoundary() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary first.', true); return; }
  const suggested = nextTerritoryName();
  const name = clean(prompt('Territory name:', suggested));
  if (!name) return;
  cancelTerritoryBoundaryEdit(false);
  pendingTerritoryName = name;
  drawMode = 'territory-new';
  updateLiveTerritoryBoundaryCount({ mode: 'new', geometry: null, vertexCount: 0 });
  new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: TERRITORY_COLORS[territories.length % TERRITORY_COLORS.length], weight: 3, fillOpacity: .12 }
  }).enable();
  toast('Draw the territory boundary. Unassigned houses inside it will be added automatically.');
}
"""
new_draw = """function drawManualTerritoryBoundary() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary first.', true); return; }
  const eligibleTotal = houses.filter(house => house.included && !house.avoid).length;
  if (!eligibleTotal) { toast('Load or restore included address points before drawing a territory.', true); return; }
  const suggested = nextTerritoryName();
  const name = clean(prompt('Territory name:', suggested));
  if (!name) return;
  cancelTerritoryBoundaryEdit(false);
  pendingTerritoryName = name;
  drawMode = 'territory-new';
  updateLiveTerritoryBoundaryCount({ mode: 'new', geometry: null, vertexCount: 0 });
  activeManualTerritoryDrawer = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: TERRITORY_COLORS[territories.length % TERRITORY_COLORS.length], weight: 3, fillOpacity: .12 }
  });
  activeManualTerritoryDrawer.enable();
  toast(`Draw the territory boundary. The live counter is checking ${eligibleTotal.toLocaleString()} included addresses.`);
}
"""
text = replace_once(text, old_draw, new_draw, 'manual draw function')

old_sync = """  const insideIds = new Set();
  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    try {
      if (turf.booleanPointInPolygon(pointFeature(house), geometry)) insideIds.add(house.id);
    } catch { /* no-op */ }
  }
"""
new_sync = """  const insideIds = new Set(includedAddressesInsideGeometry(geometry).map(house => house.id));
"""
text = replace_once(text, old_sync, new_sync, 'sync homes count')

APP.write_text(text, encoding='utf-8')

for path in [Path('territories/bootstrap.js'), Path('territories/index.html')]:
    page = path.read_text(encoding='utf-8')
    page = re.sub(r'territories-\d{8}-\d+', VERSION, page)
    path.write_text(page, encoding='utf-8')

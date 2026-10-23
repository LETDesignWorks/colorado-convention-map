// Boundary tools operate only on editable Leaflet layers, never saved records or homes.
const copy = value => JSON.parse(JSON.stringify(value));
function geometryOf(value) {
  const geometry = value?.type === 'Feature' ? value.geometry : value;
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error('This territory needs a polygon boundary before it can be trimmed.');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length || !polygons.every(polygon => Array.isArray(polygon) && polygon.length && polygon.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(pair => Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && Math.abs(pair[0]) <= 180 && Math.abs(pair[1]) <= 90) &&
    ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]))) throw new Error('The boundary has incomplete coordinates. No changes were applied.');
  return copy(geometry);
}
export function validateTrimmedBoundary(value, turf) {
  const geometry = geometryOf(value);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const coordinates of polygons) {
    if (coordinates.some(ring => new Set(ring.slice(0, -1).map(pair => JSON.stringify(pair.slice(0, 2)))).size < 3)) throw new Error('A boundary needs at least three different corners.');
    const feature = turf.polygon(coordinates);
    if (turf.kinks(feature).features.length || turf.area(feature) <= 0 || (turf.booleanValid && !turf.booleanValid(feature))) throw new Error('The boundary would cross itself or collapse. Try a different box; the original draft is unchanged.');
  }
  return geometry;
}
export function trimBoundaryArea(value, cut, turf) {
  const source = geometryOf(value), mask = validateTrimmedBoundary(cut, turf);
  if (!turf.booleanIntersects(turf.feature(source), turf.feature(mask))) throw new Error('The box does not touch this territory. Draw a box across the unwanted tail.');
  let result;
  try { result = turf.difference(turf.featureCollection([turf.feature(source), turf.feature(mask)])); }
  catch { throw new Error('This boundary could not be clipped safely. Try a box that includes the entire narrow tail, including its tip. Nothing was changed.'); }
  if (!result) throw new Error('That box would remove the entire territory. Use a smaller box around only the tail.');
  const geometry = validateTrimmedBoundary(result.geometry, turf);
  return { geometry, parts: geometry.type === 'Polygon' ? 1 : geometry.coordinates.length };
}
function groupGeometry(group) {
  const polygons = group.getLayers().flatMap(layer => {
    const shape = geometryOf(layer.toGeoJSON().geometry);
    return shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  });
  if (!polygons.length) throw new Error('There is no editable boundary to trim.');
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}
export function mountBoundaryTrim({ L, turf, map, group, container, onChange, onMode, notify }) {
  const controls = document.createElement('div'); controls.className = 'territory-trim-controls';
  controls.innerHTML = '<button type="button" class="btn outline" id="trimTerritoryTailButton" aria-pressed="false">Trim tail / area</button><button type="button" class="btn outline" id="undoTerritoryTrimButton" disabled>Undo trim</button><small id="territoryTrimHelp" role="status">Remove a narrow tail by drawing a box across the unwanted section. Only the boundary inside the box is cut; addresses are not deleted.</small>';
  container.appendChild(controls);
  const button = controls.querySelector('#trimTerritoryTailButton'), undo = controls.querySelector('#undoTerritoryTrimButton'), help = controls.querySelector('#territoryTrimHelp');
  let drawer = null, disposed = false;
  const history = [];
  const snapshot = () => group.getLayers().map(layer => ({ layer, geometry: copy(layer.toGeoJSON().geometry) }));
  function clearUndo() { history.length = 0; undo.disabled = true; }
  function resumeEditors() { group.eachLayer(layer => layer.editing?.enable()); }
  function stopSelection(resume = true) {
    const old = drawer; drawer = null;
    map.off('draw:created', created); map.off('draw:drawstop', stopped);
    try { old?.disable(); } finally {
      button.textContent = 'Trim tail / area'; button.setAttribute('aria-pressed', 'false');
      map.getContainer().classList.remove('territory-trim-selecting');
      if (!disposed) onMode?.(false);
      if (resume && !disposed) resumeEditors();
    }
  }
  function restore(entries) {
    group.eachLayer(layer => layer.editing?.disable());
    group.clearLayers();
    for (const entry of entries) {
      entry.layer.setLatLngs(L.GeoJSON.coordsToLatLngs(entry.geometry.coordinates, 1));
      entry.layer.editing?._updateLatLngs?.({ layer: entry.layer });
      group.addLayer(entry.layer); entry.layer.editing?.enable(); entry.layer.edited = true;
    }
  }
  function applyTrim(cut) {
    if (disposed) return false;
    const before = snapshot();
    try {
      const result = trimBoundaryArea(groupGeometry(group), cut, turf);
      const first = before[0].layer, replacements = [];
      const polygons = result.geometry.type === 'Polygon' ? [result.geometry.coordinates] : result.geometry.coordinates;
      // Leaflet.draw cannot edit a MultiPolygon directly: keep every remaining
      // component as a separate polygon within the same territory edit group.
      for (const coordinates of polygons) L.geoJSON({ type: 'Polygon', coordinates }, { style: { ...first.options } }).eachLayer(layer => {
        layer._denverTerritoryId = first._denverTerritoryId || first.options.denverTerritoryId;
        layer.options.denverTerritoryId = layer._denverTerritoryId;
        replacements.push(layer);
      });
      stopSelection();
      try {
        group.eachLayer(layer => layer.editing?.disable()); group.clearLayers();
        replacements.forEach(layer => { group.addLayer(layer); layer.editing?.enable(); layer.edited = true; });
      } catch (error) { restore(before); throw error; }
      history.push(before); undo.disabled = false;
      onChange?.();
      help.textContent = `Tail/area removed from the draft boundary.${result.parts > 1 ? ` All ${result.parts} remaining sections are kept.` : ''} Use Undo trim to reverse it, or Save Boundary & Update Homes to apply it. No addresses have been deleted.`;
      return true;
    } catch (error) {
      stopSelection(); help.textContent = error.message; notify?.(error.message, true); return false;
    }
  }
  function created(event) {
    if (!drawer || event.layerType !== 'rectangle') return;
    applyTrim(event.layer.toGeoJSON().geometry);
  }
  function stopped() {
    if (!drawer) return;
    stopSelection(); help.textContent = 'Trim cancelled. The draft boundary is unchanged.';
  }
  button.addEventListener('click', () => {
    if (drawer) { stopped(); return; }
    onMode?.(true); group.eachLayer(layer => layer.editing?.disable());
    button.textContent = 'Cancel trim selection'; button.setAttribute('aria-pressed', 'true');
    help.textContent = 'Drag a box across the tail you want removed. Keep the box away from the main area you want to keep. Release to preview the cut; Undo trim reverses it.';
    map.getContainer().classList.add('territory-trim-selecting');
    map.on('draw:created', created); map.on('draw:drawstop', stopped);
    try {
      drawer = new L.Draw.Rectangle(map, { repeatMode: false, shapeOptions: { color: '#b5342c', weight: 2, dashArray: '5 4', fillOpacity: .15, interactive: false } });
      drawer.enable();
    } catch (error) { stopSelection(); help.textContent = error.message; notify?.(error.message, true); }
  });
  undo.addEventListener('click', () => {
    if (drawer || !history.length) return;
    const previous = history.pop(); restore(previous); undo.disabled = !history.length; onChange?.();
    help.textContent = 'Trim undone. Continue editing or save the boundary.';
  });
  // Do not let an older trim undo overwrite a later manual drag/add/delete.
  map.on('draw:editvertex draw:editmove', clearUndo);
  const dispose = () => {
    stopSelection(false); disposed = true;
    map.off('draw:editvertex draw:editmove', clearUndo); history.length = 0; controls.remove();
  };
  dispose.applyTrim = applyTrim; dispose.clearUndo = clearUndo; dispose.isSelecting = () => Boolean(drawer);
  return dispose;
}

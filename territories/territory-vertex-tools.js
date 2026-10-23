import { mountBoundaryTrim } from './territory-trim-tools.js?v=territories-20261022-45';
// Explicit removal controls for the pinned Leaflet.draw editor. Work only on
// editable copies; the stored territory changes when Save Boundary is selected.
export function removeBoundaryVertex(geometry, ringIndex, pointIndex, turf) {
  if (geometry?.type !== 'Polygon') throw new Error('Select one polygon part to edit.');
  const next = JSON.parse(JSON.stringify(geometry));
  const ring = next.coordinates[ringIndex];
  if (!Array.isArray(ring) || ring.length <= 4) throw new Error('A boundary needs at least three corner points.');
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= ring.length - 1) throw new Error('Select an existing corner point.');
  const open = ring.slice(0, -1); open.splice(pointIndex, 1); open.push([...open[0]]);
  next.coordinates[ringIndex] = open;
  const polygon = turf.polygon(next.coordinates);
  if (turf.kinks(polygon).features.length || turf.area(polygon) <= 0) throw new Error('Removing this point would cross the boundary or collapse the area. Move a nearby point first.');
  return next;
}
export function editablePolygonFeatures(value) {
  const geometry = value?.type === 'Feature' ? value.geometry : value;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  if (!polygons.length) throw new Error('This territory has no editable polygon boundary.');
  return { type: 'FeatureCollection', features: polygons.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } })) };
}
export function mountVertexRemoval({ L, turf, map, group, container, onChange, notify }) {
  if (!container) return () => {};
  let deleting = false, trimTools = null;
  const history = [];
  const controls = document.createElement('div'); controls.className = 'territory-point-controls';
  controls.innerHTML = '<button type="button" class="btn outline" id="removeBoundaryPointButton" aria-pressed="false">Remove boundary points</button><button type="button" class="btn outline" id="undoBoundaryPointButton" disabled>Undo point removal</button><small id="boundaryPointHelp" role="status">Move a solid corner to reshape the boundary. Use Remove boundary points to delete a corner, then Save Boundary &amp; Update Homes.</small>';
  container.appendChild(controls);
  const remove = controls.querySelector('#removeBoundaryPointButton'), undo = controls.querySelector('#undoBoundaryPointButton'), help = controls.querySelector('#boundaryPointHelp');
  const mapElement = map.getContainer();
  function setMode(value) {
    deleting = value; remove.setAttribute('aria-pressed', String(value));
    remove.textContent = value ? 'Done removing points' : 'Remove boundary points';
    mapElement.classList.toggle('territory-remove-points', value);
    help.textContent = value ? 'Click or tap an existing corner point to remove it. The faded halfway handles add points; they are not corners. At least three corners must remain.' : 'Drag corners to adjust the shape, or remove another point. Save Boundary & Update Homes applies the changes; Cancel leaves the original boundary unchanged.';
  }
  function apply(layer, geometry) {
    trimTools?.clearUndo();
    layer.editing?.disable();
    layer.setLatLngs(L.GeoJSON.coordsToLatLngs(geometry.coordinates, 1));
    // Leaflet.draw holds its own coordinate-array reference after setLatLngs.
    layer.editing?._updateLatLngs?.({ layer });
    layer.editing?.enable();
    layer.edited = true; layer.fire('edit');
    onChange?.();
  }
  function deleteAt(point) {
    let closest = null;
    group.eachLayer(layer => {
      const geometry = layer.toGeoJSON().geometry;
      if (geometry.type !== 'Polygon') return;
      geometry.coordinates.forEach((ring, ringIndex) => ring.slice(0, -1).forEach((pair, pointIndex) => {
        const screen = map.latLngToContainerPoint(L.latLng(pair[1], pair[0]));
        const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
        if (distance <= 22 && (!closest || distance < closest.distance)) closest = { layer, geometry, ringIndex, pointIndex, distance };
      }));
    });
    if (!closest) { help.textContent = 'Click a solid corner point, not a line or a faded halfway handle.'; return false; }
    try {
      const changed = removeBoundaryVertex(closest.geometry, closest.ringIndex, closest.pointIndex, turf);
      history.push({ layer: closest.layer, geometry: closest.geometry });
      apply(closest.layer, changed); undo.disabled = false;
      help.textContent = 'Point removed from the draft boundary. Remove another, Undo point removal, or Save Boundary & Update Homes.';
      return true;
    } catch (error) { help.textContent = error.message; notify?.(error.message, true); return false; }
  }
  const onClick = event => {
    if (!deleting || event.target.closest?.('.leaflet-control')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    deleteAt(map.mouseEventToContainerPoint(event));
  };
  const onKey = event => { if (event.key === 'Escape' && deleting) { event.preventDefault(); setMode(false); } };
  remove.addEventListener('click', () => setMode(!deleting));
  undo.addEventListener('click', () => {
    const previous = history.pop(); if (!previous) return;
    apply(previous.layer, previous.geometry); undo.disabled = !history.length;
    help.textContent = 'Point removal undone. Save or continue editing.';
  });
  mapElement.addEventListener('click', onClick, true); mapElement.addEventListener('keydown', onKey, true);
  trimTools = mountBoundaryTrim({ L, turf, map, group, container,
    onMode: selecting => {
      setMode(false); remove.disabled = selecting; undo.disabled = selecting || !history.length;
      const saveButton = document.getElementById('saveTerritoryBoundaryEditButton');
      if (saveButton) saveButton.disabled = selecting;
    },
    onChange: () => { history.length = 0; undo.disabled = true; onChange?.(); }, notify });
  const dispose = () => { trimTools?.(); mapElement.removeEventListener('click', onClick, true); mapElement.removeEventListener('keydown', onKey, true); mapElement.classList.remove('territory-remove-points'); controls.remove(); };
  dispose.deleteAt = deleteAt;
  dispose.isTrimming = () => Boolean(trimTools?.isSelecting());
  return dispose;
}

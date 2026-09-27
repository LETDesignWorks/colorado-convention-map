from pathlib import Path

VERSION = 'territories-20260927-5'
APP = Path('territories/app-main.js')
text = APP.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    text = text.replace(old, new, 1)


# Add a single source of truth for saving an edited boundary and immediately
# reconciling the homes inside and outside that boundary.
old_helpers = """function combinedGeometryFromFeatureGroup(group) {
  const collection = group?.toGeoJSON?.();
  const geometries = (collection?.features || []).map(feature => feature.geometry).filter(Boolean);
  if (!geometries.length) return null;
  if (geometries.length === 1) return geometries[0];
  const coordinates = geometries.flatMap(geometry => geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]);
  return { type: 'MultiPolygon', coordinates };
}
function normalizeLeafletRing(value) {"""
new_helpers = """function combinedGeometryFromFeatureGroup(group) {
  const collection = group?.toGeoJSON?.();
  const geometries = (collection?.features || []).map(feature => feature.geometry).filter(Boolean);
  if (!geometries.length) return null;
  if (geometries.length === 1) return geometries[0];
  const coordinates = geometries.flatMap(geometry => geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]);
  return { type: 'MultiPolygon', coordinates };
}
function territoryIdFromLayerGroup(group) {
  for (const layer of group?.getLayers?.() || []) {
    const id = layer?._denverTerritoryId || layer?.options?.denverTerritoryId;
    if (id) return String(id);
  }
  return '';
}
function applyTerritoryBoundaryAssignments(territoryId, value) {
  const territory = territories.find(item => item.id === String(territoryId));
  const geometry = geometryObject(value);
  if (!territory || !geometry) return null;

  const insideIds = new Set(includedAddressesInsideGeometry(geometry).map(house => house.id));
  let added = 0;
  let moved = 0;
  let removed = 0;

  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    const previousTerritoryId = house.territoryId || null;
    if (insideIds.has(house.id)) {
      if (previousTerritoryId !== territory.id) {
        if (previousTerritoryId) moved += 1;
        else added += 1;
        house.territoryId = territory.id;
      }
    } else if (previousTerritoryId === territory.id) {
      house.territoryId = null;
      removed += 1;
    }
  }

  territory.geometry = JSON.parse(JSON.stringify(geometry));
  territory.manualBoundary = true;
  recalculateTerritoryHouseIds();
  const refreshed = territories.find(item => item.id === territory.id) || territory;
  return {
    territory: refreshed,
    total: insideIds.size,
    added,
    moved,
    removed
  };
}
function boundaryChangeSummary(result) {
  const changes = [];
  if (result.added) changes.push(`${result.added} unassigned added`);
  if (result.moved) changes.push(`${result.moved} moved from other territories`);
  if (result.removed) changes.push(`${result.removed} removed to Unassigned`);
  return changes.length ? changes.join(' • ') : 'No home assignments changed';
}
function normalizeLeafletRing(value) {"""
replace_once(old_helpers, new_helpers, 'territory boundary helper insertion')


# Saving the Leaflet edit checkmark now saves the edited geometry and applies
# the home changes in the same action. Read the geometry from event.layers so
# it remains available even if Leaflet fires edit-stop immediately afterward.
old_edited = """  map.on(L.Draw.Event.EDITED, () => {
    if (activeTerritoryEditId) {
      hideLiveTerritoryBoundaryCount();
      const territory = territories.find(item => item.id === activeTerritoryEditId);
      const edited = territoryEditGroup.toGeoJSON();
      const geometries = (edited.features || []).map(feature => feature.geometry).filter(Boolean);
      if (territory && geometries.length) {
        territory.geometry = geometries.length === 1
          ? geometries[0]
          : { type: 'MultiPolygon', coordinates: geometries.flatMap(geometry => geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]) };
        territory.manualBoundary = true;
      }
      activeTerritoryEditId = null;
      territoryEditToolbar = null;
      territoryEditGroup.clearLayers();
      if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
      renderAllPlanningData();
      toast('Territory boundary updated. Use Sync Homes when the boundary should control which addresses belong to it.');
      return;
    }
    const layer = boundaryGroup.getLayers()[0];"""
new_edited = """  map.on(L.Draw.Event.EDITED, async event => {
    const editedGroup = event?.layers;
    const editedTerritoryId = territoryIdFromLayerGroup(editedGroup) || activeTerritoryEditId;
    if (editedTerritoryId) {
      hideLiveTerritoryBoundaryCount();
      const geometry = combinedGeometryFromFeatureGroup(editedGroup) || combinedGeometryFromFeatureGroup(territoryEditGroup);
      const result = applyTerritoryBoundaryAssignments(editedTerritoryId, geometry);
      activeTerritoryEditId = null;
      territoryEditToolbar = null;
      territoryEditGroup.clearLayers();
      if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;

      if (!result) {
        renderAllPlanningData();
        toast('The edited territory boundary could not be read. Reopen Edit Boundary and try again.', true);
        return;
      }

      renderAllPlanningData();
      selectTerritoryHouses(result.territory.id);
      const summary = boundaryChangeSummary(result);
      if (currentPlanId) {
        await savePlan({
          successMessage: `${result.territory.name} saved with ${result.total} address${result.total === 1 ? '' : 'es'}. ${summary}.`
        });
      } else {
        toast(`${result.territory.name} boundary and homes updated in the workspace with ${result.total} address${result.total === 1 ? '' : 'es'}. ${summary}. Select Save Territory Plan to retain the changes.`);
      }
      return;
    }
    const layer = boundaryGroup.getLayers()[0];"""
replace_once(old_edited, new_edited, 'edited territory event')


# Tag every editable Leaflet layer with its territory id. This protects the
# save action from Leaflet event-order differences across browsers/devices.
old_edit_layers = """  const editableGeoJson = L.geoJSON(geometry, {
    style: { color, weight: 4, fillColor: color, fillOpacity: .16 }
  });
  editableGeoJson.eachLayer(layer => territoryEditGroup.addLayer(layer));
  if (territoryEditGroup.getBounds?.().isValid()) map.fitBounds(territoryEditGroup.getBounds(), { padding: [38, 38], maxZoom: 18 });"""
new_edit_layers = """  const editableGeoJson = L.geoJSON(geometry, {
    style: { color, weight: 4, fillColor: color, fillOpacity: .16 }
  });
  editableGeoJson.eachLayer(layer => {
    layer._denverTerritoryId = id;
    layer.options = { ...(layer.options || {}), denverTerritoryId: id };
    territoryEditGroup.addLayer(layer);
  });
  if (territoryEditGroup.getBounds?.().isValid()) map.fitBounds(territoryEditGroup.getBounds(), { padding: [38, 38], maxZoom: 18 });"""
replace_once(old_edit_layers, new_edit_layers, 'editable territory layer tagging')

old_edit_toast = """  toast(`Editing ${territory.name}. The live address count will update as you move the handles; save with the map toolbar checkmark.`);"""
new_edit_toast = """  toast(`Editing ${territory.name}. Move the handles, then select the map checkmark. The boundary and home assignments will update together.`);"""
replace_once(old_edit_toast, new_edit_toast, 'edit territory instruction')


# The existing Update/Sync control now uses the exact same reconciliation and
# auto-save path as the edit checkmark.
old_sync = """function syncTerritoryHomesToBoundary(id) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === id);
  if (!territory) return;
  const geometry = territoryGeometry(territory);
  if (!geometry) { toast('This territory does not have a usable boundary.', true); return; }
  const insideIds = new Set(includedAddressesInsideGeometry(geometry).map(house => house.id));
  const movingFromOther = houses.filter(house => insideIds.has(house.id) && house.territoryId && house.territoryId !== territory.id).length;
  const removing = houses.filter(house => house.territoryId === territory.id && !insideIds.has(house.id)).length;
  const message = `Make ${territory.name} contain exactly the ${insideIds.size} included addresses inside its boundary?` +
    `${movingFromOther ? ` This will move ${movingFromOther} address(es) from other territories.` : ''}` +
    `${removing ? ` It will leave ${removing} address(es) outside the boundary unassigned.` : ''}`;
  if (!confirm(message)) return;
  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    if (insideIds.has(house.id)) house.territoryId = territory.id;
    else if (house.territoryId === territory.id) house.territoryId = null;
  }
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  selectTerritoryHouses(territory.id);
  toast(`${territory.name} synchronized to its boundary with ${insideIds.size} addresses.`);
}"""
new_sync = """async function syncTerritoryHomesToBoundary(id) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === id);
  if (!territory) return;
  const geometry = territoryGeometry(territory);
  if (!geometry) { toast('This territory does not have a usable boundary.', true); return; }
  const insideIds = new Set(includedAddressesInsideGeometry(geometry).map(house => house.id));
  const movingFromOther = houses.filter(house => insideIds.has(house.id) && house.territoryId && house.territoryId !== territory.id).length;
  const removing = houses.filter(house => house.territoryId === territory.id && !insideIds.has(house.id)).length;
  const message = `Update ${territory.name} to contain exactly the ${insideIds.size} included addresses inside its saved boundary?` +
    `${movingFromOther ? ` This will move ${movingFromOther} address(es) from other territories.` : ''}` +
    `${removing ? ` It will leave ${removing} address(es) outside the boundary unassigned.` : ''}`;
  if (!confirm(message)) return;

  const result = applyTerritoryBoundaryAssignments(id, geometry);
  if (!result) { toast('The territory boundary could not be read.', true); return; }
  renderAllPlanningData();
  selectTerritoryHouses(result.territory.id);
  const summary = boundaryChangeSummary(result);
  if (currentPlanId) {
    await savePlan({
      successMessage: `${result.territory.name} updated and saved with ${result.total} address${result.total === 1 ? '' : 'es'}. ${summary}.`
    });
  } else {
    toast(`${result.territory.name} updated with ${result.total} address${result.total === 1 ? '' : 'es'}. ${summary}. Select Save Territory Plan to retain the changes.`);
  }
}"""
replace_once(old_sync, new_sync, 'territory home synchronization')


# Clarify that the checkmark itself applies the address changes.
text = text.replace(
    'If you save the shape and then select Sync Homes,',
    'When you save with the map toolbar checkmark,',
)
text = text.replace('>Sync Homes</button>', '>Update Homes</button>')


# Permit context-specific success text for automatic saves after boundary edits.
replace_once('async function savePlan() {', 'async function savePlan(options = {}) {', 'savePlan signature')
old_success = """    toast(`Territory plan saved in ${chunks.length} private Firebase data part${chunks.length === 1 ? '' : 's'}.`);"""
new_success = """    toast(options.successMessage || `Territory plan saved in ${chunks.length} private Firebase data part${chunks.length === 1 ? '' : 's'}.`);"""
replace_once(old_success, new_success, 'savePlan success message')

APP.write_text(text, encoding='utf-8')

# Bust all Territory Planner caches.
for path in (Path('territories/bootstrap.js'), Path('territories/index.html')):
    source = path.read_text(encoding='utf-8')
    source = source.replace('territories-20260927-4', VERSION)
    path.write_text(source, encoding='utf-8')

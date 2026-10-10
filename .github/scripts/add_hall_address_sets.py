from pathlib import Path
import re

VERSION = 'territories-20261010-3'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')

app = replace_once(
    app,
    "let boundaryGeometry = null;\nlet houses = [];",
    "let boundaryGeometry = null;\nlet boundaryPreservesAddresses = false;\nlet houses = [];",
    'boundary preservation state'
)

old_outer_edit = """    const layer = boundaryGroup.getLayers()[0];
    if (layer) {
      boundaryGeometry = layer.toGeoJSON().geometry;
      clearAddressesAndTerritoriesForBoundaryChange();
      updateBoundaryUi();
      toast('Boundary updated. Reload addresses for the revised area.');
    }"""
new_outer_edit = """    const layer = boundaryGroup.getLayers()[0];
    if (layer) {
      boundaryGeometry = layer.toGeoJSON().geometry;
      if (boundaryPreservesAddresses) {
        currentBoundaryId = null;
        updateBoundaryUi();
        renderAllPlanningData();
        toast('Kingdom Hall territory boundary updated. The uploaded ministry and avoid addresses were retained.');
      } else {
        clearAddressesAndTerritoriesForBoundaryChange();
        updateBoundaryUi();
        toast('Boundary updated. Reload addresses for the revised area.');
      }
    }"""
app = replace_once(app, old_outer_edit, new_outer_edit, 'outer boundary edit behavior')

old_set_boundary = """function setBoundaryGeometry(geometry, fit = true) {
  if (!geometry) return;
  boundaryGeometry = JSON.parse(JSON.stringify(geometry));
  boundaryGroup.clearLayers();
  const layer = L.geoJSON(boundaryGeometry, {
    style: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 }
  }).addTo(boundaryGroup);
  clearAddressesAndTerritoriesForBoundaryChange();
  if (fit && layer.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 15 });
  updateBoundaryUi();
}"""
new_set_boundary = """function setBoundaryGeometry(geometry, fit = true, preserveWork = false) {
  if (!geometry) return;
  boundaryGeometry = JSON.parse(JSON.stringify(geometry));
  boundaryPreservesAddresses = Boolean(preserveWork);
  boundaryGroup.clearLayers();
  const layer = L.geoJSON(boundaryGeometry, {
    style: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 }
  }).addTo(boundaryGroup);
  if (preserveWork) {
    currentBoundaryId = null;
    renderAllPlanningData();
  } else {
    clearAddressesAndTerritoriesForBoundaryChange();
  }
  if (fit && layer.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 15 });
  updateBoundaryUi();
}"""
app = replace_once(app, old_set_boundary, new_set_boundary, 'boundary setter')

old_clear_boundary = """function clearBoundary(ask = true) {
  if (!requireAdmin()) return;
  if (ask && boundaryGeometry && !confirm('Clear the congregation boundary and all unsaved address and territory work?')) return;
  boundaryGeometry = null;
  currentBoundaryId = null;
  boundaryGroup.clearLayers();
  clearAddressesAndTerritoriesForBoundaryChange();
  updateBoundaryUi();
}"""
new_clear_boundary = """function clearBoundary(ask = true) {
  if (!requireAdmin()) return;
  const keepAddressSet = boundaryPreservesAddresses && houses.length;
  const promptText = keepAddressSet
    ? 'Clear the editable Kingdom Hall territory boundary while keeping all uploaded addresses, avoid dots, and created territories?'
    : 'Clear the congregation boundary and all unsaved address and territory work?';
  if (ask && boundaryGeometry && !confirm(promptText)) return;
  boundaryGeometry = null;
  boundaryPreservesAddresses = false;
  currentBoundaryId = null;
  boundaryGroup.clearLayers();
  if (keepAddressSet) renderAllPlanningData();
  else clearAddressesAndTerritoriesForBoundaryChange();
  updateBoundaryUi();
}"""
app = replace_once(app, old_clear_boundary, new_clear_boundary, 'clear-boundary behavior')

old_boundary_ui = """function updateBoundaryUi() {
  els.boundaryChip.textContent = boundaryGeometry ? 'Boundary ready' : 'No boundary';
  els.boundaryMessage.textContent = boundaryGeometry
    ? 'Boundary ready. Load addresses inside it or save it as the congregation’s big-picture area.'
    : 'Select a Hall, then draw or load a boundary.';
  updateSummary();
}

function updateSourceDetail"""
new_boundary_ui = """function updateBoundaryUi() {
  els.boundaryChip.textContent = boundaryGeometry ? (boundaryPreservesAddresses ? 'Hall territory ready' : 'Boundary ready') : 'No boundary';
  els.boundaryMessage.textContent = boundaryGeometry
    ? boundaryPreservesAddresses
      ? 'Editable Kingdom Hall territory boundary ready around the uploaded ministry and avoid addresses. Use Edit Boundary to adjust it without deleting the address set.'
      : 'Boundary ready. Load addresses inside it or save it as the congregation’s big-picture area.'
    : houses.length
      ? 'Uploaded addresses are mapped without an outer boundary. Create an editable Hall boundary from the Kingdom Hall Address Set section when desired.'
      : 'Select a Hall, then draw or load a boundary.';
  updateSummary();
}

function createBoundaryAroundAddresses(paddingMiles = .12) {
  if (!requireAdmin()) return null;
  if (!selectedHall || !selectedCongregation) {
    toast('Select the Kingdom Hall and congregation before creating the Hall territory boundary.', true);
    return null;
  }
  const mapped = houses.filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)));
  if (!mapped.length) {
    toast('Upload or add mapped ministry and avoid addresses before creating the Hall territory boundary.', true);
    return null;
  }
  const padding = Math.max(.02, Math.min(2, Number(paddingMiles) || .12));
  const points = mapped.map(pointFeature);
  let baseFeature;
  try {
    if (points.length === 1) {
      baseFeature = points[0];
    } else if (points.length === 2) {
      baseFeature = turf.lineString(points.map(point => point.geometry.coordinates));
    } else {
      const collection = turf.featureCollection(points);
      baseFeature = turf.convex(collection) || turf.bboxPolygon(turf.bbox(collection));
    }
    const buffered = turf.buffer(baseFeature, padding, { units: 'miles', steps: 24 });
    const geometry = buffered?.type === 'Feature' ? buffered.geometry : buffered;
    if (!geometry) throw new Error('No boundary geometry was returned.');
    els.boundaryName.value = `${markerLabel(selectedHall)} — ${selectedCongregation} Kingdom Hall territory`;
    setBoundaryGeometry(geometry, true, true);
    toast(`Editable Hall territory boundary created around ${mapped.length.toLocaleString()} mapped addresses.`);
    return JSON.parse(JSON.stringify(geometry));
  } catch (error) {
    toast(`Could not create the Hall territory boundary: ${friendlyError(error)}`, true);
    return null;
  }
}

function updateSourceDetail"""
app = replace_once(app, old_boundary_ui, new_boundary_ui, 'boundary UI and generated Hall boundary')

app = replace_once(
    app,
    "    boundaryJson: encodeGeometry(boundaryGeometry),\n    sourceHint: currentSourceKey(),",
    "    boundaryJson: encodeGeometry(boundaryGeometry),\n    addressSetBoundary: Boolean(boundaryPreservesAddresses),\n    sourceHint: currentSourceKey(),",
    'saved boundary address-set flag'
)

old_save_start = """async function savePlan(options = {}) {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation) { toast('Select a Kingdom Hall and congregation before saving the territory plan.', true); return; }
  const addressOnlyMode = !boundaryGeometry && houses.some(house => house.bulkImported || (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.length));
  if (!boundaryGeometry && !addressOnlyMode) { toast('Draw a congregation boundary, or import a CSV address workset using the no-boundary map option before saving.', true); return; }
  if (!houses.length) { toast('Load or add addresses before saving the territory plan.', true); return; }
  const defaultPlanName = addressOnlyMode ? `${selectedCongregation} — CSV Address Territory Plan` : `${selectedCongregation} — Convention Ministry Territories`;
  const button = els.savePlanButton;"""
new_save_start = """async function savePlan(options = {}) {
  if (!requireAdmin()) return null;
  if (!selectedHall || !selectedCongregation) { toast('Select a Kingdom Hall and congregation before saving the territory plan.', true); return null; }
  const addressOnlyMode = !boundaryGeometry && houses.length > 0;
  const addressSetMode = Boolean(options.addressSetMode || addressOnlyMode || boundaryPreservesAddresses);
  if (!boundaryGeometry && !houses.length) { toast('Upload addresses or create a boundary before saving.', true); return null; }
  if (!houses.length) { toast('Load or add addresses before saving the territory plan.', true); return null; }
  const defaultPlanName = addressSetMode
    ? `${selectedCongregation} — ${markerLabel(selectedHall)} Address Set`
    : `${selectedCongregation} — Convention Ministry Territories`;
  const button = els.savePlanButton;"""
app = replace_once(app, old_save_start, new_save_start, 'Hall address-set save mode')

app = replace_once(
    app,
    "      addressOnlyMode,\n      boundaryJson: encodeGeometry(boundaryGeometry),",
    "      addressOnlyMode,\n      addressSetMode,\n      boundaryPreservesAddresses: Boolean(boundaryPreservesAddresses),\n      boundaryJson: encodeGeometry(boundaryGeometry),",
    'saved address-set plan fields'
)

old_save_finish = """    currentPlanId = planId;
    els.planName.value = clean(els.planName.value) || defaultPlanName;
    updateSummary();
    toast(options.successMessage || `Territory plan saved in ${chunks.length} private Firebase data part${chunks.length === 1 ? '' : 's'}.`);
  } catch (error) { toast(`Could not save the territory plan: ${friendlyError(error)}`, true); }
  finally { button.disabled = false; button.textContent = 'Save Territory Plan'; }
}"""
new_save_finish = """    currentPlanId = planId;
    els.planName.value = clean(els.planName.value) || defaultPlanName;
    updateSummary();
    emitPlannerDataChange();
    toast(options.successMessage || `${addressSetMode ? 'Kingdom Hall address set' : 'Territory plan'} saved in ${chunks.length} private Firebase data part${chunks.length === 1 ? '' : 's'}.`);
    return currentPlanId;
  } catch (error) {
    toast(`Could not save the territory plan: ${friendlyError(error)}`, true);
    return null;
  } finally { button.disabled = false; button.textContent = 'Save Territory Plan'; }
}"""
app = replace_once(app, old_save_finish, new_save_finish, 'save-plan completion')

app = replace_once(
    app,
    "${escapeHtml(item.congregation || '')}${item.addressOnlyMode ? ' • CSV address map' : ''} • ${(item.houseCount || 0).toLocaleString()} addresses",
    "${escapeHtml(item.congregation || '')}${item.addressSetMode ? ' • Hall address set' : item.addressOnlyMode ? ' • CSV address map' : ''} • ${(item.houseCount || 0).toLocaleString()} addresses",
    'saved plan address-set label'
)

old_snapshot = """    snapshot.forEach(item => reviewRecords.set(item.id, { id: item.id, ...item.data() }));
    renderSavedRecords();
  }, error => {"""
new_snapshot = """    snapshot.forEach(item => reviewRecords.set(item.id, { id: item.id, ...item.data() }));
    renderSavedRecords();
    emitPlannerDataChange();
  }, error => {"""
app = replace_once(app, old_snapshot, new_snapshot, 'saved plan refresh event')

app = replace_once(
    app,
    "  setBoundaryGeometry(savedBoundary, true);",
    "  setBoundaryGeometry(savedBoundary, true, Boolean(item.addressSetBoundary));",
    'saved boundary restoration'
)

app = replace_once(
    app,
    "  boundaryGeometry = decodeGeometry(plan.boundaryJson, plan.boundary);\n  if (boundaryGeometry) {",
    "  boundaryGeometry = decodeGeometry(plan.boundaryJson, plan.boundary);\n  boundaryPreservesAddresses = Boolean(plan.boundaryPreservesAddresses || plan.addressSetMode || plan.addressOnlyMode);\n  if (boundaryGeometry) {",
    'saved address-set boundary restoration'
)

app = replace_once(
    app,
    "  toast(`Saved ${plan.addressOnlyMode ? 'CSV address-only ' : ''}plan loaded with ${houses.length.toLocaleString()} addresses.`);",
    "  toast(`Saved ${plan.addressSetMode ? 'Kingdom Hall address-set ' : plan.addressOnlyMode ? 'CSV address-only ' : ''}plan loaded with ${houses.length.toLocaleString()} addresses.`);",
    'saved plan loaded message'
)

app = replace_once(
    app,
    "function clearPlanWorkspace(resetSelection = true) {\n  boundaryGeometry = null;",
    "function clearPlanWorkspace(resetSelection = true) {\n  boundaryGeometry = null;\n  boundaryPreservesAddresses = false;",
    'workspace boundary flag reset'
)

old_api = """  getHouses: () => houses,
  getBoundaryGeometry: () => boundaryGeometry,
  getHouseMarkers: () => houseMarkers,"""
new_api = """  getHouses: () => houses,
  getBoundaryGeometry: () => boundaryGeometry,
  getBoundaryPreservesAddresses: () => boundaryPreservesAddresses,
  getSavedPlans: () => savedPlans().map(item => ({ ...item })),
  loadPlanRecord,
  createBoundaryAroundAddresses,
  getHouseMarkers: () => houseMarkers,"""
app = replace_once(app, old_api, new_api, 'Hall address-set planner API')

old_header = """function drawPdfHeader(doc, logoData, title, subtitle = '') {
  if (logoData) doc.addImage(logoData, 'PNG', 0.35, 0.22, 0.68, 0.68);
  doc.setTextColor(11, 68, 126);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, 1.15, 0.48);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 84, 101);
  if (subtitle) doc.text(subtitle, 1.15, 0.70);
  doc.setDrawColor(176, 194, 210);
  doc.line(0.35, 0.92, 10.65, 0.92);
}"""
new_header = """function drawPdfHeader(doc, logoData, title, subtitle = '') {
  const textX = logoData ? 1.98 : 0.45;
  if (logoData) doc.addImage(logoData, 'PNG', 0.28, 0.10, 1.48, 0.83, undefined, 'FAST');
  doc.setTextColor(11, 68, 126);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, textX, 0.43);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 84, 101);
  if (subtitle) doc.text(subtitle, textX, 0.68);
  doc.setDrawColor(176, 194, 210);
  doc.line(0.35, 0.98, 10.65, 0.98);
}"""
app = replace_once(app, old_header, new_header, 'official wordmark PDF header')
app = app.replace("../assets/denver-2027-logo.png", "../assets/denver-2027-territory-logo.png")
app_path.write_text(app, encoding='utf-8')


directions_path = Path('territories/directions.js')
directions = directions_path.read_text(encoding='utf-8')
directions = directions.replace("../assets/denver-2027-logo.png", "../assets/denver-2027-territory-logo.png")
directions = replace_once(
    directions,
    '.head{display:grid;grid-template-columns:72px 1fr auto;gap:14px;align-items:center;border-bottom:3px solid #083f73;padding-bottom:12px}.head img{width:68px;height:68px;object-fit:contain}',
    '.head{display:grid;grid-template-columns:150px 1fr auto;gap:14px;align-items:center;border-bottom:3px solid #083f73;padding-bottom:12px}.head img{width:145px;height:82px;object-fit:contain}',
    'territory directions wordmark layout'
)
directions_path.write_text(directions, encoding='utf-8')


bootstrap_path = Path('territories/bootstrap.js')
bootstrap = bootstrap_path.read_text(encoding='utf-8')
bootstrap = re.sub(r'territories-\d{8}-\d+', VERSION, bootstrap)
if "./hall-address-sets.js" not in bootstrap:
    bootstrap = bootstrap.replace(
        f"  await import('./avoid-address-upload.js?v={VERSION}');",
        f"  await import('./avoid-address-upload.js?v={VERSION}');\n  await import('./hall-address-sets.js?v={VERSION}');"
    )
bootstrap_path.write_text(bootstrap, encoding='utf-8')

index_path = Path('territories/index.html')
index = index_path.read_text(encoding='utf-8')
index = re.sub(r'territories-\d{8}-\d+', VERSION, index)
index_path.write_text(index, encoding='utf-8')

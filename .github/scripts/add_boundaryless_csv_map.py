from pathlib import Path
import re

VERSION = 'territories-20261010-2'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')

old_save_start = """async function savePlan(options = {}) {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation || !boundaryGeometry) { toast('Select a Hall and create the congregation boundary first.', true); return; }
  if (!houses.length) { toast('Load or add addresses before saving the territory plan.', true); return; }
  const button = els.savePlanButton;"""
new_save_start = """async function savePlan(options = {}) {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation) { toast('Select a Kingdom Hall and congregation before saving the territory plan.', true); return; }
  const addressOnlyMode = !boundaryGeometry && houses.some(house => house.bulkImported || (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.length));
  if (!boundaryGeometry && !addressOnlyMode) { toast('Draw a congregation boundary, or import a CSV address workset using the no-boundary map option before saving.', true); return; }
  if (!houses.length) { toast('Load or add addresses before saving the territory plan.', true); return; }
  const defaultPlanName = addressOnlyMode ? `${selectedCongregation} — CSV Address Territory Plan` : `${selectedCongregation} — Convention Ministry Territories`;
  const button = els.savePlanButton;"""
app = replace_once(app, old_save_start, new_save_start, 'save-plan boundary requirement')

app = replace_once(
    app,
    "      planName: clean(els.planName.value) || `${selectedCongregation} — Convention Ministry Territories`,",
    "      planName: clean(els.planName.value) || defaultPlanName,",
    'saved plan default name'
)
app = replace_once(
    app,
    "      boundaryJson: encodeGeometry(boundaryGeometry),\n      boundaryName: clean(els.boundaryName.value) || `${selectedCongregation} service area`,",
    "      addressOnlyMode,\n      boundaryJson: encodeGeometry(boundaryGeometry),\n      boundaryName: boundaryGeometry ? (clean(els.boundaryName.value) || `${selectedCongregation} service area`) : 'CSV address-only map — no outer boundary',",
    'address-only plan fields'
)
app = replace_once(
    app,
    "    els.planName.value = clean(els.planName.value) || `${selectedCongregation} — Convention Ministry Territories`;",
    "    els.planName.value = clean(els.planName.value) || defaultPlanName;",
    'plan name after save'
)
app = replace_once(
    app,
    "${escapeHtml(item.congregation || '')} • ${(item.houseCount || 0).toLocaleString()} addresses",
    "${escapeHtml(item.congregation || '')}${item.addressOnlyMode ? ' • CSV address map' : ''} • ${(item.houseCount || 0).toLocaleString()} addresses",
    'saved-plan CSV label'
)

old_load_finish = """  updateBoundaryUi();
  renderAllPlanningData();
  toast(`Saved plan loaded with ${houses.length.toLocaleString()} addresses.`);
}"""
new_load_finish = """  updateBoundaryUi();
  renderAllPlanningData();
  if (!boundaryGeometry && houses.length) {
    const mappedPoints = houses
      .filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)))
      .map(house => [Number(house.lat), Number(house.lng)]);
    if (mappedPoints.length) map.fitBounds(L.latLngBounds(mappedPoints), { padding: [36, 36], maxZoom: 16 });
  }
  toast(`Saved ${plan.addressOnlyMode ? 'CSV address-only ' : ''}plan loaded with ${houses.length.toLocaleString()} addresses.`);
}"""
app = replace_once(app, old_load_finish, new_load_finish, 'address-only plan load zoom')
app_path.write_text(app, encoding='utf-8')

bulk_path = Path('territories/bulk-addresses.js')
bulk = bulk_path.read_text(encoding='utf-8')

old_admin = "function requireAdmin(){ if(api?.isAdmin?.()) return true; api?.requireAdmin?.(); return false; }"
new_admin = """function requireAdmin(){ if(api?.isAdmin?.()) return true; api?.requireAdmin?.(); return false; }
function selectedContext(){return{hall:api?.getSelectedHall?.()||null,congregation:clean(api?.getSelectedCongregation?.())};}
function contextReady(){const context=selectedContext();return Boolean(context.hall&&context.congregation);}
function requireContext(){const context=selectedContext();if(!context.hall||!context.congregation){toast('Select the Kingdom Hall and congregation in Area Setup before importing the CSV address list.',true);return null;}return context;}
function useBoundary(){return el.mode?.value==='boundary';}
function refreshContext(){const context=selectedContext();if(el.context){el.context.textContent=contextReady()?`Addresses will be mapped under ${context.hall.markerLabel||context.hall.number||'KH'} — ${context.hall.name||'Kingdom Hall'} • ${context.congregation}.`:'Select a Kingdom Hall and congregation in Area Setup before importing.';}if(el.read)el.read.disabled=!api?.isAdmin?.()||!contextReady();}"""
bulk = replace_once(bulk, old_admin, new_admin, 'bulk Hall context helpers')

bulk = replace_once(
    bulk,
    "if(el.limit.checked&&api.getBoundaryGeometry?.()&&!api.pointInsideBoundary?.({lat,lng}))return'Outside current boundary';",
    "if(useBoundary()){if(!api.getBoundaryGeometry?.())return'No congregation boundary';if(!api.pointInsideBoundary?.({lat,lng}))return'Outside current boundary';}",
    'bulk import boundary mode'
)
bulk = replace_once(
    bulk,
    "async function readList(){if(!requireAdmin())return;const defaults=",
    "async function readList(){if(!requireAdmin()||!requireContext())return;if(useBoundary()&&!api.getBoundaryGeometry?.())return toast('Draw or load a congregation boundary, or choose CSV address-only map.',true);const defaults=",
    'read-list Hall requirement'
)
bulk = replace_once(
    bulk,
    "}catch(error){setMessage(error.message,'error');}finally{el.read.disabled=!api.isAdmin();}}",
    "}catch(error){setMessage(error.message,'error');}finally{el.read.disabled=!api.isAdmin()||!contextReady();}}",
    'read-list final control state'
)
bulk = replace_once(
    bulk,
    "async function importList(){if(!requireAdmin()||!pending.length)return;const batchName=",
    "async function importList(){if(!requireAdmin()||!requireContext()||!pending.length)return;if(useBoundary()&&!api.getBoundaryGeometry?.())return toast('Draw or load a congregation boundary, or choose CSV address-only map.',true);const batchName=",
    'import-list Hall requirement'
)

old_limit = '<label class="check-row"><input id="bulkLimit" type="checkbox" checked> Keep addresses inside the current congregation boundary</label>'
new_limit = '<div class="field bulk-map-mode"><label for="bulkImportMode">CSV mapping option</label><select id="bulkImportMode"><option value="no-boundary" selected>Map CSV addresses without an outer boundary</option><option value="boundary">Keep only addresses inside the current congregation boundary</option></select><small id="bulkContext">Select a Kingdom Hall and congregation in Area Setup before importing.</small></div>'
bulk = replace_once(bulk, old_limit, new_limit, 'bulk CSV mapping option')
bulk = replace_once(
    bulk,
    'Paste or upload about 1,000 addresses, then group only that list into territories of 40 homes or draw the territories manually.',
    'Upload a CSV address list and map the homes under the selected Kingdom Hall and congregation. An outer congregation boundary is optional. You can then group only that list into territories of 40 homes or draw the territories manually.',
    'bulk address card description'
)
bulk = replace_once(
    bulk,
    "limit:document.getElementById('bulkLimit'),read:document.getElementById('bulkRead'),",
    "mode:document.getElementById('bulkImportMode'),context:document.getElementById('bulkContext'),read:document.getElementById('bulkRead'),",
    'bulk element bindings'
)
bulk = replace_once(
    bulk,
    "function refresh(){const list=batches(),previous=activeBatchId||el.batch.value;",
    "function refresh(){refreshContext();const list=batches(),previous=activeBatchId||el.batch.value;",
    'bulk context refresh'
)
bulk = replace_once(
    bulk,
    "function wire(){el.read.onclick=readList;el.import.onclick=importList;",
    "function wire(){el.read.onclick=readList;el.import.onclick=importList;el.mode.onchange=refreshContext;",
    'bulk mapping-mode listener'
)
bulk_path.write_text(bulk, encoding='utf-8')

bootstrap_path = Path('territories/bootstrap.js')
bootstrap = bootstrap_path.read_text(encoding='utf-8')
bootstrap = re.sub(r'territories-\d{8}-\d+', VERSION, bootstrap)
bootstrap_path.write_text(bootstrap, encoding='utf-8')

index_path = Path('territories/index.html')
index = index_path.read_text(encoding='utf-8')
index = re.sub(r'territories-\d{8}-\d+', VERSION, index)
index_path.write_text(index, encoding='utf-8')

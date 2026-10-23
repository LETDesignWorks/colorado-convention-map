import { startLoading, stopLoading, paintBeforeWork } from './planner-loading.js?v=territories-20261023-49';
import { workKey } from './saved-work-model.js?v=territories-20261023-49';
import { chooseMeetingPlan, latestMeetingBoundary, createMeetingBoundaryFlow,
  homeFingerprint, mappedHome, outsideHomes } from './meeting-place-model.js?v=territories-20261023-49';
let api, flow, known = new Set(), lastKey = '', lastGeneration = -1;
let restoring = false, restoreAttempt = 0;
let restorePending = true, restoreQueued = false, flushTimer, preview, uiBusy = false;
const el = id => document.getElementById(id);
const context = () => ({ hallId: String(api.getSelectedHall()?.id || ''), congregation: api.getSelectedCongregation() || '', generation: api.getWorkspaceGeneration() });
const key = () => workKey(context().hallId, context().congregation);
const isCurrent = scope => api.isAdmin() && scope.generation === api.getWorkspaceGeneration()
  && workKey(scope.hallId, scope.congregation) === key();
const houses = () => api.getHouses().filter(mappedHome);
const status = message => { if (el('meetingAddressStatus')) el('meetingAddressStatus').textContent = message; };
function reset() {
  clearTimeout(flushTimer); known = new Set(houses().map(homeFingerprint));
  lastGeneration = api.getWorkspaceGeneration(); lastKey = key(); restorePending = false;
}
function clearPreview() { if (preview) api.getMap().removeLayer(preview); preview = null; }
function showHomes() {
  const focus = el('bulkFocus'); if (focus) focus.checked = false;
  const points = houses().map(home => [Number(home.lat), Number(home.lng)]);
  if (points.length) api.getMap().fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
}
function mountUi() {
  if (el('meetingAddressTools')) return;
  const selector = el('hallSelect'); if (!selector) return;
  const card = document.createElement('section'); card.id = 'meetingAddressTools';
  card.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #c6d9e8;border-radius:12px;background:#f4f9fd;min-width:0';
  card.innerHTML = '<strong>Meeting-place addresses & boundary</strong><p id="meetingAddressStatus" role="status" aria-live="polite" style="font-size:12px;line-height:1.5">Select a meeting place to load its saved addresses.</p><div class="button-grid"><button type="button" class="btn outline" id="reloadMeetingAddresses">Load saved addresses</button><button type="button" class="btn primary" id="reviewMeetingBoundary">Review boundary & fill</button></div><small style="display:block;margin-top:8px;line-height:1.5">Saved addresses load for the selected congregation. New addresses outside the boundary stay loaded while you decide whether to expand it. Assessor filling never replaces existing territory groups.</small>';
  (selector.closest('.field') || selector).after(card);
  el('reloadMeetingAddresses').addEventListener('click', () => restore(true));
  el('reviewMeetingBoundary').addEventListener('click', () => runFill(false));
}
function controls() {
  const ready = api.isAdmin() && context().hallId && context().congregation;
  if (el('reloadMeetingAddresses')) el('reloadMeetingAddresses').disabled = !ready || uiBusy;
  if (el('reviewMeetingBoundary')) el('reviewMeetingBoundary').disabled = !ready || uiBusy;
}
async function restore(explicit = false) {
  restorePending = false;
  if (!api.isAdmin()) { stopLoading('meeting-load'); status('Sign in to load saved addresses.'); return; }
  if (api.getSavedRecordsStatus() !== 'ready') {
    restorePending = api.getSavedRecordsStatus() !== 'error';
    if (restorePending) startLoading('meeting-load', `Loading saved work for ${api.getSelectedHall()?.name || 'meeting place'}…`);
    else stopLoading('meeting-load');
    status(restorePending ? 'Loading saved addresses and territories…' : 'Saved records could not connect. Check your connection and use Load saved addresses to retry.'); return;
  }
  if (!explicit && (api.getHouses().length || api.getTerritories().length)) { stopLoading('meeting-load'); return; }
  const scope = context(), attempt = ++restoreAttempt;
  restoring = true; startLoading('meeting-load', `Loading ${api.getSelectedHall()?.name || 'meeting place'} — ${scope.congregation}…`);
  await paintBeforeWork();
  if (!isCurrent(scope)) { restoring = false; stopLoading('meeting-load'); observe(); return; }
  const records = api.getSavedRecords();
  const focus = el('bulkFocus'); if (focus) focus.checked = false;
  try {
    const selection = chooseMeetingPlan(records, scope.hallId, scope.congregation);
    const accepted = latestMeetingBoundary(records, scope.hallId, scope.congregation);
    if (selection) {
      if (!api.loadPlanRecord(selection.plan.id)) {
        status('Saved addresses were not loaded. Your current work is kept; check the saved-record message and retry.'); return;
      }
      if (accepted) api.setMeetingSearchBoundary(accepted.geometry);
      reset(); showHomes();
      status(`Loaded ${api.getHouses().length.toLocaleString()} addresses and ${api.getTerritories().length} territories for ${scope.congregation}.${selection.legacy ? ' This is the latest earlier address set; select SAVE YOUR WORK to make it your main saved work.' : ''}${accepted ? ' The saved meeting-place boundary is restored.' : ''}`);
    } else {
      if (accepted && !api.getBoundaryGeometry()) api.setMeetingSearchBoundary(accepted.geometry);
      reset();
      status(accepted ? 'The saved boundary is loaded. No complete saved address set was found. Choose Review boundary & fill to retrieve assessor/GIS homes.'
        : 'No complete saved address set was found for this congregation. Upload addresses or choose Review boundary & fill to start an assessor/GIS search around the meeting place. Existing PDF copies remain in the saved-territory library.');
    }
  } catch (error) { status(`Saved addresses could not be restored: ${error.message}. Your current work is kept.`); }
  finally { restoring = false; if (attempt === restoreAttempt) stopLoading('meeting-load'); if (restorePending) observe(); }
}
async function runFill(automatic) {
  if (uiBusy) return;
  const scope = context();
  for (const home of houses()) known.add(homeFingerprint(home));
  uiBusy = true; controls();
  try { return await flow.fill({ automatic }); }
  finally {
    uiBusy = false; controls();
    if (isCurrent(scope)) {
      const boundary = api.getBoundaryGeometry();
      for (const home of houses()) if (boundary && !outsideHomes(turf, [home], boundary).length) known.add(homeFingerprint(home));
      observe();
    }
  }
}
function observe() {
  mountUi(); controls();
  const nextKey = key(), generation = api.getWorkspaceGeneration();
  if (nextKey !== lastKey) {
    globalThis.__denverFullBoundaryAssessor?.cancel(); clearPreview();
    reset(); restorePending = Boolean(context().hallId);
  } else if (generation !== lastGeneration) reset();
  if (!api.isAdmin()) { stopLoading('meeting-load'); status('Sign in to load saved meeting-place addresses.'); return; }
  if (restorePending && !restoreQueued && !restoring) {
    restoreQueued = true;
    setTimeout(() => { restoreQueued = false; if (restorePending && !restoring) void restore(); }, 0);
  }
  if (uiBusy || restoring || restorePending || api.getSavedRecordsStatus() !== 'ready') return;
  const additions = houses().filter(home => !known.has(homeFingerprint(home)));
  if (!additions.length) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    if (uiBusy || api.getSavedRecordsStatus() !== 'ready' || !api.isAdmin()) return;
    const newHomes = houses().filter(home => !known.has(homeFingerprint(home)));
    if (!newHomes.length) return;
    const boundary = api.getBoundaryGeometry();
    if (!boundary || outsideHomes(turf, newHomes, boundary).length) void runFill(true);
    else for (const home of newHomes) known.add(homeFingerprint(home));
  }, 300);
}
async function initialize() {
  for (let attempt = 0; attempt < 200; attempt++) {
    api = globalThis.__denverTerritoryPlannerAPI;
    if (api?.getSavedRecords && api.getMap()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!api?.getSavedRecords) return;
  flow = createMeetingBoundaryFlow({
    turf, context, isCurrent, isAdmin: () => api.isAdmin(), getHomes: () => api.getHouses(),
    getHall: () => api.getSelectedHall(), getBoundary: () => api.getBoundaryGeometry(),
    padding: () => Math.max(.02, Math.min(2, Number(el('assessorBoundaryPadding')?.value) || .35)),
    applyBoundary: geometry => api.setMeetingSearchBoundary(geometry),
    preview: geometry => { clearPreview(); preview = L.geoJSON(geometry, { interactive: false, style: { color: '#c17717', weight: 2, dashArray: '6 5', fillOpacity: .05 } }).addTo(api.getMap()); }, clearPreview,
    getAcceptedBoundary: () => latestMeetingBoundary(api.getSavedRecords(), context().hallId, context().congregation)?.geometry || null,
    saveBoundary: (geometry, scope) => api.saveMeetingPlaceBoundary(geometry, scope),
    confirm: message => window.confirm(message), status,
    scan: async () => {
      const scanner = globalThis.__denverFullBoundaryAssessor;
      if (!scanner) throw new Error('The assessor/GIS scanner is not ready. Retry after the planner finishes loading.');
      const focus = el('bulkFocus'); if (focus) focus.checked = false;
      return scanner.run({ managed: true });
    }
  });
  globalThis.__denverMeetingPlaceFlow = Object.freeze({ reset, observe, fill: () => runFill(false), restore, isBusy: () => uiBusy });
  window.addEventListener('territory-planner:data', observe);
  window.addEventListener('territory-planner:saved-records', observe);
  observe();
}
initialize();

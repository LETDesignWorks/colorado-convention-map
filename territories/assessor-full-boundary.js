import { captureScanScope, scanScopeIsCurrent } from './meeting-place-model.js?v=territories-20261022-38';
import {
  ASSESSOR_SOURCES,
  inferSourceForHall,
  parseSourceFeature,
  normalizeAddressKey
} from './data.js';

const FULL_BOUNDARY_VERSION = 'territories-20261022-38';
const FEATURE_BATCH_SIZE = 250;
const FEATURE_CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_FEATURES = 100000;

let fullBoundaryRunning = false;
let cancelFullBoundary = false;
let refreshTimer = null;
const activeControllers = new Set();

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const clean = value => String(value ?? '').trim();

function plannerApi() {
  return globalThis.__denverTerritoryPlannerAPI || null;
}

function messageElement() {
  return document.getElementById('addressSourceMergeMessage');
}

function setMessage(message, state = 'waiting') {
  const element = messageElement();
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function updateProgress(percent, detail) {
  const wrap = document.getElementById('directAssessorProgress');
  const bar = document.getElementById('directAssessorProgressBar');
  const text = document.getElementById('directAssessorProgressText');
  if (!wrap || !bar || !text) return;
  wrap.hidden = false;
  bar.style.width = `${Math.max(2, Math.min(100, Number(percent) || 0))}%`;
  text.textContent = detail;
}

function hideProgress(delay = 1400) {
  setTimeout(() => {
    const wrap = document.getElementById('directAssessorProgress');
    if (wrap) wrap.hidden = true;
  }, delay);
}

function setMainButton(text, busy) {
  const button = document.getElementById('addAssessorAddressesButton');
  if (!button) return;
  button.textContent = text;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function removeLegacyControls() {
  document.getElementById('assessorNeighborControls')?.remove();
  document.getElementById('assessorNeighborReview')?.remove();
  document.getElementById('assessor-neighbor-styles')?.remove();
  const limit = document.getElementById('directAssessorLimit');
  limit?.closest('.field')?.remove();
}

function updateUi() {
  removeLegacyControls();
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return false;

  const heading = card.querySelector('h2');
  if (heading) heading.textContent = 'Fill the boundary with all assessor / GIS addresses';

  const copy = card.querySelector('.section-copy');
  if (copy) {
    copy.textContent = 'Select one button to retrieve the complete official address set for the editable Hall boundary. The faster scanner gets the address IDs first, downloads several groups in parallel, merges duplicates, and redraws the map only once at the end.';
  }

  const restart = document.getElementById('directAssessorRestart');
  if (restart) {
    restart.textContent = 'Rescan Entire Boundary';
    restart.hidden = false;
  }

  const cancel = document.getElementById('directAssessorCancel');
  if (cancel) cancel.textContent = 'Cancel Full Boundary Scan';

  const button = document.getElementById('addAssessorAddressesButton');
  if (button && !fullBoundaryRunning) {
    button.textContent = 'Fill Boundary with All Addresses';
    button.disabled = false;
    button.dataset.fullBoundaryVersion = FULL_BOUNDARY_VERSION;
  }

  let notice = document.getElementById('fullBoundaryModeNotice');
  if (!notice) {
    notice = document.createElement('small');
    notice.id = 'fullBoundaryModeNotice';
    const actions = card.querySelector('.address-source-actions');
    if (actions) actions.insertAdjacentElement('afterend', notice);
    else card.appendChild(notice);
  }
  notice.style.cssText = 'display:block;margin:8px 0;padding:9px 10px;border:1px solid #b9d9d7;border-left:4px solid #16a6a1;border-radius:9px;background:#f1fbfa;color:#456968;font-size:9px;line-height:1.5';
  notice.textContent = 'Fast complete-boundary mode is active. The planner downloads multiple protected GIS batches at the same time and waits to redraw the map until the scan is complete. Leave the page open until the completion message appears.';
  return true;
}

function sourceKeyForHall(planner) {
  const selected = clean(document.getElementById('sourceSelect')?.value);
  if (selected && !['auto', 'manual'].includes(selected) && ASSESSOR_SOURCES[selected]) {
    return selected === 'douglas' ? 'colorado' : selected;
  }
  const hall = planner.getSelectedHall?.();
  const inferred = hall?.id ? inferSourceForHall(hall.id) : '';
  if (inferred === 'douglas') return 'colorado';
  return ASSESSOR_SOURCES[inferred] ? inferred : 'colorado';
}

function geometryObject(value) {
  return value?.type === 'Feature' ? value.geometry : value;
}

function collectPairs(node, output = []) {
  if (!Array.isArray(node)) return output;
  if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
    output.push([Number(node[0]), Number(node[1])]);
    return output;
  }
  node.forEach(child => collectPairs(child, output));
  return output;
}

function geometryBounds(value) {
  const geometry = geometryObject(value);
  const pairs = collectPairs(geometry?.coordinates, []);
  if (!pairs.length) return null;
  return {
    xmin: Math.min(...pairs.map(pair => pair[0])),
    ymin: Math.min(...pairs.map(pair => pair[1])),
    xmax: Math.max(...pairs.map(pair => pair[0])),
    ymax: Math.max(...pairs.map(pair => pair[1])),
    spatialReference: { wkid: 4326 }
  };
}

function validCoordinates(item) {
  const planner = plannerApi();
  if (planner?.validMapCoordinates) return planner.validMapCoordinates(item);
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}

async function ensureBoundary(planner) {
  let geometry = planner.getBoundaryGeometry?.();
  if (geometry) return geometry;

  const mapped = planner.getHouses?.().filter(validCoordinates) || [];
  if (!mapped.length) throw new Error('Upload or map addresses before creating the Hall boundary.');
  const padding = Math.max(0.02, Math.min(2, Number(document.getElementById('assessorBoundaryPadding')?.value) || 0.35));
  setMessage(`Creating the editable Hall boundary around ${mapped.length.toLocaleString()} mapped addresses…`, 'working');
  updateProgress(5, 'Creating the editable Hall boundary…');
  await nextFrame();
  geometry = planner.createBoundaryAroundAddresses?.(padding);
  if (!geometry) throw new Error('The Hall boundary could not be created. Draw or load a boundary under Area Setup and try again.');
  await nextFrame();
  return geometry;
}

function arcGisError(payload, fallback) {
  if (!payload?.error) return null;
  const details = Array.isArray(payload.error.details) ? payload.error.details.filter(Boolean).join(' ') : '';
  return new Error(`${payload.error.message || fallback}${details ? ` ${details}` : ''}`.trim());
}

function jsonpRequest(endpoint, params) {
  return new Promise((resolve, reject) => {
    if (cancelFullBoundary) return reject(new DOMException('Canceled', 'AbortError'));
    const callback = `__denverFastAssessor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const url = new URL(endpoint);
    for (const [key, value] of params.entries()) url.searchParams.set(key, value);
    url.searchParams.set('f', 'json');
    url.searchParams.set('callback', callback);
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.remove();
      try { delete window[callback]; } catch { window[callback] = undefined; }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The official GIS request timed out.'));
    }, REQUEST_TIMEOUT_MS);
    window[callback] = payload => {
      cleanup();
      const error = arcGisError(payload, 'The official GIS service returned an error.');
      if (error) reject(error); else resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('The official GIS service could not be reached.'));
    };
    script.src = url.href;
    document.head.appendChild(script);
  });
}

async function fetchArcGis(endpoint, params) {
  if (cancelFullBoundary) throw new DOMException('Canceled', 'AbortError');
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json'
        },
        body: params,
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Official GIS service returned HTTP ${response.status}.`);
      const payload = await response.json();
      const error = arcGisError(payload, 'The official GIS service returned an error.');
      if (error) throw error;
      return payload;
    } catch (postError) {
      if (cancelFullBoundary || postError?.name === 'AbortError') throw postError;
      try {
        const url = new URL(endpoint);
        for (const [key, value] of params.entries()) url.searchParams.set(key, value);
        const response = await fetch(url.href, {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit'
        });
        if (!response.ok) throw new Error(`Official GIS service returned HTTP ${response.status}.`);
        const payload = await response.json();
        const error = arcGisError(payload, 'The official GIS service returned an error.');
        if (error) throw error;
        return payload;
      } catch (getError) {
        if (cancelFullBoundary || getError?.name === 'AbortError') throw getError;
        return await jsonpRequest(endpoint, params);
      }
    }
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

function baseSpatialParams(envelope) {
  return new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326'
  });
}

async function queryObjectIds(source, envelope) {
  const params = baseSpatialParams(envelope);
  params.set('returnIdsOnly', 'true');
  params.set('returnGeometry', 'false');
  updateProgress(10, `Finding every official address ID inside the boundary from ${source.label}…`);
  const payload = await fetchArcGis(source.endpoint, params);
  const objectIds = Array.isArray(payload.objectIds) ? payload.objectIds.filter(value => value !== null && value !== undefined) : [];
  return {
    objectIds,
    objectIdFieldName: clean(payload.objectIdFieldName || payload.objectIdField || '')
  };
}

function featureParams(source, objectIds) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    objectIds: objectIds.join(','),
    outFields: Array.isArray(source.outFields) ? source.outFields.join(',') : '*',
    returnGeometry: String(Boolean(source.returnGeometry)),
    returnCentroid: String(Boolean(source.returnCentroid)),
    outSR: '4326',
    geometryPrecision: '6'
  });
  if (source.returnGeometry) params.set('maxAllowableOffset', '0.00004');
  return params;
}

async function requestFeatureChunk(source, objectIds, attempt = 1) {
  try {
    const payload = await fetchArcGis(source.endpoint, featureParams(source, objectIds));
    return Array.isArray(payload.features) ? payload.features : [];
  } catch (error) {
    if (cancelFullBoundary || error?.name === 'AbortError') throw error;
    if (attempt < 3) {
      await sleep(250 * attempt);
      return requestFeatureChunk(source, objectIds, attempt + 1);
    }
    throw error;
  }
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchFeatureChunks(source, objectIds) {
  const groups = chunks(objectIds, FEATURE_BATCH_SIZE);
  const results = new Array(groups.length);
  let cursor = 0;
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (!cancelFullBoundary) {
      const index = cursor++;
      if (index >= groups.length) return;
      try {
        results[index] = await requestFeatureChunk(source, groups[index]);
      } catch (error) {
        if (cancelFullBoundary || error?.name === 'AbortError') return;
        console.warn('An assessor/GIS feature batch failed after retries.', error);
        results[index] = [];
        failed += 1;
      }
      completed += 1;
      const percent = 15 + ((completed / Math.max(1, groups.length)) * 58);
      updateProgress(percent, `Downloading official address groups in parallel: ${completed.toLocaleString()} of ${groups.length.toLocaleString()} complete${failed ? ` • ${failed} retried group${failed === 1 ? '' : 's'} failed` : ''}`);
      await nextFrame();
    }
  }

  await Promise.all(Array.from({ length: Math.min(FEATURE_CONCURRENCY, groups.length || 1) }, worker));
  return {
    features: results.flatMap(value => Array.isArray(value) ? value : []),
    failedBatches: failed,
    totalBatches: groups.length
  };
}

function addressKey(record, includeUnits) {
  const address = includeUnits ? record?.address : (record?.baseAddress || record?.address);
  return normalizeAddressKey(address || '', includeUnits);
}

function buildAddressIndex(houses, includeUnits) {
  const index = new Set();
  for (const house of houses) {
    const exact = addressKey(house, includeUnits);
    if (exact) index.add(exact);
    const alternate = normalizeAddressKey(house.address || '', includeUnits);
    if (alternate) index.add(alternate);
  }
  return index;
}

async function mergeFeatures(planner, sourceKey, features, scope) {
  const houses = planner.getHouses();
  const addressIndex = buildAddressIndex(houses, true), staged = [];
  const ids = new Set(houses.map(home => String(home.id)));
  let duplicates = 0, outside = 0, unusable = 0, nonResidential = 0;
  for (let index = 0; index < features.length; index++) {
    if (cancelFullBoundary || !scanScopeIsCurrent(planner, scope)) return { stale: true, added: 0 };
    const record = parseSourceFeature(sourceKey, features[index]);
    if (!record || !validCoordinates(record) || !clean(record.address)) { unusable++; continue; }
    if (document.getElementById('residentialOnly')?.checked !== false && record.residential === false) { nonResidential++; continue; }
    const inside = scope.searchGeometry
      ? turf.booleanPointInPolygon(turf.point([Number(record.lng), Number(record.lat)]), turf.feature(scope.searchGeometry))
      : planner.pointInsideBoundary(record);
    if (!inside) { outside++; continue; }
    const key = addressKey(record, true);
    if (!key || addressIndex.has(key)) { duplicates++; continue; }
    let id = String(record.id || planner.uniqueId('assessor'));
    if (ids.has(id)) id = planner.uniqueId('assessor');
    ids.add(id); addressIndex.add(key);
    staged.push({ ...record, id, supplemental: true, avoid: false, included: true, territoryId: null });
    if (index > 0 && index % 300 === 0) {
      updateProgress(76 + index / Math.max(1, features.length) * 15, `${index.toLocaleString()} official records checked • ${staged.length.toLocaleString()} new homes ready`);
      await nextFrame();
    }
  }
  if (cancelFullBoundary || !scanScopeIsCurrent(planner, scope) || houses !== planner.getHouses()) return { stale: true, added: 0 };
  const currentIndex = buildAddressIndex(houses, true), liveIds = new Set(houses.map(h => String(h.id)));
  let added = 0;
  for (const record of staged) {
    const key = addressKey(record, true);
    if (currentIndex.has(key)) { duplicates++; continue; }
    if (liveIds.has(record.id)) record.id = planner.uniqueId('assessor');
    liveIds.add(record.id); houses.push(record); currentIndex.add(key); added++;
  }
  return { added, duplicates, outside, unusable, nonResidential };
}

function cancelActiveRequests() {
  cancelFullBoundary = true;
  for (const controller of activeControllers) {
    try { controller.abort(); } catch { /* no-op */ }
  }
  activeControllers.clear();
}

async function runEveryAddressInsideBoundary(options = {}) {
  if (!options.managed && globalThis.__denverMeetingPlaceFlow) return globalThis.__denverMeetingPlaceFlow.fill();
  if (fullBoundaryRunning) return { status: 'busy' };
  const planner = plannerApi();
  if (!planner?.isAdmin?.()) { planner?.requireAdmin?.(); return { status: 'unauthorized' }; }
  if (!planner.getSelectedHall?.() || !clean(planner.getSelectedCongregation?.())) {
    setMessage('Select the meeting place and congregation first.', 'error'); return { status: 'empty' };
  }
  const startGeneration = planner.getWorkspaceGeneration?.(), startHall = String(planner.getSelectedHall().id);
  const startCongregation = planner.getSelectedCongregation();
  let scope, changedHandler, result = { status: 'failed' };
  fullBoundaryRunning = true; cancelFullBoundary = false;
  setMainButton('Preparing Boundary Scan…', true);
  document.getElementById('directAssessorCancel')?.removeAttribute('hidden');
  try {
    removeLegacyControls();
    const geometry = options.searchGeometry ? geometryObject(JSON.parse(JSON.stringify(options.searchGeometry))) : await ensureBoundary(planner);
    if (startGeneration !== planner.getWorkspaceGeneration?.() || startHall !== String(planner.getSelectedHall()?.id)
      || startCongregation !== planner.getSelectedCongregation() || !planner.isAdmin()) return { status: 'stale' };
    scope = captureScanScope(planner);
    if (options.searchGeometry) scope.searchGeometry = geometry;
    changedHandler = () => { if (!scanScopeIsCurrent(planner, scope)) cancelActiveRequests(); };
    window.addEventListener('territory-planner:data', changedHandler);
    const envelope = geometryBounds(geometry);
    if (!envelope) throw new Error('The search boundary has invalid coordinates.');
    const sourceKey = sourceKeyForHall(planner), source = ASSESSOR_SOURCES[sourceKey];
    if (!source?.endpoint) throw new Error('No official assessor/GIS source is available for this meeting place.');
    setMessage(`Finding home addresses using ${source.label}. Existing homes and territory groups will stay in place.`, 'working');
    const idResult = await queryObjectIds(source, envelope);
    if (cancelFullBoundary || !scanScopeIsCurrent(planner, scope)) return { status: 'cancelled' };
    const objectIds = [...new Set(idResult.objectIds.map(String))];
    if (!objectIds.length) throw new Error(`${source.label} returned no address IDs. Check the boundary or select another official source.`);
    if (objectIds.length > MAX_FEATURES) throw new Error(`This area contains ${objectIds.length.toLocaleString()} records, over the ${MAX_FEATURES.toLocaleString()}-record safety limit. Use a smaller boundary.`);
    setMainButton(`Downloading ${objectIds.length.toLocaleString()} Official Records…`, true);
    const downloaded = await fetchFeatureChunks(source, objectIds);
    if (cancelFullBoundary || !scanScopeIsCurrent(planner, scope)) return { status: 'cancelled' };
    const merged = await mergeFeatures(planner, sourceKey, downloaded.features, scope);
    if (merged.stale || cancelFullBoundary || !scanScopeIsCurrent(planner, scope)) return { status: 'cancelled' };
    planner.recalculateTerritoryHouseIds?.(); planner.render?.(); planner.refresh?.();
    const partial = downloaded.failedBatches > 0;
    result = { status: partial ? 'partial' : 'complete', ...merged, failedBatches: downloaded.failedBatches };
    updateProgress(100, partial ? 'Partial results loaded — retry to complete the scan.' : 'Address scan finished.');
    setMessage(`${source.label}: ${merged.added.toLocaleString()} new homes added; ${merged.duplicates.toLocaleString()} duplicates skipped; ${merged.outside.toLocaleString()} outside the boundary; ${merged.nonResidential.toLocaleString()} nonresidential; ${merged.unusable.toLocaleString()} unusable.${partial ? ` ${downloaded.failedBatches} GIS batches failed. Retry to fill the remaining addresses.` : ''} Select SAVE YOUR WORK to keep the results.`, partial ? 'warning' : 'success');
    planner.toast?.(`${merged.added.toLocaleString()} assessor/GIS homes added.${partial ? ' Some requests failed; retry to complete.' : ''}`);
    return result;
  } catch (error) {
    result = { status: cancelFullBoundary || error?.name === 'AbortError' ? 'cancelled' : 'failed', error: error?.message || 'Unknown error' };
    if (!scope || scanScopeIsCurrent(planner, scope)) setMessage(`The address scan ${result.status === 'cancelled' ? 'was cancelled' : `stopped: ${result.error}`}. Existing addresses and territories are kept.`, 'warning');
    return result;
  } finally {
    if (changedHandler) window.removeEventListener('territory-planner:data', changedHandler);
    fullBoundaryRunning = false; cancelFullBoundary = false; activeControllers.clear();
    const cancel = document.getElementById('directAssessorCancel'); if (cancel) cancel.hidden = true;
    setMainButton('Fill Boundary with All Addresses', false); hideProgress(); updateUi();
  }
}

function bindDelegatedControls() {
  if (document.documentElement.dataset.fullBoundaryScannerVersion === FULL_BOUNDARY_VERSION) return;
  document.documentElement.dataset.fullBoundaryScannerVersion = FULL_BOUNDARY_VERSION;

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#addAssessorAddressesButton');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void runEveryAddressInsideBoundary();
  }, true);

  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#directAssessorCancel')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelActiveRequests();
    setMessage('Canceling the fast complete-boundary scan…', 'working');
  }, true);

  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#directAssessorRestart')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (fullBoundaryRunning) return;
    setMessage('The next scan will recheck the entire editable boundary and skip addresses already loaded.', 'success');
  }, true);
}

function scheduleUiRefresh(delay = 80) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(updateUi, delay);
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    if (plannerApi()?.getHouses?.() && plannerApi()?.getMap?.()) break;
    await sleep(50);
  }

  bindDelegatedControls();
  for (let index = 0; index < 240; index += 1) {
    if (updateUi()) break;
    await sleep(50);
  }

  window.addEventListener('territory-planner:data', () => scheduleUiRefresh(80));
  [200, 700, 1800, 3500].forEach(delay => setTimeout(updateUi, delay));
  setMessage('Ready. Select Fill Boundary with All Addresses once. The faster scanner will find all official IDs, download multiple groups in parallel, merge duplicates, and redraw the map once.', 'waiting');
  console.info(`Denver 2027 fast complete-boundary assessor scanner loaded (${FULL_BOUNDARY_VERSION}).`);
}

globalThis.__denverFullBoundaryAssessor = Object.freeze({
  version: FULL_BOUNDARY_VERSION,
  run: runEveryAddressInsideBoundary,
  refresh: updateUi,
  cancel: cancelActiveRequests
});

export { runEveryAddressInsideBoundary, updateUi };

initialize();

import {
  ASSESSOR_SOURCES,
  inferSourceForHall,
  parseSourceFeature,
  normalizeAddressKey
} from './data.js';

const SCAN_VERSION = 'territories-20261011-16';
const DEFAULT_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 250;
const REQUEST_TIMEOUT_MS = 30000;
const CURSOR_PREFIX = 'denver2027-assessor-direct:';

let planner = null;
let scanRunning = false;
let cancelRequested = false;
let activeController = null;
let buttonObserver = null;

const clean = value => String(value ?? '').trim();
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function toast(message, error = false) {
  planner?.toast?.(message, error);
}

function validCoordinates(item) {
  if (planner?.validMapCoordinates) return planner.validMapCoordinates(item);
  const lat = Number(item?.lat);
  const lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}

function isUploadedAddress(house) {
  if (!house) return false;
  if (house.bulkImported || house.bulkBatchId) return true;
  if (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.some(Boolean)) return true;
  const text = `${house.source || ''} ${house.classification || ''}`.toLowerCase();
  return text.includes('bulk address workset') ||
    text.includes('imported address workset') ||
    text.includes('prepared address list') ||
    text.includes('imported csv') ||
    text.includes('imported geojson') ||
    text.includes('uploaded address') ||
    clean(house.classification).toLowerCase() === 'imported';
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

function setButtonState(running, text = '') {
  const button = document.getElementById('addAssessorAddressesButton');
  if (!button) return;
  button.disabled = Boolean(running);
  button.textContent = text || (running ? 'Scanning Assessor / GIS…' : 'Add Assessor / GIS Addresses');
  button.setAttribute('aria-busy', running ? 'true' : 'false');
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

function hideProgress() {
  const wrap = document.getElementById('directAssessorProgress');
  if (wrap) wrap.hidden = true;
}

function placeAvoidAfterAssessor() {
  const assessor = document.getElementById('addressSourceMergeCard');
  const avoid = document.getElementById('avoidWorkflowCard');
  if (assessor && avoid && assessor.nextElementSibling !== avoid) assessor.insertAdjacentElement('afterend', avoid);
}

function injectControls() {
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return false;

  card.querySelector('#responsiveAssessorControls')?.remove();
  card.querySelector('[for="responsiveAssessorLimit"]')?.closest('.field')?.remove();

  const actions = card.querySelector('.address-source-actions');
  if (actions && !document.getElementById('directAssessorLimit')) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
      <label for="directAssessorLimit">Official records per pass</label>
      <select id="directAssessorLimit">
        <option value="50">50 — safest</option>
        <option value="100" selected>100 — recommended</option>
        <option value="250">250 — faster computer</option>
      </select>
      <small>Each click checks one small page of official records, adds any new addresses, and then stops. Select the button again to continue.</small>`;
    actions.insertBefore(field, actions.lastElementChild || null);
  }

  if (!document.getElementById('directAssessorControls')) {
    const controls = document.createElement('div');
    controls.id = 'directAssessorControls';
    controls.innerHTML = `
      <div id="directAssessorProgress" class="direct-assessor-progress" hidden>
        <div><span id="directAssessorProgressBar"></span></div>
        <small id="directAssessorProgressText">Preparing scan…</small>
      </div>
      <div class="direct-assessor-actions">
        <button id="directAssessorCancel" type="button" class="btn outline" hidden>Cancel Current Request</button>
        <button id="directAssessorRestart" type="button" class="btn outline">Restart Scan Position</button>
      </div>`;
    const message = messageElement();
    if (message) message.insertAdjacentElement('beforebegin', controls);
    else card.appendChild(controls);

    document.getElementById('directAssessorCancel')?.addEventListener('click', () => {
      cancelRequested = true;
      try { activeController?.abort(); } catch { /* no-op */ }
      setMessage('Canceling the current official GIS request…', 'working');
    });
    document.getElementById('directAssessorRestart')?.addEventListener('click', () => {
      const signature = currentSignature();
      if (signature) sessionStorage.removeItem(CURSOR_PREFIX + signature);
      setMessage('The assessor/GIS scan position was reset. The next click will begin at the first official record and skip addresses already loaded.', 'success');
      toast('Assessor/GIS scan position reset.');
    });
  }

  if (!document.getElementById('direct-assessor-styles')) {
    const style = document.createElement('style');
    style.id = 'direct-assessor-styles';
    style.textContent = `
      .direct-assessor-progress{margin:10px 0 5px}
      .direct-assessor-progress[hidden]{display:none!important}
      .direct-assessor-progress>div{height:10px;border-radius:99px;background:#dce7ef;overflow:hidden}
      .direct-assessor-progress span{display:block;height:100%;width:0;background:#16865e;transition:width .18s ease}
      .direct-assessor-progress small{display:block;margin-top:5px;font-size:8.5px;color:#556a7e}
      .direct-assessor-actions{display:flex;flex-wrap:wrap;gap:8px;margin:7px 0}
      #addAssessorAddressesButton[aria-busy="true"]{cursor:progress}
      @media(max-width:720px){.direct-assessor-actions{display:grid;grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  placeAvoidAfterAssessor();
  return true;
}

function sourceKeyForHall() {
  const selected = clean(document.getElementById('sourceSelect')?.value);
  if (selected && !['auto', 'manual'].includes(selected) && ASSESSOR_SOURCES[selected]) {
    // The Douglas County layer currently returns ArcGIS error 400
    // (Failed to execute query) for spatial-envelope requests. Use the
    // official statewide composite, which contains Douglas County addresses.
    return selected === 'douglas' ? 'colorado' : selected;
  }
  const hall = planner?.getSelectedHall?.();
  const inferred = hall?.id ? inferSourceForHall(hall.id) : '';
  if (inferred === 'douglas') return 'colorado';
  return ASSESSOR_SOURCES[inferred] ? inferred : 'colorado';
}

function pageSize() {
  const value = Number(document.getElementById('directAssessorLimit')?.value) || DEFAULT_PAGE_SIZE;
  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, value));
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

function currentSignature() {
  if (!planner) return '';
  const sourceKey = sourceKeyForHall();
  const bounds = geometryBounds(planner.getBoundaryGeometry?.());
  if (!bounds) return '';
  return [sourceKey, bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax]
    .map(value => typeof value === 'number' ? value.toFixed(5) : String(value ?? ''))
    .join('|');
}

function loadCursor(signature) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CURSOR_PREFIX + signature) || '{}');
    return {
      offset: Math.max(0, Number(parsed.offset) || 0),
      complete: Boolean(parsed.complete)
    };
  } catch {
    return { offset: 0, complete: false };
  }
}

function saveCursor(signature, cursor) {
  try { sessionStorage.setItem(CURSOR_PREFIX + signature, JSON.stringify(cursor)); }
  catch { /* session storage is optional */ }
}

function addressKey(record, includeUnits) {
  const address = includeUnits ? record?.address : (record?.baseAddress || record?.address);
  return normalizeAddressKey(address || '', includeUnits);
}

function buildAddressIndex(houses, includeUnits) {
  const index = new Set();
  houses.forEach(house => {
    const exact = addressKey(house, includeUnits);
    if (exact) index.add(exact);
    const alternate = normalizeAddressKey(house.address || '', includeUnits);
    if (alternate) index.add(alternate);
  });
  return index;
}

function jsonpRequest(endpoint, params) {
  return new Promise((resolve, reject) => {
    const callback = `__denverDirectAssessor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    window[callback] = payload => { cleanup(); resolve(payload); };
    script.onerror = () => { cleanup(); reject(new Error('The official GIS service could not be reached.')); };
    script.src = url.href;
    document.head.appendChild(script);
  });
}

async function requestPage(source, envelope, offset, count) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: Array.isArray(source.outFields) ? source.outFields.join(',') : '*',
    returnGeometry: String(Boolean(source.returnGeometry)),
    returnCentroid: String(Boolean(source.returnCentroid)),
    outSR: '4326',
    inSR: '4326',
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    geometry: JSON.stringify(envelope),
    resultOffset: String(offset),
    resultRecordCount: String(count),
    geometryPrecision: '6'
  });
  if (source.returnGeometry) params.set('maxAllowableOffset', '0.00008');

  activeController = new AbortController();
  const timeout = setTimeout(() => activeController?.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      const response = await fetch(source.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: params,
        signal: activeController.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
      return await response.json();
    } catch (postError) {
      if (cancelRequested || postError?.name === 'AbortError') throw postError;
      try {
        const url = new URL(source.endpoint);
        for (const [key, value] of params.entries()) url.searchParams.set(key, value);
        const response = await fetch(url.href, { signal: activeController.signal, cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
        return await response.json();
      } catch (getError) {
        if (cancelRequested || getError?.name === 'AbortError') throw getError;
        return await jsonpRequest(source.endpoint, params);
      }
    }
  } finally {
    clearTimeout(timeout);
    activeController = null;
  }
}

async function ensureBoundary() {
  let geometry = planner.getBoundaryGeometry?.();
  if (geometry) return geometry;

  const mapped = planner.getHouses().filter(validCoordinates);
  if (!mapped.length) throw new Error('Upload and map the prepared address file before adding official assessor/GIS addresses.');

  const uploaded = mapped.filter(isUploadedAddress);
  const padding = Math.max(0.02, Math.min(2, Number(document.getElementById('assessorBoundaryPadding')?.value) || 0.35));
  setMessage(`${uploaded.length ? uploaded.length.toLocaleString() + ' uploaded addresses' : mapped.length.toLocaleString() + ' mapped addresses'} found. Creating the editable Hall search boundary…`, 'working');
  updateProgress(8, 'Creating the editable Hall boundary…');
  await nextFrame();
  geometry = planner.createBoundaryAroundAddresses?.(padding);
  if (!geometry) throw new Error('The Hall search boundary could not be created. Use Area Setup to draw a boundary and try again.');
  await nextFrame();
  return geometry;
}

async function runDirectScan() {
  if (scanRunning) return;

  if (!planner?.isAdmin?.()) {
    setMessage('Administrator sign-in is required. The sign-in window has been opened; select Add Assessor / GIS Addresses again after signing in.', 'error');
    planner?.requireAdmin?.();
    return;
  }

  const hall = planner.getSelectedHall?.();
  const congregation = clean(planner.getSelectedCongregation?.());
  if (!hall || !congregation) {
    setMessage('Select the Kingdom Hall or meeting point and congregation before scanning official addresses.', 'error');
    return toast('Select the Kingdom Hall or meeting point and congregation first.', true);
  }

  scanRunning = true;
  cancelRequested = false;
  setButtonState(true, 'Starting Assessor / GIS Scan…');
  document.getElementById('directAssessorCancel')?.removeAttribute('hidden');
  setMessage('The scan button is working. Preparing one small official GIS request. Douglas County locations automatically use the Colorado statewide address composite because the county layer is currently rejecting map-envelope queries.', 'working');
  updateProgress(3, 'Preparing the official address request…');
  await nextFrame();

  let added = 0;
  let duplicates = 0;
  let outside = 0;
  let nonResidential = 0;
  let unusable = 0;

  try {
    const geometry = await ensureBoundary();
    const envelope = geometryBounds(geometry);
    if (!envelope) throw new Error('The Hall boundary has invalid coordinates. Edit or redraw it and try again.');

    const sourceKey = sourceKeyForHall();
    const source = ASSESSOR_SOURCES[sourceKey];
    if (!source?.endpoint) throw new Error('No official assessor/GIS source is available for this Hall.');

    const signature = currentSignature();
    const cursor = loadCursor(signature);
    if (cursor.complete) {
      setMessage(`The ${source.label} scan has already reached the end for this boundary. Select Restart Scan Position to check it again, or edit the boundary to search another area.`, 'success');
      return;
    }

    const count = pageSize();
    setButtonState(true, `Checking ${count} Official Records…`);
    updateProgress(18, `${source.label}: requesting records ${cursor.offset + 1}–${cursor.offset + count}…`);
    const payload = await requestPage(source, envelope, cursor.offset, count);
    if (payload?.error) throw new Error(payload.error.message || `${source.label} returned an error.`);

    const features = Array.isArray(payload?.features) ? payload.features : [];
    const houses = planner.getHouses();
    const includeUnits = Boolean(document.getElementById('separateUnits')?.checked);
    const residentialOnly = document.getElementById('residentialOnly')?.checked !== false;
    const addressIndex = buildAddressIndex(houses, includeUnits);

    updateProgress(44, `${features.length.toLocaleString()} official records received. Comparing them with the current map…`);
    await nextFrame();

    for (let index = 0; index < features.length; index += 1) {
      if (cancelRequested) throw new DOMException('Canceled', 'AbortError');
      const record = parseSourceFeature(sourceKey, features[index]);
      if (!record || !validCoordinates(record) || !clean(record.address)) { unusable += 1; continue; }
      if (!planner.pointInsideBoundary?.(record)) { outside += 1; continue; }
      if (residentialOnly && record.residential === false) { nonResidential += 1; continue; }
      const key = addressKey(record, includeUnits);
      if (!key || addressIndex.has(key)) { duplicates += 1; continue; }

      const newRecord = {
        ...record,
        id: String(record.id || planner.uniqueId('assessor')),
        supplemental: true,
        avoid: false,
        included: true,
        territoryId: null
      };
      if (planner.addHouseRecord?.(newRecord)) {
        addressIndex.add(key);
        added += 1;
      } else {
        duplicates += 1;
      }

      if (index > 0 && index % 20 === 0) {
        updateProgress(44 + ((index / Math.max(1, features.length)) * 38), `${index.toLocaleString()} of ${features.length.toLocaleString()} records compared • ${added.toLocaleString()} new`);
        await nextFrame();
      }
    }

    const collapsedDuplicates = Number(planner.dedupeHouses?.() || 0);
    duplicates += collapsedDuplicates;
    const nextOffset = cursor.offset + features.length;
    const complete = !features.length || features.length < count || payload?.exceededTransferLimit === false;
    saveCursor(signature, { offset: nextOffset, complete });

    if (added) {
      updateProgress(88, `Adding ${added.toLocaleString()} new gray address dots to the map…`);
      setMessage(`${added.toLocaleString()} new official address${added === 1 ? '' : 'es'} found. Updating the map…`, 'working');
      await nextFrame();
      planner.recalculateTerritoryHouseIds?.();
      planner.render?.();
      planner.refresh?.();
      await nextFrame();
    }

    updateProgress(100, complete ? 'Official scan reached the end of this boundary.' : `Pass complete through official record ${nextOffset.toLocaleString()}.`);
    const summary = `${added.toLocaleString()} new address${added === 1 ? '' : 'es'} added; ${duplicates.toLocaleString()} already loaded; ${outside.toLocaleString()} outside the editable boundary; ${nonResidential.toLocaleString()} nonresidential; ${unusable.toLocaleString()} unusable.`;
    setMessage(complete
      ? `${source.label} scan complete. ${summary}`
      : `${source.label} pass complete. ${summary} Select Add Assessor / GIS Addresses again to continue with the next ${count.toLocaleString()} official records.`, 'success');
    toast(added ? `${added.toLocaleString()} assessor/GIS addresses added.` : 'This pass completed; no new unique addresses were found.');
  } catch (error) {
    if (cancelRequested || error?.name === 'AbortError') {
      setMessage(`The current official GIS request was canceled.${added ? ` ${added.toLocaleString()} new address${added === 1 ? ' was' : 'es were'} retained.` : ''}`, 'warning');
      toast('Assessor/GIS request canceled.');
    } else {
      console.error('Direct assessor/GIS scan failed.', error);
      setMessage(`The official address scan stopped: ${error?.message || 'Unknown error'}`, 'error');
      toast(`Assessor/GIS scan stopped: ${error?.message || 'Unknown error'}`, true);
    }
  } finally {
    scanRunning = false;
    cancelRequested = false;
    activeController = null;
    setButtonState(false);
    const cancel = document.getElementById('directAssessorCancel');
    if (cancel) cancel.hidden = true;
    setTimeout(hideProgress, 1300);
  }
}


async function startDirectScan() {
  if (!planner) planner = globalThis.__denverTerritoryPlannerAPI || null;
  if (!planner) {
    setMessage('The Territory Planner is still starting. Wait a moment and select the button again.', 'error');
    return;
  }
  injectControls();
  placeAvoidAfterAssessor();
  wireButton();
  return runDirectScan();
}

function wireButton() {
  const current = document.getElementById('addAssessorAddressesButton');
  if (!current) return false;
  if (current.dataset.directScannerVersion === SCAN_VERSION) {
    if (!scanRunning) current.disabled = false;
    return true;
  }

  const button = current.cloneNode(true);
  current.replaceWith(button);
  button.id = 'addAssessorAddressesButton';
  button.type = 'button';
  button.classList.remove('admin-control');
  button.disabled = false;
  button.dataset.directScannerVersion = SCAN_VERSION;
  button.textContent = 'Add Assessor / GIS Addresses';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void startDirectScan();
  });

  buttonObserver?.disconnect();
  buttonObserver = new MutationObserver(() => {
    if (!scanRunning && button.disabled) button.disabled = false;
  });
  buttonObserver.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  return true;
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getHouses?.() && candidate?.getBoundaryGeometry?.() && candidate?.render) {
      planner = candidate;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!planner) return;

  for (let index = 0; index < 240; index += 1) {
    injectControls();
    placeAvoidAfterAssessor();
    if (wireButton()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  window.addEventListener('territory-planner:data', () => {
    injectControls();
    placeAvoidAfterAssessor();
    wireButton();
  });
  [150, 600, 1600, 3200].forEach(delay => setTimeout(() => {
    injectControls();
    placeAvoidAfterAssessor();
    wireButton();
  }, delay));

  setMessage('Ready. Select Add Assessor / GIS Addresses to check one small page of official addresses at a time.', 'waiting');
  console.info(`Denver 2027 direct assessor/GIS scanner loaded (${SCAN_VERSION}).`);
}


globalThis.__denverDirectAssessorScan = Object.freeze({ version: SCAN_VERSION, run: startDirectScan, inject: injectControls, wire: wireButton });
export { startDirectScan, runDirectScan, injectControls, wireButton };

initialize();

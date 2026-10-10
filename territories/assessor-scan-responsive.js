import {
  ASSESSOR_SOURCES,
  inferSourceForHall,
  parseSourceFeature,
  normalizeAddressKey,
  splitStreetSort
} from './data.js';

const SCAN_VERSION = 'territories-20261010-11';
const PAGE_SIZE = 250;
const DEFAULT_PASS_LIMIT = 250;
const MAX_PASS_LIMIT = 1000;
const MAX_PAGES_PER_TILE = 30;
const MAX_TILES = 36;

let planner = null;
let scanRunning = false;
let cancelRequested = false;
let activeController = null;
const scanCursors = new Map();

const clean = value => String(value ?? '').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function toast(message, error = false) {
  planner?.toast?.(message, error);
}
function validCoordinates(item) {
  if (planner?.validMapCoordinates) return planner.validMapCoordinates(item);
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}
function setMessage(message, state = 'waiting') {
  const element = document.getElementById('addressSourceMergeMessage');
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}
function setButtonState(running, text = '') {
  const button = document.getElementById('addAssessorAddressesButton');
  const cancel = document.getElementById('responsiveAssessorCancel');
  if (button) {
    button.disabled = running || !planner?.isAdmin?.();
    button.textContent = text || (running ? 'Scanning Assessor / GIS…' : 'Add Assessor / GIS Addresses');
  }
  if (cancel) cancel.hidden = !running;
}
function updateProgress(done, total, detail = '') {
  const wrap = document.getElementById('responsiveAssessorProgress');
  const bar = document.getElementById('responsiveAssessorProgressBar');
  const text = document.getElementById('responsiveAssessorProgressText');
  if (!wrap || !bar || !text) return;
  wrap.hidden = false;
  const percent = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  bar.style.width = `${percent}%`;
  text.textContent = detail || `${done.toLocaleString()} of ${total.toLocaleString()}`;
}
function hideProgress() {
  const wrap = document.getElementById('responsiveAssessorProgress');
  if (wrap) wrap.hidden = true;
}

function injectResponsiveControls() {
  const card = document.getElementById('addressSourceMergeCard');
  if (!card || document.getElementById('responsiveAssessorControls')) return false;
  const actions = card.querySelector('.address-source-actions');
  if (actions) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label for="responsiveAssessorLimit">New addresses per pass</label><select id="responsiveAssessorLimit"><option value="100">100 — safest</option><option value="250" selected>250 — recommended</option><option value="500">500</option><option value="1000">1,000 — faster computer</option></select><small>The scan pauses after this many new homes so Chrome stays responsive. Select the scan button again to continue.</small>`;
    actions.insertBefore(field, actions.lastElementChild || null);
  }
  const controls = document.createElement('div');
  controls.id = 'responsiveAssessorControls';
  controls.innerHTML = `
    <div id="responsiveAssessorProgress" class="responsive-assessor-progress" hidden>
      <div><span id="responsiveAssessorProgressBar"></span></div>
      <small id="responsiveAssessorProgressText">Preparing scan…</small>
    </div>
    <button id="responsiveAssessorCancel" type="button" class="btn outline" hidden>Cancel Scan</button>`;
  const message = document.getElementById('addressSourceMergeMessage');
  if (message) message.insertAdjacentElement('beforebegin', controls);
  else card.appendChild(controls);
  const style = document.createElement('style');
  style.id = 'responsive-assessor-scan-styles';
  style.textContent = `
    .responsive-assessor-progress{margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
    .responsive-assessor-progress[hidden]{display:none!important}
    .responsive-assessor-progress>div{height:10px;border-radius:99px;background:#dce7ef;overflow:hidden;grid-column:1/-1}
    .responsive-assessor-progress span{display:block;height:100%;width:0;background:#16865e;transition:width .18s ease}
    .responsive-assessor-progress small{font-size:8.5px;color:#556a7e}
    #responsiveAssessorCancel{margin:7px 0 3px}
  `;
  document.head.appendChild(style);
  document.getElementById('responsiveAssessorCancel')?.addEventListener('click', () => {
    cancelRequested = true;
    try { activeController?.abort(); } catch { /* no-op */ }
    setMessage('Canceling after the current GIS request…', 'working');
  });
  return true;
}

function geometryObject(value) {
  return value?.type === 'Feature' ? value.geometry : value;
}
function collectCoordinatePairs(node, output = []) {
  if (!Array.isArray(node)) return output;
  if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
    output.push([Number(node[0]), Number(node[1])]);
    return output;
  }
  node.forEach(child => collectCoordinatePairs(child, output));
  return output;
}
function geometryBounds(value) {
  const geometry = geometryObject(value);
  const pairs = collectCoordinatePairs(geometry?.coordinates, []);
  if (!pairs.length) return null;
  return {
    xmin: Math.min(...pairs.map(point => point[0])),
    ymin: Math.min(...pairs.map(point => point[1])),
    xmax: Math.max(...pairs.map(point => point[0])),
    ymax: Math.max(...pairs.map(point => point[1]))
  };
}
function pointOnSegment(lng, lat, a, b) {
  const ax = Number(a?.[0]), ay = Number(a?.[1]), bx = Number(b?.[0]), by = Number(b?.[1]);
  if (![ax, ay, bx, by, lng, lat].every(Number.isFinite)) return false;
  const cross = ((lng - ax) * (by - ay)) - ((lat - ay) * (bx - ax));
  const tolerance = 1e-10 * Math.max(1, Math.abs(bx - ax) + Math.abs(by - ay));
  if (Math.abs(cross) > tolerance) return false;
  const dot = ((lng - ax) * (bx - ax)) + ((lat - ay) * (by - ay));
  const length = ((bx - ax) ** 2) + ((by - ay) ** 2);
  return dot >= -tolerance && dot <= length + tolerance;
}
function pointInRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if (pointOnSegment(lng, lat, a, b)) return true;
    const xi = Number(a?.[0]), yi = Number(a?.[1]), xj = Number(b?.[0]), yj = Number(b?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < (((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lng, lat, coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length || !pointInRing(lng, lat, coordinates[0])) return false;
  for (let index = 1; index < coordinates.length; index += 1) if (pointInRing(lng, lat, coordinates[index])) return false;
  return true;
}
function pointInsideGeometry(item, geometry, bounds) {
  const lat = Number(item?.lat), lng = Number(item?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !geometry || !bounds) return false;
  if (lng < bounds.xmin || lng > bounds.xmax || lat < bounds.ymin || lat > bounds.ymax) return false;
  const shape = geometryObject(geometry);
  if (shape.type === 'Polygon') return pointInPolygon(lng, lat, shape.coordinates);
  if (shape.type === 'MultiPolygon') return (shape.coordinates || []).some(polygon => pointInPolygon(lng, lat, polygon));
  return false;
}
function makeEnvelopes(bounds, source) {
  const width = Math.max(0, bounds.xmax - bounds.xmin);
  const height = Math.max(0, bounds.ymax - bounds.ymin);
  const preferredSpan = source?.key === 'colorado' ? 0.018 : 0.022;
  let columns = Math.max(1, Math.ceil(width / preferredSpan));
  let rows = Math.max(1, Math.ceil(height / preferredSpan));
  if (columns * rows > MAX_TILES) {
    const scale = Math.sqrt((columns * rows) / MAX_TILES);
    columns = Math.max(1, Math.floor(columns / scale));
    rows = Math.max(1, Math.floor(rows / scale));
    while (columns * rows > MAX_TILES) {
      if (columns >= rows) columns -= 1;
      else rows -= 1;
    }
  }
  const cellWidth = width / columns || preferredSpan;
  const cellHeight = height / rows || preferredSpan;
  const result = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result.push({
        xmin: bounds.xmin + (column * cellWidth),
        ymin: bounds.ymin + (row * cellHeight),
        xmax: column === columns - 1 ? bounds.xmax : bounds.xmin + ((column + 1) * cellWidth),
        ymax: row === rows - 1 ? bounds.ymax : bounds.ymin + ((row + 1) * cellHeight),
        spatialReference: { wkid: 4326 }
      });
    }
  }
  return result;
}
function boundarySignature(sourceKey, geometry, envelopes) {
  const bounds = geometryBounds(geometry);
  return [sourceKey, bounds?.xmin, bounds?.ymin, bounds?.xmax, bounds?.ymax, envelopes.length]
    .map(value => typeof value === 'number' ? value.toFixed(5) : String(value ?? ''))
    .join('|');
}

function arcGisJsonp(endpoint, params, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const callback = `__responsiveAssessor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    const timer = setTimeout(() => { cleanup(); reject(new Error('The assessor/GIS request timed out.')); }, timeoutMs);
    window[callback] = payload => { cleanup(); resolve(payload); };
    script.onerror = () => { cleanup(); reject(new Error('The assessor/GIS service could not be reached.')); };
    script.src = url.href;
    document.head.appendChild(script);
  });
}
async function requestPage(source, envelope, offset, forceGeometry = false) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: source.outFields.join(','),
    returnGeometry: String(forceGeometry || source.returnGeometry),
    returnCentroid: String(Boolean(source.returnCentroid)),
    outSR: '4326',
    inSR: '4326',
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    geometry: JSON.stringify(envelope),
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    geometryPrecision: '6'
  });
  if (forceGeometry || source.returnGeometry) params.set('maxAllowableOffset', '0.00008');
  activeController = new AbortController();
  try {
    const response = await fetch(source.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
      body: params,
      signal: activeController.signal
    });
    if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
    return await response.json();
  } catch (postError) {
    if (cancelRequested || postError?.name === 'AbortError') throw postError;
    try {
      const url = new URL(source.endpoint);
      for (const [key, value] of params.entries()) url.searchParams.set(key, value);
      activeController = new AbortController();
      const response = await fetch(url.href, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: activeController.signal });
      if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
      return await response.json();
    } catch (getError) {
      if (cancelRequested || getError?.name === 'AbortError') throw getError;
      return await arcGisJsonp(source.endpoint, params);
    }
  } finally {
    activeController = null;
  }
}

function addressKey(record, includeUnits) {
  return normalizeAddressKey(includeUnits ? record.address : (record.baseAddress || record.address), includeUnits);
}
function streetKey(record) {
  const parsed = splitStreetSort(record.address || record.baseAddress || '');
  return parsed?.number && parsed?.street ? `${parsed.number}|${parsed.street}` : '';
}
function distanceMiles(a, b) {
  const latA = Number(a?.lat), lngA = Number(a?.lng), latB = Number(b?.lat), lngB = Number(b?.lng);
  if (![latA, lngA, latB, lngB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const meanLat = ((latA + latB) / 2) * Math.PI / 180;
  const dx = (lngA - lngB) * 69 * Math.cos(meanLat);
  const dy = (latA - latB) * 69;
  return Math.hypot(dx, dy);
}
function buildIndexes(houses, includeUnits) {
  const exact = new Map();
  const street = new Map();
  for (const house of houses) {
    const exactKey = addressKey(house, includeUnits);
    if (exactKey && !exact.has(exactKey)) exact.set(exactKey, house);
    const sKey = streetKey(house);
    if (!sKey) continue;
    if (!street.has(sKey)) street.set(sKey, []);
    street.get(sKey).push(house);
  }
  return { exact, street };
}
function isDuplicate(record, indexes, includeUnits) {
  const exactKey = addressKey(record, includeUnits);
  if (exactKey && indexes.exact.has(exactKey)) return true;
  const sKey = streetKey(record);
  if (!sKey) return false;
  return (indexes.street.get(sKey) || []).some(existing => distanceMiles(existing, record) <= 0.12);
}
function indexRecord(record, indexes, includeUnits) {
  const exactKey = addressKey(record, includeUnits);
  if (exactKey && !indexes.exact.has(exactKey)) indexes.exact.set(exactKey, record);
  const sKey = streetKey(record);
  if (!sKey) return;
  if (!indexes.street.has(sKey)) indexes.street.set(sKey, []);
  indexes.street.get(sKey).push(record);
}
function featureKey(feature) {
  const attributes = feature?.attributes || feature?.properties || {};
  const objectId = attributes.OBJECTID ?? attributes.FID ?? attributes.ADDRESS_ID ?? attributes.SCHEDNUM ?? attributes.SAUID;
  if (objectId !== undefined && objectId !== null && objectId !== '') return String(objectId);
  const geometry = feature?.geometry || feature?.centroid || {};
  return JSON.stringify([attributes.AddrFull, attributes.ADDRESS, attributes.SITUS_ADDRESS_LINE1, geometry.x, geometry.y]);
}
function sourceKeyForHall() {
  const sourceSelect = document.getElementById('sourceSelect');
  if (sourceSelect?.value && !['auto', 'manual'].includes(sourceSelect.value) && ASSESSOR_SOURCES[sourceSelect.value]) return sourceSelect.value;
  const hall = planner?.getSelectedHall?.();
  const inferred = inferSourceForHall(hall?.id);
  return ASSESSOR_SOURCES[inferred] ? inferred : 'colorado';
}
function passLimit() {
  const value = Number(document.getElementById('responsiveAssessorLimit')?.value) || DEFAULT_PASS_LIMIT;
  return Math.max(100, Math.min(MAX_PASS_LIMIT, value));
}

async function runResponsiveScan() {
  if (scanRunning || !planner?.requireAdmin?.()) return;
  const hall = planner.getSelectedHall?.();
  const congregation = clean(planner.getSelectedCongregation?.());
  if (!hall || !congregation) return toast('Select the Kingdom Hall and congregation before adding assessor/GIS addresses.', true);
  const uploaded = planner.getHouses().filter(house => (house.bulkImported || house.bulkBatchId || (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.length)) && validCoordinates(house));
  if (!uploaded.length) return toast('Upload and map the prepared address file first.', true);

  if (!planner.getBoundaryGeometry?.()) {
    const padding = Math.max(0.02, Math.min(2, Number(document.getElementById('assessorBoundaryPadding')?.value) || 0.35));
    setMessage(`Creating an editable Hall boundary with ${padding.toFixed(2)} mile padding around the uploaded address set…`, 'working');
    const geometry = planner.createBoundaryAroundAddresses?.(padding);
    if (!geometry) return;
    await nextFrame();
  }

  const geometry = planner.getBoundaryGeometry?.();
  const bounds = geometryBounds(geometry);
  if (!geometry || !bounds) return toast('The editable Hall boundary is missing or invalid.', true);
  const sourceKey = sourceKeyForHall();
  const source = ASSESSOR_SOURCES[sourceKey];
  if (!source) return toast('No official assessor/GIS connector is available for this Hall.', true);

  const envelopes = makeEnvelopes(bounds, source);
  const signature = boundarySignature(sourceKey, geometry, envelopes);
  const cursor = scanCursors.get(signature) || { tileIndex: 0, offset: 0, page: 0, complete: false };
  if (cursor.complete) {
    cursor.tileIndex = 0;
    cursor.offset = 0;
    cursor.page = 0;
    cursor.complete = false;
  }

  const houses = planner.getHouses();
  const includeUnits = Boolean(document.getElementById('separateUnits')?.checked);
  const residentialOnly = document.getElementById('residentialOnly')?.checked !== false;
  const indexes = buildIndexes(houses, includeUnits);
  const seenFeatures = new Set();
  const limit = passLimit();
  let added = 0;
  let duplicates = 0;
  let outside = 0;
  let nonResidential = 0;
  let scanned = 0;
  let stoppedAtLimit = false;

  scanRunning = true;
  cancelRequested = false;
  setButtonState(true, `Scanning ${source.label}…`);
  setMessage(`Scanning ${source.label} in small batches. The page will remain usable, and this pass will pause after approximately ${limit.toLocaleString()} new addresses.`, 'working');
  updateProgress(cursor.tileIndex, envelopes.length, `Area ${Math.min(cursor.tileIndex + 1, envelopes.length)} of ${envelopes.length}`);

  try {
    for (let tileIndex = cursor.tileIndex; tileIndex < envelopes.length; tileIndex += 1) {
      let offset = tileIndex === cursor.tileIndex ? cursor.offset : 0;
      let page = tileIndex === cursor.tileIndex ? cursor.page : 0;
      const envelope = envelopes[tileIndex];
      for (; page < MAX_PAGES_PER_TILE; page += 1) {
        if (cancelRequested) throw new DOMException('Canceled', 'AbortError');
        updateProgress(tileIndex, envelopes.length, `Area ${tileIndex + 1} of ${envelopes.length} • ${added.toLocaleString()} new • ${scanned.toLocaleString()} checked`);
        let payload = await requestPage(source, envelope, offset, false);
        if (payload?.error) throw new Error(payload.error.message || `${source.label} returned an error.`);
        let features = Array.isArray(payload?.features) ? payload.features : [];
        let parsed = features.map(feature => parseSourceFeature(sourceKey, feature)).filter(Boolean);
        if (sourceKey === 'denver' && features.length && !parsed.length) {
          payload = await requestPage(source, envelope, offset, true);
          if (payload?.error) throw new Error(payload.error.message || `${source.label} returned an error.`);
          features = Array.isArray(payload?.features) ? payload.features : [];
          parsed = features.map(feature => parseSourceFeature(sourceKey, feature)).filter(Boolean);
        }

        scanned += features.length;
        for (let index = 0; index < parsed.length; index += 1) {
          const record = parsed[index];
          const rawFeature = features[index];
          const rawKey = rawFeature ? featureKey(rawFeature) : '';
          if (rawKey && seenFeatures.has(rawKey)) continue;
          if (rawKey) seenFeatures.add(rawKey);
          if (!validCoordinates(record) || !clean(record.address)) continue;
          if (!pointInsideGeometry(record, geometry, bounds)) { outside += 1; continue; }
          if (residentialOnly && record.residential === false) { nonResidential += 1; continue; }
          if (isDuplicate(record, indexes, includeUnits)) { duplicates += 1; continue; }
          const addedRecord = {
            ...record,
            id: String(record.id || planner.uniqueId('assessor')),
            supplemental: true,
            avoid: false,
            included: true,
            territoryId: null
          };
          houses.push(addedRecord);
          indexRecord(addedRecord, indexes, includeUnits);
          added += 1;
          if (index % 40 === 0) await nextFrame();
        }

        offset += features.length;
        const exceeded = Boolean(payload?.exceededTransferLimit);
        cursor.tileIndex = tileIndex;
        cursor.offset = offset;
        cursor.page = page + 1;
        scanCursors.set(signature, cursor);
        await nextFrame();

        if (added >= limit) {
          stoppedAtLimit = true;
          break;
        }
        if (!exceeded || !features.length) {
          cursor.tileIndex = tileIndex + 1;
          cursor.offset = 0;
          cursor.page = 0;
          scanCursors.set(signature, cursor);
          break;
        }
      }
      if (stoppedAtLimit) break;
      cursor.tileIndex = tileIndex + 1;
      cursor.offset = 0;
      cursor.page = 0;
      scanCursors.set(signature, cursor);
      await nextFrame();
    }

    if (!stoppedAtLimit && cursor.tileIndex >= envelopes.length) {
      cursor.complete = true;
      scanCursors.set(signature, cursor);
    }

    if (added) {
      planner.recalculateTerritoryHouseIds?.();
      setMessage(`Preparing ${added.toLocaleString()} new map points…`, 'working');
      await nextFrame();
      planner.render?.();
      planner.refresh?.();
      await nextFrame();
    }

    if (cancelRequested) {
      setMessage(`Scan canceled. ${added.toLocaleString()} new address${added === 1 ? '' : 'es'} added before cancellation; existing work was preserved.`, 'warning');
      toast('Assessor/GIS scan canceled. Addresses already added remain available.');
    } else if (stoppedAtLimit) {
      setMessage(`${added.toLocaleString()} new assessor/GIS address${added === 1 ? '' : 'es'} added in this responsive pass. ${duplicates.toLocaleString()} existing addresses were skipped. Select Add Assessor / GIS Addresses again to continue from the next records.`, 'success');
      toast(`${added.toLocaleString()} assessor/GIS addresses added. Run the scan again to continue without freezing Chrome.`);
    } else {
      setMessage(`${source.label} scan complete. ${added.toLocaleString()} new address${added === 1 ? '' : 'es'} added; ${duplicates.toLocaleString()} existing addresses skipped; ${outside.toLocaleString()} outside the boundary; ${nonResidential.toLocaleString()} nonresidential records skipped.`, 'success');
      toast(`${source.label} scan complete with ${added.toLocaleString()} new addresses.`);
    }
  } catch (error) {
    if (cancelRequested || error?.name === 'AbortError') {
      if (added) {
        planner.recalculateTerritoryHouseIds?.();
        planner.render?.();
        planner.refresh?.();
      }
      setMessage(`Scan canceled. ${added.toLocaleString()} new address${added === 1 ? '' : 'es'} added before cancellation.`, 'warning');
    } else {
      console.error('Responsive assessor/GIS scan failed.', error);
      setMessage(`The responsive assessor/GIS scan stopped: ${error?.message || 'Unknown error'}. Addresses already added remain on the map.`, 'error');
      toast(`Assessor/GIS scan stopped: ${error?.message || 'Unknown error'}`, true);
    }
  } finally {
    scanRunning = false;
    cancelRequested = false;
    activeController = null;
    setButtonState(false);
    hideProgress();
  }
}

function interceptScan(event) {
  const button = event.target.closest?.('#addAssessorAddressesButton');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  runResponsiveScan();
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getHouses?.() && candidate?.getBoundaryGeometry?.() && candidate?.render) {
      planner = candidate;
      break;
    }
    await sleep(50);
  }
  if (!planner) return;
  for (let index = 0; index < 180; index += 1) {
    if (injectResponsiveControls()) break;
    await sleep(50);
  }
  document.addEventListener('click', interceptScan, true);
  console.info(`Denver 2027 responsive assessor/GIS scanner loaded (${SCAN_VERSION}).`);
}

initialize();

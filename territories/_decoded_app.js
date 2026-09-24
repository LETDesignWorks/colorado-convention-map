import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS } from '../bus-access/data.js';
import {
  CCC, TERRITORY_COLORS, ASSESSOR_SOURCES, inferSourceForHall,
  parseSourceFeature, normalizeAddressKey, splitStreetSort
} from './data.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',
  authDomain: 'convention-fs.firebaseapp.com',
  projectId: 'convention-fs',
  storageBucket: 'convention-fs.firebasestorage.app',
  messagingSenderId: '29365992209',
  appId: '1:29365992209:web:0bd35e723688b37d776ab0',
  measurementId: 'G-054BLBBE0F'
};
const ADMIN_EMAIL = 'michaeltarin@hotmail.com';
const MAX_ADDRESS_RECORDS = 6000;
const FIRESTORE_HOUSE_CHUNK_SIZE = 350;
const HOUSE_LIST_LIMIT = 350;

let app;
let auth;
let db;
let currentUser = null;
let map;
let canvasRenderer;
let boundaryGroup;
let territoryGroup;
let houseGroup;
let hallGroup;
let selectionLayer = null;
let drawMode = null;
let manualHouseMode = false;
let hallLocations = [];
let selectedHall = null;
let selectedCongregation = '';
let boundaryGeometry = null;
let houses = [];
let territories = [];
let selectedHouseIds = new Set();
let currentBoundaryId = null;
let currentPlanId = null;
let reviewRecords = new Map();
let reviewsUnsubscribe = null;
let publicHallRecords = new Map();
const hallMarkers = new Map();
const houseMarkers = new Map();
const territoryLayers = new Map();

const els = Object.fromEntries([
  'loginButton','signOutButton','planStatusChip','summaryHall','summaryCongregation','summaryHouses','summaryTerritories',
  'privacyCard','hallSelect','hallDetail','congregationSelect','planName','territoryPrefix','boundaryChip','drawBoundaryButton',
  'editBoundaryButton','viewBoundaryButton','clearBoundaryButton','boundaryName','saveBoundaryButton','boundaryMessage',
  'houseCountChip','sourceSelect','sourceDetail','residentialOnly','separateUnits','loadAddressesButton','addHouseButton',
  'importFile','clearHousesButton','addressProgress','addressMessage','territoryCountChip','targetSize','customTargetWrap',
  'customTarget','groupingMethod','autoGroupButton','selectAreaButton','clearSelectionButton','excludeSelectionButton',
  'selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryList','houseSearch','houseList',
  'savePlanButton','exportGeoJsonButton','exportCsvButton','newPlanButton','savedBoundaries','savedPlans','loginModal',
  'loginForm','loginEmail','loginPassword','cancelLogin','resetPassword','toast'
].map(id => [id, document.getElementById(id)]));

function clean(value = '') { return String(value ?? '').trim(); }
function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}
function slug(value = '') {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
function isAdmin() { return currentUser?.email?.toLowerCase() === ADMIN_EMAIL; }
function uniqueId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => { els.toast.className = 'toast'; }, 4200);
}
function friendlyError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'The email or password is not correct.';
  if (code.includes('permission-denied')) return 'Firebase denied this action. Confirm the administrator sign-in and Firestore rules.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'The network or data service is temporarily unavailable.';
  if (code.includes('unauthorized-domain')) return 'Add letdesignworks.github.io under Firebase Authentication authorized domains.';
  return error?.message?.replace(/^Firebase:\s*/i, '') || 'Unknown error';
}
function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function pointFeature(item) { return turf.point([Number(item.lng), Number(item.lat)]); }
function boundaryFeature() { return boundaryGeometry ? turf.feature(boundaryGeometry) : null; }
function pointInsideBoundary(item) {
  if (!boundaryGeometry) return true;
  try { return turf.booleanPointInPolygon(pointFeature(item), boundaryFeature()); }
  catch { return false; }
}
function distanceMiles(a, b) {
  try { return turf.distance(pointFeature(a), pointFeature(b), { units: 'miles' }); }
  catch { return Number.POSITIVE_INFINITY; }
}
function markerLabel(location) { return clean(location.markerLabel || location.number || 'M'); }
function locationTypeLabel(location) { return location.locationType === 'meeting-area' ? 'Meeting area' : 'Kingdom Hall'; }
function initialPrefix(name) {
  const ignored = new Set(['THE','OF','AND','SPANISH','ENGLISH','CONGREGATION','DENVER','COLORADO','CO','USA']);
  const words = clean(name).replace(/\([^)]*\)/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).filter(word => !ignored.has(word.toUpperCase()));
  const prefix = words.slice(0, 3).map(word => word[0].toUpperCase()).join('');
  return prefix || 'T';
}
function targetSizeValue() {
  if (els.targetSize.value === 'custom') return Math.max(1, Math.min(200, Number(els.customTarget.value) || 25));
  return Math.max(1, Number(els.targetSize.value) || 30);
}
function currentSourceKey() {
  if (els.sourceSelect.value !== 'auto') return els.sourceSelect.value;
  return inferSourceForLocation(selectedHall);
}
function inferSourceForLocation(location) {
  if (!location) return 'manual';
  const explicit = inferSourceForHall(location.id);
  if (explicit !== 'manual') return explicit;
  const text = `${location.name || ''} ${location.address || ''}`.toUpperCase();
  if (/(HIGHLANDS RANCH|CASTLE ROCK|PARKER|LONE TREE|DOUGLAS)/.test(text)) return 'douglas';
  if (/(GOLDEN|WHEAT RIDGE|MORRISON|ARVADA|JEFFERSON)/.test(text)) return 'jefferson';
  if (/\bDENVER\b/.test(text)) return 'denver';
  return 'manual';
}

function normalizeCustomHall(id, data) {
  const lat = Number(data.lat), lng = Number(data.lng);
  if (data.customLocation !== true || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (data.recordType) return null;
  return {
    id: String(id),
    number: clean(data.markerLabel || data.number || 'M'),
    markerLabel: clean(data.markerLabel || data.number || 'M'),
    name: clean(data.name || 'Added meeting point'),
    address: clean(data.address || ''),
    lat, lng,
    congregationCount: Array.isArray(data.congregations) ? data.congregations.length : 0,
    congregations: Array.isArray(data.congregations) ? data.congregations.map(clean).filter(Boolean) : [],
    locationType: data.locationType === 'meeting-area' ? 'meeting-area' : 'kingdom-hall',
    customLocation: true,
    planningArea: data.planningArea || 'other'
  };
}
function rebuildHallLocations() {
  const base = HALLS.map(hall => ({ ...hall, id: String(hall.id), markerLabel: String(hall.number), locationType: 'kingdom-hall', customLocation: false }));
  const custom = [];
  for (const [id, data] of publicHallRecords.entries()) {
    const location = normalizeCustomHall(id, data);
    if (location) custom.push(location);
  }
  custom.sort((a, b) => markerLabel(a).localeCompare(markerLabel(b), undefined, { numeric: true }));
  hallLocations = [...base, ...custom];
  populateHallSelector();
  renderHallMarkers();
  const requested = new URLSearchParams(location.search).get('hall');
  const nextId = selectedHall?.id && hallLocations.some(h => h.id === selectedHall.id)
    ? selectedHall.id
    : requested && hallLocations.some(h => h.id === requested)
      ? requested
      : hallLocations[0]?.id;
  if (nextId) selectHall(nextId, false, false);
}
function populateHallSelector() {
  const previous = selectedHall?.id || els.hallSelect.value;
  const base = hallLocations.filter(item => !item.customLocation);
  const custom = hallLocations.filter(item => item.customLocation);
  els.hallSelect.innerHTML =
    `<optgroup label="Current 45-minute planning Hall list">${base.map(hall => `<option value="${escapeHtml(hall.id)}">${escapeHtml(markerLabel(hall))} — ${escapeHtml(hall.name)}</option>`).join('')}</optgroup>` +
    (custom.length ? `<optgroup label="Administrator-added locations">${custom.map(hall => `<option value="${escapeHtml(hall.id)}">${escapeHtml(markerLabel(hall))} — ${escapeHtml(hall.name)}</option>`).join('')}</optgroup>` : '');
  if (previous && hallLocations.some(item => item.id === previous)) els.hallSelect.value = previous;
}
function populateCongregations(preferred = '') {
  const congregations = selectedHall?.congregations?.length ? selectedHall.congregations : [selectedHall?.name || 'Planning group'];
  els.congregationSelect.innerHTML = congregations.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  selectedCongregation = congregations.includes(preferred) ? preferred : congregations[0] || '';
  els.congregationSelect.value = selectedCongregation;
  if (!clean(els.planName.value)) els.planName.placeholder = `${selectedCongregation} — Convention Ministry Territories`;
  if (!clean(els.boundaryName.value)) els.boundaryName.placeholder = `${selectedCongregation} service area`;
  if (!clean(els.territoryPrefix.value)) els.territoryPrefix.value = initialPrefix(selectedCongregation);
}
function selectHall(id, pan = true, preserveWork = false) {
  const hall = hallLocations.find(item => item.id === String(id));
  if (!hall) return;
  if (!preserveWork && selectedHall && selectedHall.id !== hall.id && (houses.length || territories.length || boundaryGeometry)) {
    if (!confirm('Changing the Hall will clear the current unsaved boundary and territory work. Continue?')) {
      els.hallSelect.value = selectedHall.id;
      return;
    }
    clearPlanWorkspace(false);
  }
  selectedHall = hall;
  els.hallSelect.value = hall.id;
  els.hallDetail.textContent = `${locationTypeLabel(hall)} • ${hall.address || 'Saved map location'} • approximately ${distanceMiles({ lat: CCC[0], lng: CCC[1] }, hall).toFixed(1)} straight-line miles from the Convention Center`;
  populateCongregations(selectedCongregation);
  const source = inferSourceForLocation(hall);
  updateSourceDetail(source);
  if (pan && map) map.setView([hall.lat, hall.lng], Math.max(map.getZoom(), 12), { animate: true });
  renderHallMarkers();
  updateSummary();
}

function hallIcon(location, selected = false) {
  return L.divIcon({
    className: '',
    html: `<div class="hall-pin${selected ? ' selected' : ''}">${escapeHtml(markerLabel(location))}</div>`,
    iconSize: [40, 40], iconAnchor: [20, 20]
  });
}
function initMap() {
  canvasRenderer = L.canvas({ padding: 0.45 });
  map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([39.68, -104.96], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  boundaryGroup = L.featureGroup().addTo(map);
  territoryGroup = L.featureGroup().addTo(map);
  houseGroup = L.featureGroup().addTo(map);
  hallGroup = L.featureGroup().addTo(map);
  L.marker(CCC, {
    icon: L.divIcon({ className: '', html: '<div class="ccc-star">★</div>', iconSize: [38, 38], iconAnchor: [19, 19] })
  }).addTo(map).bindPopup('<strong>Colorado Convention Center</strong><br>Convention planning center point');

  map.on(L.Draw.Event.CREATED, event => {
    if (drawMode === 'boundary') {
      setBoundaryGeometry(event.layer.toGeoJSON().geometry, false);
      toast('Congregation boundary drawn. Review it, then save the boundary.');
    } else if (drawMode === 'selection') {
      selectHousesWithin(event.layer.toGeoJSON());
      if (selectionLayer) map.removeLayer(selectionLayer);
      selectionLayer = event.layer.setStyle({ color: '#d99800', weight: 2, dashArray: '6 5', fillColor: '#ffd34f', fillOpacity: .08 }).addTo(map);
    }
    drawMode = null;
  });
  map.on(L.Draw.Event.EDITED, () => {
    const layer = boundaryGroup.getLayers()[0];
    if (layer) {
      boundaryGeometry = layer.toGeoJSON().geometry;
      clearAddressesAndTerritoriesForBoundaryChange();
      updateBoundaryUi();
      toast('Boundary updated. Reload addresses for the revised area.');
    }
  });
  map.on('click', event => {
    if (!manualHouseMode || drawMode) return;
    manualHouseMode = false;
    els.addHouseButton.textContent = 'Add House by Map Click';
    const candidate = { lat: event.latlng.lat, lng: event.latlng.lng };
    if (boundaryGeometry && !pointInsideBoundary(candidate)) {
      toast('That point is outside the congregation boundary.', true);
      return;
    }
    const address = prompt('Enter the house or ministry-stop address:');
    if (address === null) return;
    addHouseRecord({
      id: uniqueId('manual'), address: clean(address) || 'Manual map point', baseAddress: clean(address) || 'Manual map point',
      unit: '', lat: candidate.lat, lng: candidate.lng, source: 'Manual map point', residential: true,
      classification: 'Manual', included: true, territoryId: null
    });
    renderAllPlanningData();
    toast('Manual address point added.');
  });
}
function renderHallMarkers() {
  if (!map || !hallGroup) return;
  hallGroup.clearLayers();
  hallMarkers.clear();
  for (const location of hallLocations) {
    const marker = L.marker([location.lat, location.lng], { icon: hallIcon(location, location.id === selectedHall?.id) }).addTo(hallGroup);
    marker.bindPopup(`<strong>${escapeHtml(markerLabel(location))} — ${escapeHtml(location.name)}</strong><br>${escapeHtml(location.address || 'Saved map location')}<br><small>${escapeHtml((location.congregations || []).join(' • '))}</small>`);
    marker.on('click', () => selectHall(location.id, false, false));
    hallMarkers.set(location.id, marker);
  }
}

function drawBoundary() {
  if (!requireAdmin()) return;
  drawMode = 'boundary';
  const drawer = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 }
  });
  drawer.enable();
  toast('Tap around the outside of the congregation service area. Tap the first point to finish.');
}
function editBoundary() {
  if (!requireAdmin()) return;
  if (!boundaryGroup.getLayers().length) { toast('Draw or load a boundary first.', true); return; }
  new L.EditToolbar.Edit(map, { featureGroup: boundaryGroup }).enable();
  toast('Move the boundary handles, then use the map edit toolbar to save the changes.');
}
function useCurrentViewBoundary() {
  if (!requireAdmin()) return;
  const bounds = map.getBounds();
  const geometry = L.rectangle(bounds).toGeoJSON().geometry;
  setBoundaryGeometry(geometry, false);
  toast('The current map view is now the congregation boundary. Adjust it if needed.');
}
function setBoundaryGeometry(geometry, fit = true) {
  if (!geometry) return;
  boundaryGeometry = JSON.parse(JSON.stringify(geometry));
  boundaryGroup.clearLayers();
  const layer = L.geoJSON(boundaryGeometry, {
    style: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 }
  }).addTo(boundaryGroup);
  clearAddressesAndTerritoriesForBoundaryChange();
  if (fit && layer.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 15 });
  updateBoundaryUi();
}
function clearBoundary(ask = true) {
  if (!requireAdmin()) return;
  if (ask && boundaryGeometry && !confirm('Clear the congregation boundary and all unsaved address and territory work?')) return;
  boundaryGeometry = null;
  currentBoundaryId = null;
  boundaryGroup.clearLayers();
  clearAddressesAndTerritoriesForBoundaryChange();
  updateBoundaryUi();
}
function clearAddressesAndTerritoriesForBoundaryChange() {
  if (houses.length || territories.length) {
    houses = [];
    territories = [];
    selectedHouseIds.clear();
    currentPlanId = null;
    renderAllPlanningData();
  }
}
function updateBoundaryUi() {
  els.boundaryChip.textContent = boundaryGeometry ? 'Boundary ready' : 'No boundary';
  els.boundaryMessage.textContent = boundaryGeometry
    ? 'Boundary ready. Load addresses inside it or save it as the congregation’s big-picture area.'
    : 'Select a Hall, then draw or load a boundary.';
  updateSummary();
}

function updateSourceDetail(sourceKey = currentSourceKey()) {
  const source = ASSESSOR_SOURCES[sourceKey];
  if (!source) {
    els.sourceDetail.innerHTML = 'No live county connector is assigned to this location. Import CSV/GeoJSON or add addresses manually.';
    return;
  }
  els.sourceDetail.innerHTML = `${escapeHtml(source.description)} <a href="${source.infoUrl}" target="_blank" rel="noopener">Official layer details</a>`;
}
function boundaryEnvelope() {
  const bbox = turf.bbox(boundaryFeature());
  return { xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } };
}
async function arcGisJsonp(endpoint, params, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const callback = `__territoryArcGis_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    const timer = setTimeout(() => { cleanup(); reject(new Error('The county GIS request timed out.')); }, timeoutMs);
    window[callback] = payload => { cleanup(); resolve(payload); };
    script.onerror = () => { cleanup(); reject(new Error('The county GIS service could not be reached.')); };
    script.src = url.href;
    document.head.appendChild(script);
  });
}
async function requestArcGisPage(source, offset, forceGeometry = false) {
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
    geometry: JSON.stringify(boundaryEnvelope()),
    resultOffset: String(offset),
    resultRecordCount: '2000',
    geometryPrecision: '6'
  });
  if (forceGeometry || source.returnGeometry) params.set('maxAllowableOffset', '0.00008');
  try {
    const response = await fetch(source.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
      body: params
    });
    if (!response.ok) throw new Error(`County GIS service returned ${response.status}.`);
    return await response.json();
  } catch (error) {
    return await arcGisJsonp(source.endpoint, params);
  }
}
async function queryArcGisSource(source, forceGeometry = false) {
  const features = [];
  let offset = 0;
  for (let page = 0; page < 8 && features.length < MAX_ADDRESS_RECORDS; page += 1) {
    const payload = await requestArcGisPage(source, offset, forceGeometry);
    if (payload?.error) throw new Error(payload.error.message || 'The county GIS service returned an error.');
    const pageFeatures = Array.isArray(payload?.features) ? payload.features : [];
    features.push(...pageFeatures);
    offset += pageFeatures.length;
    const exceeded = Boolean(payload?.exceededTransferLimit);
    if (!exceeded || !pageFeatures.length) break;
  }
  return features.slice(0, MAX_ADDRESS_RECORDS);
}
function dedupeAddressRecords(records) {
  const includeUnits = els.separateUnits.checked;
  const seen = new Map();
  for (const record of records) {
    if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lng) || !clean(record.address)) continue;
    if (!pointInsideBoundary(record)) continue;
    if (els.residentialOnly.checked && record.residential === false) continue;
    const key = normalizeAddressKey(includeUnits ? record.address : (record.baseAddress || record.address), includeUnits);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { ...record, included: true, territoryId: null });
  }
  return [...seen.values()];
}
async function loadAddresses() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary first.', true); return; }
  const sourceKey = currentSourceKey();
  const source = ASSESSOR_SOURCES[sourceKey];
  if (!source) {
    toast('This location does not yet have a live county connector. Import CSV/GeoJSON or add addresses manually.', true);
    return;
  }
  if (houses.length && !confirm('Replace the currently loaded addresses and territories with a fresh assessor/GIS search?')) return;
  els.addressProgress.hidden = false;
  els.loadAddressesButton.disabled = true;
  els.addressMessage.textContent = `Loading ${source.label} records inside the boundary…`;
  try {
    let features = await queryArcGisSource(source, false);
    let parsed = features.map(feature => parseSourceFeature(sourceKey, feature)).filter(Boolean);
    if (sourceKey === 'denver' && features.length && !parsed.length) {
      els.addressMessage.textContent = 'The Denver service did not return parcel centroids; retrying with simplified parcel geometry…';
      features = await queryArcGisSource(source, true);
      parsed = features.map(feature => parseSourceFeature(sourceKey, feature)).filter(Boolean);
    }
    houses = dedupeAddressRecords(parsed).map(item => ({ ...item, id: String(item.id || uniqueId('address')) }));
    territories = [];
    selectedHouseIds.clear();
    currentPlanId = null;
    renderAllPlanningData();
    els.addressMessage.textContent = `${houses.length.toLocaleString()} address or parcel records loaded from ${source.label}. Review duplicates, apartments, commercial records, access, and local territory limits before use.`;
    toast(`${houses.length.toLocaleString()} address records loaded.`);
  } catch (error) {
    els.addressMessage.textContent = `Address loading failed: ${friendlyError(error)}`;
    toast(`Could not load assessor/GIS addresses: ${friendlyError(error)}`, true);
  } finally {
    els.addressProgress.hidden = true;
    els.loadAddressesButton.disabled = false;
  }
}
function addHouseRecord(record) {
  const key = normalizeAddressKey(record.address, true);
  if (houses.some(item => normalizeAddressKey(item.address, true) === key && Math.abs(item.lat - record.lat) < .00001 && Math.abs(item.lng - record.lng) < .00001)) return false;
  houses.push({ ...record, id: String(record.id || uniqueId('address')), included: record.included !== false, territoryId: record.territoryId || null });
  return true;
}
function toggleManualHouseMode() {
  if (!requireAdmin()) return;
  manualHouseMode = !manualHouseMode;
  els.addHouseButton.textContent = manualHouseMode ? 'Cancel Map Click' : 'Add House by Map Click';
  toast(manualHouseMode ? 'Tap the map where the house or ministry stop should be placed.' : 'Manual map-click mode canceled.');
}
function clearHouses() {
  if (!requireAdmin()) return;
  if (houses.length && !confirm('Clear all loaded addresses and generated territories from this unsaved workspace?')) return;
  houses = [];
  territories = [];
  selectedHouseIds.clear();
  currentPlanId = null;
  renderAllPlanningData();
  els.addressMessage.textContent = 'Address points cleared.';
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  row.push(cell); if (row.some(value => clean(value))) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, clean(values[index] || '')])));
}
function importedRecord(properties, geometry, index) {
  let lat, lng;
  if (geometry?.type === 'Point') [lng, lat] = geometry.coordinates || [];
  else if (geometry && globalThis.turf) {
    try { [lng, lat] = turf.centroid(turf.feature(geometry)).geometry.coordinates; } catch { /* ignore */ }
  }
  lat = Number(lat ?? properties.latitude ?? properties.lat ?? properties.y);
  lng = Number(lng ?? properties.longitude ?? properties.lng ?? properties.lon ?? properties.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = clean(properties.address || properties.fulladdress || properties.siteaddress || properties.streetaddress || properties.name || `Imported point ${index + 1}`);
  const unit = clean(properties.unit || properties.apartment || properties.apt || properties.suite);
  return {
    id: uniqueId('import'), address: unit && !address.includes(unit) ? `${address} Unit ${unit}` : address,
    baseAddress: address, unit, lat, lng, source: 'Imported CSV / GeoJSON', residential: true,
    classification: clean(properties.classification || properties.type || 'Imported'), included: true, territoryId: null
  };
}
async function importAddressFile(file) {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary before importing addresses.', true); return; }
  if (!file) return;
  try {
    const text = await file.text();
    let records = [];
    if (/\.csv$/i.test(file.name)) {
      records = parseCsv(text).map((row, index) => importedRecord(row, null, index)).filter(Boolean);
    } else {
      const data = JSON.parse(text);
      const features = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : [];
      records = features.map((feature, index) => importedRecord(feature.properties || {}, feature.geometry, index)).filter(Boolean);
    }
    const filtered = dedupeAddressRecords(records);
    let added = 0;
    for (const record of filtered) if (addHouseRecord(record)) added += 1;
    renderAllPlanningData();
    els.addressMessage.textContent = `${added.toLocaleString()} imported address points added inside the current boundary.`;
    toast(`${added.toLocaleString()} imported points added.`);
  } catch (error) {
    toast(`Could not import the file: ${friendlyError(error)}`, true);
  } finally {
    els.importFile.value = '';
  }
}

function houseStyle(house) {
  if (!house.included) return { radius: 4, color: '#fff', weight: 1.5, fillColor: '#b44b43', fillOpacity: .35 };
  if (selectedHouseIds.has(house.id)) return { radius: 7, color: '#fff', weight: 2.5, fillColor: '#ffbd00', fillOpacity: 1 };
  const territory = territories.find(item => item.id === house.territoryId);
  const color = territory ? TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length] : '#6b7c8f';
  return { radius: territory ? 5 : 4, color: '#fff', weight: 1.4, fillColor: color, fillOpacity: .9 };
}
function renderHouseMarkers() {
  if (!map) return;
  houseGroup.clearLayers();
  houseMarkers.clear();
  for (const house of houses) {
    const marker = L.circleMarker([house.lat, house.lng], { renderer: canvasRenderer, ...houseStyle(house) }).addTo(houseGroup);
    marker.bindPopup(`<div class="house-popup"><strong>${escapeHtml(house.address)}</strong><br>${escapeHtml(house.source || '')}<br><small>${escapeHtml(house.classification || '')}${house.unitCount > 1 ? ` • ${house.unitCount} assessor units` : ''}</small></div>`);
    marker.on('click', event => {
      L.DomEvent.stopPropagation(event);
      toggleHouseSelection(house.id);
    });
    houseMarkers.set(house.id, marker);
  }
}
function territoryGeometry(territory) {
  const points = houses.filter(house => house.included && house.territoryId === territory.id).map(pointFeature);
  if (!points.length) return null;
  try {
    if (points.length === 1) return turf.buffer(points[0], .045, { units: 'kilometers', steps: 16 });
    if (points.length === 2) return turf.buffer(turf.lineString(points.map(point => point.geometry.coordinates)), .045, { units: 'kilometers', steps: 12 });
    const collection = turf.featureCollection(points);
    const convex = turf.convex(collection) || turf.bboxPolygon(turf.bbox(collection));
    return turf.buffer(convex, .035, { units: 'kilometers', steps: 12 });
  } catch {
    return turf.bboxPolygon(turf.bbox(turf.featureCollection(points)));
  }
}
function renderTerritoryLayers() {
  territoryGroup.clearLayers();
  territoryLayers.clear();
  for (const territory of territories) {
    const geometry = territoryGeometry(territory);
    if (!geometry) continue;
    const color = TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length];
    const layer = L.geoJSON(geometry, { style: { color, weight: 2.5, fillColor: color, fillOpacity: .14 } }).addTo(territoryGroup);
    layer.bindTooltip(`${territory.name} — ${territory.houseIds.length} houses`, { sticky: true });
    layer.on('click', () => selectTerritoryHouses(territory.id));
    territoryLayers.set(territory.id, layer);
  }
}
function renderAllPlanningData() {
  renderTerritoryLayers();
  renderHouseMarkers();
  renderTerritoryList();
  renderHouseList();
  updateAssignmentSelector();
  updateSummary();
}
function toggleHouseSelection(id) {
  if (selectedHouseIds.has(id)) selectedHouseIds.delete(id); else selectedHouseIds.add(id);
  renderHouseMarkers();
  renderHouseList();
  updateSelectionUi();
}
function clearSelection(removeLayer = true) {
  selectedHouseIds.clear();
  if (removeLayer && selectionLayer) { map.removeLayer(selectionLayer); selectionLayer = null; }
  renderHouseMarkers();
  renderHouseList();
  updateSelectionUi();
}
function selectHousesWithin(feature) {
  selectedHouseIds.clear();
  for (const house of houses) {
    if (!house.included) continue;
    try { if (turf.booleanPointInPolygon(pointFeature(house), feature)) selectedHouseIds.add(house.id); } catch { /* ignore */ }
  }
  renderHouseMarkers();
  renderHouseList();
  updateSelectionUi();
  toast(`${selectedHouseIds.size} houses selected inside the drawn area.`);
}
function selectArea() {
  if (!requireAdmin()) return;
  if (!houses.length) { toast('Load or add addresses first.', true); return; }
  drawMode = 'selection';
  new L.Draw.Polygon(map, {
    allowIntersection: false,
    shapeOptions: { color: '#d99800', weight: 2.5, dashArray: '6 5', fillColor: '#ffd34f', fillOpacity: .08 }
  }).enable();
  toast('Draw around the houses to select, then close the shape.');
}
function selectTerritoryHouses(territoryId) {
  selectedHouseIds = new Set(houses.filter(house => house.included && house.territoryId === territoryId).map(house => house.id));
  renderHouseMarkers();
  renderHouseList();
  updateSelectionUi();
}
function updateSelectionUi() {
  els.selectionCount.textContent = `${selectedHouseIds.size.toLocaleString()} house${selectedHouseIds.size === 1 ? '' : 's'} selected`;
  els.assignSelectedButton.disabled = !selectedHouseIds.size || !isAdmin();
  els.newTerritoryButton.disabled = !selectedHouseIds.size || !isAdmin();
  els.excludeSelectionButton.disabled = !selectedHouseIds.size || !isAdmin();
}
function includeExcludeSelected() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id));
  const shouldInclude = selected.every(house => !house.included);
  for (const house of selected) {
    house.included = shouldInclude;
    if (!shouldInclude) house.territoryId = null;
  }
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  toast(`${selected.length} selected address${selected.length === 1 ? '' : 'es'} ${shouldInclude ? 'included' : 'excluded'}.`);
}

function compactGroups(items, target) {
  const remaining = [...items].sort((a, b) => b.lat - a.lat || a.lng - b.lng);
  const groups = [];
  while (remaining.length) {
    const group = [remaining.shift()];
    while (remaining.length && group.length < target) {
      const center = {
        lat: group.reduce((sum, item) => sum + item.lat, 0) / group.length,
        lng: group.reduce((sum, item) => sum + item.lng, 0) / group.length
      };
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((item, index) => {
        const distance = distanceMiles(center, item);
        if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
      });
      group.push(remaining.splice(nearestIndex, 1)[0]);
    }
    groups.push(group);
  }
  return groups;
}
function streetGroups(items, target) {
  const sorted = [...items].sort((a, b) => {
    const aa = splitStreetSort(a.address), bb = splitStreetSort(b.address);
    return aa.street.localeCompare(bb.street) || aa.number - bb.number || a.address.localeCompare(b.address);
  });
  const groups = [];
  for (let index = 0; index < sorted.length; index += target) groups.push(sorted.slice(index, index + target));
  return groups;
}
function nextTerritoryName(index = territories.length) {
  const prefix = clean(els.territoryPrefix.value).toUpperCase() || initialPrefix(selectedCongregation);
  return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}
function automaticGrouping() {
  if (!requireAdmin()) return;
  const included = houses.filter(house => house.included);
  if (!included.length) { toast('Load or add included addresses first.', true); return; }
  if (territories.length && !confirm('Replace the existing territory groups with new automatic groups?')) return;
  const target = targetSizeValue();
  const groups = els.groupingMethod.value === 'street' ? streetGroups(included, target) : compactGroups(included, target);
  territories = groups.map((group, index) => ({
    id: uniqueId('territory'), name: nextTerritoryName(index), colorIndex: index % TERRITORY_COLORS.length,
    houseIds: group.map(house => house.id)
  }));
  const assignment = new Map();
  territories.forEach(territory => territory.houseIds.forEach(id => assignment.set(id, territory.id)));
  houses.forEach(house => { house.territoryId = house.included ? assignment.get(house.id) || null : null; });
  clearSelection();
  renderAllPlanningData();
  toast(`${territories.length} territories created using a target of ${target} houses.`);
}
function recalculateTerritoryHouseIds() {
  for (const territory of territories) territory.houseIds = houses.filter(house => house.included && house.territoryId === territory.id).map(house => house.id);
  territories = territories.filter(territory => territory.houseIds.length);
}
function updateAssignmentSelector() {
  els.assignTerritorySelect.innerHTML = '<option value="">Unassigned</option>' + territories.map(territory => `<option value="${escapeHtml(territory.id)}">${escapeHtml(territory.name)} (${territory.houseIds.length})</option>`).join('');
}
function assignSelected() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const territoryId = els.assignTerritorySelect.value || null;
  for (const house of houses) if (selectedHouseIds.has(house.id) && house.included) house.territoryId = territoryId;
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  toast(territoryId ? 'Selected houses assigned to the chosen territory.' : 'Selected houses moved to Unassigned.');
}
function newTerritoryFromSelected() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id) && house.included);
  if (!selected.length) { toast('No included houses are selected.', true); return; }
  const suggested = nextTerritoryName();
  const name = clean(prompt('Territory name:', suggested));
  if (!name) return;
  const territory = { id: uniqueId('territory'), name, colorIndex: territories.length % TERRITORY_COLORS.length, houseIds: selected.map(house => house.id) };
  territories.push(territory);
  selected.forEach(house => { house.territoryId = territory.id; });
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  toast(`${name} created with ${selected.length} houses.`);
}
function renameTerritory(id) {
  const territory = territories.find(item => item.id === id);
  if (!territory || !requireAdmin()) return;
  const name = clean(prompt('Territory name:', territory.name));
  if (!name) return;
  territory.name = name;
  renderAllPlanningData();
}
function deleteTerritory(id) {
  const territory = territories.find(item => item.id === id);
  if (!territory || !requireAdmin()) return;
  if (!confirm(`Delete ${territory.name} and leave its houses unassigned?`)) return;
  houses.forEach(house => { if (house.territoryId === id) house.territoryId = null; });
  territories = territories.filter(item => item.id !== id);
  renderAllPlanningData();
}
function zoomTerritory(id) {
  const layer = territoryLayers.get(id);
  if (layer?.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [35, 35], maxZoom: 17 });
}
function renderTerritoryList() {
  if (!territories.length) {
    els.territoryList.innerHTML = '<div class="empty">No territories have been created.</div>';
    return;
  }
  els.territoryList.innerHTML = territories.map((territory, index) => {
    const included = houses.filter(house => house.included && house.territoryId === territory.id);
    const color = TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length];
    return `<article class="territory-row"><span class="territory-swatch" style="background:${color}"></span><div class="territory-main"><strong>${escapeHtml(territory.name)}</strong><small>${included.length.toLocaleString()} houses${included.length ? ` • ${escapeHtml(included[0].address)}${included.length > 1 ? ` through ${escapeHtml(included[included.length - 1].address)}` : ''}` : ''}</small></div><div class="row-actions"><button class="row-action" data-territory-zoom="${territory.id}">Zoom</button><button class="row-action" data-territory-select="${territory.id}">Select</button><button class="row-action" data-territory-rename="${territory.id}">Rename</button><button class="row-action danger" data-territory-delete="${territory.id}">Delete</button></div></article>`;
  }).join('');
  els.territoryList.querySelectorAll('[data-territory-zoom]').forEach(button => button.addEventListener('click', () => zoomTerritory(button.dataset.territoryZoom)));
  els.territoryList.querySelectorAll('[data-territory-select]').forEach(button => button.addEventListener('click', () => selectTerritoryHouses(button.dataset.territorySelect)));
  els.territoryList.querySelectorAll('[data-territory-rename]').forEach(button => button.addEventListener('click', () => renameTerritory(button.dataset.territoryRename)));
  els.territoryList.querySelectorAll('[data-territory-delete]').forEach(button => button.addEventListener('click', () => deleteTerritory(button.dataset.territoryDelete)));
}
function renderHouseList() {
  const query = clean(els.houseSearch.value).toLowerCase();
  const territoryById = new Map(territories.map(item => [item.id, item]));
  const filtered = houses.filter(house => {
    const territory = territoryById.get(house.territoryId);
    return !query || `${house.address} ${territory?.name || ''} ${house.source || ''}`.toLowerCase().includes(query);
  });
  const shown = filtered.slice(0, HOUSE_LIST_LIMIT);
  if (!shown.length) {
    els.houseList.innerHTML = `<div class="empty">${houses.length ? 'No addresses match this search.' : 'No addresses loaded.'}</div>`;
    return;
  }
  els.houseList.innerHTML = shown.map(house => {
    const territory = territoryById.get(house.territoryId);
    const color = territory ? TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length] : house.included ? '#6b7c8f' : '#b44b43';
    return `<article class="house-row${selectedHouseIds.has(house.id) ? ' selected' : ''}${house.included ? '' : ' excluded'}" data-house-id="${escapeHtml(house.id)}"><span class="house-dot" style="background:${color}"></span><div><strong>${escapeHtml(house.address)}</strong><small>${escapeHtml(house.source || '')}${house.classification ? ` • ${escapeHtml(house.classification)}` : ''}${house.unitCount > 1 ? ` • ${house.unitCount} assessor units` : ''}</small></div><span class="territory-tag">${escapeHtml(house.included ? territory?.name || 'Unassigned' : 'Excluded')}</span></article>`;
  }).join('') + (filtered.length > HOUSE_LIST_LIMIT ? `<div class="list-limit">Showing the first ${HOUSE_LIST_LIMIT.toLocaleString()} of ${filtered.length.toLocaleString()} matching addresses. Use search or the map to narrow the list.</div>` : '');
  els.houseList.querySelectorAll('[data-house-id]').forEach(row => row.addEventListener('click', () => toggleHouseSelection(row.dataset.houseId)));
}

function updateSummary() {
  const includedCount = houses.filter(house => house.included).length;
  els.summaryHall.textContent = selectedHall ? `${markerLabel(selectedHall)} — ${selectedHall.name}` : '—';
  els.summaryCongregation.textContent = selectedCongregation || '—';
  els.summaryHouses.textContent = includedCount.toLocaleString();
  els.summaryTerritories.textContent = territories.length.toLocaleString();
  els.houseCountChip.textContent = `${houses.length.toLocaleString()} loaded`;
  els.territoryCountChip.textContent = `${territories.length.toLocaleString()} territor${territories.length === 1 ? 'y' : 'ies'}`;
  els.planStatusChip.textContent = currentPlanId ? 'Saved plan loaded' : boundaryGeometry || houses.length ? 'Unsaved work' : 'Not started';
  els.planStatusChip.className = `status-chip${currentPlanId ? ' ready' : boundaryGeometry || houses.length ? ' working' : ''}`;
  updateSelectionUi();
}

function requireAdmin() {
  if (isAdmin()) return true;
  openLogin();
  return false;
}
function updateAuthUi() {
  const signedIn = Boolean(currentUser);
  els.loginButton.hidden = signedIn;
  els.signOutButton.hidden = !signedIn;
  document.querySelectorAll('.admin-control').forEach(control => { control.disabled = !isAdmin(); });
  els.privacyCard.innerHTML = isAdmin()
    ? '<span class="eyebrow">PRIVATE PLANNING WORKSPACE</span><h2>Administrator access active</h2><p>House-level assessor data, boundaries, and saved territory plans are available in this signed-in session.</p>'
    : '<span class="eyebrow">PRIVATE PLANNING WORKSPACE</span><h2>House-level data requires sign-in</h2><p>Kingdom Hall markers are public. Assessor address points, saved boundaries, and saved territory plans are shown only after administrator sign-in and are stored in the private Firebase <code>reviews</code> collection.</p>';
  updateSelectionUi();
  if (isAdmin()) subscribeReviews();
  else {
    if (reviewsUnsubscribe) { reviewsUnsubscribe(); reviewsUnsubscribe = null; }
    reviewRecords.clear();
    renderSavedRecords();
  }
}
function openLogin() { els.loginModal.classList.add('open'); setTimeout(() => els.loginPassword.focus(), 50); }
function closeLogin() { els.loginModal.classList.remove('open'); }

function serializeBoundaryRecord() {
  return {
    recordType: 'territory-boundary',
    name: clean(els.boundaryName.value) || `${selectedCongregation} service area`,
    hallId: selectedHall.id,
    hallLabel: markerLabel(selectedHall),
    hallName: selectedHall.name,
    hallAddress: selectedHall.address || '',
    congregation: selectedCongregation,
    boundary: boundaryGeometry,
    sourceHint: currentSourceKey(),
    updatedByEmail: currentUser.email,
    updatedAt: serverTimestamp()
  };
}
async function saveBoundary() {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation || !boundaryGeometry) { toast('Select a Hall and congregation and create a boundary first.', true); return; }
  const button = els.saveBoundaryButton;
  button.disabled = true; button.textContent = 'Saving…';
  try {
    const ref = currentBoundaryId ? doc(db, 'reviews', currentBoundaryId) : doc(collection(db, 'reviews'));
    await setDoc(ref, { ...serializeBoundaryRecord(), ...(currentBoundaryId ? {} : { createdAt: serverTimestamp() }) }, { merge: true });
    currentBoundaryId = ref.id;
    toast('Congregation boundary saved.');
  } catch (error) { toast(`Could not save the boundary: ${friendlyError(error)}`, true); }
  finally { button.disabled = false; button.textContent = 'Save Congregation Boundary'; }
}
function serializeHouse(house) {
  return {
    id: house.id, address: house.address, baseAddress: house.baseAddress || house.address, unit: house.unit || '',
    lat: Number(house.lat), lng: Number(house.lng), source: house.source || '', residential: house.residential !== false,
    classification: house.classification || '', unitCount: Number(house.unitCount) || 1, included: house.included !== false,
    territoryId: house.territoryId || null, rawId: house.rawId ?? null
  };
}
async function savePlan() {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation || !boundaryGeometry) { toast('Select a Hall and create the congregation boundary first.', true); return; }
  if (!houses.length) { toast('Load or add addresses before saving the territory plan.', true); return; }
  const button = els.savePlanButton;
  button.disabled = true; button.textContent = 'Saving…';
  try {
    const planRef = currentPlanId ? doc(db, 'reviews', currentPlanId) : doc(collection(db, 'reviews'));
    const planId = planRef.id;
    const chunks = [];
    for (let index = 0; index < houses.length; index += FIRESTORE_HOUSE_CHUNK_SIZE) chunks.push(houses.slice(index, index + FIRESTORE_HOUSE_CHUNK_SIZE).map(serializeHouse));
    const chunkIds = chunks.map((_, index) => `${planId}__houses_${String(index).padStart(3, '0')}`);
    const oldChunkIds = [...reviewRecords.values()].filter(item => item.recordType === 'territory-plan-chunk' && item.planId === planId).map(item => item.id);
    const batch = writeBatch(db);
    batch.set(planRef, {
      recordType: 'territory-plan',
      planName: clean(els.planName.value) || `${selectedCongregation} — Convention Ministry Territories`,
      hallId: selectedHall.id,
      hallLabel: markerLabel(selectedHall),
      hallName: selectedHall.name,
      hallAddress: selectedHall.address || '',
      congregation: selectedCongregation,
      territoryPrefix: clean(els.territoryPrefix.value).toUpperCase(),
      boundary: boundaryGeometry,
      boundaryName: clean(els.boundaryName.value) || `${selectedCongregation} service area`,
      sourceKey: currentSourceKey(),
      targetSize: targetSizeValue(),
      groupingMethod: els.groupingMethod.value,
      residentialOnly: els.residentialOnly.checked,
      separateUnits: els.separateUnits.checked,
      houseCount: houses.length,
      includedHouseCount: houses.filter(house => house.included).length,
      territories: territories.map(item => ({ id: item.id, name: item.name, colorIndex: item.colorIndex, houseIds: [...item.houseIds] })),
      chunkIds,
      chunkCount: chunkIds.length,
      updatedByEmail: currentUser.email,
      updatedAt: serverTimestamp(),
      ...(currentPlanId ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });
    chunks.forEach((chunk, index) => {
      batch.set(doc(db, 'reviews', chunkIds[index]), {
        recordType: 'territory-plan-chunk', planId, chunkIndex: index, houses: chunk,
        updatedByEmail: currentUser.email, updatedAt: serverTimestamp()
      });
    });
    oldChunkIds.filter(id => !chunkIds.includes(id)).forEach(id => batch.delete(doc(db, 'reviews', id)));
    await batch.commit();
    currentPlanId = planId;
    els.planName.value = clean(els.planName.value) || `${selectedCongregation} — Convention Ministry Territories`;
    updateSummary();
    toast(`Territory plan saved in ${chunks.length} private Firebase data part${chunks.length === 1 ? '' : 's'}.`);
  } catch (error) { toast(`Could not save the territory plan: ${friendlyError(error)}`, true); }
  finally { button.disabled = false; button.textContent = 'Save Territory Plan'; }
}
function subscribeReviews() {
  if (!db || !isAdmin()) return;
  if (reviewsUnsubscribe) reviewsUnsubscribe();
  reviewsUnsubscribe = onSnapshot(collection(db, 'reviews'), snapshot => {
    reviewRecords.clear();
    snapshot.forEach(item => reviewRecords.set(item.id, { id: item.id, ...item.data() }));
    renderSavedRecords();
  }, error => {
    els.savedBoundaries.innerHTML = `<div class="empty">Saved records could not be loaded: ${escapeHtml(friendlyError(error))}</div>`;
    els.savedPlans.innerHTML = '';
  });
}
function savedBoundaries() { return [...reviewRecords.values()].filter(item => item.recordType === 'territory-boundary').sort((a, b) => clean(a.congregation).localeCompare(clean(b.congregation))); }
function savedPlans() { return [...reviewRecords.values()].filter(item => item.recordType === 'territory-plan').sort((a, b) => clean(a.planName).localeCompare(clean(b.planName))); }
function renderSavedRecords() {
  if (!isAdmin()) {
    els.savedBoundaries.innerHTML = '<div class="empty">Sign in to load saved boundaries.</div>';
    els.savedPlans.innerHTML = '<div class="empty">Sign in to load saved territory plans.</div>';
    return;
  }
  const boundaries = savedBoundaries();
  const plans = savedPlans();
  els.savedBoundaries.innerHTML = boundaries.length ? boundaries.map(item => `<article class="saved-row"><div><strong>${escapeHtml(item.name || item.congregation || 'Saved boundary')}</strong><small>${escapeHtml(item.hallLabel || '')} ${escapeHtml(item.hallName || '')} • ${escapeHtml(item.congregation || '')} • ${escapeHtml(formatDate(item.updatedAt))}</small></div><div class="row-actions"><button class="row-action" data-load-boundary="${item.id}">Load</button><button class="row-action danger" data-delete-boundary="${item.id}">Delete</button></div></article>`).join('') : '<div class="empty">No congregation boundaries saved yet.</div>';
  els.savedPlans.innerHTML = plans.length ? plans.map(item => `<article class="saved-row"><div><strong>${escapeHtml(item.planName || 'Saved territory plan')}</strong><small>${escapeHtml(item.hallLabel || '')} ${escapeHtml(item.hallName || '')} • ${escapeHtml(item.congregation || '')} • ${(item.houseCount || 0).toLocaleString()} addresses • ${(item.territories || []).length} territories • ${escapeHtml(formatDate(item.updatedAt))}</small></div><div class="row-actions"><button class="row-action" data-load-plan="${item.id}">Load</button><button class="row-action danger" data-delete-plan="${item.id}">Delete</button></div></article>`).join('') : '<div class="empty">No territory plans saved yet.</div>';
  els.savedBoundaries.querySelectorAll('[data-load-boundary]').forEach(button => button.addEventListener('click', () => loadBoundaryRecord(button.dataset.loadBoundary)));
  els.savedBoundaries.querySelectorAll('[data-delete-boundary]').forEach(button => button.addEventListener('click', () => deleteBoundaryRecord(button.dataset.deleteBoundary)));
  els.savedPlans.querySelectorAll('[data-load-plan]').forEach(button => button.addEventListener('click', () => loadPlanRecord(button.dataset.loadPlan)));
  els.savedPlans.querySelectorAll('[data-delete-plan]').forEach(button => button.addEventListener('click', () => deletePlanRecord(button.dataset.deletePlan)));
}
function restoreHallAndCongregation(hallId, congregation) {
  if (hallLocations.some(hall => hall.id === String(hallId))) selectHall(String(hallId), false, true);
  populateCongregations(congregation);
  selectedCongregation = congregation || els.congregationSelect.value;
  els.congregationSelect.value = selectedCongregation;
}
function loadBoundaryRecord(id) {
  const item = reviewRecords.get(id);
  if (!item?.boundary) return;
  if ((houses.length || boundaryGeometry) && !confirm('Replace the current unsaved workspace with this saved boundary?')) return;
  clearPlanWorkspace(false);
  restoreHallAndCongregation(item.hallId, item.congregation);
  currentBoundaryId = item.id;
  els.boundaryName.value = item.name || '';
  els.sourceSelect.value = item.sourceHint && ASSESSOR_SOURCES[item.sourceHint] ? item.sourceHint : 'auto';
  setBoundaryGeometry(item.boundary, true);
  toast('Saved congregation boundary loaded.');
}
function loadPlanRecord(id) {
  const plan = reviewRecords.get(id);
  if (!plan) return;
  if ((houses.length || boundaryGeometry) && !confirm('Replace the current unsaved workspace with this saved territory plan?')) return;
  const chunkIds = Array.isArray(plan.chunkIds) ? plan.chunkIds : [...reviewRecords.values()].filter(item => item.recordType === 'territory-plan-chunk' && item.planId === id).sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex)).map(item => item.id);
  const loadedHouses = chunkIds.flatMap(chunkId => reviewRecords.get(chunkId)?.houses || []);
  clearPlanWorkspace(false);
  restoreHallAndCongregation(plan.hallId, plan.congregation);
  currentPlanId = plan.id;
  currentBoundaryId = null;
  els.planName.value = plan.planName || '';
  els.territoryPrefix.value = plan.territoryPrefix || initialPrefix(plan.congregation || 'T');
  els.boundaryName.value = plan.boundaryName || '';
  els.sourceSelect.value = plan.sourceKey && ASSESSOR_SOURCES[plan.sourceKey] ? plan.sourceKey : 'auto';
  els.groupingMethod.value = plan.groupingMethod || 'compact';
  els.residentialOnly.checked = plan.residentialOnly !== false;
  els.separateUnits.checked = Boolean(plan.separateUnits);
  const target = Number(plan.targetSize) || 30;
  if ([10, 20, 30, 40].includes(target)) els.targetSize.value = String(target);
  else { els.targetSize.value = 'custom'; els.customTarget.value = target; els.customTargetWrap.hidden = false; }
  boundaryGeometry = plan.boundary || null;
  if (boundaryGeometry) {
    boundaryGroup.clearLayers();
    const layer = L.geoJSON(boundaryGeometry, { style: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 } }).addTo(boundaryGroup);
    if (layer.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 15 });
  }
  houses = loadedHouses.map(item => ({ ...item, id: String(item.id), included: item.included !== false, territoryId: item.territoryId || null }));
  territories = (plan.territories || []).map((item, index) => ({ id: String(item.id || uniqueId('territory')), name: item.name || nextTerritoryName(index), colorIndex: Number(item.colorIndex) || index, houseIds: [...(item.houseIds || [])] }));
  recalculateTerritoryHouseIds();
  selectedHouseIds.clear();
  updateBoundaryUi();
  renderAllPlanningData();
  toast(`Saved plan loaded with ${houses.length.toLocaleString()} addresses.`);
}
async function deleteBoundaryRecord(id) {
  const item = reviewRecords.get(id);
  if (!item || !confirm(`Delete the saved boundary “${item.name || item.congregation || 'Boundary'}”?`)) return;
  try { await deleteDoc(doc(db, 'reviews', id)); if (currentBoundaryId === id) currentBoundaryId = null; toast('Saved boundary deleted.'); }
  catch (error) { toast(`Could not delete the boundary: ${friendlyError(error)}`, true); }
}
async function deletePlanRecord(id) {
  const plan = reviewRecords.get(id);
  if (!plan || !confirm(`Delete the saved territory plan “${plan.planName || 'Territory plan'}” and all of its private address chunks?`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'reviews', id));
    [...reviewRecords.values()].filter(item => item.recordType === 'territory-plan-chunk' && item.planId === id).forEach(item => batch.delete(doc(db, 'reviews', item.id)));
    await batch.commit();
    if (currentPlanId === id) currentPlanId = null;
    toast('Saved territory plan deleted.');
  } catch (error) { toast(`Could not delete the plan: ${friendlyError(error)}`, true); }
}

function planGeoJson() {
  const features = [];
  if (boundaryGeometry) features.push(turf.feature(boundaryGeometry, { recordType: 'congregation-boundary', name: clean(els.boundaryName.value), hall: selectedHall?.name, congregation: selectedCongregation }));
  for (const territory of territories) {
    const geometry = territoryGeometry(territory);
    if (geometry) features.push(turf.feature(geometry.geometry, { recordType: 'territory', territoryId: territory.id, territoryName: territory.name, houseCount: territory.houseIds.length }));
  }
  const territoryById = new Map(territories.map(item => [item.id, item.name]));
  for (const house of houses) features.push(turf.point([house.lng, house.lat], {
    recordType: 'ministry-address', address: house.address, source: house.source, included: house.included,
    territoryId: house.territoryId || '', territoryName: territoryById.get(house.territoryId) || ''
  }));
  return turf.featureCollection(features);
}
function exportGeoJson() {
  if (!boundaryGeometry && !houses.length) { toast('There is no boundary or address data to export.', true); return; }
  const filename = `${slug(clean(els.planName.value) || selectedCongregation || 'territory-plan')}.geojson`;
  downloadText(filename, JSON.stringify(planGeoJson(), null, 2), 'application/geo+json;charset=utf-8');
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function exportCsv() {
  if (!houses.length) { toast('There are no addresses to export.', true); return; }
  const territoryById = new Map(territories.map(item => [item.id, item.name]));
  const rows = [['territory','address','latitude','longitude','included','source','classification','unit_count']];
  houses.forEach(house => rows.push([
    territoryById.get(house.territoryId) || '', house.address, Number(house.lat).toFixed(6), Number(house.lng).toFixed(6),
    house.included ? 'Yes' : 'No', house.source || '', house.classification || '', house.unitCount || 1
  ]));
  const filename = `${slug(clean(els.planName.value) || selectedCongregation || 'territory-plan')}.csv`;
  downloadText(filename, rows.map(row => row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
}
function clearPlanWorkspace(resetSelection = true) {
  boundaryGeometry = null;
  houses = [];
  territories = [];
  selectedHouseIds.clear();
  currentBoundaryId = null;
  currentPlanId = null;
  boundaryGroup?.clearLayers();
  territoryGroup?.clearLayers();
  houseGroup?.clearLayers();
  if (selectionLayer && map) { map.removeLayer(selectionLayer); selectionLayer = null; }
  els.planName.value = '';
  els.boundaryName.value = '';
  if (resetSelection && selectedHall) {
    els.territoryPrefix.value = initialPrefix(selectedCongregation);
  }
  updateBoundaryUi();
  renderAllPlanningData();
}
function startNewPlan() {
  if (!requireAdmin()) return;
  if ((houses.length || boundaryGeometry) && !confirm('Clear the current unsaved territory workspace and start a new plan?')) return;
  clearPlanWorkspace(true);
  if (selectedHall) map.setView([selectedHall.lat, selectedHall.lng], 12, { animate: true });
  toast('New territory workspace ready.');
}

function wireEvents() {
  els.hallSelect.addEventListener('change', () => selectHall(els.hallSelect.value, true, false));
  els.congregationSelect.addEventListener('change', () => {
    selectedCongregation = els.congregationSelect.value;
    if (!clean(els.territoryPrefix.value)) els.territoryPrefix.value = initialPrefix(selectedCongregation);
    updateSummary();
  });
  els.sourceSelect.addEventListener('change', () => updateSourceDetail());
  els.targetSize.addEventListener('change', () => { els.customTargetWrap.hidden = els.targetSize.value !== 'custom'; });
  els.drawBoundaryButton.addEventListener('click', drawBoundary);
  els.editBoundaryButton.addEventListener('click', editBoundary);
  els.viewBoundaryButton.addEventListener('click', useCurrentViewBoundary);
  els.clearBoundaryButton.addEventListener('click', () => clearBoundary(true));
  els.saveBoundaryButton.addEventListener('click', saveBoundary);
  els.loadAddressesButton.addEventListener('click', loadAddresses);
  els.addHouseButton.addEventListener('click', toggleManualHouseMode);
  els.importFile.addEventListener('change', () => importAddressFile(els.importFile.files?.[0]));
  els.clearHousesButton.addEventListener('click', clearHouses);
  els.autoGroupButton.addEventListener('click', automaticGrouping);
  els.selectAreaButton.addEventListener('click', selectArea);
  els.clearSelectionButton.addEventListener('click', () => clearSelection(true));
  els.excludeSelectionButton.addEventListener('click', includeExcludeSelected);
  els.assignSelectedButton.addEventListener('click', assignSelected);
  els.newTerritoryButton.addEventListener('click', newTerritoryFromSelected);
  els.houseSearch.addEventListener('input', renderHouseList);
  els.savePlanButton.addEventListener('click', savePlan);
  els.exportGeoJsonButton.addEventListener('click', exportGeoJson);
  els.exportCsvButton.addEventListener('click', exportCsv);
  els.newPlanButton.addEventListener('click', startNewPlan);
  els.loginButton.addEventListener('click', openLogin);
  els.cancelLogin.addEventListener('click', closeLogin);
  els.loginModal.addEventListener('click', event => { if (event.target === els.loginModal) closeLogin(); });
  els.loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, clean(els.loginEmail.value), els.loginPassword.value);
      els.loginPassword.value = '';
      closeLogin();
      toast('Administrator signed in.');
    } catch (error) { toast(friendlyError(error), true); }
  });
  els.resetPassword.addEventListener('click', async () => {
    try { await sendPasswordResetEmail(auth, clean(els.loginEmail.value) || ADMIN_EMAIL); toast('Password reset email sent.'); }
    catch (error) { toast(friendlyError(error), true); }
  });
  els.signOutButton.addEventListener('click', async () => { await signOut(auth); toast('Signed out.'); });
}

async function initialize() {
  initMap();
  wireEvents();
  rebuildHallLocations();
  renderAllPlanningData();
  updateBoundaryUi();
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    await setPersistence(auth, browserLocalPersistence);
    onAuthStateChanged(auth, user => {
      currentUser = user;
      updateAuthUi();
      if (user && !isAdmin()) toast('This account has public viewing access only.', true);
    });
    onSnapshot(collection(db, 'halls'), snapshot => {
      publicHallRecords.clear();
      snapshot.forEach(item => publicHallRecords.set(item.id, item.data()));
      rebuildHallLocations();
    }, error => toast(`Added meeting locations could not be loaded: ${friendlyError(error)}`, true));
  } catch (error) {
    toast(`Firebase could not initialize: ${friendlyError(error)}`, true);
  }
}

initialize();

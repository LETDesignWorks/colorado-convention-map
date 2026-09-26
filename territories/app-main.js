import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS } from './halls.js';
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
const AVOID_GEOCODE_TIMEOUT_MS = 12000;

let app;
let auth;
let db;
let currentUser = null;
let map;
let canvasRenderer;
let boundaryGroup;
let territoryGroup;
let territoryEditGroup;
let territoryEditToolbar = null;
let activeTerritoryEditId = null;
let pendingTerritoryName = '';
let houseGroup;
let hallGroup;
let selectionLayer = null;
let drawMode = null;
let manualHouseMode = false;
let avoidGeocodeSequence = 0;
let lastAvoidNominatimRequestAt = 0;
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
  'loginButton','signOutButton','planStatusChip','summaryHall','summaryCongregation','summaryHouses','summaryAvoid','summaryTerritories',
  'privacyCard','hallSelect','hallDetail','congregationSelect','planName','territoryPrefix','boundaryChip','drawBoundaryButton',
  'editBoundaryButton','viewBoundaryButton','clearBoundaryButton','boundaryName','saveBoundaryButton','boundaryMessage',
  'houseCountChip','sourceSelect','sourceDetail','residentialOnly','separateUnits','loadAddressesButton','addHouseButton',
  'importFile','clearHousesButton','avoidAddressInput','avoidAddressMessage','addAvoidAddressButton','addressProgress','addressMessage','territoryCountChip','targetSize','customTargetWrap',
  'customTarget','groupingMethod','autoGroupButton','drawTerritoryButton','selectAreaButton','clearSelectionButton','excludeSelectionButton',
  'markAvoidButton','restoreAvoidButton','selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryEditMessage','territoryList','houseSearch','houseList',
  'savePlanButton','pdfTerritorySelect','exportTerritoryPdfButton','exportGeoJsonButton','exportCsvButton','newPlanButton','savedBoundaries','savedPlans','loginModal',
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
function avoidCensusGeocode(address, sequence) {
  return new Promise((resolve, reject) => {
    const callbackName = `__denver2027AvoidGeocode_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let finished = false;
    let timeout;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('The U.S. Census address service timed out.'));
    }, AVOID_GEOCODE_TIMEOUT_MS);
    window[callbackName] = payload => {
      if (sequence !== avoidGeocodeSequence) {
        cleanup();
        reject(new Error('The address changed before the lookup finished.'));
        return;
      }
      const match = payload?.result?.addressMatches?.[0];
      const coordinates = match?.coordinates;
      cleanup();
      if (!coordinates) {
        reject(new Error('No U.S. Census address match was found.'));
        return;
      }
      resolve({
        lat: Number(coordinates.y),
        lng: Number(coordinates.x),
        matchedAddress: match.matchedAddress || address,
        source: 'U.S. Census Geocoder'
      });
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('The U.S. Census address service could not be reached.'));
    };
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.searchParams.set('address', address);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('format', 'jsonp');
    url.searchParams.set('callback', callbackName);
    script.src = url.href;
    document.head.appendChild(script);
  });
}
async function avoidNominatimGeocode(address) {
  const wait = Math.max(0, 1100 - (Date.now() - lastAvoidNominatimRequestAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastAvoidNominatimRequestAt = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', address);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`OpenStreetMap address service returned ${response.status}.`);
  const results = await response.json();
  if (!results.length) throw new Error('No address match was found.');
  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    matchedAddress: results[0].display_name || address,
    source: 'OpenStreetMap address search'
  };
}
async function geocodeAvoidAddress(address) {
  const sequence = ++avoidGeocodeSequence;
  try {
    return await avoidCensusGeocode(address, sequence);
  } catch (censusError) {
    if (sequence !== avoidGeocodeSequence) throw censusError;
    try { return await avoidNominatimGeocode(address); }
    catch (fallbackError) {
      throw new Error(`${censusError.message} ${fallbackError.message}`.trim());
    }
  }
}

function encodeGeometry(geometry) {
  if (!geometry) return '';
  try { return JSON.stringify(geometry); }
  catch { return ''; }
}
function decodeGeometry(value, legacyValue = null) {
  const candidate = value || legacyValue;
  if (!candidate) return null;
  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  }
  if (typeof candidate === 'object') {
    try { return JSON.parse(JSON.stringify(candidate)); }
    catch { return null; }
  }
  return null;
}
function decodeTerritories(plan) {
  if (typeof plan?.territoriesJson === 'string' && plan.territoriesJson) {
    try {
      const parsed = JSON.parse(plan.territoriesJson);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through to legacy records */ }
  }
  return Array.isArray(plan?.territories) ? plan.territories : [];
}
function savedTerritoryCount(plan) {
  const storedCount = Number(plan?.territoryCount);
  return Number.isFinite(storedCount) ? storedCount : decodeTerritories(plan).length;
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
  if (!location.customLocation) return inferSourceForHall(location.id);

  const text = `${location.name || ''} ${location.address || ''}`.toUpperCase().replace(/\s+/g, ' ');
  const douglasZip = /\b(?:80104|80108|80109|80116|80117|80118|80124|80125|80126|80129|80130|80134|80135|80138)\b/;
  if (/(HIGHLANDS\s+R(?:ANCH|NACH)|CASTLE\s+ROCK|LONE\s+TREE|DOUGLAS\s+COUNTY)/.test(text) || douglasZip.test(text)) return 'douglas';
  if (/(GOLDEN|WHEAT\s+RIDGE|MORRISON|ARVADA|JEFFERSON\s+COUNTY|\b80401\b|\b80465\b|\b80033\b|\b80005\b|\b80128\b)/.test(text)) return 'jefferson';
  if (/\bDENVER\b/.test(text) && !/(AURORA|COMMERCE\s+CITY|GREENWOOD\s+VILLAGE)/.test(text)) return 'denver';
  return 'colorado';
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
  territoryEditGroup = L.featureGroup().addTo(map);
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
    } else if (drawMode === 'territory-new') {
      const geometry = event.layer.toGeoJSON().geometry;
      const territory = {
        id: uniqueId('territory'),
        name: pendingTerritoryName || nextTerritoryName(),
        colorIndex: territories.length % TERRITORY_COLORS.length,
        houseIds: [],
        geometry,
        manualBoundary: true
      };
      territories.push(territory);
      let assigned = 0;
      let conflicts = 0;
      for (const house of houses) {
        if (!house.included || house.avoid) continue;
        let inside = false;
        try { inside = turf.booleanPointInPolygon(pointFeature(house), turf.feature(geometry)); } catch { inside = false; }
        if (!inside) continue;
        if (!house.territoryId) {
house.territoryId = territory.id;
assigned += 1;
        } else if (house.territoryId !== territory.id) {
conflicts += 1;
        }
      }
      recalculateTerritoryHouseIds();
      pendingTerritoryName = '';
      clearSelection();
      renderAllPlanningData();
      zoomTerritory(territory.id);
      toast(`${territory.name} created with ${assigned} previously unassigned houses${conflicts ? `; ${conflicts} houses inside the boundary remain assigned to other territories` : ''}.`);
    }
    drawMode = null;
  });
  map.on(L.Draw.Event.EDITED, () => {
    if (activeTerritoryEditId) {
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
    const layer = boundaryGroup.getLayers()[0];
    if (layer) {
      boundaryGeometry = layer.toGeoJSON().geometry;
      clearAddressesAndTerritoriesForBoundaryChange();
      updateBoundaryUi();
      toast('Boundary updated. Reload addresses for the revised area.');
    }
  });
  map.on(L.Draw.Event.EDITSTOP, () => {
    if (!activeTerritoryEditId) return;
    activeTerritoryEditId = null;
    territoryEditToolbar = null;
    territoryEditGroup.clearLayers();
    if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
    renderAllPlanningData();
  });
  map.on(L.Draw.Event.DRAWSTOP, () => {
    if (drawMode === 'territory-new') {
      pendingTerritoryName = '';
      drawMode = null;
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
  cancelTerritoryBoundaryEdit(false);
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
function boundaryEnvelope(geometry = boundaryGeometry) {
  if (!geometry) throw new Error('The congregation boundary is missing.');
  const bbox = turf.bbox(turf.feature(geometry));
  if (!bbox.every(Number.isFinite)) throw new Error('The congregation boundary has invalid coordinates.');
  return { xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } };
}
function boundaryQueryEnvelopes(source) {
  const base = boundaryEnvelope();
  const width = Math.max(0, base.xmax - base.xmin);
  const height = Math.max(0, base.ymax - base.ymin);
  const preferredSpan = source?.key === 'colorado' ? 0.020 : 0.025;
  let columns = Math.max(1, Math.ceil(width / preferredSpan));
  let rows = Math.max(1, Math.ceil(height / preferredSpan));
  const maxTiles = 64;
  if (columns * rows > maxTiles) {
    const scale = Math.sqrt((columns * rows) / maxTiles);
    columns = Math.max(1, Math.floor(columns / scale));
    rows = Math.max(1, Math.floor(rows / scale));
    while (columns * rows > maxTiles) {
      if (columns >= rows) columns -= 1; else rows -= 1;
    }
  }
  const cellWidth = width / columns || preferredSpan;
  const cellHeight = height / rows || preferredSpan;
  const envelopes = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      envelopes.push({
        xmin: base.xmin + (column * cellWidth),
        ymin: base.ymin + (row * cellHeight),
        xmax: column === columns - 1 ? base.xmax : base.xmin + ((column + 1) * cellWidth),
        ymax: row === rows - 1 ? base.ymax : base.ymin + ((row + 1) * cellHeight),
        spatialReference: { wkid: 4326 }
      });
    }
  }
  return envelopes;
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
async function requestArcGisPage(source, offset, forceGeometry = false, envelope = boundaryEnvelope()) {
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
    resultRecordCount: '1000',
    geometryPrecision: '6'
  });
  if (forceGeometry || source.returnGeometry) params.set('maxAllowableOffset', '0.00008');
  let firstError = null;
  try {
    const response = await fetch(source.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
      body: params
    });
    if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    firstError = error;
  }
  try {
    const url = new URL(source.endpoint);
    for (const [key, value] of params.entries()) url.searchParams.set(key, value);
    const response = await fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
    return await response.json();
  } catch {
    try {
      return await arcGisJsonp(source.endpoint, params, 45000);
    } catch (jsonpError) {
      throw new Error(`${source.label} could not be reached. ${jsonpError?.message || firstError?.message || ''}`.trim());
    }
  }
}
function arcGisFeatureKey(feature) {
  const attributes = feature?.attributes || feature?.properties || {};
  const objectId = attributes.OBJECTID ?? attributes.FID ?? attributes.ADDRESS_ID ?? attributes.SCHEDNUM ?? attributes.SAUID;
  if (objectId !== undefined && objectId !== null && objectId !== '') return String(objectId);
  const geometry = feature?.geometry || feature?.centroid || {};
  return JSON.stringify([attributes.AddrFull, attributes.ADDRESS, attributes.SITUS_ADDRESS_LINE1, geometry.x, geometry.y]);
}
async function queryArcGisSource(source, forceGeometry = false) {
  const features = [];
  const seen = new Set();
  const envelopes = boundaryQueryEnvelopes(source);
  for (let tileIndex = 0; tileIndex < envelopes.length && features.length < MAX_ADDRESS_RECORDS; tileIndex += 1) {
    const envelope = envelopes[tileIndex];
    if (els?.addressMessage) els.addressMessage.textContent = `Loading ${source.label}: area ${tileIndex + 1} of ${envelopes.length}…`;
    let offset = 0;
    for (let page = 0; page < 8 && features.length < MAX_ADDRESS_RECORDS; page += 1) {
      const payload = await requestArcGisPage(source, offset, forceGeometry, envelope);
      if (payload?.error) throw new Error(payload.error.message || `${source.label} returned an error.`);
      const pageFeatures = Array.isArray(payload?.features) ? payload.features : [];
      for (const feature of pageFeatures) {
        const key = arcGisFeatureKey(feature);
        if (seen.has(key)) continue;
        seen.add(key);
        features.push(feature);
        if (features.length >= MAX_ADDRESS_RECORDS) break;
      }
      offset += pageFeatures.length;
      const exceeded = Boolean(payload?.exceededTransferLimit);
      if (!exceeded || !pageFeatures.length) break;
    }
  }
  return features.slice(0, MAX_ADDRESS_RECORDS);
}
async function loadParsedSource(sourceKey) {
  const source = ASSESSOR_SOURCES[sourceKey];
  if (!source) throw new Error('No assessor/GIS connector is available for this source.');
  let features = await queryArcGisSource(source, false);
  let parsed = features.map(feature => parseSourceFeature(sourceKey, feature)).filter(Boolean);
  if (sourceKey === 'denver' && features.length && !parsed.length) {
    els.addressMessage.textContent = 'The Denver service did not return parcel centroids; retrying with simplified parcel geometry…';
    features = await queryArcGisSource(source, true);
    parsed = features.map(feature => parseSourceFeature(sourceKey, feature)).filter(Boolean);
  }
  return { sourceKey, source, features, parsed };
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
    if (!seen.has(key)) seen.set(key, { ...record, avoid: Boolean(record.avoid), included: record.avoid ? false : true, territoryId: null });
  }
  return [...seen.values()];
}
function mergeAvoidAddresses(records, existingAvoids) {
  const merged = records.map(record => ({ ...record, avoid: Boolean(record.avoid), included: record.avoid ? false : record.included !== false, territoryId: record.avoid ? null : record.territoryId || null }));
  for (const avoid of existingAvoids) {
    if (!pointInsideBoundary(avoid)) continue;
    const avoidKey = normalizeAddressKey(avoid.baseAddress || avoid.address, false);
    let match = merged.find(record => normalizeAddressKey(record.baseAddress || record.address, false) === avoidKey);
    if (!match) {
      const parsed = splitStreetSort(avoid.address || '');
      match = merged.find(record => {
        const candidate = splitStreetSort(record.address || '');
        return parsed.number && candidate.number === parsed.number && parsed.street && candidate.street === parsed.street && distanceMiles(record, avoid) <= 0.08;
      });
    }
    if (match) {
      match.avoid = true;
      match.included = false;
      match.territoryId = null;
      match.avoidSource = avoid.avoidSource || avoid.source || '';
    } else {
      merged.push({ ...avoid, avoid: true, included: false, territoryId: null });
    }
  }
  return merged;
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
  const retainedAvoids = houses.filter(house => house.avoid).map(house => ({ ...house }));
  try {
  let result;
  let fallbackUsed = false;
  let primaryError = null;
  try {
    result = await loadParsedSource(sourceKey);
  } catch (error) {
    primaryError = error;
  }
  if ((!result || !result.parsed.length) && sourceKey !== 'colorado') {
    fallbackUsed = true;
    els.addressMessage.textContent = `${source.label} was unavailable or returned no usable addresses. Retrying with the Colorado Public Address Composite…`;
    try {
      result = await loadParsedSource('colorado');
    } catch (fallbackError) {
      const primaryMessage = primaryError?.message ? `${primaryError.message} ` : '';
      throw new Error(`${primaryMessage}Statewide fallback also failed: ${fallbackError.message}`.trim());
    }
  }
  if (!result) throw primaryError || new Error(`${source.label} returned no data.`);
  const refreshedAddresses = dedupeAddressRecords(result.parsed);
  houses = mergeAvoidAddresses(refreshedAddresses, retainedAvoids).map(item => ({ ...item, id: String(item.id || uniqueId('address')) }));
  territories = [];
  selectedHouseIds.clear();
  currentPlanId = null;
  renderAllPlanningData();
  const sourceNote = fallbackUsed ? `${result.source.label} fallback` : result.source.label;
  if (!houses.length) {
    els.addressMessage.textContent = `The ${sourceNote} responded, but no usable address points were found inside this boundary. Confirm the boundary is over the intended neighborhood, or try the Colorado Public Address Composite from the source menu.`;
    toast('The GIS service responded, but no addresses were found inside this boundary.', true);
  } else {
    const avoidCount = houses.filter(house => house.avoid).length;
    els.addressMessage.textContent = `${houses.length.toLocaleString()} address or parcel records loaded from ${sourceNote}${avoidCount ? `, including ${avoidCount.toLocaleString()} retained avoid address${avoidCount === 1 ? '' : 'es'}` : ''}. Review duplicates, apartments, commercial records, access, and local territory limits before use.`;
    toast(`${houses.length.toLocaleString()} address records loaded${fallbackUsed ? ' using the statewide fallback' : ''}${avoidCount ? `; ${avoidCount} avoid address${avoidCount === 1 ? '' : 'es'} retained` : ''}.`);
  }
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
  const avoid = Boolean(record.avoid);
  houses.push({
    ...record,
    id: String(record.id || uniqueId('address')),
    avoid,
    included: avoid ? false : record.included !== false,
    territoryId: avoid ? null : record.territoryId || null
  });
  return true;
}
function findExistingHouseForAvoid(address, candidate) {
  const key = normalizeAddressKey(address, false);
  let match = houses.find(house => normalizeAddressKey(house.baseAddress || house.address, false) === key);
  if (match) return match;
  const target = splitStreetSort(address || '');
  if (!target.number || !target.street) return null;
  const nearby = houses
    .filter(house => {
      const parsed = splitStreetSort(house.address || '');
      return parsed.number === target.number && parsed.street === target.street;
    })
    .map(house => ({ house, miles: distanceMiles(house, candidate) }))
    .sort((a, b) => a.miles - b.miles);
  return nearby[0]?.miles <= 0.08 ? nearby[0].house : null;
}
function markHouseAvoid(house) {
  house.avoid = true;
  house.included = false;
  house.territoryId = null;
  house.classification = house.classification || 'Avoid / do not visit';
}
function markSelectedAvoid() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id) && !house.avoid);
  if (!selected.length) { toast('All selected addresses are already marked to avoid.', true); return; }
  if (!confirm(`Mark ${selected.length} selected address${selected.length === 1 ? '' : 'es'} as Avoid / Do Not Visit? They will be removed from territory assignments.`)) return;
  selected.forEach(markHouseAvoid);
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  toast(`${selected.length} address${selected.length === 1 ? '' : 'es'} marked with red avoid dots.`);
}
function restoreSelectedAvoid() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id) && house.avoid);
  if (!selected.length) { toast('Select one or more red avoid addresses first.', true); return; }
  if (!confirm(`Restore ${selected.length} avoid address${selected.length === 1 ? '' : 'es'} to the unassigned address list?`)) return;
  for (const house of selected) {
    house.avoid = false;
    house.included = true;
    house.territoryId = null;
    if (house.classification === 'Avoid / do not visit') house.classification = 'Manual address';
  }
  renderAllPlanningData();
  toast(`${selected.length} address${selected.length === 1 ? '' : 'es'} restored as unassigned.`);
}
async function addAvoidAddress() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary before adding an avoid address.', true); return; }
  const address = clean(els.avoidAddressInput.value);
  if (!address) { toast('Enter the complete address to avoid.', true); els.avoidAddressInput.focus(); return; }
  const button = els.addAvoidAddressButton;
  button.disabled = true;
  button.textContent = 'Locating…';
  els.avoidAddressMessage.textContent = 'Locating the address and checking the current congregation boundary…';
  els.avoidAddressMessage.dataset.state = 'working';
  try {
    const result = await geocodeAvoidAddress(address);
    const candidate = { lat: Number(result.lat), lng: Number(result.lng) };
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) throw new Error('The address service returned invalid coordinates.');
    if (!pointInsideBoundary(candidate)) {
      throw new Error('The matched address is outside the current congregation boundary. Verify the address or enlarge the boundary first.');
    }
    let house = findExistingHouseForAvoid(result.matchedAddress || address, candidate);
    let added = false;
    if (!house) {
      const record = {
        id: uniqueId('avoid'),
        address: result.matchedAddress || address,
        baseAddress: result.matchedAddress || address,
        unit: '',
        lat: candidate.lat,
        lng: candidate.lng,
        source: `Manual avoid address — ${result.source}`,
        avoidSource: result.source,
        residential: true,
        classification: 'Avoid / do not visit',
        avoid: true,
        included: false,
        territoryId: null
      };
      added = addHouseRecord(record);
      house = houses.find(item => item.id === record.id) || findExistingHouseForAvoid(record.address, candidate);
    }
    if (!house) throw new Error('The address could not be added to the map.');
    markHouseAvoid(house);
    selectedHouseIds = new Set([house.id]);
    recalculateTerritoryHouseIds();
    renderAllPlanningData();
    map?.setView([house.lat, house.lng], Math.max(map.getZoom(), 17), { animate: true });
    houseMarkers.get(house.id)?.openPopup();
    els.avoidAddressInput.value = '';
    els.avoidAddressMessage.textContent = `${house.address} is marked Avoid / Do Not Visit with a red dot.`;
    els.avoidAddressMessage.dataset.state = 'success';
    toast(`${added ? 'Added' : 'Updated'} avoid address: ${house.address}`);
  } catch (error) {
    els.avoidAddressMessage.textContent = `Could not add the avoid address: ${friendlyError(error)}`;
    els.avoidAddressMessage.dataset.state = 'error';
    toast(`Could not add the avoid address: ${friendlyError(error)}`, true);
  } finally {
    button.disabled = !isAdmin();
    button.textContent = 'Locate & Add Avoid Address';
  }
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
  if (house.avoid) {
    if (selectedHouseIds.has(house.id)) return { radius: 8, color: '#ffbd00', weight: 3, fillColor: '#c9362b', fillOpacity: 1 };
    return { radius: 6, color: '#fff', weight: 2.2, fillColor: '#c9362b', fillOpacity: 1 };
  }
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
    const avoidNotice = house.avoid ? '<br><span class="avoid-popup-badge">AVOID / DO NOT VISIT</span>' : '';
    marker.bindPopup(`<div class="house-popup"><strong>${escapeHtml(house.address)}</strong>${avoidNotice}<br>${escapeHtml(house.source || '')}<br><small>${escapeHtml(house.classification || '')}${house.unitCount > 1 ? ` • ${house.unitCount} assessor units` : ''}</small></div>`);
    marker.on('click', event => {
      L.DomEvent.stopPropagation(event);
      toggleHouseSelection(house.id);
    });
    houseMarkers.set(house.id, marker);
  }
}

function drawManualTerritoryBoundary() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary first.', true); return; }
  const suggested = nextTerritoryName();
  const name = clean(prompt('Territory name:', suggested));
  if (!name) return;
  cancelTerritoryBoundaryEdit(false);
  pendingTerritoryName = name;
  drawMode = 'territory-new';
  new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: TERRITORY_COLORS[territories.length % TERRITORY_COLORS.length], weight: 3, fillOpacity: .12 }
  }).enable();
  toast('Draw the territory boundary. Unassigned houses inside it will be added automatically.');
}
function cancelTerritoryBoundaryEdit(showNotice = true) {
  if (territoryEditToolbar) {
    try { territoryEditToolbar.disable(); } catch { /* no-op */ }
  }
  const wasEditing = Boolean(activeTerritoryEditId);
  territoryEditToolbar = null;
  activeTerritoryEditId = null;
  territoryEditGroup?.clearLayers();
  if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
  if (wasEditing) renderAllPlanningData();
  if (wasEditing && showNotice) toast('Territory-boundary editing canceled.');
}
function editTerritoryBoundary(id) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === id);
  if (!territory) return;
  const geometry = territoryGeometry(territory);
  if (!geometry) { toast('This territory needs at least one house or a manually drawn boundary.', true); return; }
  cancelTerritoryBoundaryEdit(false);
  activeTerritoryEditId = id;
  territoryGroup.clearLayers();
  territoryEditGroup.clearLayers();
  const color = TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length];
  const editableGeoJson = L.geoJSON(geometry, {
    style: { color, weight: 4, fillColor: color, fillOpacity: .16 }
  });
  editableGeoJson.eachLayer(layer => territoryEditGroup.addLayer(layer));
  if (territoryEditGroup.getBounds?.().isValid()) map.fitBounds(territoryEditGroup.getBounds(), { padding: [38, 38], maxZoom: 18 });
  territoryEditToolbar = new L.EditToolbar.Edit(map, { featureGroup: territoryEditGroup });
  territoryEditToolbar.enable();
  if (els.territoryEditMessage) {
    els.territoryEditMessage.hidden = false;
    els.territoryEditMessage.textContent = `Editing ${territory.name}. Move the white handles, then use the map toolbar checkmark to save or X to cancel.`;
  }
  toast(`Editing ${territory.name}. Move the handles, then save with the map toolbar.`);
}
function resetTerritoryBoundary(id) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === id);
  if (!territory?.geometry) return;
  if (!confirm(`Return ${territory.name} to an automatically calculated outline around its assigned houses?`)) return;
  territory.geometry = null;
  territory.manualBoundary = false;
  renderAllPlanningData();
  toast(`${territory.name} now uses its automatic house outline.`);
}
function syncTerritoryHomesToBoundary(id) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === id);
  if (!territory) return;
  const geometry = territoryGeometry(territory);
  if (!geometry) { toast('This territory does not have a usable boundary.', true); return; }
  const insideIds = new Set();
  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    try {
      if (turf.booleanPointInPolygon(pointFeature(house), geometry)) insideIds.add(house.id);
    } catch { /* no-op */ }
  }
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
}

function territoryGeometry(territory) {
  if (territory?.geometry) return turf.feature(JSON.parse(JSON.stringify(territory.geometry)));
  const points = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).map(pointFeature);
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
    const manuallyEdited = Boolean(territory.geometry);
    const layer = L.geoJSON(geometry, { style: {
      color,
      weight: manuallyEdited ? 3.2 : 2.4,
      dashArray: manuallyEdited ? null : '7 5',
      fillColor: color,
      fillOpacity: manuallyEdited ? .18 : .12
    } }).addTo(territoryGroup);
    layer.bindTooltip(`${territory.name} — ${territory.houseIds.length} houses${manuallyEdited ? ' — edited boundary' : ' — automatic outline'}`, { sticky: true });
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
    if (!house.included || house.avoid) continue;
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
  const selected = houses.filter(house => selectedHouseIds.has(house.id));
  const selectedAvoid = selected.filter(house => house.avoid).length;
  const eligible = selected.filter(house => house.included && !house.avoid).length;
  els.selectionCount.textContent = `${selected.length.toLocaleString()} house${selected.length === 1 ? '' : 's'} selected${selectedAvoid ? ` • ${selectedAvoid} avoid` : ''}`;
  els.assignSelectedButton.disabled = !eligible || !isAdmin();
  els.newTerritoryButton.disabled = !eligible || !isAdmin();
  els.excludeSelectionButton.disabled = !selected.some(house => !house.avoid) || !isAdmin();
  els.markAvoidButton.disabled = !selected.some(house => !house.avoid) || !isAdmin();
  els.restoreAvoidButton.disabled = !selectedAvoid || !isAdmin();
}
function includeExcludeSelected() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id) && !house.avoid);
  if (!selected.length) { toast('Avoid addresses must be restored with the Restore Selected button.', true); return; }
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
function medianValue(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function streetSequenceInfo(item) {
  const address = clean(item.address || item.baseAddress || '');
  const parsed = splitStreetSort(address) || {};
  const fallbackNumber = Number(address.match(/^\s*(\d+)/)?.[1]) || 0;
  const parsedNumber = Number(parsed.number);
  const number = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : fallbackNumber;
  const street = clean(parsed.street || address.replace(/^\s*\d+[A-Za-z]?\s+/, ''));
  const streetKey = street.toUpperCase().replace(/\s+/g, ' ') || `UNNAMED-${Number(item.lat).toFixed(4)}-${Number(item.lng).toFixed(4)}`;
  return { street, streetKey, number };
}
function streetSequenceRuns(items) {
  const byStreet = new Map();
  for (const item of items) {
    const info = streetSequenceInfo(item);
    if (!byStreet.has(info.streetKey)) byStreet.set(info.streetKey, []);
    byStreet.get(info.streetKey).push({ item, info });
  }
  const runs = [];
  for (const entries of byStreet.values()) {
    entries.sort((a, b) => a.info.number - b.info.number || a.item.address.localeCompare(b.item.address) || b.item.lat - a.item.lat || a.item.lng - b.item.lng);
    const numberGaps = [];
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1].info.number;
      const current = entries[index].info.number;
      if (previous > 0 && current > previous) numberGaps.push(current - previous);
    }
    const typicalGap = medianValue(numberGaps) || 10;
    let run = [];
    for (const entry of entries) {
      const previous = run[run.length - 1];
      if (previous) {
        const mapGap = distanceMiles(previous.item, entry.item);
        const numberGap = previous.info.number > 0 && entry.info.number > 0 ? Math.abs(entry.info.number - previous.info.number) : 0;
        const numberBreak = numberGap > Math.max(120, typicalGap * 8);
        const mapBreak = mapGap > 0.45;
        if (numberBreak || mapBreak) {
          runs.push(run.map(value => value.item));
          run = [];
        }
      }
      run.push(entry);
    }
    if (run.length) runs.push(run.map(value => value.item));
  }
  return runs;
}
function balancedStreetChunks(run, target) {
  const maximumSize = Math.max(target, Math.round(target * 1.25));
  const chunkCount = Math.max(1, Math.ceil(run.length / maximumSize));
  const baseSize = Math.floor(run.length / chunkCount);
  const remainder = run.length % chunkCount;
  const chunks = [];
  let cursor = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    chunks.push(run.slice(cursor, cursor + size));
    cursor += size;
  }
  return chunks.filter(chunk => chunk.length);
}
function sequenceGroupCenter(group) {
  return {
    lat: group.reduce((sum, item) => sum + Number(item.lat), 0) / group.length,
    lng: group.reduce((sum, item) => sum + Number(item.lng), 0) / group.length
  };
}
function endpointDistance(group, candidate) {
  if (!group.length || !candidate.length) return Number.POSITIVE_INFINITY;
  const groupEnds = [group[0], group[group.length - 1]];
  const candidateEnds = [candidate[0], candidate[candidate.length - 1]];
  let best = Number.POSITIVE_INFINITY;
  for (const a of groupEnds) for (const b of candidateEnds) best = Math.min(best, distanceMiles(a, b));
  return best;
}
function orientChunkToward(chunk, anchor) {
  if (!anchor || chunk.length < 2) return [...chunk];
  return distanceMiles(anchor, chunk[0]) <= distanceMiles(anchor, chunk[chunk.length - 1]) ? [...chunk] : [...chunk].reverse();
}
function orderTerritoryGroups(groups) {
  const remaining = groups.map(group => [...group]);
  const ordered = [];
  let previous = null;
  while (remaining.length) {
    let chosenIndex = 0;
    if (!previous) {
      remaining.forEach((group, index) => {
        const center = sequenceGroupCenter(group);
        const chosenCenter = sequenceGroupCenter(remaining[chosenIndex]);
        if (center.lat > chosenCenter.lat || (center.lat === chosenCenter.lat && center.lng < chosenCenter.lng)) chosenIndex = index;
      });
    } else {
      let bestDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((group, index) => {
        const distance = endpointDistance(previous, group);
        if (distance < bestDistance) { bestDistance = distance; chosenIndex = index; }
      });
    }
    let chosen = remaining.splice(chosenIndex, 1)[0];
    if (previous?.length) chosen = orientChunkToward(chosen, previous[previous.length - 1]);
    ordered.push(chosen);
    previous = chosen;
  }
  return ordered;
}
function streetGroups(items, target) {
  const minimumStandalone = Math.max(4, Math.floor(target * 0.60));
  const maximumSize = Math.max(target, Math.round(target * 1.25));
  const chunks = streetSequenceRuns(items).flatMap(run => balancedStreetChunks(run, target));
  const groups = chunks.filter(chunk => chunk.length >= minimumStandalone).map(chunk => [...chunk]);
  const loose = chunks.filter(chunk => chunk.length < minimumStandalone).map(chunk => [...chunk]);

  loose.sort((a, b) => {
    const aa = sequenceGroupCenter(a), bb = sequenceGroupCenter(b);
    return bb.lat - aa.lat || aa.lng - bb.lng;
  });
  while (loose.length) {
    let group = loose.shift();
    while (group.length < target && loose.length) {
      let nearestIndex = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      loose.forEach((candidate, index) => {
        if (group.length + candidate.length > maximumSize) return;
        const distance = endpointDistance(group, candidate);
        if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
      });
      if (nearestIndex < 0) break;
      const candidate = loose.splice(nearestIndex, 1)[0];
      group.push(...orientChunkToward(candidate, group[group.length - 1]));
    }
    groups.push(group);
  }
  return orderTerritoryGroups(groups);
}
function nextTerritoryName(index = territories.length) {
  const prefix = clean(els.territoryPrefix.value).toUpperCase() || initialPrefix(selectedCongregation);
  return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}
function automaticGrouping() {
  if (!requireAdmin()) return;
  const included = houses.filter(house => house.included && !house.avoid);
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
  houses.forEach(house => { house.territoryId = house.included && !house.avoid ? assignment.get(house.id) || null : null; });
  clearSelection();
  renderAllPlanningData();
  toast(`${territories.length} territories created using a target of ${target} houses. Sequential mode keeps each street in contiguous house-number blocks and combines only short nearby runs.`);
}
function recalculateTerritoryHouseIds() {
  for (const territory of territories) territory.houseIds = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).map(house => house.id);
  territories = territories.filter(territory => territory.houseIds.length || territory.geometry);
}
function updateAssignmentSelector() {
  const previousAssignment = els.assignTerritorySelect.value;
  const previousPdf = els.pdfTerritorySelect?.value;
  const options = territories.map(territory => `<option value="${escapeHtml(territory.id)}">${escapeHtml(territory.name)} (${territory.houseIds.length})</option>`).join('');
  els.assignTerritorySelect.innerHTML = '<option value="">Unassigned</option>' + options;
  if (previousAssignment && territories.some(item => item.id === previousAssignment)) els.assignTerritorySelect.value = previousAssignment;
  if (els.pdfTerritorySelect) {
    els.pdfTerritorySelect.innerHTML = territories.length ? options : '<option value="">Create a territory first</option>';
    if (previousPdf && territories.some(item => item.id === previousPdf)) els.pdfTerritorySelect.value = previousPdf;
    else if (territories[0]) els.pdfTerritorySelect.value = territories[0].id;
  }
  if (els.exportTerritoryPdfButton) els.exportTerritoryPdfButton.disabled = !territories.length || !isAdmin();
}
function assignSelected() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const territoryId = els.assignTerritorySelect.value || null;
  for (const house of houses) if (selectedHouseIds.has(house.id) && house.included && !house.avoid) house.territoryId = territoryId;
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  toast(territoryId ? 'Selected houses assigned to the chosen territory.' : 'Selected houses moved to Unassigned.');
}
function newTerritoryFromSelected() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id) && house.included && !house.avoid);
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
  els.territoryList.innerHTML = territories.map(territory => {
    const included = territoryHousesSorted(territory);
    const color = TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length];
    const boundaryLabel = territory.geometry ? 'Edited/manual boundary' : 'Automatic outline';
    return `<article class="territory-row"><span class="territory-swatch" style="background:${color}"></span><div class="territory-main"><strong>${escapeHtml(territory.name)}${territory.geometry ? '<span class="manual-boundary-chip">Manual</span>' : ''}</strong><small>${included.length.toLocaleString()} houses • ${boundaryLabel}${included.length ? ` • ${escapeHtml(included[0].address)}${included.length > 1 ? ` through ${escapeHtml(included[included.length - 1].address)}` : ''}` : ''}</small></div><div class="row-actions"><button class="row-action" data-territory-zoom="${territory.id}">Zoom</button><button class="row-action" data-territory-select="${territory.id}">Homes</button><button class="row-action" data-territory-boundary="${territory.id}">Edit Boundary</button><button class="row-action" data-territory-sync="${territory.id}">Sync Homes</button><button class="row-action" data-territory-pdf="${territory.id}">PDF</button>${territory.geometry ? `<button class="row-action" data-territory-reset="${territory.id}">Auto Outline</button>` : ''}<button class="row-action" data-territory-rename="${territory.id}">Rename</button><button class="row-action danger" data-territory-delete="${territory.id}">Delete</button></div></article>`;
  }).join('');
  els.territoryList.querySelectorAll('[data-territory-zoom]').forEach(button => button.addEventListener('click', () => zoomTerritory(button.dataset.territoryZoom)));
  els.territoryList.querySelectorAll('[data-territory-select]').forEach(button => button.addEventListener('click', () => selectTerritoryHouses(button.dataset.territorySelect)));
  els.territoryList.querySelectorAll('[data-territory-boundary]').forEach(button => button.addEventListener('click', () => editTerritoryBoundary(button.dataset.territoryBoundary)));
  els.territoryList.querySelectorAll('[data-territory-sync]').forEach(button => button.addEventListener('click', () => syncTerritoryHomesToBoundary(button.dataset.territorySync)));
  els.territoryList.querySelectorAll('[data-territory-pdf]').forEach(button => button.addEventListener('click', () => exportTerritoryPdf(button.dataset.territoryPdf)));
  els.territoryList.querySelectorAll('[data-territory-reset]').forEach(button => button.addEventListener('click', () => resetTerritoryBoundary(button.dataset.territoryReset)));
  els.territoryList.querySelectorAll('[data-territory-rename]').forEach(button => button.addEventListener('click', () => renameTerritory(button.dataset.territoryRename)));
  els.territoryList.querySelectorAll('[data-territory-delete]').forEach(button => button.addEventListener('click', () => deleteTerritory(button.dataset.territoryDelete)));
}
function renderHouseList() {
  const query = clean(els.houseSearch.value).toLowerCase();
  const territoryById = new Map(territories.map(item => [item.id, item]));
  const filtered = houses.filter(house => {
    const territory = territoryById.get(house.territoryId);
    return !query || `${house.address} ${territory?.name || ''} ${house.source || ''} ${house.avoid ? 'avoid do not visit' : ''}`.toLowerCase().includes(query);
  }).sort((a, b) => Number(Boolean(b.avoid)) - Number(Boolean(a.avoid)) || a.address.localeCompare(b.address, undefined, { numeric: true }));
  const shown = filtered.slice(0, HOUSE_LIST_LIMIT);
  if (!shown.length) {
    els.houseList.innerHTML = `<div class="empty">${houses.length ? 'No addresses match this search.' : 'No addresses loaded.'}</div>`;
    return;
  }
  els.houseList.innerHTML = shown.map(house => {
    const territory = territoryById.get(house.territoryId);
    const color = house.avoid ? '#c9362b' : territory ? TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length] : house.included ? '#6b7c8f' : '#b44b43';
    const rowClass = `${selectedHouseIds.has(house.id) ? ' selected' : ''}${house.avoid ? ' avoid' : house.included ? '' : ' excluded'}`;
    const status = house.avoid ? 'Avoid' : house.included ? territory?.name || 'Unassigned' : 'Excluded';
    return `<article class="house-row${rowClass}" data-house-id="${escapeHtml(house.id)}"><span class="house-dot" style="background:${color}"></span><div><strong>${escapeHtml(house.address)}</strong><small>${escapeHtml(house.source || '')}${house.classification ? ` • ${escapeHtml(house.classification)}` : ''}${house.unitCount > 1 ? ` • ${house.unitCount} assessor units` : ''}</small></div><span class="territory-tag">${escapeHtml(status)}</span></article>`;
  }).join('') + (filtered.length > HOUSE_LIST_LIMIT ? `<div class="list-limit">Showing the first ${HOUSE_LIST_LIMIT.toLocaleString()} of ${filtered.length.toLocaleString()} matching addresses. Use search or the map to narrow the list.</div>` : '');
  els.houseList.querySelectorAll('[data-house-id]').forEach(row => row.addEventListener('click', () => toggleHouseSelection(row.dataset.houseId)));
}

function updateSummary() {
  const includedCount = houses.filter(house => house.included && !house.avoid).length;
  const avoidCount = houses.filter(house => house.avoid).length;
  els.summaryHall.textContent = selectedHall ? `${markerLabel(selectedHall)} — ${selectedHall.name}` : '—';
  els.summaryCongregation.textContent = selectedCongregation || '—';
  els.summaryHouses.textContent = includedCount.toLocaleString();
  els.summaryAvoid.textContent = avoidCount.toLocaleString();
  els.summaryTerritories.textContent = territories.length.toLocaleString();
  els.houseCountChip.textContent = `${houses.length.toLocaleString()} loaded${avoidCount ? ` • ${avoidCount.toLocaleString()} avoid` : ''}`;
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
    boundaryJson: encodeGeometry(boundaryGeometry),
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
    avoid: Boolean(house.avoid), avoidSource: house.avoidSource || '', territoryId: house.avoid ? null : house.territoryId || null,
    rawId: house.rawId ?? null
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
      boundaryJson: encodeGeometry(boundaryGeometry),
      boundaryName: clean(els.boundaryName.value) || `${selectedCongregation} service area`,
      sourceKey: currentSourceKey(),
      targetSize: targetSizeValue(),
      groupingMethod: els.groupingMethod.value,
      residentialOnly: els.residentialOnly.checked,
      separateUnits: els.separateUnits.checked,
      houseCount: houses.length,
      includedHouseCount: houses.filter(house => house.included && !house.avoid).length,
      avoidHouseCount: houses.filter(house => house.avoid).length,
      territoriesJson: JSON.stringify(territories.map(item => ({ id: item.id, name: item.name, colorIndex: item.colorIndex, houseIds: [...item.houseIds], geometryJson: encodeGeometry(item.geometry), manualBoundary: Boolean(item.geometry) }))),
      territoryCount: territories.length,
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
  els.savedPlans.innerHTML = plans.length ? plans.map(item => `<article class="saved-row"><div><strong>${escapeHtml(item.planName || 'Saved territory plan')}</strong><small>${escapeHtml(item.hallLabel || '')} ${escapeHtml(item.hallName || '')} • ${escapeHtml(item.congregation || '')} • ${(item.houseCount || 0).toLocaleString()} addresses${item.avoidHouseCount ? ` • ${Number(item.avoidHouseCount).toLocaleString()} avoid` : ''} • ${savedTerritoryCount(item)} territories • ${escapeHtml(formatDate(item.updatedAt))}</small></div><div class="row-actions"><button class="row-action" data-load-plan="${item.id}">Load</button><button class="row-action danger" data-delete-plan="${item.id}">Delete</button></div></article>`).join('') : '<div class="empty">No territory plans saved yet.</div>';
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
  const savedBoundary = decodeGeometry(item?.boundaryJson, item?.boundary);
  if (!savedBoundary) return;
  if ((houses.length || boundaryGeometry) && !confirm('Replace the current unsaved workspace with this saved boundary?')) return;
  clearPlanWorkspace(false);
  restoreHallAndCongregation(item.hallId, item.congregation);
  currentBoundaryId = item.id;
  els.boundaryName.value = item.name || '';
  els.sourceSelect.value = item.sourceHint && ASSESSOR_SOURCES[item.sourceHint] ? item.sourceHint : 'auto';
  setBoundaryGeometry(savedBoundary, true);
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
  els.groupingMethod.value = plan.groupingMethod || 'street';
  els.residentialOnly.checked = plan.residentialOnly !== false;
  els.separateUnits.checked = Boolean(plan.separateUnits);
  const target = Number(plan.targetSize) || 30;
  if ([10, 20, 30, 40].includes(target)) els.targetSize.value = String(target);
  else { els.targetSize.value = 'custom'; els.customTarget.value = target; els.customTargetWrap.hidden = false; }
  boundaryGeometry = decodeGeometry(plan.boundaryJson, plan.boundary);
  if (boundaryGeometry) {
    boundaryGroup.clearLayers();
    const layer = L.geoJSON(boundaryGeometry, { style: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 } }).addTo(boundaryGroup);
    if (layer.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 15 });
  }
  houses = loadedHouses.map(item => {
    const avoid = Boolean(item.avoid);
    return { ...item, id: String(item.id), avoid, included: avoid ? false : item.included !== false, territoryId: avoid ? null : item.territoryId || null };
  });
  const savedTerritoriesForPlan = decodeTerritories(plan);
  territories = savedTerritoriesForPlan.map((item, index) => {
    const geometry = decodeGeometry(item.geometryJson, item.geometry);
    return { id: String(item.id || uniqueId('territory')), name: item.name || nextTerritoryName(index), colorIndex: Number(item.colorIndex) || index, houseIds: [...(item.houseIds || [])], geometry, manualBoundary: Boolean(geometry) };
  });
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
    recordType: house.avoid ? 'avoid-address' : 'ministry-address', address: house.address, source: house.source, included: house.included, avoid: Boolean(house.avoid),
    territoryId: house.avoid ? '' : house.territoryId || '', territoryName: house.avoid ? '' : territoryById.get(house.territoryId) || ''
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
  const rows = [['territory','address','latitude','longitude','included','avoid','source','classification','unit_count']];
  houses.forEach(house => rows.push([
    territoryById.get(house.territoryId) || '', house.address, Number(house.lat).toFixed(6), Number(house.lng).toFixed(6),
    house.included && !house.avoid ? 'Yes' : 'No', house.avoid ? 'Yes' : 'No', house.source || '', house.classification || '', house.unitCount || 1
  ]));
  const filename = `${slug(clean(els.planName.value) || selectedCongregation || 'territory-plan')}.csv`;
  downloadText(filename, rows.map(row => row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates || [];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
  return [];
}
function hexRgb(hex) {
  const value = String(hex || '#0b5b9f').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value.padEnd(6, '0').slice(0, 6);
  return [parseInt(normalized.slice(0, 2), 16), parseInt(normalized.slice(2, 4), 16), parseInt(normalized.slice(4, 6), 16)];
}
function territoryHousesSorted(territory) {
  return houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).sort((a, b) => {
    const aa = splitStreetSort(a.address), bb = splitStreetSort(b.address);
    return aa.street.localeCompare(bb.street) || aa.number - bb.number || a.address.localeCompare(b.address);
  });
}
function avoidHousesInsideGeometry(geometry) {
  if (!geometry) return [];
  const feature = geometry.type === 'Feature' ? geometry : turf.feature(geometry.geometry || geometry);
  return houses.filter(house => {
    if (!house.avoid) return false;
    try { return turf.booleanPointInPolygon(pointFeature(house), feature); }
    catch { return false; }
  }).sort((a, b) => {
    const aa = splitStreetSort(a.address), bb = splitStreetSort(b.address);
    return aa.street.localeCompare(bb.street) || aa.number - bb.number || a.address.localeCompare(b.address);
  });
}
function addressHouseNumber(address = '') {
  const match = clean(address).match(/^\s*(\d+[A-Za-z]?)/);
  return match ? match[1] : '';
}
async function imageDataUrl(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Logo could not be loaded (${response.status}).`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function webMercatorWorldPoint(lng, lat, zoom) {
  const worldSize = 256 * (2 ** zoom);
  const safeLng = Number(lng);
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const radians = safeLat * Math.PI / 180;
  return {
    x: ((safeLng + 180) / 360) * worldSize,
    y: ((1 - Math.log(Math.tan(radians) + (1 / Math.cos(radians))) / Math.PI) / 2) * worldSize
  };
}
function territoryStreetMapPoints(territoryHouses, geometry, avoidHouses = []) {
  const rings = geometryRings(geometry?.geometry || geometry);
  return [
    ...rings.flat().map(point => [Number(point[0]), Number(point[1])]),
    ...territoryHouses.map(house => [Number(house.lng), Number(house.lat)]),
    ...avoidHouses.map(house => [Number(house.lng), Number(house.lat)])
  ].filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}
function territoryStreetMapViewport(territoryHouses, geometry, avoidHouses = []) {
  const width = 1050;
  const height = 992;
  const padding = 72;
  const points = territoryStreetMapPoints(territoryHouses, geometry, avoidHouses);
  if (!points.length) return null;
  let selected = null;
  for (let zoom = 18; zoom >= 11; zoom -= 1) {
    const worldPoints = points.map(([lng, lat]) => webMercatorWorldPoint(lng, lat, zoom));
    const minX = Math.min(...worldPoints.map(point => point.x));
    const maxX = Math.max(...worldPoints.map(point => point.x));
    const minY = Math.min(...worldPoints.map(point => point.y));
    const maxY = Math.max(...worldPoints.map(point => point.y));
    selected = { zoom, minX, maxX, minY, maxY };
    if ((maxX - minX) <= width - (padding * 2) && (maxY - minY) <= height - (padding * 2)) break;
  }
  const centerX = (selected.minX + selected.maxX) / 2;
  const centerY = (selected.minY + selected.maxY) / 2;
  return {
    width,
    height,
    zoom: selected.zoom,
    left: centerX - (width / 2),
    top: centerY - (height / 2)
  };
}
async function loadStreetMapTile(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Street-map tile could not be loaded (${response.status}).`);
  const blob = await response.blob();
  if (globalThis.createImageBitmap) return await createImageBitmap(blob);
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Street-map tile image could not be decoded.')); };
    image.src = objectUrl;
  });
}
async function buildTerritoryStreetMap(territoryHouses, geometry, avoidHouses = []) {
  const viewport = territoryStreetMapViewport(territoryHouses, geometry, avoidHouses);
  if (!viewport) return null;
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f2efe9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const tileSize = 256;
  const tileCount = 2 ** viewport.zoom;
  const firstX = Math.floor(viewport.left / tileSize);
  const lastX = Math.floor((viewport.left + viewport.width) / tileSize);
  const firstY = Math.floor(viewport.top / tileSize);
  const lastY = Math.floor((viewport.top + viewport.height) / tileSize);
  const jobs = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const drawX = (tileX * tileSize) - viewport.left;
      const drawY = (tileY * tileSize) - viewport.top;
      const url = `https://tile.openstreetmap.org/${viewport.zoom}/${wrappedX}/${tileY}.png`;
      jobs.push(loadStreetMapTile(url).then(image => {
        context.drawImage(image, drawX, drawY, tileSize, tileSize);
        if (typeof image.close === 'function') image.close();
        return true;
      }).catch(error => {
        console.warn('A street-map tile could not be loaded.', error);
        return false;
      }));
    }
  }
  const results = await Promise.all(jobs);
  if (!results.some(Boolean)) throw new Error('The street map could not be loaded.');
  return {
    ...viewport,
    dataUrl: canvas.toDataURL('image/jpeg', 0.90)
  };
}
function projectStreetMapPoint(streetMap, lng, lat, mapX, mapY, mapW, mapH) {
  const point = webMercatorWorldPoint(lng, lat, streetMap.zoom);
  return [
    mapX + (((point.x - streetMap.left) / streetMap.width) * mapW),
    mapY + (((point.y - streetMap.top) / streetMap.height) * mapH)
  ];
}

function drawPdfHeader(doc, logoData, title, subtitle = '') {
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
}
function drawPdfFooter(doc, pageNumber, pageCount) {
  doc.setDrawColor(211, 220, 228);
  doc.line(0.35, 8.12, 10.65, 8.12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(94, 106, 119);
  doc.text('Denver 2027 Convention ministry territory — verify addresses, access, and boundaries locally before use.', 0.35, 8.32);
  doc.text(`Page ${pageNumber} of ${pageCount}`, 10.65, 8.32, { align: 'right' });
}
function drawTerritoryPdfMap(doc, territory, territoryHouses, geometry, streetMap = null, avoidHouses = []) {
  const mapX = 0.42, mapY = 1.18, mapW = 7.05, mapH = 6.66;
  if (streetMap?.dataUrl) {
    doc.addImage(streetMap.dataUrl, 'JPEG', mapX, mapY, mapW, mapH, undefined, 'FAST');
  } else {
    doc.setFillColor(248, 250, 252);
    doc.rect(mapX, mapY, mapW, mapH, 'F');
  }
  doc.setDrawColor(174, 190, 204);
  doc.setLineWidth(.018);
  doc.roundedRect(mapX, mapY, mapW, mapH, 0.08, 0.08, 'S');
  const rings = geometryRings(geometry.geometry || geometry);
  const allCoords = rings.flat();
  const points = [...allCoords, ...territoryHouses.map(house => [Number(house.lng), Number(house.lat)]), ...avoidHouses.map(house => [Number(house.lng), Number(house.lat)])];
  if (!points.length) return;
  let project;
  if (streetMap?.dataUrl) {
    project = ([lng, lat]) => projectStreetMapPoint(streetMap, lng, lat, mapX, mapY, mapW, mapH);
  } else {
    let minLng = Math.min(...points.map(point => point[0]));
    let maxLng = Math.max(...points.map(point => point[0]));
    let minLat = Math.min(...points.map(point => point[1]));
    let maxLat = Math.max(...points.map(point => point[1]));
    const lngPad = Math.max((maxLng - minLng) * .08, .00035);
    const latPad = Math.max((maxLat - minLat) * .08, .00035);
    minLng -= lngPad; maxLng += lngPad; minLat -= latPad; maxLat += latPad;
    const meanLat = ((minLat + maxLat) / 2) * Math.PI / 180;
    const cosLat = Math.max(.2, Math.cos(meanLat));
    const minX = minLng * cosLat, maxX = maxLng * cosLat;
    const spanX = Math.max(maxX - minX, .000001), spanY = Math.max(maxLat - minLat, .000001);
    const scale = Math.min((mapW - .30) / spanX, (mapH - .38) / spanY);
    const usedW = spanX * scale, usedH = spanY * scale;
    const offsetX = mapX + (mapW - usedW) / 2;
    const offsetY = mapY + (mapH - usedH) / 2;
    project = ([lng, lat]) => [offsetX + ((lng * cosLat) - minX) * scale, offsetY + (maxLat - lat) * scale];
  }
  const color = hexRgb(TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length]);
  if (streetMap?.dataUrl) {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(.060);
    for (const ring of rings) {
      for (let index = 1; index < ring.length; index += 1) {
        const [x1, y1] = project(ring[index - 1]);
        const [x2, y2] = project(ring[index]);
        doc.line(x1, y1, x2, y2);
      }
    }
  }
  doc.setDrawColor(...color);
  doc.setLineWidth(.030);
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index += 1) {
      const [x1, y1] = project(ring[index - 1]);
      const [x2, y2] = project(ring[index]);
      doc.line(x1, y1, x2, y2);
    }
  }
  territoryHouses.forEach((house, index) => {
    const [x, y] = project([Number(house.lng), Number(house.lat)]);
    doc.setFillColor(...color);
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(.016);
    doc.circle(x, y, .092, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.2);
    doc.setTextColor(255, 255, 255);
    doc.text(String(index + 1), x, y + .018, { align: 'center' });

    const houseNumber = addressHouseNumber(house.address);
  if (houseNumber) {
    const mapCenterX = mapX + (mapW / 2);
    const mapCenterY = mapY + (mapH / 2);
    const placeRight = x >= mapCenterX;
    const placeBelow = y >= mapCenterY;
    const labelW = Math.max(.24, Math.min(.50, .09 + (houseNumber.length * .067)));
    const labelH = .16;
    const horizontalGap = .115;
    const verticalGap = .065;
    let labelX = placeRight ? x + horizontalGap : x - horizontalGap - labelW;
    let labelY = placeBelow ? y + verticalGap : y - verticalGap - labelH;
    labelY += index % 2 === 0 ? -.015 : .015;
    labelX = Math.max(mapX + .025, Math.min(mapX + mapW - labelW - .025, labelX));
    labelY = Math.max(mapY + .025, Math.min(mapY + mapH - labelH - .025, labelY));
    const connectorX = placeRight ? labelX : labelX + labelW;
    const connectorY = labelY + (labelH / 2);
    const textX = labelX + (labelW / 2);
    const textY = labelY + .112;

    doc.setDrawColor(181, 197, 209);
    doc.setLineWidth(.006);
    doc.line(x + (placeRight ? .082 : -.082), y, connectorX, connectorY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.4);
    doc.setTextColor(255, 255, 255);
    const halo = .007;
    doc.text(houseNumber, textX - halo, textY, { align: 'center' });
    doc.text(houseNumber, textX + halo, textY, { align: 'center' });
    doc.text(houseNumber, textX, textY - halo, { align: 'center' });
    doc.text(houseNumber, textX, textY + halo, { align: 'center' });
    doc.setTextColor(139, 160, 176);
    doc.text(houseNumber, textX, textY, { align: 'center' });
  }
});
  avoidHouses.forEach((house, index) => {
  const [x, y] = project([Number(house.lng), Number(house.lat)]);
  doc.setFillColor(201, 54, 43);
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(.018);
  doc.circle(x, y, .088, 'FD');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(.014);
  doc.line(x - .034, y - .034, x + .034, y + .034);
  doc.line(x - .034, y + .034, x + .034, y - .034);
  const houseNumber = addressHouseNumber(house.address);
  if (houseNumber) {
    const placeRight = index % 2 === 0;
    const textX = placeRight ? x + .12 : x - .12;
    const textY = y + .018;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.1);
    doc.setTextColor(255, 255, 255);
    const halo = .007;
    doc.text(houseNumber, textX - halo, textY, { align: placeRight ? 'left' : 'right' });
    doc.text(houseNumber, textX + halo, textY, { align: placeRight ? 'left' : 'right' });
    doc.text(houseNumber, textX, textY - halo, { align: placeRight ? 'left' : 'right' });
    doc.text(houseNumber, textX, textY + halo, { align: placeRight ? 'left' : 'right' });
    doc.setTextColor(205, 112, 104);
    doc.text(houseNumber, textX, textY, { align: placeRight ? 'left' : 'right' });
  }
});
  if (streetMap?.dataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(195, 205, 214);
    doc.roundedRect(mapX + .07, mapY + mapH - .23, 1.68, .16, .03, .03, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.2);
    doc.setTextColor(73, 86, 101);
    doc.text('© OpenStreetMap contributors', mapX + .13, mapY + mapH - .12);
  }
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(193, 204, 214);
  doc.circle(mapX + mapW - .23, mapY + .36, .18, 'FD');
  doc.setTextColor(31, 52, 71);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('N', mapX + mapW - .23, mapY + .27, { align: 'center' });
  doc.setLineWidth(.018);
  doc.line(mapX + mapW - .23, mapY + .60, mapX + mapW - .23, mapY + .34);
  doc.line(mapX + mapW - .23, mapY + .34, mapX + mapW - .29, mapY + .43);
  doc.line(mapX + mapW - .23, mapY + .34, mapX + mapW - .17, mapY + .43);
}
function addAddressListPage(doc, logoData, territory, territoryHouses, startIndex) {
  doc.addPage('letter', 'landscape');
  drawPdfHeader(doc, logoData, `${territory.name} — Address List`, `${selectedCongregation} • ${selectedHall?.name || ''}`);
  const columnX = [0.45, 5.55];
  const columnWidth = 4.78;
  const startY = 1.18;
  const bottomY = 7.92;
  let index = startIndex;
  for (let column = 0; column < 2 && index < territoryHouses.length; column += 1) {
    let y = startY;
    while (index < territoryHouses.length) {
      const label = `${index + 1}.  ${territoryHouses[index].address}`;
      const lines = doc.splitTextToSize(label, columnWidth - .12);
      const needed = Math.max(.22, lines.length * .17 + .08);
      if (y + needed > bottomY) break;
      doc.setDrawColor(218, 225, 232);
      doc.setFillColor(255, 255, 255);
      doc.rect(columnX[column], y - .13, .14, .14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(39, 55, 72);
      doc.text(lines, columnX[column] + .22, y);
      y += needed;
      index += 1;
    }
  }
  return index;
}
function addAvoidAddressListPage(doc, logoData, territory, avoidHouses, startIndex) {
  doc.addPage('letter', 'landscape');
  drawPdfHeader(doc, logoData, `${territory.name} — Avoid / Do Not Visit`, `${selectedCongregation} • ${selectedHall?.name || ''}`);
  const columnX = [0.55, 5.55];
  const columnWidth = 4.72;
  const startY = 1.28;
  const bottomY = 7.92;
  let index = startIndex;
  for (let column = 0; column < 2 && index < avoidHouses.length; column += 1) {
    let y = startY;
    while (index < avoidHouses.length) {
      const label = avoidHouses[index].address;
      const lines = doc.splitTextToSize(label, columnWidth - .36);
      const needed = Math.max(.28, lines.length * .17 + .08);
      if (y + needed > bottomY) break;
      doc.setFillColor(201, 54, 43);
      doc.setDrawColor(255, 255, 255);
      doc.circle(columnX[column] + .08, y - .015, .065, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(143, 45, 38);
      doc.text(lines, columnX[column] + .22, y);
      y += needed;
      index += 1;
    }
  }
  return index;
}

async function exportTerritoryPdf(territoryId = els.pdfTerritorySelect?.value) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === territoryId);
  if (!territory) { toast('Choose a territory to print.', true); return; }
  const territoryHouses = territoryHousesSorted(territory);
  if (!territoryHouses.length) { toast('This territory does not have any assigned addresses.', true); return; }
  const geometry = territoryGeometry(territory);
  const avoidHouses = avoidHousesInsideGeometry(geometry);
  if (!geometry) { toast('This territory does not have a usable map boundary.', true); return; }
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) { toast('The PDF library did not load. Refresh the page and try again.', true); return; }
  const button = els.exportTerritoryPdfButton;
  if (button) { button.disabled = true; button.textContent = 'Building PDF…'; }
  try {
    let logoData = null;
    try { logoData = await imageDataUrl(new URL('../assets/denver-2027-logo.png', import.meta.url).href); } catch { /* PDF remains usable without image */ }
    let streetMap = null;
    try { streetMap = await buildTerritoryStreetMap(territoryHouses, geometry, avoidHouses); }
    catch (error) { console.warn('Street background could not be included in this PDF.', error); }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
    drawPdfHeader(doc, logoData, territory.name, `${selectedCongregation} • ${selectedHall?.name || ''} • ${territoryHouses.length} addresses${avoidHouses.length ? ` • ${avoidHouses.length} avoid` : ''}`);
    drawTerritoryPdfMap(doc, territory, territoryHouses, geometry, streetMap, avoidHouses);
    const panelX = 7.72;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(11, 68, 126);
    doc.text('Territory Information', panelX, 1.28);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(45, 60, 76);
    const info = [
      `Territory: ${territory.name}`,
      `Congregation: ${selectedCongregation}`,
      `Meeting location: ${selectedHall?.name || ''}`,
      `Hall address: ${selectedHall?.address || ''}`,
      `Homes / stops: ${territoryHouses.length}`,
      `Avoid / do not visit: ${avoidHouses.length}`,
      `Boundary: ${territory.geometry ? 'Manually edited' : 'Automatic outline'}`
    ];
    let y = 1.52;
    for (const line of info) {
      const wrapped = doc.splitTextToSize(line, 2.82);
      doc.text(wrapped, panelX, y);
      y += wrapped.length * .18 + .06;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(11, 68, 126);
    doc.text('Address Key', panelX, y + .08);
    y += .32;
    let nextIndex = 0;
    while (nextIndex < territoryHouses.length && y < 7.85) {
      const label = `${nextIndex + 1}. ${territoryHouses[nextIndex].address}`;
      const lines = doc.splitTextToSize(label, 2.82);
      const needed = lines.length * .15 + .06;
      if (y + needed > 7.85) break;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(45, 60, 76);
      doc.text(lines, panelX, y);
      y += needed;
      nextIndex += 1;
    }
    while (nextIndex < territoryHouses.length) nextIndex = addAddressListPage(doc, logoData, territory, territoryHouses, nextIndex);
    let avoidIndex = 0;
    while (avoidIndex < avoidHouses.length) avoidIndex = addAvoidAddressListPage(doc, logoData, territory, avoidHouses, avoidIndex);
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      drawPdfFooter(doc, page, pageCount);
    }
    doc.save(`${slug(selectedCongregation)}-${slug(territory.name)}-territory.pdf`);
    toast(`${territory.name} PDF created with ${territoryHouses.length} addresses${avoidHouses.length ? ` and ${avoidHouses.length} red avoid dot${avoidHouses.length === 1 ? '' : 's'}` : ''}${streetMap ? ' and street labels' : ''}.`);
  } catch (error) {
    toast(`Could not create the territory PDF: ${friendlyError(error)}`, true);
  } finally {
    if (button) { button.disabled = !territories.length || !isAdmin(); button.textContent = 'Export Branded Territory PDF'; }
  }
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
  if (els.avoidAddressInput) els.avoidAddressInput.value = '';
  if (els.avoidAddressMessage) { els.avoidAddressMessage.textContent = 'Enter a complete address to place a private red avoid dot on the map.'; els.avoidAddressMessage.dataset.state = 'waiting'; }
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
  els.addAvoidAddressButton.addEventListener('click', addAvoidAddress);
  els.avoidAddressInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addAvoidAddress(); } });
  els.markAvoidButton.addEventListener('click', markSelectedAvoid);
  els.restoreAvoidButton.addEventListener('click', restoreSelectedAvoid);
  els.importFile.addEventListener('change', () => importAddressFile(els.importFile.files?.[0]));
  els.clearHousesButton.addEventListener('click', clearHouses);
  els.autoGroupButton.addEventListener('click', automaticGrouping);
  els.drawTerritoryButton.addEventListener('click', drawManualTerritoryBoundary);
  els.selectAreaButton.addEventListener('click', selectArea);
  els.clearSelectionButton.addEventListener('click', () => clearSelection(true));
  els.excludeSelectionButton.addEventListener('click', includeExcludeSelected);
  els.assignSelectedButton.addEventListener('click', assignSelected);
  els.newTerritoryButton.addEventListener('click', newTerritoryFromSelected);
  els.houseSearch.addEventListener('input', renderHouseList);
  els.savePlanButton.addEventListener('click', savePlan);
  els.exportTerritoryPdfButton.addEventListener('click', () => exportTerritoryPdf());
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

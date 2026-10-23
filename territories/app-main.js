import { validateTrimmedBoundary } from './territory-trim-tools.js?v=territories-20261022-44';
import { buildReviewedVersionPdf } from './pdf-address-review.js?v=territories-20261022-44';
import { createMeetingSessionManager } from './meeting-session-service.js?v=territories-20261022-44';
import { sessionContentStamp, territoryStamps, sessionChanges } from './meeting-session-model.js?v=territories-20261022-44';
import { editablePolygonFeatures, mountVertexRemoval } from './territory-vertex-tools.js?v=territories-20261022-44';
import { createConfirmedRecordBuffer } from './planner-records-cache.js?v=territories-20261022-44';
import { datedWorkName, createLibraryManager, libraryChoice } from './library-management-model.js?v=territories-20261022-44';
import { startLoading, stopLoading, paintBeforeWork } from './planner-loading.js?v=territories-20261022-44';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp, writeBatch, query, where, getDoc, getDocFromServer, getDocsFromServer, runTransaction
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { makePdfArchive, readArchivePdf, readArchiveSnapshot, PDF_LAYOUT_VERSION } from './pdf-archive.js?v=territories-20261017-33';
import { setupRecoveryImport } from './territory-recovery.js?v=territories-20261016-30';
import { mountSavedTerritories } from './saved-territories-layer.js?v=territories-20261022-44';
import { compareStreetAddresses, streetAddressInfo, drawStreetAddressColumns } from './street-addresses.js?v=territories-20261017-31';
import { workKey, latestWork, currentWorkFor, readPlanAddresses, readPlanTerritories, mergeTerritoryWork } from './saved-work-model.js?v=territories-20261022-44';
import { createBackupTools } from './backup-merge-service.js?v=territories-20261022-44';
import { workspaceStamp as mergeWorkspaceStamp, stable as mergeStable, deletionProblem as backupDeletionProblem, nameKey as libraryNameKey } from './backup-merge-model.js?v=territories-20261022-44';
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
const MAX_ADDRESS_RECORDS = 50000;
const ARCGIS_PAGE_SIZE = 1000;
const MAX_ARCGIS_PAGES_PER_TILE = 50;
const FIRESTORE_HOUSE_CHUNK_SIZE = 350;
const HOUSE_LIST_LIMIT = 350;
const AVOID_GEOCODE_TIMEOUT_MS = 12000;
const COLORADO_PARCEL_SOURCE = {
  key: 'colorado-parcels',
  label: 'Colorado Public Parcel Situs Addresses',
  endpoint: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0/query',
  infoUrl: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0',
  outFields: ['OBJECTID','parcel_id','countyName','situsAdd','sitAddCty','sitAddZip','landUseCde','landUseDsc','dateReceived'],
  returnGeometry: true,
  returnCentroid: false
};

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
let disposeVertexRemoval = null;
let pendingTerritoryName = '';
let liveTerritoryCountTimer = null;
let pendingLiveTerritoryCount = null;
let liveTerritoryCountContext = null;
let activeManualTerritoryDrawer = null;
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
let boundaryPreservesAddresses = false;
let houses = [];
let territories = [];
let selectedHouseIds = new Set();
let focusedTerritoryId = null;
let currentBoundaryId = null;
let currentPlanId = null;
let activeSavedWorkKey = '';
let planSaveQueue = Promise.resolve();
let workspaceGeneration = 0;
let savedTerritoryEditId = null;
let reviewRecords = new Map();
let savedRecordsStatus = 'loading';
let reviewsUnsubscribe = null;
let publicHallRecords = new Map();
const hallMarkers = new Map();
const houseMarkers = new Map();
const territoryLayers = new Map();
const territoryMapGeometries = new Map();

const els = Object.fromEntries([
  'loginButton','signOutButton','planStatusChip','summaryHall','summaryCongregation','summaryHouses','summaryAvoid','summaryTerritories',
  'privacyCard','hallSelect','hallDetail','congregationSelect','planName','territoryPrefix','boundaryChip','drawBoundaryButton',
  'editBoundaryButton','viewBoundaryButton','clearBoundaryButton','boundaryName','saveBoundaryButton','boundaryMessage',
  'houseCountChip','sourceSelect','sourceDetail','residentialOnly','separateUnits','loadAddressesButton','addHouseButton',
  'importFile','clearHousesButton','gapFillButton','gapFillMessage','missingAddressInput','missingAddressMessage','addMissingAddressButton','avoidAddressInput','avoidAddressMessage','addAvoidAddressButton','addressProgress','addressMessage','territoryCountChip','targetSize','customTargetWrap',
  'customTarget','groupingMethod','autoGroupButton','drawTerritoryButton','selectAreaButton','clearSelectionButton','clearAllTerritoriesButton','excludeSelectionButton',
  'markAvoidButton','restoreAvoidButton','selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryEditMessage','territoryBoundaryLiveCount','territoryBoundaryLiveLabel','territoryBoundaryLiveValue','territoryBoundaryLiveDetail','territoryEditActions','territoryEditActionLabel','saveTerritoryBoundaryEditButton','cancelTerritoryBoundaryEditButton','territoryList','houseSearch','houseList',
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
function emitPlannerDataChange() {
  try {
    window.dispatchEvent(new CustomEvent('territory-planner:data', {
      detail: {
        hallId: selectedHall?.id || '',
        congregation: selectedCongregation || '',
        planId: currentPlanId || '',
        territoryCount: territories.length,
        houseCount: houses.length,
        isAdmin: isAdmin()
      }
    }));
  } catch { /* no-op */ }
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
function validMapCoordinates(item) {
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}
function pointFeature(item) { return turf.point([Number(item.lng), Number(item.lat)]); }
function houseInsideTerritoryGeometry(house, geometry) {
  if (!validMapCoordinates(house) || !geometry) return false;
  try {
    const feature = geometry.type === 'Feature' ? geometry : turf.feature(geometry.geometry || geometry);
    return turf.booleanPointInPolygon(pointFeature(house), feature);
  } catch { return false; }
}
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
  const listed = selectedHall?.congregations?.length ? selectedHall.congregations : [selectedHall?.name || 'Planning group'];
  const saved = savedPlans().filter(plan => String(plan.hallId) === String(selectedHall?.id) && clean(plan.congregation));
  const congregations = [...new Set([...listed, ...saved.map(plan => clean(plan.congregation))])];
  if (!congregations.includes(preferred)) {
    const current = latestWork(saved)[0] || saved.find(plan => plan.addressSetMode || plan.addressOnlyMode);
    if (current) preferred = clean(current.congregation);
  }
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
  emitPlannerDataChange();
}

function hallIcon(location, selected = false) {
  return L.divIcon({
    className: '',
    html: `<div class="hall-pin${selected ? ' selected' : ''}">${escapeHtml(markerLabel(location))}</div>`,
    iconSize: [40, 40], iconAnchor: [20, 20]
  });
}

function combinedGeometryFromFeatureGroup(group) {
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
function normalizeLeafletRing(value) {
  let current = value;
  while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) current = current[0];
  if (!Array.isArray(current)) return [];
  return current.map(item => {
    if (item && !Array.isArray(item) && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))) {
      return L.latLng(Number(item.lat), Number(item.lng));
    }
    if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
      return L.latLng(Number(item[0]), Number(item[1]));
    }
    return null;
  }).filter(Boolean);
}
function draftGeometryFromLatLngs(value) {
  const latlngs = normalizeLeafletRing(value);
  if (latlngs.length < 3) return { geometry: null, vertexCount: latlngs.length, latlngs };
  const coordinates = latlngs.map(point => [Number(point.lng), Number(point.lat)]);
  const first = coordinates[0], last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
  return { geometry: { type: 'Polygon', coordinates: [coordinates] }, vertexCount: latlngs.length, latlngs };
}
function currentManualTerritoryDraft(eventLayers) {
  const drawerLatLngs = normalizeLeafletRing(activeManualTerritoryDrawer?._poly?.getLatLngs?.());
  const eventLatLngs = normalizeLeafletRing(
    (eventLayers?.getLayers?.() || []).map(layer => layer.getLatLng?.()).filter(Boolean)
  );
  const latlngs = drawerLatLngs.length >= eventLatLngs.length ? drawerLatLngs : eventLatLngs;
  return draftGeometryFromLatLngs(latlngs);
}
function geometryObject(value) {
  return value?.type === 'Feature' ? value.geometry : value;
}
function pointOnCountSegment(lng, lat, a, b) {
  const ax = Number(a?.[0]), ay = Number(a?.[1]), bx = Number(b?.[0]), by = Number(b?.[1]);
  if (![ax, ay, bx, by, lng, lat].every(Number.isFinite)) return false;
  const tolerance = 1e-9 * Math.max(1, Math.abs(bx - ax) + Math.abs(by - ay));
  const squaredLength = ((bx - ax) ** 2) + ((by - ay) ** 2);
  if (squaredLength <= Number.EPSILON) {
    const squaredDistance = ((lng - ax) ** 2) + ((lat - ay) ** 2);
    return squaredDistance <= tolerance ** 2;
  }
  const cross = ((lng - ax) * (by - ay)) - ((lat - ay) * (bx - ax));
  if (Math.abs(cross) > tolerance) return false;
  const dot = ((lng - ax) * (bx - ax)) + ((lat - ay) * (by - ay));
  if (dot < -tolerance) return false;
  return dot <= squaredLength + tolerance;
}
function pointInCountRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index], previousPoint = ring[previous];
    if (pointOnCountSegment(lng, lat, previousPoint, currentPoint)) return true;
    const xi = Number(currentPoint?.[0]), yi = Number(currentPoint?.[1]);
    const xj = Number(previousPoint?.[0]), yj = Number(previousPoint?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const crosses = ((yi > lat) !== (yj > lat)) &&
      (lng < (((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON)) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}
function pointInCountPolygon(lng, lat, polygonCoordinates) {
  if (!Array.isArray(polygonCoordinates) || !polygonCoordinates.length) return false;
  if (!pointInCountRing(lng, lat, polygonCoordinates[0])) return false;
  for (let index = 1; index < polygonCoordinates.length; index += 1) {
    if (pointInCountRing(lng, lat, polygonCoordinates[index])) return false;
  }
  return true;
}
function pointInsideCountGeometry(lng, lat, value) {
  const geometry = geometryObject(value);
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInCountPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).some(polygon => pointInCountPolygon(lng, lat, polygon));
  }
  return false;
}
function countGeometryBounds(value) {
  const geometry = geometryObject(value);
  const pairs = [];
  const collect = node => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
      pairs.push([Number(node[0]), Number(node[1])]);
      return;
    }
    node.forEach(collect);
  };
  collect(geometry?.coordinates);
  if (!pairs.length) return null;
  return [
    Math.min(...pairs.map(point => point[0])),
    Math.min(...pairs.map(point => point[1])),
    Math.max(...pairs.map(point => point[0])),
    Math.max(...pairs.map(point => point[1]))
  ];
}
function includedAddressesInsideGeometry(value) {
  const geometry = geometryObject(value);
  const bounds = countGeometryBounds(geometry);
  if (!geometry || !bounds) return [];
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const inside = [];
  for (const house of houses) {
    if (!house.included || house.avoid) continue;
    const lat = Number(house.lat), lng = Number(house.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (pointInsideCountGeometry(lng, lat, geometry)) inside.push(house);
  }
  return inside;
}
function updateLiveTerritoryBoundaryCount({ mode, geometry = null, territoryId = '', vertexCount = 0 }) {
  liveTerritoryCountContext = { mode, territoryId };
  if (mode === 'edit') renderHouseMarkers();
  const box = els.territoryBoundaryLiveCount;
  if (!box) return;
  box.hidden = false;
  box.dataset.mode = mode;

  const territory = mode === 'edit' ? territories.find(item => item.id === territoryId) : null;
  const territoryName = territory?.name || pendingTerritoryName || nextTerritoryName();
  const eligibleTotal = houses.filter(house => house.included && !house.avoid).length;
  els.territoryBoundaryLiveLabel.textContent = mode === 'edit' ? `Editing ${territoryName}` : `Drawing ${territoryName}`;

  if (!geometry) {
    const remaining = Math.max(0, 3 - Number(vertexCount || 0));
    els.territoryBoundaryLiveValue.textContent = vertexCount
      ? `${vertexCount} boundary point${vertexCount === 1 ? '' : 's'}`
      : '0 addresses selected';
    els.territoryBoundaryLiveDetail.textContent = !eligibleTotal
      ? 'No included addresses are loaded. Load or restore address points before drawing a territory.'
      : vertexCount
        ? `Add ${remaining} more point${remaining === 1 ? '' : 's'} before the address count can be calculated. ${eligibleTotal.toLocaleString()} included addresses are loaded.`
        : `Begin drawing the boundary to count the ${eligibleTotal.toLocaleString()} included addresses currently loaded.`;
    if (els.territoryEditMessage) {
      els.territoryEditMessage.hidden = false;
      els.territoryEditMessage.textContent = `Drawing ${territoryName}. Add at least three boundary points; the address count will update as you continue drawing.`;
    }
    return;
  }

  const inside = includedAddressesInsideGeometry(geometry);
  const count = inside.length;
  els.territoryBoundaryLiveValue.textContent = `${count.toLocaleString()} address${count === 1 ? '' : 'es'} inside`;

  if (mode === 'edit' && territory) {
    const currentlyInside = inside.filter(house => house.territoryId === territory.id).length;
    const unassignedInside = inside.filter(house => !house.territoryId).length;
    const otherTerritoryInside = inside.filter(house => house.territoryId && house.territoryId !== territory.id).length;
    const currentlyAssigned = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).length;
    const currentlyOutside = Math.max(0, currentlyAssigned - currentlyInside);
    els.territoryBoundaryLiveDetail.textContent = `${currentlyInside} already in ${territory.name} • ${unassignedInside} unassigned • ${otherTerritoryInside} in other territories${currentlyOutside ? ` • ${currentlyOutside} current outside` : ''} • ${eligibleTotal.toLocaleString()} included loaded`;
    if (els.territoryEditMessage) {
      els.territoryEditMessage.hidden = false;
      els.territoryEditMessage.textContent = `Editing ${territory.name}: ${count.toLocaleString()} included address${count === 1 ? '' : 'es'} are inside the proposed boundary. When you save with the map toolbar checkmark, ${unassignedInside} unassigned address${unassignedInside === 1 ? '' : 'es'} and ${otherTerritoryInside} address${otherTerritoryInside === 1 ? '' : 'es'} from other territories would move in, while ${currentlyOutside} current address${currentlyOutside === 1 ? '' : 'es'} would move out. Avoid and excluded addresses are not counted.`;
    }
  } else {
    const unassigned = inside.filter(house => !house.territoryId).length;
    const alreadyAssigned = count - unassigned;
    els.territoryBoundaryLiveDetail.textContent = `${unassigned} unassigned will be added${alreadyAssigned ? ` • ${alreadyAssigned} already assigned elsewhere` : ''} • ${eligibleTotal.toLocaleString()} included loaded`;
    if (els.territoryEditMessage) {
      els.territoryEditMessage.hidden = false;
      els.territoryEditMessage.textContent = `Drawing ${territoryName}: ${count.toLocaleString()} included address${count === 1 ? '' : 'es'} are inside the current boundary. ${unassigned} unassigned address${unassigned === 1 ? '' : 'es'} will be added when you close the shape${alreadyAssigned ? `; ${alreadyAssigned} already belong to other territories and will remain there` : ''}. Avoid and excluded addresses are not counted.`;
    }
  }
}
function scheduleLiveTerritoryBoundaryCount(payload, immediate = false) {
  clearTimeout(liveTerritoryCountTimer);
  liveTerritoryCountTimer = null;
  if (immediate) {
    pendingLiveTerritoryCount = null;
    updateLiveTerritoryBoundaryCount(payload);
    return;
  }
  pendingLiveTerritoryCount = payload;
  liveTerritoryCountTimer = setTimeout(() => {
    liveTerritoryCountTimer = null;
    const next = pendingLiveTerritoryCount;
    pendingLiveTerritoryCount = null;
    if (next) updateLiveTerritoryBoundaryCount(next);
  }, 75);
}
function hideLiveTerritoryBoundaryCount() {
  clearTimeout(liveTerritoryCountTimer);
  liveTerritoryCountTimer = null;
  pendingLiveTerritoryCount = null;
  liveTerritoryCountContext = null;
  if (els.territoryBoundaryLiveCount) {
    els.territoryBoundaryLiveCount.hidden = true;
    delete els.territoryBoundaryLiveCount.dataset.mode;
  }
  if (els.territoryEditMessage) {
    els.territoryEditMessage.hidden = true;
    els.territoryEditMessage.textContent = '';
  }
}

function showTerritoryEditActions(territory) {
  if (!els.territoryEditActions) return;
  els.territoryEditActions.hidden = false;
  if (els.territoryEditActionLabel) els.territoryEditActionLabel.textContent = `Editing ${territory?.name || 'territory boundary'}`;
  els.territoryEditActions.closest('.map-card')?.classList.add('territory-edit-active');
}
function hideTerritoryEditActions() {
  disposeVertexRemoval?.(); disposeVertexRemoval = null;
  if (!els.territoryEditActions) return;
  els.territoryEditActions.hidden = true;
  els.territoryEditActions.closest('.map-card')?.classList.remove('territory-edit-active');
}
function confirmBoundaryEditUpdate(territoryId, geometry) {
  try { validateTrimmedBoundary(geometry, turf); }
  catch (error) { toast(error.message, true); return false; }
  const inside = new Set(includedAddressesInsideGeometry(geometry).map(h => h.id));
  const moving = houses.filter(h => h.included && !h.avoid && inside.has(h.id) && h.territoryId && h.territoryId !== territoryId).length;
  const outside = houses.filter(h => h.included && !h.avoid && h.territoryId === territoryId && !inside.has(h.id)).length;
  if (!moving && !outside) return true;
  const changes = [];
  if (outside) changes.push(`${outside} current home(s) will move to Unassigned because they are outside the edited boundary. These addresses are kept, not deleted.`);
  if (moving) changes.push(`${moving} home(s) inside the edited boundary will move from other territories into this one.`);
  return confirm(changes.join('\n\n') + '\n\nApply this boundary change? Cancel keeps the draft open for editing. Avoid and excluded addresses remain protected.');
}
function announceBoundaryUpdate(territory) {
  window.dispatchEvent(new CustomEvent('territory-planner:boundary-updated', {
    detail: { territoryId: String(territory.id), name: territory.name, hallId: String(selectedHall?.id || '') }
  }));
}
async function saveActiveTerritoryBoundaryEdit() {
  if (!requireAdmin()) return;
  if (disposeVertexRemoval?.isTrimming?.()) { toast('Finish or cancel the trim box before saving the boundary.', true); return; }
  const territoryId = activeTerritoryEditId || territoryIdFromLayerGroup(territoryEditGroup);
  if (!territoryId) {
    toast('No territory boundary is currently being edited.', true);
    hideTerritoryEditActions();
    return;
  }
  const geometry = combinedGeometryFromFeatureGroup(territoryEditGroup);
  if (!geometry) {
    toast('The edited boundary could not be read. Move a handle and try Save Boundary & Update Homes again.', true);
    return;
  }

  if (!confirmBoundaryEditUpdate(territoryId, geometry)) return;
  const result = applyTerritoryBoundaryAssignments(territoryId, geometry);
  if (!result) {
    toast('The edited territory boundary could not be saved. Reopen Edit Boundary and try again.', true);
    return;
  }

  const toolbar = territoryEditToolbar;
  activeTerritoryEditId = null;
  territoryEditToolbar = null;
  hideLiveTerritoryBoundaryCount();
  hideTerritoryEditActions();
  try { toolbar?.disable(); } catch { /* no-op */ }
  territoryEditGroup.clearLayers();
  renderAllPlanningData();
  selectTerritoryHouses(result.territory.id);
  announceBoundaryUpdate(result.territory);

  toast(`${result.territory.name} boundary and address assignments updated in this session. Select SAVE YOUR WORK to save all territories and addresses together.`);
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
      for (const house of includedAddressesInsideGeometry(geometry)) {
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
    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();
    activeManualTerritoryDrawer = null;
    drawMode = null;
  });
  map.on('draw:drawvertex', event => {
    if (drawMode !== 'territory-new') return;
    const draft = currentManualTerritoryDraft(event.layers);
    scheduleLiveTerritoryBoundaryCount({ mode: 'new', geometry: draft.geometry, vertexCount: draft.vertexCount }, true);
  });
  map.on('draw:editvertex', () => {
    if (!activeTerritoryEditId) return;
    scheduleLiveTerritoryBoundaryCount({ mode: 'edit', geometry: combinedGeometryFromFeatureGroup(territoryEditGroup), territoryId: activeTerritoryEditId });
  });
  map.on('draw:editmove', () => {
    if (!activeTerritoryEditId) return;
    scheduleLiveTerritoryBoundaryCount({ mode: 'edit', geometry: combinedGeometryFromFeatureGroup(territoryEditGroup), territoryId: activeTerritoryEditId });
  });
  map.on(L.Draw.Event.EDITED, async event => {
    const editedGroup = event?.layers;
    const editedTerritoryId = territoryIdFromLayerGroup(editedGroup) || activeTerritoryEditId;
    if (editedTerritoryId) {
      // Include untouched multipart components, not only the layers moved by the editor.
      const geometry = combinedGeometryFromFeatureGroup(territoryEditGroup) || combinedGeometryFromFeatureGroup(editedGroup);
      if (!confirmBoundaryEditUpdate(editedTerritoryId, geometry)) return;
      hideLiveTerritoryBoundaryCount();
      hideTerritoryEditActions();
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
      announceBoundaryUpdate(result.territory);
      const summary = boundaryChangeSummary(result);
      toast(`${result.territory.name} updated in this session. ${summary}. Select SAVE YOUR WORK to save the complete session.`);
      return;
    }
    const layer = boundaryGroup.getLayers()[0];
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
    }
  });
  map.on(L.Draw.Event.EDITSTOP, () => {
    if (liveTerritoryCountContext?.mode === 'edit') hideLiveTerritoryBoundaryCount();
    if (!activeTerritoryEditId) {
      hideTerritoryEditActions();
      return;
    }
    activeTerritoryEditId = null;
    territoryEditToolbar = null;
    territoryEditGroup.clearLayers();
    hideTerritoryEditActions();
    if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
    renderAllPlanningData();
  });
  map.on(L.Draw.Event.DRAWSTOP, () => {
    if (liveTerritoryCountContext?.mode === 'new') hideLiveTerritoryBoundaryCount();
    activeManualTerritoryDrawer = null;
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
    // Keep outside manual points and ask whether to expand the meeting-place boundary.
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
    marker.on('click', () => { void selectHallWithFeedback(location.id, false); });
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
function setBoundaryGeometry(geometry, fit = true, preserveWork = false) {
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
}
function clearBoundary(ask = true) {
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
  const mapped = houses.filter(house => validMapCoordinates(house));
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
      // A convex hull across thousands of imported homes can block the browser.
      // For large address sets use the complete bounding box; it is fast and remains editable.
      baseFeature = points.length > 600
        ? turf.bboxPolygon(turf.bbox(collection))
        : turf.convex(collection) || turf.bboxPolygon(turf.bbox(collection));
    }
    const buffered = turf.buffer(baseFeature, padding, { units: 'miles', steps: points.length > 600 ? 8 : 24 });
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
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
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
  let truncated = false;
  for (let tileIndex = 0; tileIndex < envelopes.length; tileIndex += 1) {
    if (features.length >= MAX_ADDRESS_RECORDS) { truncated = true; break; }
    const envelope = envelopes[tileIndex];
    if (els?.addressMessage) {
      els.addressMessage.textContent = `Loading ${source.label}: area ${tileIndex + 1} of ${envelopes.length} — ${features.length.toLocaleString()} records found…`;
    }
    let offset = 0;
    let tileComplete = false;
    for (let page = 0; page < MAX_ARCGIS_PAGES_PER_TILE; page += 1) {
      const payload = await requestArcGisPage(source, offset, forceGeometry, envelope);
      if (payload?.error) throw new Error(payload.error.message || `${source.label} returned an error.`);
      const pageFeatures = Array.isArray(payload?.features) ? payload.features : [];
      for (const feature of pageFeatures) {
        const key = arcGisFeatureKey(feature);
        if (seen.has(key)) continue;
        seen.add(key);
        features.push(feature);
        if (features.length >= MAX_ADDRESS_RECORDS) { truncated = true; break; }
      }
      if (truncated) break;
      offset += pageFeatures.length;
      const exceeded = Boolean(payload?.exceededTransferLimit);
      if (!exceeded || !pageFeatures.length) { tileComplete = true; break; }
      if (page === MAX_ARCGIS_PAGES_PER_TILE - 1) truncated = true;
    }
    if (!tileComplete && !truncated) truncated = true;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (els?.addressMessage) {
    els.addressMessage.textContent = truncated
      ? `${source.label} reached the ${MAX_ADDRESS_RECORDS.toLocaleString()}-record safety limit. Use a smaller boundary for complete coverage.`
      : `${source.label} scan complete: ${features.length.toLocaleString()} records found across ${envelopes.length} map areas.`;
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

function parcelSupplementPoint(feature) {
  const attributes = feature?.attributes || feature?.properties || {};
  const situs = clean(attributes.situsAdd || attributes.SITUSADD || attributes.situs_address || '');
  if (!situs || !/^\s*\d/.test(situs)) return null;
  const city = clean(attributes.sitAddCty || attributes.SITADDCTY || '');
  const zip = clean(attributes.sitAddZip || attributes.SITADDZIP || '').slice(0, 10);
  const address = [situs, city, 'CO', zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const geometry = feature?.geometry || {};
  let lat = Number(geometry.y);
  let lng = Number(geometry.x);
  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && Array.isArray(geometry.rings) && geometry.rings.length) {
    try {
      const firstRing = geometry.rings.find(ring => Array.isArray(ring) && ring.length >= 4);
      if (firstRing) {
        const point = turf.pointOnFeature(turf.polygon([firstRing]));
        [lng, lat] = point.geometry.coordinates;
      }
    } catch {
      const coordinates = geometry.rings.flat().filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
      if (coordinates.length) {
        lng = coordinates.reduce((sum, point) => sum + Number(point[0]), 0) / coordinates.length;
        lat = coordinates.reduce((sum, point) => sum + Number(point[1]), 0) / coordinates.length;
      }
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const landUse = clean(attributes.landUseDsc || attributes.LANDUSEDSC || attributes.landUseCde || '');
  const clearlyNonResidential = /\b(?:COMMERCIAL|INDUSTRIAL|RETAIL|OFFICE|WAREHOUSE|UTILITY|SCHOOL|CHURCH|GOVERNMENT|PARK|OPEN SPACE|COMMON AREA|VACANT|AGRICULTURAL|FARM|EXEMPT)\b/i.test(landUse);
  return {
    id: `parcel-${attributes.OBJECTID ?? attributes.parcel_id ?? uniqueId('parcel')}`,
    address,
    baseAddress: address,
    unit: '',
    lat: Number(lat),
    lng: Number(lng),
    source: 'Colorado Public Parcel Situs Address',
    residential: !clearlyNonResidential,
    classification: landUse || 'Parcel situs address — verify locally',
    unitCount: 1,
    rawId: attributes.parcel_id ?? attributes.OBJECTID ?? null,
    supplemental: true,
    included: true,
    territoryId: null
  };
}

function addressRecordsMatch(a, b) {
  const includeUnits = Boolean(els.separateUnits?.checked);
  const unitA = clean(a?.unit || '');
  const unitB = clean(b?.unit || '');
  if (includeUnits && (unitA || unitB) && unitA.toUpperCase() !== unitB.toUpperCase()) return false;
  const keyA = normalizeAddressKey(includeUnits ? a.address : (a.baseAddress || a.address), includeUnits);
  const keyB = normalizeAddressKey(includeUnits ? b.address : (b.baseAddress || b.address), includeUnits);
  if (keyA && keyB && keyA === keyB) return true;
  const parsedA = splitStreetSort(a.address || a.baseAddress || '');
  const parsedB = splitStreetSort(b.address || b.baseAddress || '');
  if (parsedA?.number && parsedB?.number && parsedA.number === parsedB.number && parsedA.street && parsedA.street === parsedB.street) {
    return distanceMiles(a, b) <= 0.12;
  }
  return false;
}

function mergeSupplementalAddressRecords(records) {
  const candidates = dedupeAddressRecords(records);
  let added = 0;
  let duplicate = 0;
  for (const candidate of candidates) {
    if (houses.some(existing => addressRecordsMatch(existing, candidate))) {
      duplicate += 1;
      continue;
    }
    houses.push({
      ...candidate,
      id: String(candidate.id || uniqueId('supplement')),
      supplemental: true,
      avoid: false,
      included: true,
      territoryId: null
    });
    added += 1;
  }
  return { added, duplicate };
}
async function fillAddressGaps() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary before checking for missing addresses.', true); return; }
  const button = els.gapFillButton;
  button.disabled = true;
  button.textContent = 'Scanning Entire Boundary…';
  els.addressProgress.hidden = false;
  els.gapFillMessage.dataset.state = 'working';
  const results = [];
  const errors = [];
  let addedTotal = 0;
  try {
    const current = currentSourceKey();
    const inferred = inferSourceForLocation(selectedHall);
    const pointSourceKeys = [];
    // Always rescan the primary source. Earlier versions stopped at 6,000 records,
    // which could leave the later map tiles blank even though the county had data.
    if (current && current !== 'manual') pointSourceKeys.push(current);
    if (current !== 'colorado') pointSourceKeys.push('colorado');
    else if (inferred && !['manual','colorado'].includes(inferred)) pointSourceKeys.push(inferred);
    for (const sourceKey of [...new Set(pointSourceKeys)]) {
      const source = ASSESSOR_SOURCES[sourceKey];
      if (!source) continue;
      els.gapFillMessage.textContent = `Checking ${source.label} for addresses not already loaded…`;
      try {
        const result = await loadParsedSource(sourceKey);
        const merged = mergeSupplementalAddressRecords(result.parsed);
        addedTotal += merged.added;
        results.push(`${merged.added.toLocaleString()} from ${source.label}`);
      } catch (error) {
        errors.push(`${source.label}: ${friendlyError(error)}`);
      }
    }

    els.gapFillMessage.textContent = 'Checking Colorado parcel situs addresses for additional properties…';
    try {
      const parcelFeatures = await queryArcGisSource(COLORADO_PARCEL_SOURCE, true);
      const parcelRecords = parcelFeatures.map(parcelSupplementPoint).filter(Boolean);
      const merged = mergeSupplementalAddressRecords(parcelRecords);
      addedTotal += merged.added;
      results.push(`${merged.added.toLocaleString()} from parcel situs addresses`);
    } catch (error) {
      errors.push(`${COLORADO_PARCEL_SOURCE.label}: ${friendlyError(error)}`);
    }

    if (addedTotal) currentPlanId = null;
    renderAllPlanningData();
    if (addedTotal) {
      els.gapFillMessage.textContent = `${addedTotal.toLocaleString()} additional address${addedTotal === 1 ? '' : 'es'} added as unassigned. ${results.join('; ')}.${errors.length ? ` Some sources could not be checked: ${errors.join(' | ')}` : ''}`;
      els.gapFillMessage.dataset.state = errors.length ? 'warning' : 'success';
      toast(`${addedTotal.toLocaleString()} additional address${addedTotal === 1 ? '' : 'es'} added without replacing existing territories.`);
    } else {
      els.gapFillMessage.textContent = `No additional unique addresses were found in the other official sources.${errors.length ? ` ${errors.join(' | ')}` : ' Enter a known missing address below to add it directly.'}`;
      els.gapFillMessage.dataset.state = errors.length ? 'warning' : 'waiting';
      toast('No additional unique addresses were found. Use the missing-address entry for a known address.', true);
    }
  } finally {
    els.addressProgress.hidden = true;
    button.disabled = !isAdmin();
    button.textContent = 'Complete Boundary Scan & Fill Gaps';
  }
}
async function addMissingAddress() {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation) { toast('Select the meeting place and congregation first.', true); return; }
  const address = clean(els.missingAddressInput.value);
  if (!address) { toast('Enter the complete missing address.', true); els.missingAddressInput.focus(); return; }
  const button = els.addMissingAddressButton;
  button.disabled = true;
  button.textContent = 'Locating…';
  els.missingAddressMessage.textContent = 'Locating the address and checking the current congregation boundary…';
  els.missingAddressMessage.dataset.state = 'working';
  const requestGeneration = workspaceGeneration;
  try {
    const result = await geocodeAvoidAddress(address);
    if (requestGeneration !== workspaceGeneration || !isAdmin()) return;
    const candidate = { lat: Number(result.lat), lng: Number(result.lng) };
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) throw new Error('The address service returned invalid coordinates.');
    // Outside addresses are kept for the expansion prompt.
    const matchedAddress = clean(result.matchedAddress || address);
    const probe = { ...candidate, address: matchedAddress, baseAddress: matchedAddress };
    const existing = houses.find(house => addressRecordsMatch(house, probe));
    if (existing) {
      selectedHouseIds = new Set([existing.id]);
      renderAllPlanningData();
      map?.setView([existing.lat, existing.lng], Math.max(map.getZoom(), 17), { animate: true });
      houseMarkers.get(existing.id)?.openPopup();
      const status = existing.avoid ? 'already marked Avoid / Do Not Visit' : existing.included ? 'already loaded' : 'already loaded but excluded';
      els.missingAddressMessage.textContent = `${existing.address} is ${status}.`;
      els.missingAddressMessage.dataset.state = existing.avoid ? 'warning' : 'success';
      toast(`${existing.address} is already in this plan.`);
      return;
    }
    const record = {
      id: uniqueId('missing'),
      address: matchedAddress,
      baseAddress: matchedAddress,
      unit: '',
      lat: candidate.lat,
      lng: candidate.lng,
      source: `Manual missing address — ${result.source}`,
      residential: true,
      classification: 'Manually added missing address',
      unitCount: 1,
      manualGap: true,
      supplemental: true,
      avoid: false,
      included: true,
      territoryId: null
    };
    if (!addHouseRecord(record)) throw new Error('The address matches a point already loaded in this plan.');
    currentPlanId = null;
    selectedHouseIds = new Set([record.id]);
    renderAllPlanningData();
    map?.setView([record.lat, record.lng], Math.max(map.getZoom(), 17), { animate: true });
    houseMarkers.get(record.id)?.openPopup();
    els.missingAddressInput.value = '';
    els.missingAddressMessage.textContent = `${record.address} was added as an unassigned address. Save the territory plan to retain it.`;
    els.missingAddressMessage.dataset.state = 'success';
    toast(`Missing address added: ${record.address}`);
  } catch (error) {
    els.missingAddressMessage.textContent = `Could not add the missing address: ${friendlyError(error)}`;
    els.missingAddressMessage.dataset.state = 'error';
    toast(`Could not add the missing address: ${friendlyError(error)}`, true);
  } finally {
    button.disabled = !isAdmin();
    button.textContent = 'Locate & Add Missing Address';
  }
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
  const retainedManualGaps = houses.filter(house => (house.manualGap || house.bulkImported || (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.length)) && !house.avoid).map(house => ({ ...house, territoryId: null }));
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
  for (const manual of retainedManualGaps) {
    const existing = houses.find(item => addressRecordsMatch(item, manual));
    if (!existing) {
      houses.push({ ...manual, id: String(manual.id || uniqueId('missing')), supplemental: true, avoid: false, included: true, territoryId: null });
      continue;
    }
    const existingIds = Array.isArray(existing.bulkBatchIds) ? [...existing.bulkBatchIds] : [];
    const existingNames = Array.isArray(existing.bulkBatchNames) ? [...existing.bulkBatchNames] : [];
    const manualIds = Array.isArray(manual.bulkBatchIds) ? manual.bulkBatchIds : manual.bulkBatchId ? [manual.bulkBatchId] : [];
    const manualNames = Array.isArray(manual.bulkBatchNames) ? manual.bulkBatchNames : manual.bulkBatchName ? [manual.bulkBatchName] : [];
    manualIds.forEach((batchId, index) => {
      if (!existingIds.includes(batchId)) {
        existingIds.push(batchId);
        existingNames.push(manualNames[index] || 'Imported addresses');
      }
    });
    existing.bulkBatchIds = existingIds;
    existing.bulkBatchNames = existingNames;
    existing.bulkBatchId = existingIds[0] || '';
    existing.bulkBatchName = existingNames[0] || '';
    existing.bulkImported = Boolean(existing.bulkImported || manual.bulkImported);
    existing.bulkOriginalAddress = existing.bulkOriginalAddress || manual.bulkOriginalAddress || '';
  }
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

function mergeBulkWorksetMetadata(target, incoming) {
  const pairs = new Map();
  const collect = record => {
    const ids = Array.isArray(record?.bulkBatchIds)
      ? record.bulkBatchIds.map(String).filter(Boolean)
      : record?.bulkBatchId ? [String(record.bulkBatchId)] : [];
    const names = Array.isArray(record?.bulkBatchNames)
      ? record.bulkBatchNames.map(clean)
      : record?.bulkBatchName ? [clean(record.bulkBatchName)] : [];
    ids.forEach((id, index) => {
      if (!pairs.has(id) || !clean(pairs.get(id))) pairs.set(id, names[index] || 'Imported addresses');
    });
  };
  collect(target);
  collect(incoming);
  target.bulkBatchIds = [...pairs.keys()];
  target.bulkBatchNames = [...pairs.values()];
  target.bulkBatchId = target.bulkBatchIds[0] || '';
  target.bulkBatchName = target.bulkBatchNames[0] || '';
  target.bulkImported = Boolean(target.bulkImported || incoming?.bulkImported || target.bulkBatchIds.length);
  target.bulkOriginalAddress = target.bulkOriginalAddress || incoming?.bulkOriginalAddress || '';
  target.bulkSourceRow = target.bulkSourceRow ?? incoming?.bulkSourceRow ?? null;
}
function mergeHouseRecordData(target, incoming) {
  if (!target || !incoming) return target;
  if (!validMapCoordinates(target) && validMapCoordinates(incoming)) {
    target.lat = Number(incoming.lat);
    target.lng = Number(incoming.lng);
  }
  const incomingAddress = clean(incoming.address);
  const targetAddress = clean(target.address);
  if ((!targetAddress || incomingAddress.length > targetAddress.length) && incomingAddress) target.address = incomingAddress;
  target.baseAddress = target.baseAddress || incoming.baseAddress || incoming.address || target.address;
  target.unit = target.unit || incoming.unit || '';
  target.source = target.source || incoming.source || '';
  target.classification = target.classification || incoming.classification || '';
  target.residential = target.residential !== false || incoming.residential !== false;
  target.unitCount = Math.max(Number(target.unitCount) || 1, Number(incoming.unitCount) || 1);
  target.manualGap = Boolean(target.manualGap || incoming.manualGap);
  target.supplemental = Boolean(target.supplemental || incoming.supplemental);
  target.rawId = target.rawId ?? incoming.rawId ?? null;
  target.avoidSource = target.avoidSource || incoming.avoidSource || '';
  mergeBulkWorksetMetadata(target, incoming);
  const rememberedTerritory = target.avoidTerritoryId || incoming.avoidTerritoryId || target.territoryId || incoming.territoryId || null;
  if (target.avoid || incoming.avoid) {
    target.avoid = true;
    target.included = false;
    target.avoidTerritoryId = rememberedTerritory;
    target.territoryId = null;
    target.classification = 'Avoid / do not visit';
  } else {
    target.avoid = false;
    target.included = target.included !== false || incoming.included !== false;
    target.territoryId = target.territoryId || incoming.territoryId || null;
    target.avoidTerritoryId = null;
  }
  return target;
}
function dedupeHouseRecords() {
  if (houses.length < 2) return 0;
  const includeUnits = Boolean(els.separateUnits?.checked);
  const unique = [];
  const exact = new Map();
  const street = new Map();
  const redirects = new Map();
  const streetKey = house => {
    const parsed = splitStreetSort(house.address || house.baseAddress || '');
    return parsed?.number && parsed?.street ? `${parsed.number}|${parsed.street}` : '';
  };
  for (const house of houses) {
    const key = normalizeAddressKey(includeUnits ? house.address : (house.baseAddress || house.address), includeUnits);
    let match = key ? exact.get(key) : null;
    const sKey = streetKey(house);
    if (!match && sKey) {
      match = (street.get(sKey) || []).find(candidate => addressRecordsMatch(candidate, house)) || null;
    }
    if (match) {
      redirects.set(String(house.id), String(match.id));
      mergeHouseRecordData(match, house);
      continue;
    }
    unique.push(house);
    if (key && !exact.has(key)) exact.set(key, house);
    if (sKey) {
      if (!street.has(sKey)) street.set(sKey, []);
      street.get(sKey).push(house);
    }
  }
  const removed = houses.length - unique.length;
  if (!removed) return 0;
  houses = unique;
  selectedHouseIds = new Set([...selectedHouseIds].map(id => redirects.get(String(id)) || String(id)));
  recalculateTerritoryHouseIds();
  return removed;
}
function addHouseRecord(record) {
  if (!validMapCoordinates(record) || !clean(record.address || record.baseAddress)) return false;
  const existing = houses.find(item => addressRecordsMatch(item, record));
  if (existing) {
    mergeHouseRecordData(existing, record);
    return false;
  }
  const avoid = Boolean(record.avoid);
  houses.push({
    ...record,
    id: String(record.id || uniqueId('address')),
    avoid,
    avoidTerritoryId: avoid ? (record.avoidTerritoryId || record.territoryId || null) : null,
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
  if (house.territoryId && !house.avoidTerritoryId) house.avoidTerritoryId = house.territoryId;
  house.avoid = true;
  house.included = false;
  house.territoryId = null;
  house.classification = 'Avoid / do not visit';
}
function markSelectedAvoid() {
  if (!requireAdmin() || !selectedHouseIds.size) return;
  const selected = houses.filter(house => selectedHouseIds.has(house.id) && !house.avoid);
  if (!selected.length) { toast('All selected addresses are already marked to avoid.', true); return; }
  if (!confirm(`Mark ${selected.length} selected address${selected.length === 1 ? '' : 'es'} as Avoid / Do Not Visit? Their normal territory count will exclude them, but the red avoid marker will stay associated with the territory for maps and PDFs.`)) return;
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
    const previousTerritory = house.avoidTerritoryId && territories.some(item => String(item.id) === String(house.avoidTerritoryId))
      ? house.avoidTerritoryId : null;
    house.territoryId = previousTerritory;
    house.avoidTerritoryId = null;
    if (house.classification === 'Avoid / do not visit') house.classification = 'Manual address';
  }
  recalculateTerritoryHouseIds();
  renderAllPlanningData();
  toast(`${selected.length} address${selected.length === 1 ? '' : 'es'} restored as unassigned.`);
}
async function addAvoidAddress() {
  if (!requireAdmin()) return;
  if (!selectedHall || !selectedCongregation) { toast('Select the meeting place and congregation first.', true); return; }
  const address = clean(els.avoidAddressInput.value);
  if (!address) { toast('Enter the complete address to avoid.', true); els.avoidAddressInput.focus(); return; }
  const button = els.addAvoidAddressButton;
  button.disabled = true;
  button.textContent = 'Locating…';
  els.avoidAddressMessage.textContent = 'Locating the address and checking the current congregation boundary…';
  els.avoidAddressMessage.dataset.state = 'working';
  const requestGeneration = workspaceGeneration;
  try {
    const result = await geocodeAvoidAddress(address);
    if (requestGeneration !== workspaceGeneration || !isAdmin()) return;
    const candidate = { lat: Number(result.lat), lng: Number(result.lng) };
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) throw new Error('The address service returned invalid coordinates.');
    // Retain an outside address for the meeting-boundary expansion prompt.
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
  if (!selectedHall || !selectedCongregation) { toast('Select the meeting place and congregation first.', true); return; }
  if (!file) return;
  const requestGeneration = workspaceGeneration;
  try {
    const text = await file.text();
    if (requestGeneration !== workspaceGeneration || !isAdmin()) return;
    let records = [];
    if (/\.csv$/i.test(file.name)) {
      records = parseCsv(text).map((row, index) => importedRecord(row, null, index)).filter(Boolean);
    } else {
      const data = JSON.parse(text);
      const features = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : [];
      records = features.map((feature, index) => importedRecord(feature.properties || {}, feature.geometry, index)).filter(Boolean);
    }
    const filtered = records.filter(validMapCoordinates);
    let added = 0;
    for (const record of filtered) if (addHouseRecord(record)) added += 1;
    renderAllPlanningData();
    els.addressMessage.textContent = `${added.toLocaleString()} imported address points added. Outside addresses will prompt a boundary review.`;
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
  const uploaded = mapHouseIsUploaded(house);
  const color = territory ? TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length] : uploaded ? '#7952c7' : '#16A6A1';
  return {
    radius: territory ? 5 : uploaded ? 5.4 : 5,
    color: territory ? '#fff' : uploaded ? '#4d2e8f' : '#0B6F6B',
    weight: territory ? 1.4 : 2,
    fillColor: color,
    fillOpacity: .94
  };
}
function mapHouseIsUploaded(house) {
  if (!house) return false;
  if (house.bulkImported || house.bulkBatchId) return true;
  if (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.some(Boolean)) return true;
  const source = `${house.source || ''} ${house.classification || ''}`.toLowerCase();
  return source.includes('bulk address workset') || source.includes('imported address workset') ||
    source.includes('prepared address list') || source.includes('imported csv') || source.includes('imported geojson');
}
function evenlySampleHouses(items, count) {
  if (count <= 0 || !items.length) return [];
  if (items.length <= count) return [...items];
  const result = [];
  const step = items.length / count;
  for (let index = 0; index < count; index += 1) result.push(items[Math.min(items.length - 1, Math.floor(index * step))]);
  return result;
}
function updateMapHouseDisplayNotice(shown, visible, total) {
  const host = document.querySelector('.map-card');
  if (!host) return;
  let notice = document.getElementById('mapHouseDisplayNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'mapHouseDisplayNotice';
    notice.style.cssText = 'position:absolute;z-index:880;left:14px;top:74px;max-width:290px;padding:7px 10px;border-radius:10px;background:rgba(255,255,255,.94);border:1px solid #c7d7e3;box-shadow:0 4px 14px rgba(24,53,79,.18);font:700 9px/1.35 system-ui,sans-serif;color:#40566d;pointer-events:none';
    host.appendChild(notice);
  }
  const limited = shown < visible;
  notice.hidden = !limited;
  if (limited) notice.textContent = `Showing ${shown.toLocaleString()} of ${visible.toLocaleString()} visible address dots (${total.toLocaleString()} loaded). Zoom in to display the remaining nearby homes.`;
}
function visibleMapHouses() {
  const editing = territories.some(territory => territory.id === activeTerritoryEditId);
  const focusedId = editing ? activeTerritoryEditId : focusedTerritoryId;
  const hasFocus = focusedId && territories.some(territory => territory.id === focusedId);
  const geometries = editing
    ? [combinedGeometryFromFeatureGroup(territoryEditGroup)].filter(Boolean)
    : hasFocus
      ? [territoryMapGeometries.get(focusedId)].filter(Boolean)
      : [...territoryMapGeometries.values()];
  // Avoid records remain in the directory, but only appear on a map that contains them.
  return houses.filter(house => validMapCoordinates(house) &&
    (!house.avoid || geometries.some(geometry => houseInsideTerritoryGeometry(house, geometry))));
}
function renderHouseMarkers() {
  if (!map || !houseGroup) return;
  if (!map._denverHouseViewportRefreshBound) {
    map._denverHouseViewportRefreshBound = true;
    const schedule = () => {
      clearTimeout(map._denverHouseViewportRefreshTimer);
      map._denverHouseViewportRefreshTimer = setTimeout(() => renderHouseMarkers(), 100);
    };
    map.on('moveend zoomend resize', schedule);
  }

  houseGroup.clearLayers();
  houseMarkers.clear();

  const valid = visibleMapHouses();
  const paddedBounds = map.getBounds?.()?.pad?.(0.18);
  const visible = paddedBounds
    ? valid.filter(house => paddedBounds.contains([Number(house.lat), Number(house.lng)]))
    : valid;
  const zoom = Number(map.getZoom?.() || 12);
  const maximum = zoom >= 17 ? 2600 : zoom >= 15 ? 1900 : zoom >= 13 ? 1300 : 850;
  const chosen = [];
  const chosenIds = new Set();
  const add = items => {
    for (const house of items) {
      if (chosen.length >= maximum) break;
      const id = String(house.id);
      if (chosenIds.has(id)) continue;
      chosenIds.add(id);
      chosen.push(house);
    }
  };

  const mustShow = visible.filter(house => selectedHouseIds.has(house.id) || house.avoid);
  const assigned = visible.filter(house => !selectedHouseIds.has(house.id) && !house.avoid && house.territoryId);
  const uploaded = visible.filter(house => !selectedHouseIds.has(house.id) && !house.avoid && !house.territoryId && mapHouseIsUploaded(house));
  const official = visible.filter(house => !selectedHouseIds.has(house.id) && !house.avoid && !house.territoryId && !mapHouseIsUploaded(house));

  add(mustShow);
  add(evenlySampleHouses(assigned, Math.max(0, maximum - chosen.length)));
  let remaining = Math.max(0, maximum - chosen.length);
  if (remaining) {
    let uploadQuota = Math.min(uploaded.length, Math.ceil(remaining * .58));
    let officialQuota = Math.min(official.length, remaining - uploadQuota);
    if (uploadQuota + officialQuota < remaining) {
      const extraUpload = Math.min(uploaded.length - uploadQuota, remaining - uploadQuota - officialQuota);
      uploadQuota += Math.max(0, extraUpload);
      officialQuota = Math.min(official.length, remaining - uploadQuota);
    }
    add(evenlySampleHouses(uploaded, uploadQuota));
    add(evenlySampleHouses(official, Math.max(0, maximum - chosen.length)));
  }

  for (const house of chosen) {
    const marker = L.circleMarker([house.lat, house.lng], { renderer: canvasRenderer, ...houseStyle(house) }).addTo(houseGroup);
    const avoidNotice = house.avoid ? '<br><span class="avoid-popup-badge">AVOID / DO NOT VISIT</span>' : '';
    marker.bindPopup(`<div class="house-popup"><strong>${escapeHtml(house.address)}</strong>${avoidNotice}<br>${escapeHtml(house.source || '')}<br><small>${escapeHtml(house.classification || '')}${house.unitCount > 1 ? ` • ${house.unitCount} assessor units` : ''}</small></div>`);
    marker.on('click', event => {
      L.DomEvent.stopPropagation(event);
      toggleHouseSelection(house.id);
    });
    houseMarkers.set(house.id, marker);
  }
  updateMapHouseDisplayNotice(chosen.length, visible.length, valid.length);
}

function drawManualTerritoryBoundary() {
  if (!requireAdmin()) return;
  if (!boundaryGeometry) { toast('Draw or load the congregation boundary first.', true); return; }
  const eligibleTotal = houses.filter(house => house.included && !house.avoid).length;
  if (!eligibleTotal) { toast('Load or restore included address points before drawing a territory.', true); return; }
  const suggested = nextTerritoryName();
  const name = clean(prompt('Territory name:', suggested));
  if (!name) return;
  cancelTerritoryBoundaryEdit(false);
  pendingTerritoryName = name;
  drawMode = 'territory-new';
  updateLiveTerritoryBoundaryCount({ mode: 'new', geometry: null, vertexCount: 0 });
  activeManualTerritoryDrawer = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: TERRITORY_COLORS[territories.length % TERRITORY_COLORS.length], weight: 3, fillOpacity: .12 }
  });
  activeManualTerritoryDrawer.enable();
  toast(`Draw the territory boundary. The live counter is checking ${eligibleTotal.toLocaleString()} included addresses.`);
}
function cancelTerritoryBoundaryEdit(showNotice = true) {
  const wasEditing = Boolean(activeTerritoryEditId);
  hideLiveTerritoryBoundaryCount();
  hideTerritoryEditActions();
  if (territoryEditToolbar) {
    try { territoryEditToolbar.disable(); } catch { /* no-op */ }
  }
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
  focusedTerritoryId = id;
  territoryGroup.clearLayers();
  territoryEditGroup.clearLayers();
  const color = TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length];
  const editableGeoJson = L.geoJSON(editablePolygonFeatures(geometry), {
    style: { color, weight: 4, fillColor: color, fillOpacity: .16 }
  });
  editableGeoJson.eachLayer(layer => {
    layer._denverTerritoryId = id;
    layer.options = { ...(layer.options || {}), denverTerritoryId: id };
    territoryEditGroup.addLayer(layer);
  });
  if (territoryEditGroup.getBounds?.().isValid()) map.fitBounds(territoryEditGroup.getBounds(), { padding: [38, 38], maxZoom: 18 });
  territoryEditToolbar = new L.EditToolbar.Edit(map, { featureGroup: territoryEditGroup });
  territoryEditToolbar.enable();
  updateLiveTerritoryBoundaryCount({ mode: 'edit', geometry: geometry.geometry || geometry, territoryId: id });
  showTerritoryEditActions(territory);
  disposeVertexRemoval = mountVertexRemoval({ L, turf, map, group: territoryEditGroup,
    container: els.territoryEditActions, notify: toast,
    onChange: () => scheduleLiveTerritoryBoundaryCount({ mode: 'edit', geometry: combinedGeometryFromFeatureGroup(territoryEditGroup), territoryId: id }, true) });
  toast(`Editing ${territory.name}. Move corners, remove points, or use Trim tail / area. Then select Save Boundary & Update Homes.`);
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
async function syncTerritoryHomesToBoundary(id) {
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
}

function territoryGeometry(territory) {
  if (territory?.geometry) {
    const geometry = geometryObject(territory.geometry);
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) return null;
    try { return turf.feature(JSON.parse(JSON.stringify(geometry))); }
    catch { return null; }
  }
  // Only assigned visitable homes define an automatic outline; an old avoid assignment
  // must not expand the territory to include an otherwise outside address.
  const points = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id && validMapCoordinates(house)).map(pointFeature);
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
  territoryMapGeometries.clear();
  for (const territory of territories) {
    const geometry = territoryGeometry(territory);
    if (!geometry) continue;
    territoryMapGeometries.set(territory.id, geometry);
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
  emitPlannerDataChange();
}
function toggleHouseSelection(id) {
  if (selectedHouseIds.has(id)) selectedHouseIds.delete(id); else selectedHouseIds.add(id);
  renderHouseMarkers();
  renderHouseList();
  updateSelectionUi();
}
function clearSelection(removeLayer = true) {
  selectedHouseIds.clear();
  focusedTerritoryId = null;
  if (removeLayer && selectionLayer) { map.removeLayer(selectionLayer); selectionLayer = null; }
  renderHouseMarkers();
  renderHouseList();
  updateSelectionUi();
}
function selectHousesWithin(feature) {
  selectedHouseIds.clear();
  focusedTerritoryId = null;
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
  globalThis.__denverDuplicateReview?.selectId(territoryId);
  const territory = territories.find(item => item.id === territoryId);
  if (!territory) return;
  focusedTerritoryId = territoryId;
  const geometry = territoryMapGeometries.get(territoryId) || territoryGeometry(territory);
  const insideAvoidIds = new Set(avoidHousesInsideGeometry(geometry).map(house => house.id));
  selectedHouseIds = new Set(houses.filter(house => (house.included && !house.avoid && house.territoryId === territoryId) || insideAvoidIds.has(house.id)).map(house => house.id));
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
  const misplaced = houses.filter(house => house.included && !house.avoid && !validMapCoordinates(house));
  if (misplaced.length) { toast(`${misplaced.length.toLocaleString()} address location${misplaced.length === 1 ? ' needs' : 's need'} repair before territories can be grouped. Use Repair Mapped Locations in Pre-Done Address Lists.`, true); return; }
  const included = houses.filter(house => house.included && !house.avoid && validMapCoordinates(house));
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
  houses.forEach(house => { if (house.avoid) { house.territoryId = null; house.avoidTerritoryId = null; } else house.territoryId = house.included ? assignment.get(house.id) || null : null; });
  clearSelection();
  renderAllPlanningData();
  toast(`${territories.length} territories created using a target of ${target} houses. Sequential mode keeps each street in contiguous house-number blocks and combines only short nearby runs.`);
}
function clearAllTerritories() {
  if (!requireAdmin()) return;
  const territoryCount = territories.length;
  const assignedCount = houses.filter(house => house.territoryId).length;
  if (!territoryCount && !assignedCount) {
    toast('There are no territories to clear.');
    return;
  }
  const territoryLabel = `${territoryCount} territor${territoryCount === 1 ? 'y' : 'ies'}`;
  const addressLabel = `${assignedCount} assigned address${assignedCount === 1 ? '' : 'es'}`;
  const message = `Remove all ${territoryLabel} and return ${addressLabel} to Unassigned? ` +
    'The congregation boundary, loaded addresses, red avoid addresses, and excluded addresses will remain. ' +
    'This changes the current workspace only until you select Save Territory Plan.';
  if (!confirm(message)) return;

  cancelTerritoryBoundaryEdit(false);
  territories = [];
  for (const house of houses) { house.territoryId = null; house.avoidTerritoryId = null; }
  pendingTerritoryName = '';
  clearSelection(true);
  renderAllPlanningData();
  els.addressMessage.textContent = `All ${territoryLabel} cleared. Loaded addresses remain and are ready to regroup.`;
  toast(`All ${territoryLabel} cleared; ${addressLabel} returned to Unassigned.`);
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
  houses.forEach(house => { if (house.territoryId === id) house.territoryId = null; if (house.avoidTerritoryId === id) house.avoidTerritoryId = null; });
  territories = territories.filter(item => item.id !== id);
  if (focusedTerritoryId === id) focusedTerritoryId = null;
  renderAllPlanningData();
}
function zoomTerritory(id) {
  focusedTerritoryId = id;
  const layer = territoryLayers.get(id);
  if (layer?.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [35, 35], maxZoom: 17 });
  renderHouseMarkers();
}
function renderTerritoryList() {
  if (els.territoryList.closest('.territory-list-card')?.hidden) return;
  if (!territories.length) {
    els.territoryList.innerHTML = '<div class="empty">No territories have been created.</div>';
    return;
  }
  els.territoryList.innerHTML = territories.map(territory => {
    const included = territoryHousesSorted(territory);
    const color = TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length];
    const boundaryLabel = territory.geometry ? 'Edited/manual boundary' : 'Automatic outline';
    return `<article class="territory-row"><span class="territory-swatch" style="background:${color}"></span><div class="territory-main"><strong>${escapeHtml(territory.name)}${territory.geometry ? '<span class="manual-boundary-chip">Manual</span>' : ''}</strong><small>${included.length.toLocaleString()} houses • ${boundaryLabel}${included.length ? ` • ${escapeHtml(included[0].address)}${included.length > 1 ? ` through ${escapeHtml(included[included.length - 1].address)}` : ''}` : ''}</small></div><div class="row-actions"><button class="row-action" data-territory-zoom="${territory.id}">Zoom</button><button class="row-action" data-territory-select="${territory.id}">Homes</button><button class="row-action" data-territory-boundary="${territory.id}">Edit Boundary</button><button class="row-action" data-territory-sync="${territory.id}">Update Homes</button><button class="row-action" data-territory-pdf="${territory.id}">PDF</button>${territory.geometry ? `<button class="row-action" data-territory-reset="${territory.id}">Auto Outline</button>` : ''}<button class="row-action" data-territory-rename="${territory.id}">Rename</button><button class="row-action danger" data-territory-delete="${territory.id}">Delete</button></div></article>`;
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
    const territory = territoryById.get(house.avoid ? house.avoidTerritoryId : house.territoryId);
    return !query || `${house.address} ${territory?.name || ''} ${house.source || ''} ${house.avoid ? 'avoid do not visit' : ''}`.toLowerCase().includes(query);
  }).sort(compareStreetAddresses);
  const shown = filtered.slice(0, HOUSE_LIST_LIMIT);
  if (!shown.length) {
    els.houseList.innerHTML = `<div class="empty">${houses.length ? 'No addresses match this search.' : 'No addresses loaded.'}</div>`;
    return;
  }
  let previousStreet = null;
  els.houseList.innerHTML = shown.map(house => {
    const street = streetAddressInfo(house);
    const heading = previousStreet !== street.key ? `<h3 class="house-street-heading">${escapeHtml(street.name)}</h3>` : '';
    previousStreet = street.key;
    const territory = territoryById.get(house.avoid ? house.avoidTerritoryId : house.territoryId);
    const color = house.avoid ? '#c9362b' : territory ? TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length] : house.included ? (mapHouseIsUploaded(house) ? '#7952c7' : '#16A6A1') : '#b44b43';
    const rowClass = `${selectedHouseIds.has(house.id) ? ' selected' : ''}${house.avoid ? ' avoid' : house.included ? '' : ' excluded'}`;
    const status = house.avoid ? `Avoid${territory?.name ? ` — ${territory.name}` : ''}` : house.included ? territory?.name || 'Unassigned' : 'Excluded';
    return heading + `<article class="house-row${rowClass}" data-house-id="${escapeHtml(house.id)}"><span class="house-dot" style="background:${color}"></span><div><strong>${escapeHtml(house.address)}</strong><small>${escapeHtml(house.source || '')}${house.classification ? ` • ${escapeHtml(house.classification)}` : ''}${house.unitCount > 1 ? ` • ${house.unitCount} assessor units` : ''}</small></div><span class="territory-tag">${escapeHtml(status)}</span></article>`;
  }).join('') + (filtered.length > HOUSE_LIST_LIMIT ? `<div class="list-limit">Showing the first ${HOUSE_LIST_LIMIT.toLocaleString()} of ${filtered.length.toLocaleString()} matching addresses. Use search or the map to narrow the list.</div>` : '');
  els.houseList.querySelectorAll('[data-house-id]').forEach(row => row.addEventListener('click', () => toggleHouseSelection(row.dataset.houseId)));
}

function updateSummary() {
  updateSavedTerritoryEditUi();
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
  updateSavedTerritoryEditUi();
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
  emitPlannerDataChange();
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
    addressSetBoundary: Boolean(boundaryPreservesAddresses),
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
async function saveMeetingPlaceBoundary(geometry, expected) {
  if (!isAdmin() || !selectedHall || !selectedCongregation) throw new Error('Sign in and select a meeting place first.');
  if (savedRecordsStatus !== 'ready') throw new Error('Saved records are not ready. Reconnect before adopting a boundary.');
  const generation = workspaceGeneration, hall = { ...selectedHall }, congregation = selectedCongregation;
  if (!expected || expected.generation !== generation || workKey(expected.hallId, expected.congregation) !== workKey(hall.id, congregation)) {
    throw new Error('The selected workspace changed. No meeting-place boundary was saved.');
  }
  const shape = JSON.parse(JSON.stringify(geometry?.type === 'Feature' ? geometry.geometry : geometry));
  if (!['Polygon', 'MultiPolygon'].includes(shape?.type) || !(turf.area(turf.feature(shape)) > 0)) throw new Error('The boundary is not usable.');
  if (JSON.stringify(shape) !== JSON.stringify(boundaryGeometry)) throw new Error('The search boundary changed before it was confirmed. Review it again.');
  // Each approval is independent; earlier plans, PDFs and boundaries stay intact.
  const ref = doc(collection(db, 'reviews'));
  const record = { recordType: 'territory-boundary', meetingPlaceBoundary: true,
    name: `${hall.name} — ${congregation} meeting-place boundary`, hallId: hall.id,
    hallLabel: markerLabel(hall), hallName: hall.name, hallAddress: hall.address || '', congregation,
    boundaryJson: encodeGeometry(shape), addressSetBoundary: true, sourceHint: currentSourceKey(),
    updatedByEmail: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await setDoc(ref, record);
  if (isAdmin()) {
    reviewRecords.set(ref.id, { ...record, id: ref.id, updatedAt: new Date() });
    renderSavedRecords();
  }
  return ref.id;
}

function serializeHouse(house) {
  return {
    id: house.id, address: house.address, baseAddress: house.baseAddress || house.address, unit: house.unit || '',
    lat: Number(house.lat), lng: Number(house.lng), source: house.source || '', residential: house.residential !== false,
    classification: house.classification || '', unitCount: Number(house.unitCount) || 1, included: house.included !== false,
    avoid: Boolean(house.avoid), avoidSource: house.avoidSource || '', territoryId: house.avoid ? null : house.territoryId || null,
    avoidTerritoryId: house.avoid ? house.avoidTerritoryId || null : null,
    manualGap: Boolean(house.manualGap), supplemental: Boolean(house.supplemental), rawId: house.rawId ?? null,
    bulkImported: Boolean(house.bulkImported), bulkBatchIds: Array.isArray(house.bulkBatchIds) ? house.bulkBatchIds.map(String) : [],
    bulkBatchNames: Array.isArray(house.bulkBatchNames) ? house.bulkBatchNames.map(clean) : [],
    bulkBatchId: house.bulkBatchId || '', bulkBatchName: house.bulkBatchName || '',
    bulkOriginalAddress: house.bulkOriginalAddress || '', bulkSourceRow: house.bulkSourceRow ?? null
  };
}
function decodeHouseChunk(chunk) {
  if (Array.isArray(chunk?.houses)) return chunk.houses;
  try {
    const houses = JSON.parse(chunk?.housesJson || 'null');
    return Array.isArray(houses) ? houses : null;
  } catch { return null; }
}
function setPlanSaveMessage(message, state = 'waiting') {
  const element = document.getElementById('planSaveMessage');
  if (element) { element.textContent = message; element.dataset.state = state; }
}
function savePlan(options = {}) {
  const generation = workspaceGeneration;
  // Serialize saves from PDF export, boundary edits, and the save buttons.
  // Each request saves the latest workspace after the preceding save finishes.
  const request = planSaveQueue.then(() => {
    if (generation !== workspaceGeneration) return null;
    return persistPlan(options);
  });
  planSaveQueue = request.catch(() => null);
  return request;
}
async function persistPlan(options = {}) {
  const unavailable = message => { setPlanSaveMessage(message, 'error'); toast(message, true); return null; };
  if (!requireAdmin()) return unavailable('Sign in to save your work.');
  if (!selectedHall || !selectedCongregation) return unavailable('Select the meeting location and congregation before saving your work.');
  if (!houses.length) return unavailable('Load or add addresses before saving your work.');
  if (options.expectedMergeFingerprint && options.expectedMergeFingerprint !== mergeWorkspaceStamp(backupWorkspaceSnapshot())) return unavailable('The workspace changed before the merged save began. Review it and save again.');
  if (savedRecordsStatus === 'loading' || savedRecordsStatus === 'error') return unavailable('Saved records are not ready. Reconnect or refresh saved records, then save. Your current work has been kept.');
  const key = workKey(selectedHall.id, selectedCongregation);
  const latest = currentWorkFor(savedPlans(), selectedHall.id, selectedCongregation);
  const partialEdit = Boolean(savedTerritoryEditId);
  const saveAsWork = !options.forceBackup && Boolean(options.saveYourWork || activeSavedWorkKey === key || (partialEdit && latest));
  if (saveAsWork && !partialEdit && latest && latest.id !== currentPlanId &&
    !confirm('Use this entire workspace as the current saved work for this meeting location and congregation? The previous saved work will remain in Backup with its own addresses and territories. Choose Cancel to load the current saved work first.')) return null;

  // Capture everything before awaiting a database write. A later selection or
  // sign-out must never attach this snapshot to a different editable workspace.
  const generation = workspaceGeneration, hall = { ...selectedHall }, congregation = selectedCongregation;
  let savedHouses = houses.map(serializeHouse);
  let savedTerritories = JSON.parse(JSON.stringify(territories));
  let base = null;
  if (partialEdit && latest && saveAsWork) {
    try {
      base = latest;
      const combined = mergeTerritoryWork(readPlanAddresses(base, reviewRecords), readPlanTerritories(base),
        savedHouses, savedTerritories, savedTerritoryEditId);
      savedHouses = combined.houses.map(serializeHouse); savedTerritories = combined.territories;
    } catch (error) { return unavailable(`Your saved work was not changed: ${friendlyError(error)}`); }
  }
  const savedBoundary = base ? decodeGeometry(base.boundaryJson, base.boundary) : boundaryGeometry;
  const addressOnlyMode = !savedBoundary && savedHouses.length > 0;
  const preserves = base ? Boolean(base.boundaryPreservesAddresses || base.addressSetMode || base.addressOnlyMode) : Boolean(boundaryPreservesAddresses);
  const addressSetMode = Boolean(options.addressSetMode || addressOnlyMode || preserves);
  const defaultName = `${hall.name || markerLabel(hall)} — ${congregation}`;
  const planName = clean(options.namedSave) || clean(options.backupName) || base?.planName || clean(els.planName.value) || defaultName;
  const button = els.savePlanButton;
  button.disabled = true; button.textContent = 'Saving your work…';
  setPlanSaveMessage('Saving all addresses, avoid information, boundaries, and territories. Keep this page open until saving is confirmed.', 'working');
  const pending = setTimeout(() => setPlanSaveMessage('The save is still awaiting confirmation. Your earlier saved work is safe; keep this page open and check your connection.', 'working'), 12000);
  try {
    // Every save owns its address chunks. No current work or backup relies on
    // another plan's chunks, and no prior manifest or PDF is overwritten.
    const ref = doc(collection(db, 'reviews')), planId = ref.id;
    const chunks = [];
    for (let start = 0; start < savedHouses.length; start += FIRESTORE_HOUSE_CHUNK_SIZE) chunks.push(savedHouses.slice(start, start + FIRESTORE_HOUSE_CHUNK_SIZE));
    const chunkIds = chunks.map((_, index) => `${planId}__houses_${String(index).padStart(4, '0')}`);
    const record = {
      recordType: 'territory-plan', saveKind: saveAsWork ? 'work' : 'backup',
      savedWorkKey: key, savedWorkSchemaVersion: 1,
      previousWorkId: saveAsWork ? latest?.id || null : null,
      sourcePlanId: currentPlanId || null,
      mergedFromRecordIds: [...new Set([...(reviewRecords.get(currentPlanId)?.mergedFromRecordIds || []), ...(Array.isArray(options.mergeSourceIds) ? options.mergeSourceIds.map(String) : [])])],
      planName, hallId: hall.id, hallLabel: markerLabel(hall), hallName: hall.name, hallAddress: hall.address || '',
      congregation, territoryPrefix: base?.territoryPrefix ?? clean(els.territoryPrefix.value).toUpperCase(),
      addressOnlyMode, addressSetMode, boundaryPreservesAddresses: preserves,
      boundaryJson: encodeGeometry(savedBoundary),
      boundaryName: base?.boundaryName ?? (savedBoundary ? clean(els.boundaryName.value) || `${congregation} service area` : 'Address-only map — no outer boundary'),
      sourceKey: base?.sourceKey ?? currentSourceKey(), targetSize: base?.targetSize ?? targetSizeValue(),
      groupingMethod: base?.groupingMethod ?? els.groupingMethod.value,
      residentialOnly: base?.residentialOnly ?? els.residentialOnly.checked,
      separateUnits: base?.separateUnits ?? els.separateUnits.checked,
      houseCount: savedHouses.length, includedHouseCount: savedHouses.filter(house => house.included && !house.avoid).length,
      avoidHouseCount: savedHouses.filter(house => house.avoid).length,
      territoriesJson: JSON.stringify(savedTerritories.map(item => ({ id: item.id, name: item.name, colorIndex: item.colorIndex || 0,
        houseIds: [...(item.houseIds || [])], geometryJson: encodeGeometry(decodeGeometry(item.geometryJson, item.geometry)),
        congregation: item.congregation || congregation, manualBoundary: Boolean(item.geometryJson || item.geometry), bulkBatchId: item.bulkBatchId || '', bulkBatchName: item.bulkBatchName || '' }))),
      territoryCount: savedTerritories.length, chunkIds, chunkCount: chunkIds.length,
      updatedByEmail: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    for (const [index, chunk] of chunks.entries()) {
      setPlanSaveMessage(`Saving address data ${index + 1} of ${chunks.length}… Your earlier saved work remains unchanged.`, 'working');
      const batch = writeBatch(db);
      batch.set(doc(db, 'reviews', chunkIds[index]), { recordType: 'territory-plan-chunk', planId, chunkIndex: index,
        housesJson: JSON.stringify(chunk), houseCount: chunk.length, updatedByEmail: record.updatedByEmail, updatedAt: serverTimestamp() });
      await batch.commit();
    }
    // Publish the manifest only after every independent address chunk succeeds.
    await setDoc(ref, record);
    reviewRecords.set(planId, { ...record, id: planId, updatedAt: new Date() });
    chunks.forEach((chunk, index) => reviewRecords.set(chunkIds[index], { id: chunkIds[index], recordType: 'territory-plan-chunk', planId, chunkIndex: index, houses: chunk }));
    if (generation === workspaceGeneration && !partialEdit) {
      currentPlanId = planId; activeSavedWorkKey = saveAsWork ? key : '';
      els.planName.value = planName;
    }
    renderSavedRecords(); updateSummary(); emitPlannerDataChange();
    if (generation === workspaceGeneration) {
      const message = saveAsWork ? `Saved ${record.houseCount.toLocaleString()} addresses and ${record.territoryCount} territories for ${hall.name} — ${congregation}. Load them under Return to your territories. Earlier saves are in Backup.`
        : 'Backup copy saved. Your main saved work is unchanged. Use SAVE YOUR WORK to make this workspace your current saved work.';
      setPlanSaveMessage(message, 'success');
      if (!options.silent) toast(message);
    }
    return planId;
  } catch (error) {
    console.error('Saved-work snapshot failed.', error);
    const message = `Your new work was not confirmed saved: ${friendlyError(error)}. Your earlier saved work is unchanged. Keep this page open and try SAVE YOUR WORK again.`;
    setPlanSaveMessage(message, 'error'); toast(message, true); return null;
  } finally {
    clearTimeout(pending); button.disabled = !isAdmin(); button.textContent = 'SAVE YOUR WORK';
  }
}
function subscribeReviews() {
  if (!db || !isAdmin()) return;
  if (reviewsUnsubscribe) reviewsUnsubscribe();
  savedRecordsStatus = 'loading';
  reviewRecords.clear();
  const records = query(collection(db, 'reviews'), where('recordType', 'in', ['territory-boundary', 'territory-plan', 'territory-plan-chunk', 'territory-pdf', 'territory-name-choice']));
  const applyConfirmedRecords = createConfirmedRecordBuffer(reviewRecords);
  reviewsUnsubscribe = onSnapshot(records, { includeMetadataChanges: true }, snapshot => {
    // Firestore emits local writes before the server accepts them. The saved
    // list must not claim an unacknowledged plan can be reopened later.
    const updates = applyConfirmedRecords(snapshot);
    if (updates.pending) return;
    const previousStatus = savedRecordsStatus;
    savedRecordsStatus = snapshot.metadata?.fromCache ? 'cached' : 'ready';
    const changed = updates.changed || previousStatus !== savedRecordsStatus;
    if (changed) { renderSavedRecords(); emitPlannerDataChange(); }
  }, error => {
    savedRecordsStatus = 'error';
    window.dispatchEvent(new CustomEvent('territory-planner:saved-records'));
    els.savedBoundaries.innerHTML = `<div class="empty">Saved records could not be loaded: ${escapeHtml(friendlyError(error))}</div>`;
    els.savedPlans.innerHTML = '';
    const pdfs = document.getElementById('savedTerritoryPdfs');
    if (pdfs) pdfs.innerHTML = '<div class="empty">Saved PDFs could not be loaded. Check your connection and administrator sign-in, then refresh.</div>';
  });
}
function savedBoundaries() { return [...reviewRecords.values()].filter(item => item.recordType === 'territory-boundary' && !item.deletedAt).sort((a, b) => clean(a.congregation).localeCompare(clean(b.congregation))); }
function savedPlans() { return [...reviewRecords.values()].filter(item => item.recordType === 'territory-plan' && !item.deletedAt).sort((a, b) => clean(a.planName).localeCompare(clean(b.planName))); }
function renderSavedRecords() {
  renderSavedPdfs();
  if (!isAdmin()) {
    els.savedBoundaries.innerHTML = '<div class="empty">Sign in to load saved boundaries.</div>';
    els.savedPlans.innerHTML = '<div class="empty">Sign in to load saved territory plans.</div>';
    return;
  }
  const boundaries = savedBoundaries();
  const currentIds = new Set(latestWork(savedPlans()).map(plan => plan.id));
  const plans = savedPlans().filter(plan => !currentIds.has(plan.id));
  els.savedBoundaries.innerHTML = boundaries.length ? boundaries.map(item => `<article class="saved-row"><div><strong>${escapeHtml(item.name || item.congregation || 'Saved boundary')}</strong><small>${escapeHtml(item.hallLabel || '')} ${escapeHtml(item.hallName || '')} • ${escapeHtml(item.congregation || '')} • ${escapeHtml(formatDate(item.updatedAt))}</small></div><div class="row-actions"><button class="row-action" data-load-boundary="${item.id}">Load</button></div></article>`).join('') : '<div class="empty">No congregation boundaries saved yet.</div>';
  els.savedPlans.innerHTML = plans.length ? plans.map(item => `<article class="saved-row"><div><strong>${escapeHtml(item.planName || 'Saved territory plan')}</strong><small>${escapeHtml(item.hallLabel || '')} ${escapeHtml(item.hallName || '')} • ${escapeHtml(item.congregation || '')}${item.addressSetMode ? ' • Hall address set' : item.addressOnlyMode ? ' • CSV address map' : ''} • ${(item.houseCount || 0).toLocaleString()} addresses${item.avoidHouseCount ? ` • ${Number(item.avoidHouseCount).toLocaleString()} avoid` : ''} • ${savedTerritoryCount(item)} territories • ${escapeHtml(formatDate(item.updatedAt))}</small></div><div class="row-actions"><button class="row-action" data-load-plan="${item.id}">Load backup copy</button></div></article>`).join('') : '<div class="empty">No territory plans saved yet.</div>';
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
  if (!item || item.deletedAt) return;
  const savedBoundary = decodeGeometry(item?.boundaryJson, item?.boundary);
  if (!savedBoundary) return;
  if ((houses.length || boundaryGeometry) && !confirm('Replace the current unsaved workspace with this saved boundary?')) return;
  clearPlanWorkspace(false);
  restoreHallAndCongregation(item.hallId, item.congregation);
  currentBoundaryId = item.id;
  els.boundaryName.value = item.name || '';
  els.sourceSelect.value = item.sourceHint && ASSESSOR_SOURCES[item.sourceHint] ? item.sourceHint : 'auto';
  setBoundaryGeometry(savedBoundary, true, Boolean(item.addressSetBoundary));
  toast('Saved congregation boundary loaded.');
}
function loadPlanRecord(id) {
  const plan = reviewRecords.get(id);
  if (!plan || plan.deletedAt) return false;
  const chunkIds = Array.isArray(plan.chunkIds) ? plan.chunkIds : [...reviewRecords.values()].filter(item => item.recordType === 'territory-plan-chunk' && item.planId === id).sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex)).map(item => item.id);
  if (chunkIds.some(chunkId => !decodeHouseChunk(reviewRecords.get(chunkId)))) {
    toast('This saved plan has missing address data. Your current work has been kept. Wait for saved records to finish loading and try again.', true);
    return false;
  }
  const loadedHouses = chunkIds.flatMap(chunkId => decodeHouseChunk(reviewRecords.get(chunkId)) || []);
  if (Number.isFinite(plan.houseCount) && loadedHouses.length !== plan.houseCount) {
    toast('The saved address count does not match this plan. Your current work has been kept; reload saved records before trying again.', true);
    return false;
  }
  if ((houses.length || territories.length || boundaryGeometry) && !confirm('Replace the current workspace with this saved territory? Unsaved changes will be lost. Choose Cancel to save your current work first.')) return false;
  clearPlanWorkspace(false);
  restoreHallAndCongregation(plan.hallId, plan.congregation);
  currentPlanId = plan.pdfArchive ? null : plan.id;
  const currentSavedWork = currentWorkFor(savedPlans(), plan.hallId, plan.congregation);
  activeSavedWorkKey = currentSavedWork?.id === plan.id ? workKey(plan.hallId, plan.congregation) : '';
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
  boundaryPreservesAddresses = Boolean(plan.boundaryPreservesAddresses || plan.addressSetMode || plan.addressOnlyMode);
  if (boundaryGeometry) {
    boundaryGroup.clearLayers();
    const layer = L.geoJSON(boundaryGeometry, { style: { color: '#0b5b9f', weight: 3, dashArray: '9 7', fillColor: '#4d9cdb', fillOpacity: .08 } }).addTo(boundaryGroup);
    if (layer.getBounds?.().isValid()) map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 15 });
  }
  houses = loadedHouses.map(item => {
    const avoid = Boolean(item.avoid);
    const avoidTerritoryId = avoid ? (item.avoidTerritoryId || item.territoryId || null) : null;
    return { ...item, id: String(item.id), avoid, included: avoid ? false : item.included !== false, territoryId: avoid ? null : item.territoryId || null, avoidTerritoryId };
  });
  const duplicatesRemovedOnLoad = 0; // Saved units, excluded homes and avoid records stay exactly as saved.
  const savedTerritoriesForPlan = decodeTerritories(plan);
  territories = savedTerritoriesForPlan.map((item, index) => {
    const geometry = decodeGeometry(item.geometryJson, item.geometry);
    return { id: String(item.id || uniqueId('territory')), name: item.name || nextTerritoryName(index), colorIndex: Number(item.colorIndex) || index, houseIds: [...(item.houseIds || [])], geometry, manualBoundary: Boolean(geometry), bulkBatchId: item.bulkBatchId || '', bulkBatchName: item.bulkBatchName || '', congregation: item.congregation || plan.congregation };
  });
  recalculateTerritoryHouseIds();
  sessionRemovedNames = [...(plan.sessionRemovedTerritoryNames || [])];
  rememberMeetingSessionBaseline();
  selectedHouseIds.clear();
  updateBoundaryUi();
  renderAllPlanningData();
  if (!boundaryGeometry && houses.length) {
    const mappedPoints = houses
      .filter(house => validMapCoordinates(house))
      .map(house => [Number(house.lat), Number(house.lng)]);
    if (mappedPoints.length) map.fitBounds(L.latLngBounds(mappedPoints), { padding: [36, 36], maxZoom: 16 });
  }
  if (document.getElementById('bulkFocus')) document.getElementById('bulkFocus').checked = false;
  globalThis.__denverMeetingPlaceFlow?.reset();
  toast(`Saved ${plan.addressSetMode ? 'Kingdom Hall address-set ' : plan.addressOnlyMode ? 'CSV address-only ' : ''}plan loaded with ${houses.length.toLocaleString()} addresses.`);
  setPlanSaveMessage(activeSavedWorkKey ? `Loaded saved work for ${plan.hallName || 'this meeting location'}. Edit addresses or territories, then select SAVE YOUR WORK.` : 'Backup copy loaded for editing. Your main saved work is unchanged. Select SAVE YOUR WORK only when you want to make this workspace the current saved work.', 'success');
  return true;
}

function updateSavedTerritoryEditUi() {
  const card = document.getElementById('savedTerritoryEditCard');
  if (!card) return;
  const territory = territories.find(item => item.id === savedTerritoryEditId);
  card.hidden = !territory || !isAdmin();
  if (!territory) return;
  document.getElementById('savedTerritoryEditName').textContent = territory.name;
  document.getElementById('saveEditedTerritoryPdfButton').dataset.territoryPdf = territory.id;
}

async function editSavedTerritory(version) {
  if (!requireAdmin()) return false;
  return meetingSessionManager.edit(version);
}

async function deleteBoundaryRecord(id) {
  const item = reviewRecords.get(id);
  if (!item || !confirm(`Delete the saved boundary “${item.name || item.congregation || 'Boundary'}”?`)) return;
  try { await deleteDoc(doc(db, 'reviews', id)); if (currentBoundaryId === id) currentBoundaryId = null; toast('Saved boundary deleted.'); }
  catch (error) { toast(`Could not delete the boundary: ${friendlyError(error)}`, true); }
}
async function deletePlanRecord(id) {
  const plan = reviewRecords.get(id);
  if (plan?.saveKind === 'work') { toast('Saved-work snapshots are protected. Earlier copies remain available in Backup.', true); return; }
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

async function saveTerritoryPdf(blob, filename, snapshot, planId, recovery = null) {
  if (!isAdmin()) throw new Error('Sign in before saving a territory PDF.');
  const id = recovery?.archiveId || doc(collection(db, 'reviews')).id;
  const archive = await makePdfArchive(id, blob, snapshot, {
    filename, planId, territoryId: snapshot.territory.id, territoryName: snapshot.territory.name,
    hallId: snapshot.hall.id, hallName: snapshot.hall.name, congregation: snapshot.congregation,
    houseCount: snapshot.houses.filter(house => !house.avoid).length,
    pdfLayoutVersion: recovery ? 0 : Number(snapshot.pdfLayoutVersion || 0),
    coffeeShopCount: recovery ? 0 : Number(snapshot.nearbyCoffee?.shops?.length || 0),
    territorySavedAt: serverTimestamp(), updatedByEmail: currentUser.email, updatedAt: serverTimestamp(),
    ...(recovery ? { recoveryId: recovery.recoveryId, sourcePdfSha256: recovery.sha256, recoveredOriginal: true } : {})
  });
  await publishPdfArchive(archive);
  reviewRecords.set(id, { ...archive.record, territorySavedAt: new Date(), updatedAt: new Date() });
  renderSavedPdfs();
  return id;
}
async function publishPdfArchive(archive) {
  const written = [];
  try {
    // Small staged batches keep large PDFs below the request limit. Incomplete
    // payloads never appear in the library. Updated copies use unique part IDs,
    // so the old PDF stays readable until the new manifest is confirmed.
    for (let start = 0; start < archive.parts.length; start += 1) {
      const parts = archive.parts.slice(start, start + 1), batch = writeBatch(db);
      parts.forEach(part => batch.set(doc(db, 'reviews', part.id), part));
      await batch.commit();
      written.push(...parts.map(part => part.id));
    }
    await setDoc(doc(db, 'reviews', archive.record.id), archive.record);
  } catch (error) {
    // Clean up only this failed, unpublished export's own payloads.
    for (let start = 0; start < written.length; start += 4) {
      const batch = writeBatch(db);
      written.slice(start, start + 4).forEach(partId => batch.delete(doc(db, 'reviews', partId)));
      try { await batch.commit(); } catch { /* Unlisted parts can be removed later. */ }
    }
    throw error;
  }
}

let savedPdfUpdateBusy = false;
const savedPdfUpdates = new Map();
function savedPdfStatus(message, state = 'saving') {
  const element = document.getElementById('savedPdfUpdateStatus');
  if (element) { element.textContent = message; element.dataset.state = state; }
}
async function archiveParts(record, kind) {
  const ids = kind === 'snapshot' ? record.snapshotPartIds : record.pdfPartIds;
  if (!Array.isArray(ids) || !ids.length) throw new Error('The saved file information is missing.');
  const parts = [];
  for (let start = 0; start < ids.length; start += 4) {
    const results = await Promise.all(ids.slice(start, start + 4).map(partId => getDoc(doc(db, 'reviews', partId))));
    results.forEach(result => { if (result.exists()) parts.push({ ...result.data(), id: result.id }); });
  }
  return parts;
}
async function renderSavedTerritoryPdf(snapshot, status) {
  const renderer = await import('./territory-flex-grouping-pdf.js?v=territories-20261022-44');
  return renderer.buildTerritoryPdf(snapshot, status);
}
function refreshSavedPdfRecord(id, progress = () => {}) {
  if (savedPdfUpdates.has(id)) return savedPdfUpdates.get(id);
  const work = (async () => {
    if (!isAdmin()) throw new Error('Sign in before updating saved PDFs.');
    const existing = await getDoc(doc(db, 'reviews', id));
    if (!existing.exists() || existing.data().recordType !== 'territory-pdf') throw new Error('The saved PDF could not be found.');
    const record = { ...existing.data(), id };
    if (Number(record.pdfLayoutVersion || 0) >= PDF_LAYOUT_VERSION) return record;
    progress('Reading the saved territory…');
    const snapshot = readArchiveSnapshot(record, await archiveParts(record, 'snapshot'));
    const built = await renderSavedTerritoryPdf(snapshot, { set textContent(value) { progress(value); } });
    if (built.snapshot.nearbyCoffee?.status === 'unavailable') throw new Error('Coffee shops could not be loaded. The previous PDF is safe; please try updating again.');
    // Keep the first PDF and its snapshot downloadable. Publish new parts under
    // this same library row only after every part has reached the server.
    const originalPdf = record.originalPdf || Object.fromEntries(
      ['id', 'filename', 'pdfPartIds', 'pdfBytes', 'snapshotPartIds', 'snapshotCharacters', 'pdfLayoutVersion', 'territorySavedAt', 'updatedAt']
        .filter(key => record[key] !== undefined).map(key => [key, record[key]]));
    const archive = await makePdfArchive(id, built.blob, built.snapshot, {
      ...record, originalPdf, payloadRevision: uniqueId('revision'), recoveredOriginal: false,
      territorySavedAt: record.territorySavedAt || record.createdAt || record.updatedAt,
      pdfLayoutVersion: PDF_LAYOUT_VERSION, coffeeShopCount: built.snapshot.nearbyCoffee.shops.length,
      updatedByEmail: currentUser.email, updatedAt: serverTimestamp()
    });
    progress('Saving the updated PDF…');
    await publishPdfArchive(archive);
    const confirmed = { ...archive.record, updatedAt: new Date() };
    reviewRecords.set(id, confirmed);
    renderSavedPdfs();
    return confirmed;
  })();
  savedPdfUpdates.set(id, work);
  return work.finally(() => savedPdfUpdates.delete(id));
}
async function updateSavedPdfs() {
  if (!requireAdmin() || savedPdfUpdateBusy) return;
  const records = [...reviewRecords.values()].filter(record => !record.deletedAt && record.recordType === 'territory-pdf' && Number(record.pdfLayoutVersion || 0) < PDF_LAYOUT_VERSION);
  if (!records.length) { savedPdfStatus('All saved PDFs already have street-grouped addresses and the coffee-shop page.', 'success'); return; }
  savedPdfUpdateBusy = true; renderSavedPdfs();
  const failures = []; let updated = 0;
  try {
    for (const [index, record] of records.entries()) {
      try {
        await refreshSavedPdfRecord(record.id, message => savedPdfStatus(`Updating ${index + 1} of ${records.length} — ${record.territoryName}: ${message}`));
        updated++;
      } catch (error) { failures.push(`${record.territoryName}: ${friendlyError(error)}`); }
    }
    savedPdfStatus(failures.length ? `${updated} PDFs updated. ${failures.length} still need an update; their previous copies are safe. ${failures.join(' ')} ` :
      `All ${updated} saved PDFs updated with street-grouped addresses and coffee shops. Use Download PDF for the updated copy; Original PDF keeps the earlier file.`, failures.length ? 'error' : 'success');
  } finally { savedPdfUpdateBusy = false; renderSavedPdfs(); }
}
async function restoreRecoveryPackage(data, progress = () => {}) {
  if (!isAdmin()) throw new Error('Sign in before restoring territories.');
  const plan = data.plan, planId = `recovered-${data.recoveryId.slice(0, 40)}`;
  const planRef = doc(db, 'reviews', planId), previous = await getDoc(planRef);
  // Deterministic recovery IDs make retrying safe. Never replace an existing
  // user plan, or overwrite later edits to a previously recovered plan.
  if (previous.exists() && previous.data().recoveryId !== data.recoveryId) throw new Error('This recovery conflicts with an existing saved plan.');
  if (!previous.exists()) {
    const chunks = [];
    for (let index = 0; index < plan.houses.length; index += 150) chunks.push(plan.houses.slice(index, index + 150).map(serializeHouse));
    const chunkIds = chunks.map((_, index) => `${planId}__houses_${index}`);
    for (const [index, chunk] of chunks.entries()) {
      progress(`Saving recovered addresses ${index + 1} of ${chunks.length}…`);
      const batch = writeBatch(db);
      batch.set(doc(db, 'reviews', chunkIds[index]), { recordType: 'territory-plan-chunk', planId, chunkIndex: index,
        housesJson: JSON.stringify(chunk), houseCount: chunk.length, updatedByEmail: currentUser.email, updatedAt: serverTimestamp() });
      await batch.commit();
    }
    const record = { recordType: 'territory-plan', planName: plan.name,
      hallId: plan.hall.id, hallLabel: String(plan.hall.number || plan.hall.id), hallName: plan.hall.name, hallAddress: plan.hall.address || '',
      congregation: plan.congregation, territoryPrefix: plan.territoryPrefix || '', addressOnlyMode: !plan.geometry,
      addressSetMode: true, boundaryPreservesAddresses: true, boundaryJson: encodeGeometry(plan.geometry), boundaryName: 'Recovered territory areas',
      sourceKey: 'manual', targetSize: 40, groupingMethod: 'street', residentialOnly: true, separateUnits: false,
      houseCount: plan.houses.length, includedHouseCount: plan.houses.filter(h => !h.avoid).length, avoidHouseCount: plan.houses.filter(h => h.avoid).length,
      territoriesJson: JSON.stringify(plan.territories.map(t => ({ id: t.id, name: t.name, colorIndex: t.colorIndex || 0,
        houseIds: t.houseIds, geometryJson: encodeGeometry(t.geometry), manualBoundary: Boolean(t.geometry) }))),
      territoryCount: plan.territories.length, chunkIds, chunkCount: chunks.length,
      recoveryId: data.recoveryId, recoveryNotes: plan.recoveryNotes || '', sourcePdfNames: data.originals.map(item => item.filename),
      updatedByEmail: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await setDoc(planRef, record);
    reviewRecords.set(planId, { ...record, id: planId, updatedAt: new Date() });
    chunks.forEach((houses, index) => reviewRecords.set(chunkIds[index], { id: chunkIds[index], recordType: 'territory-plan-chunk', planId, houses }));
    renderSavedRecords();
  }
  for (const [index, original] of data.originals.entries()) {
    progress(`Saved recovery plan. Saving original PDF ${index + 1} of ${data.originals.length}: ${original.snapshot.territory.name}…`);
    const archiveId = `recovered-pdf-${data.recoveryId.slice(0, 16)}-${original.sha256.slice(0, 32)}`;
    const existing = await getDoc(doc(db, 'reviews', archiveId));
    if (existing.exists()) {
      if (existing.data().sourcePdfSha256 !== original.sha256 || existing.data().recoveryId !== data.recoveryId) throw new Error('A saved PDF conflicts with this recovery.');
      continue;
    }
    const bytes = Uint8Array.from(atob(original.pdfBase64), character => character.charCodeAt(0));
    await saveTerritoryPdf(new Blob([bytes], { type: 'application/pdf' }), original.filename, original.snapshot, planId,
      { archiveId, recoveryId: data.recoveryId, sha256: original.sha256 });
  }
  return planId;
}
function renderSavedPdfs() {
  window.dispatchEvent(new CustomEvent('territory-planner:saved-records'));
  const element = document.getElementById('savedTerritoryPdfs');
  if (!element) return;
  const updateButton = document.getElementById('updateSavedPdfsButton');
  if (updateButton) { updateButton.disabled = !isAdmin() || savedPdfUpdateBusy; updateButton.onclick = updateSavedPdfs; }
  if (!isAdmin()) { element.innerHTML = '<div class="empty">Sign in to see saved territory PDFs.</div>'; return; }
  const dateValue = value => value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
  const records = [...reviewRecords.values()].filter(item => item.recordType === 'territory-pdf' && !item.deletedAt)
    .sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt));
  element.innerHTML = records.length ? records.map(item => `<article class="saved-row"><div><strong>${escapeHtml(item.territoryName || 'Territory PDF')}</strong><small>${escapeHtml(item.hallName || '')} • ${escapeHtml(item.congregation || '')} • ${Number(item.houseCount || 0).toLocaleString()} homes • ${escapeHtml(formatDate(item.updatedAt))}</small><small>${Number(item.pdfLayoutVersion || 0) >= PDF_LAYOUT_VERSION ? `Updated format • Street-grouped addresses • ${Number(item.coffeeShopCount || 0)} coffee stops` : 'Earlier format — updates when downloaded'}</small></div><div class="row-actions"><button class="row-action" data-download-territory-pdf="${escapeHtml(item.id)}" ${savedPdfUpdateBusy ? 'disabled' : ''}>Download PDF</button><button class="row-action" data-load-territory-pdf="${escapeHtml(item.id)}">Edit territory</button>${item.originalPdf ? `<button class="row-action" data-original-territory-pdf="${escapeHtml(item.id)}">Original PDF</button>` : ''}</div></article>`).join('')
    : '<div class="empty">New PDF exports will appear here automatically, with a copy of the territory as it was printed.</div>';
  element.querySelectorAll('[data-download-territory-pdf]').forEach(button => button.addEventListener('click', () => openSavedPdf(button.dataset.downloadTerritoryPdf, button, false)));
  element.querySelectorAll('[data-load-territory-pdf]').forEach(button => button.addEventListener('click', () => openSavedPdf(button.dataset.loadTerritoryPdf, button, true)));
  element.querySelectorAll('[data-original-territory-pdf]').forEach(button => button.addEventListener('click', () => openSavedPdf(button.dataset.originalTerritoryPdf, button, false, true)));
}
async function openSavedPdf(id, button, restore, originalCopy = false) {
  if (!requireAdmin()) return;
  let record = reviewRecords.get(id);
  if (!record || record.deletedAt) return;
  const generation = workspaceGeneration;
  const original = button.textContent;
  button.disabled = true; button.textContent = 'Loading…';
  try {
    if (!restore && !originalCopy && Number(record.pdfLayoutVersion || 0) < PDF_LAYOUT_VERSION) {
      button.textContent = 'Updating PDF…';
      record = await refreshSavedPdfRecord(id, message => savedPdfStatus(`${record.territoryName}: ${message}`));
      savedPdfStatus(`${record.territoryName} updated with street-grouped addresses and coffee shops. The earlier file is available under Original PDF.`, 'success');
    }
    if (originalCopy && record.originalPdf) record = { ...record, ...record.originalPdf };
    const parts = await archiveParts(record, restore ? 'snapshot' : 'pdf');
    if (restore) {
      const snapshot = readArchiveSnapshot(record, parts);
      if (generation !== workspaceGeneration || !isAdmin()) return;
      if (String(snapshot.hall.id) !== String(record.hallId) || String(snapshot.territory.id) !== String(record.territoryId)) {
        throw new Error('The saved PDF does not match its meeting place or territory.');
      }
      await editSavedTerritory({ ...snapshot, hallId: snapshot.hall.id, source: 'pdf' });
    } else {
      const blob = readArchivePdf(record, parts), url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = record.filename || 'territory.pdf';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Saved territory PDF downloaded.');
    }
  } catch (error) { savedPdfStatus(`Could not update or open this PDF: ${friendlyError(error)}`, 'error'); toast(`Could not open the saved territory: ${friendlyError(error)}`, true); }
  finally { button.disabled = false; button.textContent = original; }
}

function planGeoJson() {
  const features = [];
  if (boundaryGeometry) features.push(turf.feature(boundaryGeometry, { recordType: 'congregation-boundary', name: clean(els.boundaryName.value), hall: selectedHall?.name, congregation: selectedCongregation }));
  for (const territory of territories) {
    const geometry = territoryGeometry(territory);
    if (geometry) features.push(turf.feature(geometry.geometry, { recordType: 'territory', territoryId: territory.id, territoryName: territory.name, houseCount: territory.houseIds.length, bulkBatchId: territory.bulkBatchId || '', bulkBatchName: territory.bulkBatchName || '' }));
  }
  const territoryById = new Map(territories.map(item => [item.id, item.name]));
  for (const house of houses) features.push(turf.point([house.lng, house.lat], {
    recordType: house.avoid ? 'avoid-address' : 'ministry-address', address: house.address, source: house.source, included: house.included, avoid: Boolean(house.avoid), manualGap: Boolean(house.manualGap), supplemental: Boolean(house.supplemental),
    territoryId: house.avoid ? house.avoidTerritoryId || '' : house.territoryId || '', territoryName: territoryById.get(house.avoid ? house.avoidTerritoryId : house.territoryId) || '',
    bulkWorksets: (Array.isArray(house.bulkBatchNames) ? house.bulkBatchNames : []).join(' | ')
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
  const rows = [['territory','address','latitude','longitude','included','avoid','manual_added','supplemental','source','classification','unit_count','address_worksets']];
  houses.forEach(house => rows.push([
    territoryById.get(house.avoid ? house.avoidTerritoryId : house.territoryId) || '', house.address, Number(house.lat).toFixed(6), Number(house.lng).toFixed(6),
    house.included && !house.avoid ? 'Yes' : 'No', house.avoid ? 'Yes' : 'No', house.manualGap ? 'Yes' : 'No', house.supplemental ? 'Yes' : 'No', house.source || '', house.classification || '', house.unitCount || 1, (Array.isArray(house.bulkBatchNames) ? house.bulkBatchNames : []).join(' | ')
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
  return houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id && validMapCoordinates(house) &&
    (!territory.geometry || houseInsideTerritoryGeometry(house, territory.geometry))).sort(compareStreetAddresses);
}
function avoidHousesInsideGeometry(geometry) {
  // Current geometry is authoritative, including holes and edited boundaries.
  return houses.filter(house => house.avoid && houseInsideTerritoryGeometry(house, geometry)).sort(compareStreetAddresses);
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
function territoryStreetMapViewport(territoryHouses, geometry, avoidHouses = [], options = {}) {
  const width = 1200;
  const height = 775;
  const padding = options.tight ? 50 : 72;
  // The overview includes the complete outline. The closer view fits every
  // included home and contained avoid address, without distant boundary corners.
  const points = territoryStreetMapPoints(territoryHouses, options.tight ? null : geometry, avoidHouses);
  if (!points.length) return null;
  const sourcePoints = points.map(([lng, lat]) => webMercatorWorldPoint(lng, lat, 18));
  const minX = Math.min(...sourcePoints.map(point => point.x));
  const maxX = Math.max(...sourcePoints.map(point => point.x));
  const minY = Math.min(...sourcePoints.map(point => point.y));
  const maxY = Math.max(...sourcePoints.map(point => point.y));
  const fit = Math.min((width - 2 * padding) / Math.max(maxX - minX, 1), (height - 2 * padding) / Math.max(maxY - minY, 1));
  const fittedZoom = 18 + Math.log2(fit);
  const displayZoom = options.tight ? Math.min(20, fittedZoom) : Math.min(18, Math.floor(fittedZoom));
  const zoom = Math.max(0, Math.min(18, Math.floor(displayZoom)));
  const sourceFactor = 2 ** (zoom - 18);
  const scale = 2 ** (displayZoom - zoom);
  const centerX = ((minX + maxX) / 2) * sourceFactor;
  const centerY = ((minY + maxY) / 2) * sourceFactor;
  return {
    width,
    height,
    zoom,
    scale,
    left: centerX - (width / (2 * scale)),
    top: centerY - (height / (2 * scale))
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
async function buildTerritoryStreetMap(territoryHouses, geometry, avoidHouses = [], options = {}) {
  const viewport = territoryStreetMapViewport(territoryHouses, geometry, avoidHouses, options);
  if (!viewport) return null;
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const tileSize = 256;
  const tileCount = 2 ** viewport.zoom;
  const firstX = Math.floor(viewport.left / tileSize);
  const lastX = Math.floor((viewport.left + viewport.width / viewport.scale) / tileSize);
  const firstY = Math.floor(viewport.top / tileSize);
  const lastY = Math.floor((viewport.top + viewport.height / viewport.scale) / tileSize);
  const jobs = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const drawX = ((tileX * tileSize) - viewport.left) * viewport.scale;
      const drawY = ((tileY * tileSize) - viewport.top) * viewport.scale;
      const url = `https://tile.openstreetmap.org/${viewport.zoom}/${wrappedX}/${tileY}.png`;
      jobs.push(loadStreetMapTile(url).then(image => {
        context.drawImage(image, drawX, drawY, tileSize * viewport.scale, tileSize * viewport.scale);
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
  const scale = streetMap.scale || 1;
  return [
    mapX + (((point.x - streetMap.left) * scale / streetMap.width) * mapW),
    mapY + (((point.y - streetMap.top) * scale / streetMap.height) * mapH)
  ];
}

function drawPdfHeader(doc, logoData, title, subtitle = '') {
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
  doc.setLineWidth(.008);
  doc.line(0.35, 0.98, 10.65, 0.98);
}
function drawPdfFooter(doc, pageNumber, pageCount) {
  doc.setDrawColor(211, 220, 228);
  doc.setLineWidth(.008);
  doc.line(0.35, 8.06, 10.65, 8.06);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4); doc.setTextColor(40, 55, 72);
  doc.text('ANY REMAINING HOMES ON A STREET THAT ARE NOT LISTED BELONG TO ANOTHER TERRITORY AND SHOULD NOT BE WORKED.', 5.5, 8.19, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(94, 106, 119);
  doc.text('Denver 2027 Convention ministry territory — verify addresses, access, and boundaries locally before use.', 0.35, 8.34);
  doc.text(`Page ${pageNumber} of ${pageCount}`, 10.65, 8.34, { align: 'right' });
}
function drawTerritoryPdfMap(doc, territory, territoryHouses, geometry, streetMap = null, avoidHouses = [], options = {}) {
  const mapX = .43, mapY = 1.17, mapW = 10.14, mapH = 6.55;
  const viewport = streetMap || territoryStreetMapViewport(territoryHouses, geometry, avoidHouses, options);
  if (!viewport) return;
  // The tighter view may crop the true outline; all map artwork stays inside
  // the image area, including when the street tiles are unavailable.
  doc.saveGraphicsState();
  doc.rect(mapX, mapY, mapW, mapH, null);
  doc.clip();
  doc.discardPath();
  if (streetMap?.dataUrl) {
    doc.addImage(streetMap.dataUrl, 'JPEG', mapX, mapY, mapW, mapH, undefined, 'FAST');
  } else {
    doc.setFillColor(255, 255, 255);
    doc.rect(mapX, mapY, mapW, mapH, 'F');
  }
  const shape = geometry?.geometry || geometry;
  const polygons = shape?.type === 'MultiPolygon' ? shape.coordinates : shape?.type === 'Polygon' ? [shape.coordinates] : [];
  const project = ([lng, lat]) => projectStreetMapPoint(viewport, lng, lat, mapX, mapY, mapW, mapH);
  const color = hexRgb(TERRITORY_COLORS[territory.colorIndex % TERRITORY_COLORS.length]);
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: .08, 'stroke-opacity': .45 }));
  doc.setFillColor(...color);
  doc.setDrawColor(...color);
  doc.setLineWidth(.55 / 72);
  for (const polygon of polygons) {
    const path = [];
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      ring.forEach((point, index) => path.push({ op: index ? 'l' : 'm', c: project(point) }));
      path.push({ op: 'h', c: [] });
    }
    if (path.length) { doc.path(path); doc.fillStrokeEvenOdd(); }
  }
  doc.restoreGraphicsState();
  territoryHouses.forEach((house, index) => {
    const [x, y] = project([Number(house.lng), Number(house.lat)]);
    const label = addressHouseNumber(house.address) || `#${index + 1}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.5);
    doc.setTextColor(255, 255, 255);
    const halo = .005;
    const textOptions = { align: 'center', baseline: 'middle' };
    doc.text(label, x - halo, y, textOptions);
    doc.text(label, x + halo, y, textOptions);
    doc.text(label, x, y - halo, textOptions);
    doc.text(label, x, y + halo, textOptions);
    doc.setTextColor(85, 112, 134);
    doc.text(label, x, y, textOptions);
  });
  avoidHouses.forEach((house, index) => {
  const [x, y] = project([Number(house.lng), Number(house.lat)]);
  doc.setFillColor(201, 54, 43);
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(.018);
  doc.circle(x, y, .070, 'FD');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(.014);
  doc.line(x - .027, y - .027, x + .027, y + .027);
  doc.line(x - .027, y + .027, x + .027, y - .027);
  const houseNumber = addressHouseNumber(house.address);
  if (houseNumber) {
    const placeRight = index % 2 === 0;
    const textX = placeRight ? x + .095 : x - .095;
    const textY = y + .018;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.5);
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
  // Keep the north badge wholly within the reserved margin around the homes.
  const northX = mapX + mapW - .203, northY = mapY + .203;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(193, 204, 214);
  doc.setLineWidth(.007);
  doc.circle(northX, northY, .152, 'FD');
  doc.setTextColor(31, 52, 71);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text('N', northX, northY - .01, { align: 'center' });
  doc.setLineWidth(.010);
  doc.line(northX, northY + .095, northX, northY + .025);
  doc.line(northX, northY + .025, northX - .03, northY + .060);
  doc.line(northX, northY + .025, northX + .03, northY + .060);
  doc.restoreGraphicsState();
  const legend = `Street number = home${territoryHouses.some(house => !addressHouseNumber(house.address)) ? ' • # = address list entry' : ''} • Red X = Avoid • Shading = territory`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(73, 86, 101);
  doc.text(legend, mapX, 7.93);
  if (streetMap?.dataUrl) {
    doc.setFontSize(5.2);
    doc.text('© OpenStreetMap contributors', mapX + mapW, 7.93, { align: 'right' });
  }
}
function addAddressListPage(doc, logoData, territory, territoryHouses, startIndex) {
  doc.addPage('letter', 'landscape');
  drawPdfHeader(doc, logoData, `${territory.name} — Address List`, `${selectedCongregation} • ${selectedHall?.name || ''}`);
  return drawStreetAddressColumns(doc, territoryHouses, startIndex);
}

function addAvoidAddressListPage(doc, logoData, territory, avoidHouses, startIndex) {
  doc.addPage('letter', 'landscape');
  drawPdfHeader(doc, logoData, `${territory.name} — Avoid / Do Not Visit`, `${selectedCongregation} • ${selectedHall?.name || ''}`);
  return drawStreetAddressColumns(doc, avoidHouses, startIndex, { avoid: true });
}

async function exportTerritoryPdf(territoryId = els.pdfTerritorySelect?.value) {
  if (!requireAdmin()) return;
  const territory = territories.find(item => item.id === territoryId);
  if (!territory) { toast('Choose a territory to print.', true); return; }
  const assignedTerritoryHouses = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id);
  const misplacedTerritoryHouses = assignedTerritoryHouses.filter(house => !validMapCoordinates(house));
  if (misplacedTerritoryHouses.length) { toast(`${misplacedTerritoryHouses.length.toLocaleString()} address location${misplacedTerritoryHouses.length === 1 ? ' needs' : 's need'} repair before this PDF can be created. Use Repair Mapped Locations in Pre-Done Address Lists.`, true); return; }
  const territoryHouses = territoryHousesSorted(territory);
  if (!territoryHouses.length) { toast('This territory does not have any mapped assigned addresses.', true); return; }
  const geometry = territoryGeometry(territory);
  const avoidHouses = avoidHousesInsideGeometry(geometry);
  if (!geometry) { toast('This territory does not have a usable map boundary.', true); return; }
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) { toast('The PDF library did not load. Refresh the page and try again.', true); return; }
  const button = els.exportTerritoryPdfButton;
  if (button) { button.disabled = true; button.textContent = 'Building PDF…'; }
  try {
    let logoData = null;
    try { logoData = await imageDataUrl(new URL('../assets/denver-2027-territory-logo.png', import.meta.url).href); } catch { /* PDF remains usable without image */ }
    const maps = [];
    for (const tight of [false, true]) {
      let streetMap = null;
      try { streetMap = await buildTerritoryStreetMap(territoryHouses, geometry, avoidHouses, { tight }); }
      catch (error) { console.warn('Street background could not be included in this PDF.', error); }
      maps.push({ tight, streetMap });
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
    const subtitle = `${selectedCongregation} • ${selectedHall?.name || ''} • ${territoryHouses.length} addresses${avoidHouses.length ? ` • ${avoidHouses.length} avoid` : ''}`;
    for (const { tight, streetMap } of maps) {
      if (tight) doc.addPage('letter', 'landscape');
      drawPdfHeader(doc, logoData, `${territory.name} — ${tight ? 'Closer View' : 'Overview'}`, subtitle);
      drawTerritoryPdfMap(doc, territory, territoryHouses, geometry, streetMap, avoidHouses, { tight });
    }
    let nextIndex = 0;
    while (nextIndex < territoryHouses.length) nextIndex = addAddressListPage(doc, logoData, territory, territoryHouses, nextIndex);
    let avoidIndex = 0;
    while (avoidIndex < avoidHouses.length) avoidIndex = addAvoidAddressListPage(doc, logoData, territory, avoidHouses, avoidIndex);
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      drawPdfFooter(doc, page, pageCount);
    }
    doc.save(`${slug(selectedCongregation)}-${slug(territory.name)}-territory.pdf`);
    toast(`${territory.name} PDF created with ${territoryHouses.length} addresses${avoidHouses.length ? ` and ${avoidHouses.length} red avoid dot${avoidHouses.length === 1 ? '' : 's'}` : ''} with overview and closer maps${maps.some(item => item.streetMap) ? ' and street labels' : ''}.`);
  } catch (error) {
    toast(`Could not create the territory PDF: ${friendlyError(error)}`, true);
  } finally {
    if (button) { button.disabled = !territories.length || !isAdmin(); button.textContent = 'Export Branded Territory PDF'; }
  }
}

function clearPlanWorkspace(resetSelection = true) {
  sessionBaseline = new Map(); sessionRemovedNames = [];
  workspaceGeneration += 1;
  savedTerritoryEditId = null;
  updateSavedTerritoryEditUi();
  setPlanSaveMessage('Exporting a territory PDF automatically saves the current plan. You can also use Save Territory Plan at any time.');
  cancelTerritoryBoundaryEdit(false);
  focusedTerritoryId = null;
  boundaryGeometry = null;
  boundaryPreservesAddresses = false;
  houses = [];
  territories = [];
  selectedHouseIds.clear();
  currentBoundaryId = null;
  currentPlanId = null;
  activeSavedWorkKey = '';
  boundaryGroup?.clearLayers();
  territoryGroup?.clearLayers();
  houseGroup?.clearLayers();
  if (selectionLayer && map) { map.removeLayer(selectionLayer); selectionLayer = null; }
  els.planName.value = '';
  els.boundaryName.value = '';
  if (els.missingAddressInput) els.missingAddressInput.value = '';
  if (els.missingAddressMessage) { els.missingAddressMessage.textContent = 'Enter a known missing address to add it as an unassigned home.'; els.missingAddressMessage.dataset.state = 'waiting'; }
  if (els.gapFillMessage) { els.gapFillMessage.textContent = 'Search the other official address and parcel sources after the first address load.'; els.gapFillMessage.dataset.state = 'waiting'; }
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
  globalThis.__denverMeetingPlaceFlow?.reset();
  toast('New territory workspace ready.');
}

function wireEvents() {
  els.hallSelect.addEventListener('change', () => { void selectHallWithFeedback(els.hallSelect.value, true); });
  els.congregationSelect.addEventListener('change', () => {
    const next = els.congregationSelect.value;
    if (next === selectedCongregation) return;
    if ((houses.length || territories.length || boundaryGeometry) && !confirm('Change congregation and load its saved addresses? Unsaved changes in the current workspace will be lost. Choose Cancel to SAVE YOUR WORK first.')) {
      els.congregationSelect.value = selectedCongregation;
      return;
    }
    clearPlanWorkspace(false);
    selectedCongregation = next;
    if (!clean(els.territoryPrefix.value)) els.territoryPrefix.value = initialPrefix(selectedCongregation);
    updateSummary();
    emitPlannerDataChange();
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
  els.gapFillButton.addEventListener('click', fillAddressGaps);
  els.addMissingAddressButton.addEventListener('click', addMissingAddress);
  els.missingAddressInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addMissingAddress(); } });
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
  els.pdfTerritorySelect.addEventListener('change', () => {
    focusedTerritoryId = els.pdfTerritorySelect.value || null;
    renderHouseMarkers();
  });
  els.clearAllTerritoriesButton.addEventListener('click', clearAllTerritories);
  els.excludeSelectionButton.addEventListener('click', includeExcludeSelected);
  els.assignSelectedButton.addEventListener('click', assignSelected);
  els.newTerritoryButton.addEventListener('click', newTerritoryFromSelected);
  els.saveTerritoryBoundaryEditButton?.addEventListener('click', saveActiveTerritoryBoundaryEdit);
  els.cancelTerritoryBoundaryEditButton?.addEventListener('click', () => cancelTerritoryBoundaryEdit(true));
  els.houseSearch.addEventListener('input', renderHouseList);
  els.savePlanButton.addEventListener('click', () => saveNamedWork());
  document.getElementById('editSavedTerritoryBoundaryButton')?.addEventListener('click', () => editTerritoryBoundary(savedTerritoryEditId));
  document.getElementById('selectSavedTerritoryHomesButton')?.addEventListener('click', () => selectTerritoryHouses(savedTerritoryEditId));
  // The current PDF renderer intercepts this data-territory-pdf button and saves
  // the plan plus a new archive. Keep the legacy renderer as a fallback.
  document.getElementById('saveEditedTerritoryPdfButton')?.addEventListener('click', () => exportTerritoryPdf(savedTerritoryEditId));
  window.addEventListener('territory-planner:pdf-saved', event => {
    if (event.detail?.territoryId !== savedTerritoryEditId) return;
    const status = document.getElementById('savedTerritoryEditStatus');
    status.textContent = 'Updated territory and PDF saved. The earlier PDF is still available in saved territory history.';
    status.dataset.state = 'success';
  });
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
  mountSavedTerritories({
    map, L, turf, isAdmin, getHall: () => selectedHall,
    editTerritory: editSavedTerritory,
    getWorkspace: sessionWorkspace, sessionManager: meetingSessionManager,
    libraryManager, versionPdf: libraryVersionPdf, getCongregation: () => selectedCongregation, loadSavedSet: loadPlanRecord,
    saveNameChoice: (name, key) => backupTools.saveNameChoice(name, key),
    getRecords: () => reviewRecords, getStatus: () => savedRecordsStatus,
    readSnapshot: async record => {
      if (!isAdmin()) throw new Error('Sign in to view saved territories.');
      return readArchiveSnapshot(record, await archiveParts(record, 'snapshot'));
    },
    readPdf: async record => {
      if (!isAdmin()) throw new Error('Sign in to view saved PDFs.');
      return readArchivePdf(record, await archiveParts(record, 'pdf'));
    }
  });
  setupRecoveryImport({ requireAdmin, restore: restoreRecoveryPackage });
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
  window.dispatchEvent(new CustomEvent('territory-planner:ready'));
  emitPlannerDataChange();
}


function backupWorkspaceSnapshot() {
  return { hallId: selectedHall?.id || '', hallName: selectedHall?.name || '', congregation: selectedCongregation,
    currentPlanId, generation: workspaceGeneration, editId: savedTerritoryEditId,
    editing: Boolean(activeTerritoryEditId || drawMode || manualHouseMode),
    houses: JSON.parse(JSON.stringify(houses)), territories: JSON.parse(JSON.stringify(territories)),
    boundary: boundaryGeometry ? JSON.parse(JSON.stringify(boundaryGeometry)) : null };
}
async function readBackupMergeSource(id) {
  if (!isAdmin() || savedRecordsStatus !== 'ready') throw new Error('Sign in and wait for saved records to connect.');
  const record = reviewRecords.get(id);
  if (!record || record.deletedAt) throw new Error('This backup is not available.');
  if (record.recordType === 'territory-plan') return { id, label: record.planName || 'Saved plan', hallId: record.hallId,
    congregation: record.congregation, houses: readPlanAddresses(record, reviewRecords), territories: readPlanTerritories(record),
    boundary: decodeGeometry(record.boundaryJson, record.boundary) };
  if (record.recordType === 'territory-pdf') {
    const snapshot = readArchiveSnapshot(record, await archiveParts(record, 'snapshot'));
    if (String(snapshot.hall?.id) !== String(record.hallId) || String(snapshot.territory?.id) !== String(record.territoryId))
      throw new Error('This PDF snapshot does not match its saved meeting location or territory.');
    return { id, label: record.territoryName || 'Saved PDF territory', hallId: snapshot.hall.id, congregation: snapshot.congregation,
      houses: snapshot.houses, territories: [snapshot.territory], boundary: snapshot.territory.geometry || null };
  }
  throw new Error('Choose a saved plan or saved territory PDF to merge.');
}
function applyBackupMergeDraft(draft, expectedStamp) {
  if (!isAdmin() || expectedStamp !== mergeWorkspaceStamp(backupWorkspaceSnapshot())) throw new Error('The workspace changed. Preview the backup again.');
  if (activeTerritoryEditId || drawMode || manualHouseMode) throw new Error('Finish the current drawing or boundary edit before merging.');
  houses = JSON.parse(JSON.stringify(draft.houses)); territories = JSON.parse(JSON.stringify(draft.territories));
  selectedHouseIds.clear(); focusedTerritoryId = null; savedTerritoryEditId = null;
  workspaceGeneration += 1;
  // The location, current outer boundary and all original saved records stay intact.
  boundaryPreservesAddresses = true;
  renderAllPlanningData(); updateBoundaryUi();
  const points = houses.filter(validMapCoordinates).map(h => [Number(h.lat), Number(h.lng)]);
  if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
  setPlanSaveMessage('Backup added to this location in the editable workspace. Save merged backup to retain this combined set. Original backups are unchanged.', 'waiting');
}
function backupComparableTerritory(item) {
  return { id: String(item.id), name: item.name, colorIndex: item.colorIndex || 0,
    houseIds: [...(item.houseIds || [])].map(String).sort(),
    geometry: decodeGeometry(item.geometryJson, item.geometry),
    bulkBatchId: item.bulkBatchId || '', bulkBatchName: item.bulkBatchName || '' };
}
async function verifyMergedBackup(id, expected) {
  const response = await getDocFromServer(doc(db, 'reviews', id));
  if (!response.exists()) throw new Error('The merged backup could not be verified on the server. Keep the old backups.');
  const record = { ...response.data(), id: response.id }, parts = new Map();
  if (record.saveKind !== 'backup' || workKey(record.hallId, record.congregation) !== workKey(expected.hallId, expected.congregation))
    throw new Error('The backup destination could not be verified. Keep the old backups.');
  for (const partId of record.chunkIds || []) {
    const part = await getDocFromServer(doc(db, 'reviews', partId));
    if (!part.exists() || part.data().planId !== id) throw new Error('A merged backup address part is incomplete or shared. Keep all original backups.');
    parts.set(part.id, { ...part.data(), id: part.id });
  }
  const actualHouses = readPlanAddresses(record, parts).map(serializeHouse);
  const actualTerritories = readPlanTerritories(record).map(backupComparableTerritory);
  if (mergeStable(actualHouses) !== mergeStable(expected.houses.map(serializeHouse)) ||
    mergeStable(actualTerritories) !== mergeStable(expected.territories.map(backupComparableTerritory)) ||
    mergeStable(decodeGeometry(record.boundaryJson, record.boundary)) !== mergeStable(expected.boundary))
    throw new Error('The saved copy did not match the complete merged workspace. Keep the originals and check the saved copy before cleanup.');
  return true;
}
async function trashBackupRecord(id, restore, pendingSources) {
  if (!isAdmin() || savedRecordsStatus !== 'ready') throw new Error('Sign in and reconnect before changing backups.');
  const before = reviewRecords.get(id);
  if (!before) throw new Error('This backup is no longer available.');
  const metadata = await getDocsFromServer(query(collection(db, 'reviews'), where('recordType', 'in', ['territory-plan', 'territory-boundary', 'territory-name-choice'])));
  const scopeRecords = new Map();
  metadata.forEach(item => {
    const record = { ...item.data(), id: item.id };
    if (workKey(record.hallId, record.congregation) === workKey(before.hallId, before.congregation) || (record.recordType === 'territory-name-choice' && String(record.hallId) === String(before.hallId))) scopeRecords.set(item.id, record);
  });
  scopeRecords.set(id, before);
  const userEmail = currentUser?.email;
  const confirmed = await runTransaction(db, async transaction => {
    const fresh = new Map();
    for (const key of scopeRecords.keys()) {
      const response = await transaction.get(doc(db, 'reviews', key));
      if (response.exists()) fresh.set(key, { ...response.data(), id: response.id });
    }
    const record = fresh.get(id);
    if (!isAdmin() || currentUser.email !== userEmail || !record) throw new Error('The account or saved backup changed. Try again.');
    if (mergeStable(record) !== mergeStable(before)) throw new Error('This backup changed after it was shown. Refresh and review it again.');
    if (!restore) {
      const problem = backupDeletionProblem(record, fresh, currentPlanId, pendingSources);
      if (problem) throw new Error(problem);
    } else if (!record.deletedAt) throw new Error('This backup has already been restored.');
    transaction.set(doc(db, 'reviews', id), { deletedAt: restore ? null : serverTimestamp(), deletedByEmail: restore ? null : userEmail }, { merge: true });
    return record;
  });
  // Removal is reversible. Never delete shared chunks, original PDF payloads, or current work.
  reviewRecords.set(id, { ...confirmed, deletedAt: restore ? null : new Date(), deletedByEmail: restore ? null : userEmail });
  renderSavedRecords(); emitPlannerDataChange();
}
async function saveTerritoryNameChoice(hallId, normalizedName, territoryKey, details = {}) {
  if (!isAdmin() || String(selectedHall?.id) !== String(hallId)) throw new Error('The selected meeting place changed. Review the territory again.');
  const ref = doc(collection(db, 'reviews'));
  const record = { ...details, recordType: 'territory-name-choice', hallId, normalizedName, territoryKey, updatedAt: serverTimestamp(), updatedByEmail: currentUser.email };
  await setDoc(ref, record);
  reviewRecords.set(ref.id, { ...record, id: ref.id, updatedAt: new Date() });
  renderSavedRecords(); emitPlannerDataChange();
  return ref.id;
}
async function saveLibrarySnapshot(snapshot, options = {}) {
  if (!isAdmin() || savedRecordsStatus !== 'ready' || String(selectedHall?.id) !== String(snapshot.hallId)) throw new Error('Sign in and keep the intended meeting place selected.');
  const hall = { ...selectedHall }, email = currentUser.email, scopeCongregation = selectedCongregation;
  if (options.sessionScope && snapshot.territories.length > 400) throw new Error('This session has more than 400 territories. Divide it before saving.');
  const savedHouses = snapshot.houses.map(serializeHouse);
  const savedTerritories = JSON.parse(JSON.stringify(snapshot.territories));
  const ref = doc(collection(db, 'reviews')), id = ref.id;
  const chunks = [];
  for (let start = 0; start < savedHouses.length; start += FIRESTORE_HOUSE_CHUNK_SIZE) chunks.push(savedHouses.slice(start, start + FIRESTORE_HOUSE_CHUNK_SIZE));
  const chunkIds = chunks.map((_, index) => `${id}__library_${String(index).padStart(4, '0')}`);
  const record = { recordType: 'territory-plan', saveKind: options.kind || 'backup', savedWorkSchemaVersion: 1,
    savedWorkKey: workKey(hall.id, snapshot.congregation), libraryKept: Boolean(options.libraryKept),
    sessionScope: options.sessionScope || '',
    sessionRemovedTerritoryNames: snapshot.removedTerritoryNames || [],
    keptFromVersion: options.fromVersion || '', sourceVersionIds: options.sourceVersionIds || [],
    planName: options.name || datedWorkName(hall.name), hallId: hall.id, hallName: hall.name,
    hallLabel: markerLabel(hall), hallAddress: hall.address || '', congregation: snapshot.congregation,
    addressSetMode: true, addressOnlyMode: !snapshot.boundary, boundaryPreservesAddresses: true,
    boundaryJson: encodeGeometry(snapshot.boundary), boundaryName: `${hall.name} — ${snapshot.congregation}`,
    territoryPrefix: clean(els.territoryPrefix.value), sourceKey: 'manual', targetSize: targetSizeValue(),
    residentialOnly: true, separateUnits: true, groupingMethod: 'street',
    territoriesJson: JSON.stringify(savedTerritories.map(t => ({ ...t, geometry: null,
      geometryJson: encodeGeometry(decodeGeometry(t.geometryJson, t.geometry)) }))),
    houseCount: savedHouses.length, territoryCount: savedTerritories.length,
    includedHouseCount: savedHouses.filter(h => !h.avoid && h.included).length,
    avoidHouseCount: savedHouses.filter(h => h.avoid).length, chunkIds, chunkCount: chunkIds.length,
    updatedByEmail: email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  for (const [index, chunk] of chunks.entries()) {
    if (!isAdmin() || currentUser.email !== email || String(selectedHall?.id) !== String(hall.id) || selectedCongregation !== scopeCongregation) throw new Error('The meeting place or account changed. The new set was not published.');
    const batch = writeBatch(db);
    batch.set(doc(db, 'reviews', chunkIds[index]), { recordType: 'territory-plan-chunk', planId: id,
      chunkIndex: index, housesJson: JSON.stringify(chunk), houseCount: chunk.length, updatedAt: serverTimestamp(), updatedByEmail: email });
    await batch.commit();
  }
  if (!isAdmin() || currentUser.email !== email || String(selectedHall?.id) !== String(hall.id) || selectedCongregation !== scopeCongregation) throw new Error('The meeting place or account changed. The new set was not published.');
  const publish = writeBatch(db), choices = [];
  publish.set(ref, record);
  if (options.sessionScope === 'meeting-place') {
    savedTerritories.forEach((territory, index) => {
      const old = libraryChoice(reviewRecords, hall.id, territory.name), choiceRef = doc(collection(db, 'reviews'));
      const choice = { recordType: 'territory-name-choice', hallId: hall.id,
        normalizedName: libraryNameKey(territory.name), territoryKey: JSON.stringify([String(hall.id), String(territory.id)]),
        versionId: JSON.stringify(['plan', id, index]), hiddenVersionIds: old?.hiddenVersionIds || [],
        updatedAt: serverTimestamp(), updatedByEmail: email };
      publish.set(choiceRef, choice); choices.push({ ...choice, id: choiceRef.id });
    });
  }
  await publish.commit();
  choices.forEach(choice => reviewRecords.set(choice.id, { ...choice, updatedAt: new Date() }));
  reviewRecords.set(id, { ...record, id, updatedAt: new Date() });
  chunks.forEach((chunk, index) => reviewRecords.set(chunkIds[index], { id: chunkIds[index], recordType: 'territory-plan-chunk', planId: id, houses: chunk }));
  renderSavedRecords(); emitPlannerDataChange();
  return id;
}
async function libraryVersionPdf(version, progress) {
  if (!isAdmin() || String(selectedHall?.id) !== String(version.hallId)) throw new Error('Select the saved territory\'s meeting place first.');
  const hall = { ...selectedHall };
  return buildReviewedVersionPdf(version, hall, progress, {
    readPdf: async record => readArchivePdf(record, await archiveParts(record, 'pdf')),
    buildPdf: async (snapshot, progress) => {
      const { buildTerritoryPdf } = await import('./territory-flex-grouping-pdf.js?v=territories-20261022-44');
      return buildTerritoryPdf(snapshot, progress);
    }
  });
}

let hallSelectionSequence = 0;
async function selectHallWithFeedback(id, pan = true) {
  const token = ++hallSelectionSequence;
  const name = hallLocations.find(h => h.id === String(id))?.name || 'meeting place';
  startLoading('hall-selection', `Loading ${name}…`);
  await paintBeforeWork();
  if (token !== hallSelectionSequence) return;
  try { selectHall(id, pan, false); }
  finally { if (token === hallSelectionSequence) stopLoading('hall-selection'); }
}

const backupTools = createBackupTools({
  isAdmin, status: () => savedRecordsStatus, capture: backupWorkspaceSnapshot, context: () => ({ hallId: selectedHall?.id, congregation: selectedCongregation, generation: workspaceGeneration, currentPlanId }), records: () => new Map(reviewRecords),
  readSource: readBackupMergeSource, applyDraft: applyBackupMergeDraft, savePlan,
  verifySaved: verifyMergedBackup, trashRecord: trashBackupRecord, saveNameChoice: saveTerritoryNameChoice
});

async function saveNamedWork() {
  if (!requireAdmin()) return null;
  try { return await meetingSessionManager.save(); }
  catch (error) { setPlanSaveMessage(`The complete session was not saved: ${friendlyError(error)}`, 'error'); toast(friendlyError(error), true); return null; }
}

const libraryManager = createLibraryManager({
  isAdmin, status: () => savedRecordsStatus, hall: () => selectedHall,
  records: () => reviewRecords, capture: backupWorkspaceSnapshot, saveSnapshot: saveLibrarySnapshot,
  writeChoice: (hallId, name, key, details) => saveTerritoryNameChoice(hallId, libraryNameKey(name), key, details)
});


// One editable meeting-place session, with saved-library versions folded in at
// explicit edit/keep/save actions. Previewing alone never changes the workspace.
let sessionBaseline = new Map();
let sessionRemovedNames = [];
function sessionWorkspace() {
  const value = { hallId: selectedHall?.id || '', hallName: selectedHall?.name || '', congregation: selectedCongregation,
    currentPlanId, generation: workspaceGeneration, editId: savedTerritoryEditId,
    editing: Boolean(activeTerritoryEditId || drawMode || manualHouseMode), houses, territories, boundary: boundaryGeometry };
  const changes = sessionChanges(value, sessionBaseline);
  changes.removedTerritoryNames = [...new Set([...sessionRemovedNames, ...changes.removedTerritoryNames])];
  return { ...value, ...changes };
}
function captureMeetingSession() { return JSON.parse(JSON.stringify(sessionWorkspace())); }
function rememberMeetingSessionBaseline() { sessionBaseline = territoryStamps({ houses, territories }); }
function readSessionBase(workspace) {
  const plan = currentWorkFor(savedPlans(), workspace.hallId, workspace.congregation);
  if (!plan || (!workspace.editId && plan.id === workspace.currentPlanId)) return null;
  return { id: plan.id, hallId: plan.hallId, congregation: plan.congregation,
    houses: readPlanAddresses(plan, reviewRecords), territories: readPlanTerritories(plan),
    boundary: decodeGeometry(plan.boundaryJson, plan.boundary) };
}
function applyMeetingSession(draft, expectedStamp, planId = null) {
  if (!isAdmin() || sessionContentStamp(captureMeetingSession()) !== expectedStamp || String(selectedHall?.id) !== String(draft.hallId)) throw new Error('Your session changed. Nothing was replaced; retry the action.');
  houses = JSON.parse(JSON.stringify(draft.houses)); territories = JSON.parse(JSON.stringify(draft.territories));
  boundaryGeometry = draft.boundary ? JSON.parse(JSON.stringify(draft.boundary)) : null;
  boundaryPreservesAddresses = true; savedTerritoryEditId = null; selectedHouseIds.clear(); focusedTerritoryId = null;
  workspaceGeneration += 1;
  sessionRemovedNames = [...(draft.removedTerritoryNames || [])];
  if (planId) { currentPlanId = planId; activeSavedWorkKey = workKey(selectedHall.id, selectedCongregation); els.planName.value = reviewRecords.get(planId)?.planName || ''; }
  boundaryGroup.clearLayers();
  if (boundaryGeometry) L.geoJSON(boundaryGeometry, { style: { color: '#0b5b9f', weight: 2, dashArray: '9 7', fillOpacity: .06 } }).addTo(boundaryGroup);
  recalculateTerritoryHouseIds();
  if (planId) rememberMeetingSessionBaseline();
  if (document.getElementById('bulkFocus')) document.getElementById('bulkFocus').checked = false;
  globalThis.__denverMeetingPlaceFlow?.reset();
  updateSavedTerritoryEditUi(); updateBoundaryUi(); renderAllPlanningData();
}
const meetingSessionManager = createMeetingSessionManager({
  turf, isAdmin, status: () => savedRecordsStatus, capture: captureMeetingSession,
  context: () => [selectedHall?.id, selectedCongregation, workspaceGeneration],
  records: () => new Map(reviewRecords), hall: () => selectedHall, readBase: readSessionBase,
  readSnapshot: async record => readArchiveSnapshot(record, await archiveParts(record, 'snapshot')),
  saveSnapshot: saveLibrarySnapshot, apply: applyMeetingSession, editBoundary: editTerritoryBoundary,
  finishEdit: async () => { if (activeTerritoryEditId) await saveActiveTerritoryBoundaryEdit(); return !activeTerritoryEditId && !drawMode; },
  askName: (suggestion, draft) => prompt(`Save this complete meeting-place session: ${draft.territories.length} territories and ${draft.houses.length.toLocaleString()} addresses, including avoid and unassigned addresses. Name:`, suggestion),
  confirmVersion: version => confirm(`Use this version of ${version.territory.name} in the current meeting-place session? Only that territory is replaced; other territories, new uploads and avoid records are kept. SAVE YOUR WORK saves the complete session.`),
  confirm: message => confirm(message), keepVersion: version => libraryManager.keep(version),
  scanTerritory: async geometry => {
    const scanner = globalThis.__denverFullBoundaryAssessor;
    if (!scanner) throw new Error('The assessor/GIS scanner is not ready. Retry after loading completes.');
    return scanner.run({ managed: true, searchGeometry: geometry });
  },
  loading: busy => busy ? startLoading('meeting-session', 'Preparing the complete meeting-place session…') : stopLoading('meeting-session'),
  paint: paintBeforeWork,
  message: message => { setPlanSaveMessage(message, 'success'); toast(message); }
});


globalThis.__denverTerritoryPlannerAPI = Object.freeze({
  meetingSessionManager,
  getSessionWorkspace: sessionWorkspace,
  backupTools,
  libraryManager,
  getMap: () => map,
  getDb: () => db,
  getCurrentUser: () => currentUser,
  getSelectedHall: () => selectedHall,
  getSelectedCongregation: () => selectedCongregation,
  getCurrentPlanId: () => currentPlanId,
  getTerritories: () => territories,
  getHouses: () => houses,
  getBoundaryGeometry: () => boundaryGeometry,
  getBoundaryPreservesAddresses: () => boundaryPreservesAddresses,
  getSavedPlans: () => savedPlans().map(item => ({ ...item })),
  getSavedRecords: () => new Map(reviewRecords),
  getSavedRecordsStatus: () => savedRecordsStatus,
  getWorkspaceGeneration: () => workspaceGeneration,
  setMeetingSearchBoundary: geometry => {
    if (!requireAdmin()) return false;
    setBoundaryGeometry(geometry, true, true);
    return true;
  },
  saveMeetingPlaceBoundary,
  loadPlanRecord,
  createBoundaryAroundAddresses,
  getHouseMarkers: () => houseMarkers,
  getTerritoryLayers: () => territoryLayers,
  getTerritoryColors: () => TERRITORY_COLORS,
  addHouseRecord,
  dedupeHouses: dedupeHouseRecords,
  pointInsideBoundary,
  recalculateTerritoryHouseIds,
  render: renderAllPlanningData,
  savePlan,
  saveYourWork: saveNamedWork,
  saveTerritoryPdf,
  finishTerritoryBoundaryEdit: async id => {
    if (activeTerritoryEditId !== id) return true;
    await saveActiveTerritoryBoundaryEdit();
    return activeTerritoryEditId === null;
  },
  selectTerritoryHouses,
  uniqueId,
  normalizeAddressKey,
  distanceMiles,
  isAdmin,
  requireAdmin,
  toast,
  geocodeAddress: address => geocodeAvoidAddress(address),
  validMapCoordinates,
  refresh: emitPlannerDataChange
});

initialize();


import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HOTELS, RAIL_STATIONS, RAIL_CORRIDORS } from './data.js';

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
const GEOCODE_TIMEOUT_MS = 12000;

let firebaseApp;
let auth;
let db;
let currentUser = null;
let map;
let previewMarker = null;
let selectedLocationId = null;
let geocodeTimer = null;
let geocodeRevision = 0;
let lastNominatimRequestAt = 0;
let locations = [];
let hallsUnsubscribe = null;

const hotelLayer = L.layerGroup();
const stationLayer = L.layerGroup();
const railLineLayer = L.layerGroup();
const smpwLayer = L.layerGroup();
const hotelMarkers = new Map();
const stationMarkers = new Map();
const smpwMarkers = new Map();

const els = Object.fromEntries([
  'loginButton','signOutButton','addLocationButton','showHotels','showStations','showRailLines','showSmpw',
  'fitAllButton','fitSmpwButton','hotelCount','stationCount','locationCount','approvedCount','directoryCount',
  'locationSearch','statusFilter','locationList','loginModal','loginForm','loginEmail','loginPassword',
  'cancelLogin','resetPassword','smpwLocationModal','locationModalTitle','closeLocationModal','smpwLocationForm',
  'locationId','markerLabel','locationStatus','locationName','locationAddress','addressStatus','locationLat','locationLng',
  'locateAddressButton','useMapCenterButton','verifyGoogleLink','verifyAppleLink','cartCount','locationSchedule',
  'locationContact','locationNotes','cancelLocation','saveLocationButton','toast'
].map(id => [id, document.getElementById(id)]));

function clean(value = '') { return String(value ?? '').trim(); }
function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
}
function isAdmin() { return currentUser?.email?.toLowerCase() === ADMIN_EMAIL; }
function statusLabel(status) {
  return ({ proposed:'Proposed', review:'Needs site review', approved:'Approved', unavailable:'Not available' })[status] || 'Proposed';
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
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'The network or Firebase service is temporarily unavailable.';
  if (code.includes('unauthorized-domain')) return 'Add letdesignworks.github.io under Firebase Authentication authorized domains.';
  return error?.message?.replace(/^Firebase:\s*/i, '') || 'Unknown error';
}
function pointQuery(point) {
  if (Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))) return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
  return clean(point?.address || point?.name);
}
function googleSearch(point) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', pointQuery(point));
  return url.href;
}
function appleSearch(point) {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('q', clean(point?.name || point?.address));
  if (Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))) url.searchParams.set('ll', `${point.lat},${point.lng}`);
  return url.href;
}
function googleDirections(origin, destination, mode = 'walking') {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', pointQuery(origin));
  url.searchParams.set('destination', pointQuery(destination));
  url.searchParams.set('travelmode', mode);
  return url.href;
}
function appleDirections(origin, destination, mode = 'walking') {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('saddr', pointQuery(origin));
  url.searchParams.set('daddr', pointQuery(destination));
  url.searchParams.set('dirflg', mode === 'transit' ? 'r' : mode === 'driving' ? 'd' : 'w');
  return url.href;
}
function distanceMiles(a, b) {
  const toRad = degrees => degrees * Math.PI / 180;
  const lat1 = toRad(Number(a.lat)), lat2 = toRad(Number(b.lat));
  const dLat = lat2 - lat1;
  const dLng = toRad(Number(b.lng) - Number(a.lng));
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function nearestTo(point, items) {
  return items.map(item => ({ item, miles: distanceMiles(point, item) })).sort((a, b) => a.miles - b.miles)[0] || null;
}
function formatMiles(miles) {
  if (!Number.isFinite(miles)) return '—';
  if (miles < .1) return '<0.1 mi';
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}
function cartSvg() {
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M11 16h8"/><path d="M17 16l3 7"/><rect x="20" y="12" width="29" height="34" rx="3"/><path d="M24 19h21M24 25h21M24 32h9M36 32h9"/><circle cx="27" cy="51" r="4"/><circle cx="44" cy="51" r="4"/></svg>';
}
function hotelIcon(hotel) {
  return L.divIcon({ className:'', html:`<div class="hotel-pin">${escapeHtml(hotel.id)}</div>`, iconSize:[40,40], iconAnchor:[20,20] });
}
function stationIcon(station) {
  return L.divIcon({ className:'', html:`<div class="rail-pin">${escapeHtml(station.marker)}</div>`, iconSize:[37,37], iconAnchor:[18,18] });
}
function cartIcon(record) {
  const selected = record.id === selectedLocationId ? ' selected' : '';
  const status = clean(record.status || 'proposed');
  return L.divIcon({
    className:'',
    html:`<div class="cart-pin ${escapeHtml(status)}${selected}">${cartSvg()}<b>${escapeHtml(record.markerLabel || 'S')}</b></div>`,
    iconSize:[53,53], iconAnchor:[26,26]
  });
}
function previewIcon() {
  return L.divIcon({ className:'', html:'<div class="preview-pin"></div>', iconSize:[30,30], iconAnchor:[15,15] });
}

function initMap() {
  map = L.map('map', { zoomControl:true, attributionControl:true }).setView([39.665, -104.95], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  hotelLayer.addTo(map);
  stationLayer.addTo(map);
  railLineLayer.addTo(map);
  smpwLayer.addTo(map);
  renderHotels();
  renderStations();
  renderRailCorridors();
  fitAll();
}
function renderHotels() {
  hotelLayer.clearLayers();
  hotelMarkers.clear();
  for (const hotel of HOTELS) {
    const marker = L.marker([hotel.lat, hotel.lng], { icon:hotelIcon(hotel), title:hotel.name }).addTo(hotelLayer);
    marker.bindPopup(`<div class="popup-title">${escapeHtml(hotel.id)} — ${escapeHtml(hotel.name)}</div><div class="popup-sub">${escapeHtml(hotel.address)}<br>${escapeHtml(hotel.region)}</div><div class="popup-actions"><a href="${googleSearch(hotel)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(hotel)}" target="_blank" rel="noopener">Apple Maps</a></div>`);
    hotelMarkers.set(hotel.id, marker);
  }
  els.hotelCount.textContent = HOTELS.length;
}
function renderStations() {
  stationLayer.clearLayers();
  stationMarkers.clear();
  for (const station of RAIL_STATIONS) {
    const marker = L.marker([station.lat, station.lng], { icon:stationIcon(station), title:station.name }).addTo(stationLayer);
    marker.bindPopup(`<div class="popup-title">${escapeHtml(station.marker)} — ${escapeHtml(station.name)}</div><div class="popup-sub">${escapeHtml(station.address)}</div><div class="popup-actions"><a href="${escapeHtml(station.rtdUrl)}" target="_blank" rel="noopener">Official RTD Page</a><a href="${googleSearch(station)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(station)}" target="_blank" rel="noopener">Apple Maps</a></div>`);
    stationMarkers.set(station.id, marker);
  }
  els.stationCount.textContent = RAIL_STATIONS.length;
}
function renderRailCorridors() {
  railLineLayer.clearLayers();
  const stationById = new Map(RAIL_STATIONS.map(station => [station.id, station]));
  for (const corridor of RAIL_CORRIDORS) {
    const points = corridor.points.map(id => stationById.get(id)).filter(Boolean).map(station => [station.lat, station.lng]);
    if (points.length > 1) L.polyline(points, { color:corridor.color, weight:5, opacity:.58, dashArray:'10 7', interactive:false }).addTo(railLineLayer);
  }
}
function locationPopup(record) {
  const nearestHotel = nearestTo(record, HOTELS);
  const nearestStation = nearestTo(record, RAIL_STATIONS);
  return `<div class="popup-title">${escapeHtml(record.markerLabel || 'S')} — ${escapeHtml(record.name)}</div>
    <div class="popup-sub">${escapeHtml(record.address)}<br>${escapeHtml(statusLabel(record.status))}${record.cartCount ? ` • ${escapeHtml(record.cartCount)} cart${Number(record.cartCount) === 1 ? '' : 's'}` : ''}${record.schedule ? `<br>${escapeHtml(record.schedule)}` : ''}</div>
    <div class="popup-grid">
      <div class="popup-tile"><span>Nearest hotel</span><strong>${nearestHotel ? `${escapeHtml(nearestHotel.item.id)} — ${escapeHtml(nearestHotel.item.name)} (${formatMiles(nearestHotel.miles)})` : '—'}</strong></div>
      <div class="popup-tile"><span>Nearest rail</span><strong>${nearestStation ? `${escapeHtml(nearestStation.item.name)} (${formatMiles(nearestStation.miles)})` : '—'}</strong></div>
    </div>
    <div class="popup-actions"><a href="${googleSearch(record)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(record)}" target="_blank" rel="noopener">Apple Maps</a>${nearestStation ? `<a href="${googleDirections(nearestStation.item, record, 'walking')}" target="_blank" rel="noopener">Walk from Rail</a>` : ''}</div>`;
}
function renderSmpwMarkers() {
  smpwLayer.clearLayers();
  smpwMarkers.clear();
  for (const record of locations) {
    const marker = L.marker([record.lat, record.lng], { icon:cartIcon(record), title:record.name, zIndexOffset:500 }).addTo(smpwLayer);
    marker.bindPopup(locationPopup(record));
    marker.on('click', () => {
      selectedLocationId = record.id;
      renderSmpwMarkers();
      renderLocationList();
      smpwMarkers.get(record.id)?.openPopup();
    });
    smpwMarkers.set(record.id, marker);
  }
  updateCounts();
}
function updateCounts() {
  els.locationCount.textContent = locations.length;
  els.approvedCount.textContent = locations.filter(record => record.status === 'approved').length;
}
function fitAll() {
  if (!map) return;
  const points = [
    ...HOTELS.map(item => [item.lat,item.lng]),
    ...RAIL_STATIONS.map(item => [item.lat,item.lng]),
    ...locations.map(item => [item.lat,item.lng])
  ];
  if (points.length) map.fitBounds(points, { padding:[35,35], maxZoom:11 });
}
function fitSmpw() {
  if (!locations.length) { toast('No SMPW locations have been added yet.', true); return; }
  map.fitBounds(locations.map(item => [item.lat,item.lng]), { padding:[45,45], maxZoom:15 });
}
function syncLayer(checkbox, layer) {
  if (checkbox.checked) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else if (map.hasLayer(layer)) map.removeLayer(layer);
}

function filteredLocations() {
  const query = clean(els.locationSearch.value).toLowerCase();
  const status = els.statusFilter.value;
  return locations.filter(record => {
    if (status !== 'all' && record.status !== status) return false;
    if (!query) return true;
    const hotel = nearestTo(record, HOTELS)?.item;
    const station = nearestTo(record, RAIL_STATIONS)?.item;
    return [record.markerLabel,record.name,record.address,record.schedule,record.notes,record.contact,hotel?.name,station?.name].join(' ').toLowerCase().includes(query);
  });
}
function renderLocationList() {
  const list = filteredLocations();
  els.directoryCount.textContent = `${list.length} shown`;
  if (!list.length) {
    els.locationList.innerHTML = `<div class="empty">${locations.length ? 'No SMPW locations match this search or status filter.' : 'No SMPW locations have been added yet.'}</div>`;
    return;
  }
  els.locationList.innerHTML = list.map(record => {
    const nearestHotel = nearestTo(record, HOTELS);
    const nearestStation = nearestTo(record, RAIL_STATIONS);
    return `<article class="location-row${record.id === selectedLocationId ? ' active' : ''}" data-location-id="${escapeHtml(record.id)}">
      <div class="location-icon">${cartSvg()}<em>${escapeHtml(record.markerLabel || 'S')}</em></div>
      <div class="location-main">
        <div class="location-title"><strong>${escapeHtml(record.name)}</strong><span class="status-pill status-${escapeHtml(record.status || 'proposed')}">${escapeHtml(statusLabel(record.status))}</span></div>
        <small>${escapeHtml(record.address)}</small>
        <small>${record.cartCount ? `${escapeHtml(record.cartCount)} cart${Number(record.cartCount) === 1 ? '' : 's'} • ` : ''}${record.schedule ? escapeHtml(record.schedule) : 'Schedule not entered'}</small>
        <small>Nearest hotel: ${nearestHotel ? `${escapeHtml(nearestHotel.item.id)} — ${escapeHtml(nearestHotel.item.name)} (${formatMiles(nearestHotel.miles)})` : '—'}<br>Nearest rail: ${nearestStation ? `${escapeHtml(nearestStation.item.name)} (${formatMiles(nearestStation.miles)})` : '—'}</small>
        <div class="location-links"><a href="${googleSearch(record)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(record)}" target="_blank" rel="noopener">Apple Maps</a>${nearestStation ? `<a href="${googleDirections(nearestStation.item, record, 'walking')}" target="_blank" rel="noopener">Rail → Cart</a>` : ''}${nearestHotel ? `<a href="${googleDirections(nearestHotel.item, record, 'transit')}" target="_blank" rel="noopener">Hotel → Cart</a>` : ''}</div>
        ${isAdmin() ? `<div class="location-actions"><button type="button" data-edit-location="${escapeHtml(record.id)}">Edit</button><button type="button" class="danger" data-delete-location="${escapeHtml(record.id)}">Delete</button></div>` : ''}
      </div>
    </article>`;
  }).join('');
  els.locationList.querySelectorAll('[data-location-id]').forEach(row => row.addEventListener('click', event => {
    if (event.target.closest('a,button')) return;
    selectLocation(row.dataset.locationId, true);
  }));
  els.locationList.querySelectorAll('[data-edit-location]').forEach(button => button.addEventListener('click', () => openLocationModal(button.dataset.editLocation)));
  els.locationList.querySelectorAll('[data-delete-location]').forEach(button => button.addEventListener('click', () => deleteLocation(button.dataset.deleteLocation)));
}
function selectLocation(id, pan = false) {
  const record = locations.find(item => item.id === id);
  if (!record) return;
  selectedLocationId = id;
  renderSmpwMarkers();
  renderLocationList();
  if (pan) map.setView([record.lat,record.lng], Math.max(map.getZoom(),15), { animate:true });
  smpwMarkers.get(id)?.openPopup();
}

function openLogin() { els.loginModal.classList.add('open'); setTimeout(() => els.loginPassword.focus(), 50); }
function closeLogin() { els.loginModal.classList.remove('open'); }
function nextMarkerLabel() {
  const used = locations.map(record => clean(record.markerLabel).toUpperCase()).filter(Boolean);
  let number = 1;
  while (used.includes(`S${number}`)) number += 1;
  return `S${number}`;
}
function clearPreview() {
  if (previewMarker && map) map.removeLayer(previewMarker);
  previewMarker = null;
}
function setPreview(lat, lng, pan = true) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
  clearPreview();
  previewMarker = L.marker([Number(lat),Number(lng)], { icon:previewIcon(), zIndexOffset:1000 }).addTo(map);
  if (pan) map.setView([Number(lat),Number(lng)], Math.max(map.getZoom(),15), { animate:true });
}
function updateVerifyLinks() {
  const point = { name:clean(els.locationName.value) || 'SMPW location', address:clean(els.locationAddress.value), lat:Number(els.locationLat.value), lng:Number(els.locationLng.value) };
  const valid = Number.isFinite(point.lat) && Number.isFinite(point.lng);
  els.verifyGoogleLink.hidden = !valid;
  els.verifyAppleLink.hidden = !valid;
  if (valid) {
    els.verifyGoogleLink.href = googleSearch(point);
    els.verifyAppleLink.href = appleSearch(point);
  }
}
function openLocationModal(id = null) {
  if (!isAdmin()) { openLogin(); return; }
  clearTimeout(geocodeTimer);
  clearPreview();
  els.smpwLocationForm.reset();
  els.locationId.value = '';
  els.markerLabel.value = nextMarkerLabel();
  els.locationStatus.value = 'proposed';
  els.cartCount.value = '1';
  els.addressStatus.textContent = 'Pause after typing the complete address and the coordinates will update automatically.';
  els.addressStatus.dataset.state = 'waiting';
  const record = id ? locations.find(item => item.id === id) : null;
  if (record) {
    els.locationModalTitle.textContent = 'Edit SMPW Cart Location';
    els.locationId.value = record.id;
    els.markerLabel.value = record.markerLabel || '';
    els.locationStatus.value = record.status || 'proposed';
    els.locationName.value = record.name || '';
    els.locationAddress.value = record.address || '';
    els.locationLat.value = record.lat;
    els.locationLng.value = record.lng;
    els.cartCount.value = Number(record.cartCount) || 0;
    els.locationSchedule.value = record.schedule || '';
    els.locationContact.value = record.contact || '';
    els.locationNotes.value = record.notes || '';
    setPreview(record.lat, record.lng, false);
  } else {
    els.locationModalTitle.textContent = 'Add SMPW Cart Location';
    const center = map.getCenter();
    els.locationLat.value = center.lat.toFixed(6);
    els.locationLng.value = center.lng.toFixed(6);
  }
  updateVerifyLinks();
  els.smpwLocationModal.classList.add('open');
  setTimeout(() => els.locationName.focus(), 60);
}
function closeLocationModal() {
  els.smpwLocationModal.classList.remove('open');
  clearTimeout(geocodeTimer);
  clearPreview();
}

function censusGeocode(address, revision) {
  return new Promise((resolve, reject) => {
    const callbackName = `__smpwCensus_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The U.S. Census address service timed out.')); }, GEOCODE_TIMEOUT_MS);
    window[callbackName] = payload => {
      if (revision !== geocodeRevision) { cleanup(); reject(new Error('The address changed before the lookup finished.')); return; }
      const match = payload?.result?.addressMatches?.[0];
      cleanup();
      if (!match?.coordinates) { reject(new Error('No U.S. Census address match was found.')); return; }
      resolve({ lat:Number(match.coordinates.y), lng:Number(match.coordinates.x), matchedAddress:match.matchedAddress || address, source:'U.S. Census Geocoder' });
    };
    script.onerror = () => { cleanup(); reject(new Error('The U.S. Census address service could not be reached.')); };
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.searchParams.set('address', address);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('format', 'jsonp');
    url.searchParams.set('callback', callbackName);
    script.src = url.href;
    document.head.appendChild(script);
  });
}
async function nominatimGeocode(address) {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastNominatimRequestAt = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', address);
  const response = await fetch(url, { headers:{ Accept:'application/json' } });
  if (!response.ok) throw new Error(`OpenStreetMap address search returned ${response.status}.`);
  const results = await response.json();
  if (!results.length) throw new Error('No address match was found.');
  return { lat:Number(results[0].lat), lng:Number(results[0].lon), matchedAddress:results[0].display_name || address, source:'OpenStreetMap address search' };
}
async function geocodeAddress(address, revision) {
  try { return await censusGeocode(address, revision); }
  catch (firstError) {
    if (revision !== geocodeRevision) throw firstError;
    try { return await nominatimGeocode(address); }
    catch (secondError) { throw new Error(`${firstError.message} ${secondError.message}`.trim()); }
  }
}
async function locateAddress(automatic = false) {
  const address = clean(els.locationAddress.value);
  if (address.length < 8) {
    if (!automatic) toast('Enter the complete address first.', true);
    return;
  }
  const revision = ++geocodeRevision;
  els.locateAddressButton.disabled = true;
  els.locateAddressButton.textContent = 'Locating…';
  els.addressStatus.textContent = 'Locating the address and updating the map coordinates…';
  try {
    const result = await geocodeAddress(address, revision);
    if (revision !== geocodeRevision) return;
    if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) throw new Error('The address service returned invalid coordinates.');
    els.locationLat.value = result.lat.toFixed(6);
    els.locationLng.value = result.lng.toFixed(6);
    els.addressStatus.textContent = `Matched by ${result.source}: ${result.matchedAddress}. Confirm the preview marker before saving.`;
    setPreview(result.lat, result.lng, true);
    updateVerifyLinks();
    if (!automatic) toast('Address coordinates updated.');
  } catch (error) {
    if (revision !== geocodeRevision) return;
    els.addressStatus.textContent = `Could not locate the address automatically: ${friendlyError(error)} Use the map center or enter coordinates manually.`;
    if (!automatic) toast(`Could not locate the address: ${friendlyError(error)}`, true);
  } finally {
    els.locateAddressButton.disabled = false;
    els.locateAddressButton.textContent = 'Refresh Address Coordinates';
  }
}
function scheduleAutomaticGeocode() {
  clearTimeout(geocodeTimer);
  geocodeRevision += 1;
  els.locationLat.value = '';
  els.locationLng.value = '';
  clearPreview();
  updateVerifyLinks();
  const address = clean(els.locationAddress.value);
  els.addressStatus.textContent = address.length >= 8 ? 'Waiting for you to finish typing the address…' : 'Enter the complete street address, city, state, and ZIP.';
  if (address.length >= 12) geocodeTimer = setTimeout(() => locateAddress(true), 950);
}
function useMapCenter() {
  const center = map.getCenter();
  els.locationLat.value = center.lat.toFixed(6);
  els.locationLng.value = center.lng.toFixed(6);
  els.addressStatus.textContent = 'Current map-center coordinates copied. Confirm the marker is at the intended cart position.';
  setPreview(center.lat, center.lng, false);
  updateVerifyLinks();
  toast('Map-center coordinates copied.');
}
async function saveLocation(event) {
  event.preventDefault();
  if (!isAdmin()) { closeLocationModal(); openLogin(); return; }
  const lat = Number(els.locationLat.value), lng = Number(els.locationLng.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { toast('Locate the address or enter valid latitude and longitude coordinates.', true); return; }
  const id = clean(els.locationId.value);
  const ref = id ? doc(db, 'halls', id) : doc(collection(db, 'halls'));
  const button = els.saveLocationButton;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await setDoc(ref, {
      recordType:'smpw-location',
      markerLabel:clean(els.markerLabel.value).toUpperCase(),
      name:clean(els.locationName.value),
      address:clean(els.locationAddress.value),
      lat,lng,
      status:els.locationStatus.value,
      cartCount:Math.max(0, Math.min(99, Number(els.cartCount.value) || 0)),
      schedule:clean(els.locationSchedule.value),
      contact:clean(els.locationContact.value),
      notes:clean(els.locationNotes.value),
      updatedByEmail:currentUser.email,
      updatedAt:serverTimestamp(),
      ...(id ? {} : { createdByEmail:currentUser.email, createdAt:serverTimestamp() })
    }, { merge:true });
    selectedLocationId = ref.id;
    closeLocationModal();
    toast(id ? 'SMPW location updated.' : 'SMPW location added.');
  } catch (error) {
    toast(`Could not save the SMPW location: ${friendlyError(error)}`, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Save SMPW Location';
  }
}
async function deleteLocation(id) {
  if (!isAdmin()) return;
  const record = locations.find(item => item.id === id);
  if (!record || !confirm(`Delete SMPW location “${record.name}”?`)) return;
  try {
    await deleteDoc(doc(db, 'halls', id));
    if (selectedLocationId === id) selectedLocationId = null;
    toast('SMPW location deleted.');
  } catch (error) {
    toast(`Could not delete the SMPW location: ${friendlyError(error)}`, true);
  }
}
function updateAuthUi() {
  const signedIn = Boolean(currentUser);
  els.loginButton.hidden = signedIn;
  els.signOutButton.hidden = !signedIn;
  els.addLocationButton.hidden = !isAdmin();
  renderLocationList();
}
function subscribeLocations() {
  if (hallsUnsubscribe) hallsUnsubscribe();
  hallsUnsubscribe = onSnapshot(collection(db, 'halls'), snapshot => {
    locations = [];
    snapshot.forEach(item => {
      const data = item.data();
      if (data.recordType !== 'smpw-location') return;
      const lat = Number(data.lat), lng = Number(data.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      locations.push({ id:item.id, ...data, lat, lng });
    });
    locations.sort((a,b) => clean(a.markerLabel).localeCompare(clean(b.markerLabel), undefined, { numeric:true }) || clean(a.name).localeCompare(clean(b.name)));
    if (selectedLocationId && !locations.some(item => item.id === selectedLocationId)) selectedLocationId = null;
    renderSmpwMarkers();
    renderLocationList();
  }, error => toast(`SMPW locations could not be loaded: ${friendlyError(error)}`, true));
}

function wireEvents() {
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
  els.addLocationButton.addEventListener('click', () => openLocationModal());
  els.closeLocationModal.addEventListener('click', closeLocationModal);
  els.cancelLocation.addEventListener('click', closeLocationModal);
  els.smpwLocationModal.addEventListener('click', event => { if (event.target === els.smpwLocationModal) closeLocationModal(); });
  els.smpwLocationForm.addEventListener('submit', saveLocation);
  els.locationAddress.addEventListener('input', scheduleAutomaticGeocode);
  els.locationName.addEventListener('input', updateVerifyLinks);
  els.locationLat.addEventListener('input', () => {
    updateVerifyLinks();
    const lat = Number(els.locationLat.value), lng = Number(els.locationLng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setPreview(lat,lng,false);
  });
  els.locationLng.addEventListener('input', () => {
    updateVerifyLinks();
    const lat = Number(els.locationLat.value), lng = Number(els.locationLng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setPreview(lat,lng,false);
  });
  els.locateAddressButton.addEventListener('click', () => locateAddress(false));
  els.useMapCenterButton.addEventListener('click', useMapCenter);
  els.locationSearch.addEventListener('input', renderLocationList);
  els.statusFilter.addEventListener('change', renderLocationList);
  els.fitAllButton.addEventListener('click', fitAll);
  els.fitSmpwButton.addEventListener('click', fitSmpw);
  els.showHotels.addEventListener('change', () => syncLayer(els.showHotels, hotelLayer));
  els.showStations.addEventListener('change', () => syncLayer(els.showStations, stationLayer));
  els.showRailLines.addEventListener('change', () => syncLayer(els.showRailLines, railLineLayer));
  els.showSmpw.addEventListener('change', () => syncLayer(els.showSmpw, smpwLayer));
}

initMap();
wireEvents();
updateCounts();
renderLocationList();

try {
  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, user => { currentUser = user; updateAuthUi(); });
  subscribeLocations();
} catch (error) {
  toast(`Firebase could not initialize: ${friendlyError(error)}`, true);
}

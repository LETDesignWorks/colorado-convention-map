import {canEdit, canView, isOwner, observeSiteAccess} from '../assets/site-access.mjs?v=access-20261114-1';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from 'https://letdesignworks.github.io/colorado-convention-map/bus-access/data.js?v=pin-audit-20261108-1';
import { HOTELS } from 'https://letdesignworks.github.io/colorado-convention-map/routes/hotels.js?v=south-dtc-rail-20260910-1';
import {
  DTC_HOTEL_IDS, SOUTH_BASE_IDS, RAIL_STATIONS,
  RTD_E_SCHEDULE_URL, RTD_R_SCHEDULE_URL, RTD_C_SCHEDULE_URL
} from 'https://letdesignworks.github.io/colorado-convention-map/south-dtc-rail/data.js?v=south-dtc-rail-20260910-1';

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
const SOUTH_LAT_TOLERANCE = 0.02;
const SOUTH_RADIUS_MILES = 33;

let app;
let auth;
let db;
let map;
let southBoundaryLayer;
let currentUser = null;
let meetingPoints = [];
let selectedHotel = null;
let selectedMeeting = null;
let pendingLocationId = null;

const publicHallData = new Map();
const railPreferences = new Map();
const meetingMarkers = new Map();
const stationMarkers = new Map();
const hotelMarkers = new Map();

const els = {
  hotelSelect: document.getElementById('hotelSelect'),
  hotelDetail: document.getElementById('hotelDetail'),
  meetingSelect: document.getElementById('meetingSelect'),
  meetingDetail: document.getElementById('meetingDetail'),
  originStationSelect: document.getElementById('originStationSelect'),
  destinationStationSelect: document.getElementById('destinationStationSelect'),
  originDistance: document.getElementById('originDistance'),
  destinationDistance: document.getElementById('destinationDistance'),
  firstMileMode: document.getElementById('firstMileMode'),
  lastMileMode: document.getElementById('lastMileMode'),
  closestStationsButton: document.getElementById('closestStationsButton'),
  resultTitle: document.getElementById('resultTitle'),
  connectionQuality: document.getElementById('connectionQuality'),
  tripSummary: document.getElementById('tripSummary'),
  routeGuidance: document.getElementById('routeGuidance'),
  linkSections: document.getElementById('linkSections'),
  googleFullTrip: document.getElementById('googleFullTrip'),
  appleFullTrip: document.getElementById('appleFullTrip'),
  googleFirstLeg: document.getElementById('googleFirstLeg'),
  appleFirstLeg: document.getElementById('appleFirstLeg'),
  googleRailLeg: document.getElementById('googleRailLeg'),
  appleRailLeg: document.getElementById('appleRailLeg'),
  googleLastLeg: document.getElementById('googleLastLeg'),
  appleLastLeg: document.getElementById('appleLastLeg'),
  railNoteWrap: document.getElementById('railNoteWrap'),
  railNote: document.getElementById('railNote'),
  savedPreferenceChip: document.getElementById('savedPreferenceChip'),
  savedPublicNote: document.getElementById('savedPublicNote'),
  loadSavedButton: document.getElementById('loadSavedButton'),
  savePreferenceButton: document.getElementById('savePreferenceButton'),
  clearPreferenceButton: document.getElementById('clearPreferenceButton'),
  meetingSearch: document.getElementById('meetingSearch'),
  distanceFilter: document.getElementById('distanceFilter'),
  meetingList: document.getElementById('meetingList'),
  meetingCount: document.getElementById('meetingCount'),
  stationGrid: document.getElementById('stationGrid'),
  loginButton: document.getElementById('loginButton'),
  signOutButton: document.getElementById('signOutButton'),
  addLocationButton: document.getElementById('addLocationButton'),
  loginModal: document.getElementById('loginModal'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  addLocationModal: document.getElementById('addLocationModal'),
  addLocationForm: document.getElementById('addLocationForm'),
  locationType: document.getElementById('locationType'),
  markerLabel: document.getElementById('markerLabel'),
  locationName: document.getElementById('locationName'),
  locationAddress: document.getElementById('locationAddress'),
  locationLat: document.getElementById('locationLat'),
  locationLng: document.getElementById('locationLng'),
  locationCongregations: document.getElementById('locationCongregations'),
  coordinateMessage: document.getElementById('coordinateMessage'),
  toast: document.getElementById('toast')
};

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}
function clean(value = '') { return String(value ?? '').trim(); }
function parseLines(value = '') {
  return String(value).split(/[\n;]+/).map(v => v.trim()).filter(Boolean);
}
function isAdmin() { return canEdit('rail'); }
function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => { els.toast.className = 'toast'; }, 3800);
}
function friendlyError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'The email or password is not correct.';
  if (code.includes('permission-denied')) return 'Firebase denied this change. Confirm the administrator sign-in and published Firestore rules.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'The network or Firebase service is temporarily unavailable.';
  if (code.includes('unauthorized-domain')) return 'Add letdesignworks.github.io under Firebase Authentication authorized domains.';
  return error?.message?.replace(/^Firebase:\s*/, '') || 'Unknown error';
}
function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
function markerLabel(location) { return clean(location.markerLabel || location.number || 'M'); }
function pointQuery(point) {
  if (Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng))) return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
  return clean(point.address || point.name);
}
function haversineMiles(a, b) {
  const toRad = d => d * Math.PI / 180;
  const lat1 = toRad(Number(a.lat)), lat2 = toRad(Number(b.lat));
  const dLat = lat2 - lat1, dLng = toRad(Number(b.lng) - Number(a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function formatMiles(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 0.1) return '<0.1 mi';
  return `${value.toFixed(value < 10 ? 1 : 0)} mi`;
}
function distanceClass(miles) {
  if (miles <= 1) return 'walk';
  if (miles <= 3) return 'shuttle';
  return 'remote';
}
function distanceLabel(miles) {
  if (miles <= 1) return 'Walk candidate';
  if (miles <= 3) return 'Short shuttle likely';
  return 'Vehicle connection needed';
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
function googleSearch(point) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', pointQuery(point));
  return url.href;
}
function appleSearch(point) {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('q', clean(point.name || point.address));
  url.searchParams.set('ll', `${point.lat},${point.lng}`);
  return url.href;
}

function getDtcHotels() {
  return DTC_HOTEL_IDS.map(id => HOTELS.find(h => h.id === id)).filter(Boolean);
}
function normalizeMeetingPoint(id, data) {
  const lat = Number(data.lat), lng = Number(data.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || data.customLocation !== true) return null;
  const congregations = Array.isArray(data.congregations) ? data.congregations.map(clean).filter(Boolean) : parseLines(data.congregations || '');
  return {
    id: String(id), markerLabel: clean(data.markerLabel || data.number || 'M'),
    number: clean(data.markerLabel || data.number || 'M'), name: clean(data.name || 'Added meeting point'),
    address: clean(data.address || ''), lat, lng, congregations,
    locationType: data.locationType === 'kingdom-hall' ? 'kingdom-hall' : 'meeting-area',
    planningArea: data.planningArea || 'other', customLocation: true
  };
}
function isSouthCustom(location) {
  if (location.planningArea === 'south-dtc-45') return true;
  return location.lat <= DTC[0] + SOUTH_LAT_TOLERANCE && haversineMiles({ lat: DTC[0], lng: DTC[1] }, location) <= SOUTH_RADIUS_MILES;
}
function rebuildMeetingPoints() {
  const base = HALLS.filter(h => SOUTH_BASE_IDS.has(String(h.id))).map(h => ({
    ...h, id: String(h.id), markerLabel: String(h.number), locationType: 'kingdom-hall', customLocation: false
  }));
  const custom = [];
  railPreferences.clear();
  for (const [id, data] of publicHallData.entries()) {
    if (data.recordType === 'south-dtc-rail-connection') {
      railPreferences.set(`${data.hotelId}|${data.meetingPointId}`, { id, ...data });
      continue;
    }
    const location = normalizeMeetingPoint(id, data);
    if (location && isSouthCustom(location)) custom.push(location);
  }
  custom.sort((a, b) => markerLabel(a).localeCompare(markerLabel(b), undefined, { numeric: true }));
  meetingPoints = [...base, ...custom];
  populateMeetingSelector();
  syncMeetingMarkers();
  renderMeetingList();
  if (!selectedMeeting || !meetingPoints.some(x => x.id === selectedMeeting.id)) {
    selectMeeting(meetingPoints[0]?.id, false, true);
  } else {
    selectedMeeting = meetingPoints.find(x => x.id === selectedMeeting.id) || null;
    updatePlanner(true);
  }
  if (pendingLocationId && meetingPoints.some(x => x.id === pendingLocationId)) {
    const id = pendingLocationId;
    pendingLocationId = null;
    selectMeeting(id, true, true);
  }
}

function buildSouthBoundary() {
  const south = DTC_BOUNDARY.filter(([lat]) => lat <= DTC[0] + 0.002);
  if (!south.length) return [[DTC[0], DTC[1]], ...DTC_BOUNDARY];
  return [[DTC[0], south[0][1]], ...south, [DTC[0], south[south.length - 1][1]]];
}
function hotelIcon(hotel) {
  return L.divIcon({ className: '', html: `<div class="hotel-pin">${escapeHtml(hotel.id)}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
}
function meetingIcon(location, selected = false) {
  return L.divIcon({
    className: '',
    html: `<div class="meeting-pin${location.customLocation ? ' manual' : ''}${selected ? ' selected' : ''}">${escapeHtml(markerLabel(location))}</div>`,
    iconSize: [38, 38], iconAnchor: [19, 19]
  });
}
function stationIcon(station) {
  const origin = els.originStationSelect.value === station.id;
  const destination = els.destinationStationSelect.value === station.id;
  const state = origin && destination ? ' selected-both' : origin ? ' selected-origin' : destination ? ' selected-destination' : '';
  return L.divIcon({ className: '', html: `<div class="rail-pin${state}">${escapeHtml(station.marker)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
}
function initMap() {
  if (!window.L) {
    document.getElementById('map').innerHTML = '<div style="padding:24px">The map library could not load. The hotel, meeting-point, and station lists remain available.</div>';
    return;
  }
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([39.52, -104.91], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  southBoundaryLayer = L.polygon(buildSouthBoundary(), {
    color: '#0b5b9f', weight: 3, dashArray: '10 8', fillColor: '#4d9cdb', fillOpacity: 0.055, interactive: false
  }).addTo(map);
  L.marker(DTC, { icon: L.divIcon({ className: '', html: '<div class="dtc-star">★</div>', iconSize: [38, 38], iconAnchor: [19, 19] }) })
    .addTo(map).bindPopup('<div class="popup-title">DTC Center Point</div><div class="popup-sub">I-25 &amp; E. Belleview Avenue</div>');

  const southeast = RAIL_STATIONS.filter(s => s.corridor === 'southeast').sort((a, b) => a.order - b.order);
  L.polyline(southeast.map(s => [s.lat, s.lng]), { color: '#087b63', weight: 5, opacity: 0.72, interactive: false }).addTo(map);

  for (const hotel of getDtcHotels()) {
    const marker = L.marker([hotel.lat, hotel.lng], { icon: hotelIcon(hotel) }).addTo(map);
    marker.bindPopup(`<div class="popup-title">${escapeHtml(hotel.id)} — ${escapeHtml(hotel.name)}</div><div class="popup-sub">${escapeHtml(hotel.address)}</div><div class="popup-actions"><a href="${googleSearch(hotel)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(hotel)}" target="_blank" rel="noopener">Apple Maps</a></div>`);
    marker.on('click', () => selectHotel(hotel.id, false, true));
    hotelMarkers.set(hotel.id, marker);
  }
  for (const station of RAIL_STATIONS) {
    const marker = L.marker([station.lat, station.lng], { icon: stationIcon(station) }).addTo(map);
    marker.bindPopup(`<div class="popup-title">${escapeHtml(station.marker)} — ${escapeHtml(station.name)}</div><div class="popup-sub">${escapeHtml(station.address)}<br>Lines: ${escapeHtml(station.lines.join(', '))}</div><div class="popup-actions"><a href="${station.rtdUrl}" target="_blank" rel="noopener">RTD Station</a><a href="${googleSearch(station)}" target="_blank" rel="noopener">Google Maps</a></div>`);
    stationMarkers.set(station.id, marker);
  }
  fitSouthMap();
}
function fitSouthMap() {
  if (!map) return;
  const points = [
    ...getDtcHotels().map(h => [h.lat, h.lng]),
    ...RAIL_STATIONS.map(s => [s.lat, s.lng]),
    ...meetingPoints.map(m => [m.lat, m.lng])
  ];
  if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 10 });
}
function syncMeetingMarkers() {
  if (!map) return;
  const active = new Set(meetingPoints.map(x => x.id));
  for (const [id, marker] of meetingMarkers.entries()) {
    if (!active.has(id)) { map.removeLayer(marker); meetingMarkers.delete(id); }
  }
  for (const location of meetingPoints) {
    let marker = meetingMarkers.get(location.id);
    const closest = nearestStation(location);
    const popup = `<div class="popup-title">${escapeHtml(markerLabel(location))} — ${escapeHtml(location.name)}</div><div class="popup-sub">${escapeHtml(location.address || 'Saved map point')}<br>Closest mapped rail: ${escapeHtml(closest.station.name)} (${escapeHtml(formatMiles(closest.miles))})</div><div class="popup-actions"><a href="${googleSearch(location)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(location)}" target="_blank" rel="noopener">Apple Maps</a></div>`;
    if (!marker) {
      marker = L.marker([location.lat, location.lng], { icon: meetingIcon(location, location.id === selectedMeeting?.id) }).addTo(map);
      marker.on('click', () => selectMeeting(location.id, true, true));
      meetingMarkers.set(location.id, marker);
    } else {
      marker.setLatLng([location.lat, location.lng]);
      marker.setIcon(meetingIcon(location, location.id === selectedMeeting?.id));
    }
    marker.bindPopup(popup);
    marker.bindTooltip(`${markerLabel(location)} — ${location.name}`, { direction: 'top', offset: [0, -15] });
  }
}
function refreshStationIcons() {
  for (const station of RAIL_STATIONS) stationMarkers.get(station.id)?.setIcon(stationIcon(station));
}

function populateHotelSelector() {
  const hotels = getDtcHotels();
  els.hotelSelect.innerHTML = hotels.map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.id)} — ${escapeHtml(h.name)}</option>`).join('');
  selectHotel(hotels[0]?.id, false, false);
}
function populateMeetingSelector() {
  const previous = selectedMeeting?.id || els.meetingSelect.value;
  const base = meetingPoints.filter(x => !x.customLocation);
  const custom = meetingPoints.filter(x => x.customLocation);
  els.meetingSelect.innerHTML = '<option value="">Choose a meeting point…</option>' +
    (base.length ? `<optgroup label="Kingdom Halls from the planning list">${base.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(markerLabel(m))} — ${escapeHtml(m.name)}</option>`).join('')}</optgroup>` : '') +
    (custom.length ? `<optgroup label="Manually added meeting points">${custom.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(markerLabel(m))} — ${escapeHtml(m.name)}</option>`).join('')}</optgroup>` : '');
  if (previous && meetingPoints.some(x => x.id === previous)) els.meetingSelect.value = previous;
}
function populateStationSelectors() {
  const groups = [
    ['Southeast I-25 rail corridor', RAIL_STATIONS.filter(s => s.corridor === 'southeast')],
    ['Southwest connection', RAIL_STATIONS.filter(s => s.corridor === 'southwest')]
  ];
  const html = groups.map(([label, stations]) => `<optgroup label="${escapeHtml(label)}">${stations.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.marker)} — ${escapeHtml(s.name)} (${escapeHtml(s.lines.join('/'))})</option>`).join('')}</optgroup>`).join('');
  els.originStationSelect.innerHTML = html;
  els.destinationStationSelect.innerHTML = html;
}
function renderStationGrid() {
  els.stationGrid.innerHTML = RAIL_STATIONS.map(station => `<article class="station-row"><span class="station-num">${escapeHtml(station.marker)}</span><span><strong>${escapeHtml(station.name)}</strong><small>${escapeHtml(station.address)}</small></span><span class="line-badges">${station.lines.map(line => `<span class="line-badge">${escapeHtml(line)}</span>`).join('')}</span><a href="${station.rtdUrl}" target="_blank" rel="noopener">Official RTD station information →</a></article>`).join('');
}
function nearestStation(point) {
  const ranked = RAIL_STATIONS.map(station => ({ station, miles: haversineMiles(point, station) })).sort((a, b) => a.miles - b.miles);
  return ranked[0];
}
function stationById(id) { return RAIL_STATIONS.find(s => s.id === id) || null; }
function hotelById(id) { return getDtcHotels().find(h => h.id === id) || null; }
function meetingById(id) { return meetingPoints.find(m => m.id === String(id)) || null; }
function preferenceKey() {
  return selectedHotel && selectedMeeting ? `${selectedHotel.id}|${selectedMeeting.id}` : '';
}
function currentPreference() { return railPreferences.get(preferenceKey()) || null; }

function selectHotel(id, pan = false, preserveMeeting = true) {
  const hotel = hotelById(id);
  if (!hotel) return;
  selectedHotel = hotel;
  els.hotelSelect.value = hotel.id;
  els.hotelDetail.textContent = `${hotel.address} • ${hotel.region}`;
  if (pan && map) map.setView([hotel.lat, hotel.lng], Math.max(map.getZoom(), 13), { animate: true });
  if (preserveMeeting && selectedMeeting) applySavedOrClosest(true);
  else updatePlanner(false);
}
function selectMeeting(id, pan = false, usePreference = true) {
  const meeting = meetingById(id);
  if (!meeting) return;
  selectedMeeting = meeting;
  els.meetingSelect.value = meeting.id;
  const kind = meeting.locationType === 'kingdom-hall' ? 'Kingdom Hall' : 'Added meeting area';
  els.meetingDetail.textContent = `${kind} • ${meeting.address || 'Saved map coordinates'}`;
  if (pan && map) {
    map.setView([meeting.lat, meeting.lng], Math.max(map.getZoom(), 12), { animate: true });
    meetingMarkers.get(meeting.id)?.openPopup();
  }
  syncMeetingMarkers();
  if (usePreference) applySavedOrClosest(true); else updatePlanner(false);
  renderMeetingList();
}
function useClosestStations(showToast = false) {
  if (!selectedHotel || !selectedMeeting) return;
  const origin = nearestStation(selectedHotel);
  const destination = nearestStation(selectedMeeting);
  els.originStationSelect.value = origin.station.id;
  els.destinationStationSelect.value = destination.station.id;
  els.firstMileMode.value = origin.miles <= 0.8 ? 'walking' : 'driving';
  els.lastMileMode.value = destination.miles <= 1 ? 'walking' : 'driving';
  els.railNote.value = '';
  updatePlanner(false);
  if (showToast) toast('Closest mapped rail stations selected.');
}
function applySavedOrClosest(automatic = false) {
  const pref = currentPreference();
  if (pref && stationById(pref.originStationId) && stationById(pref.destinationStationId)) {
    els.originStationSelect.value = pref.originStationId;
    els.destinationStationSelect.value = pref.destinationStationId;
    els.firstMileMode.value = pref.firstMileMode || 'walking';
    els.lastMileMode.value = pref.lastMileMode || 'walking';
    els.railNote.value = pref.publicNote || '';
    updatePlanner(true);
    if (!automatic) toast('Saved preferred rail connection loaded.');
  } else {
    useClosestStations(false);
  }
}

function routeInstruction(origin, destination, firstMiles, lastMiles) {
  if (origin.id === destination.id) {
    return {
      level: 'bad',
      text: `Both locations are tied to ${origin.name}. A rail ride does not add value for this pairing; use the first- and last-mile directions or plan a direct shuttle.`
    };
  }
  let text = '';
  let level = 'good';
  if (origin.corridor === 'southeast' && destination.corridor === 'southeast') {
    const direction = destination.order > origin.order ? 'southbound toward RidgeGate Parkway' : 'northbound toward Denver';
    text = `Use the Southeast Corridor ${direction} from ${origin.name} to ${destination.name}. The E Line serves this full station sequence; other listed lines may serve part of the corridor. Confirm the current RTD departure and any service alert before travel.`;
  } else {
    level = 'warn';
    text = `The selected stations are on different rail corridors. There is not a simple single-train connection between the Southeast I-25 corridor and Littleton / Mineral. Use the Google or Apple transit link to identify the current transfer, bus connection, or alternate trip, and consider a direct shuttle.`;
  }
  if (firstMiles > 1 || lastMiles > 1) level = level === 'good' ? 'warn' : level;
  if (firstMiles > 3 || lastMiles > 3) level = 'bad';
  if (lastMiles > 3) text += ` The meeting point is ${formatMiles(lastMiles)} from the selected arrival station, so a vehicle or shuttle connection should be planned rather than treating it as a walkable station destination.`;
  else if (lastMiles > 1) text += ` The final connection is ${formatMiles(lastMiles)}; review the walking route carefully or provide a short shuttle.`;
  if (firstMiles > 1) text += ` The hotel is ${formatMiles(firstMiles)} from the boarding station, so hotel-to-station transportation also needs to be confirmed.`;
  return { level, text };
}
function updatePlanner(usingSaved = false) {
  if (!selectedHotel || !selectedMeeting) {
    els.resultTitle.textContent = 'Select a hotel and meeting point';
    els.tripSummary.innerHTML = '';
    els.routeGuidance.textContent = 'Choose both locations to create a rail connection.';
    els.linkSections.hidden = true;
    return;
  }
  const origin = stationById(els.originStationSelect.value) || nearestStation(selectedHotel).station;
  const destination = stationById(els.destinationStationSelect.value) || nearestStation(selectedMeeting).station;
  if (!origin || !destination) return;
  els.originStationSelect.value = origin.id;
  els.destinationStationSelect.value = destination.id;
  const firstMiles = haversineMiles(selectedHotel, origin);
  const lastMiles = haversineMiles(destination, selectedMeeting);
  els.originDistance.textContent = `${formatMiles(firstMiles)} straight-line from hotel • ${distanceLabel(firstMiles)}`;
  els.destinationDistance.textContent = `${formatMiles(lastMiles)} straight-line to meeting point • ${distanceLabel(lastMiles)}`;

  const pref = currentPreference();
  els.savedPreferenceChip.hidden = !pref;
  els.loadSavedButton.hidden = !pref;
  els.clearPreferenceButton.hidden = !(pref && isAdmin());
  els.savePreferenceButton.hidden = !isAdmin();
  els.railNoteWrap.hidden = !isAdmin();
  els.savedPublicNote.hidden = !pref?.publicNote;
  els.savedPublicNote.textContent = pref?.publicNote ? `Saved public note: ${pref.publicNote}` : '';

  els.resultTitle.textContent = `${selectedHotel.id} to ${markerLabel(selectedMeeting)} ${selectedMeeting.name}`;
  els.tripSummary.innerHTML = `
    <article class="summary-tile"><span>Hotel</span><strong>${escapeHtml(selectedHotel.name)}</strong><small>${escapeHtml(selectedHotel.address)}</small></article>
    <article class="summary-tile"><span>Meeting point</span><strong>${escapeHtml(markerLabel(selectedMeeting))} — ${escapeHtml(selectedMeeting.name)}</strong><small>${escapeHtml(selectedMeeting.address || 'Saved map point')}</small></article>
    <article class="summary-tile"><span>Boarding station</span><strong>${escapeHtml(origin.name)}</strong><small>${escapeHtml(formatMiles(firstMiles))} from hotel • Lines ${escapeHtml(origin.lines.join('/'))}</small></article>
    <article class="summary-tile"><span>Arrival station</span><strong>${escapeHtml(destination.name)}</strong><small>${escapeHtml(formatMiles(lastMiles))} to meeting point • Lines ${escapeHtml(destination.lines.join('/'))}</small></article>`;

  const guidance = routeInstruction(origin, destination, firstMiles, lastMiles);
  els.routeGuidance.className = 'route-guidance' + (guidance.level === 'warn' ? ' warn' : guidance.level === 'bad' ? ' bad' : '');
  els.routeGuidance.textContent = guidance.text;
  els.connectionQuality.className = `quality-chip ${guidance.level === 'good' ? 'good' : guidance.level === 'warn' ? 'caution' : 'poor'}`;
  els.connectionQuality.textContent = guidance.level === 'good' ? 'Strong rail candidate' : guidance.level === 'warn' ? 'Shuttle / transfer review' : 'Rail may not be practical';

  const firstMode = els.firstMileMode.value;
  const lastMode = els.lastMileMode.value;
  els.googleFullTrip.href = googleDirections(selectedHotel, selectedMeeting, 'transit');
  els.appleFullTrip.href = appleDirections(selectedHotel, selectedMeeting, 'transit');
  els.googleFirstLeg.href = googleDirections(selectedHotel, origin, firstMode);
  els.appleFirstLeg.href = appleDirections(selectedHotel, origin, firstMode);
  els.googleRailLeg.href = googleDirections(origin, destination, 'transit');
  els.appleRailLeg.href = appleDirections(origin, destination, 'transit');
  els.googleLastLeg.href = googleDirections(destination, selectedMeeting, lastMode);
  els.appleLastLeg.href = appleDirections(destination, selectedMeeting, lastMode);
  els.linkSections.hidden = false;
  refreshStationIcons();
  if (usingSaved && pref) els.savedPreferenceChip.textContent = 'Saved preferred connection';
}

function filteredMeetingPoints() {
  const q = els.meetingSearch.value.trim().toLowerCase();
  const filter = els.distanceFilter.value;
  return meetingPoints.filter(meeting => {
    const nearest = nearestStation( meeting);
    if (filter !== 'all' && distanceClass(nearest.miles) !== filter) return false;
    if (!q) return true;
    return [markerLabel(meeting), meeting.name, meeting.address, ...(meeting.congregations || [])].join(' ').toLowerCase().includes(q);
  });
}
function renderMeetingList() {
  const items = filteredMeetingPoints();
  els.meetingCount.textContent = `${items.length} shown`;
  els.meetingList.innerHTML = items.map(meeting => {
    const nearest = nearestStation(meeting);
    const cls = distanceClass(nearest.miles);
    return `<button type="button" class="meeting-row${meeting.id === selectedMeeting?.id ? ' active' : ''}" data-meeting-id="${escapeHtml(meeting.id)}"><span class="meeting-marker-small${meeting.customLocation ? ' manual' : ''}">${escapeHtml(markerLabel(meeting))}</span><span><strong>${escapeHtml(meeting.name)}</strong><small>${escapeHtml(meeting.address || 'Saved map point')}<br>Closest mapped rail: ${escapeHtml(nearest.station.name)}</small></span><span class="distance-pill ${cls}">${escapeHtml(formatMiles(nearest.miles))}</span></button>`;
  }).join('') || '<div class="empty-list">No meeting points match this search or rail-distance filter.</div>';
  els.meetingList.querySelectorAll('[data-meeting-id]').forEach(button => button.addEventListener('click', () => selectMeeting(button.dataset.meetingId, true, true)));
}

async function savePreference() {
  if (!isAdmin()) { openLogin(); return; }
  if (!selectedHotel || !selectedMeeting) { toast('Choose a hotel and meeting point first.', true); return; }
  const origin = stationById(els.originStationSelect.value);
  const destination = stationById(els.destinationStationSelect.value);
  if (!origin || !destination) { toast('Choose both rail stations.', true); return; }
  const id = `rail-${slug(selectedHotel.id)}-${slug(selectedMeeting.id)}`;
  const button = els.savePreferenceButton;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'halls', id), {
      recordType: 'south-dtc-rail-connection',
      hotelId: selectedHotel.id,
      hotelName: selectedHotel.name,
      meetingPointId: selectedMeeting.id,
      meetingPointLabel: markerLabel(selectedMeeting),
      meetingPointName: selectedMeeting.name,
      originStationId: origin.id,
      originStationName: origin.name,
      destinationStationId: destination.id,
      destinationStationName: destination.name,
      firstMileMode: els.firstMileMode.value,
      lastMileMode: els.lastMileMode.value,
      publicNote: clean(els.railNote.value),
      updatedByEmail: currentUser.email,
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast('Preferred rail connection saved for public viewing.');
  } catch (error) {
    toast('Could not save the rail connection: ' + friendlyError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = 'Save Preferred Connection';
  }
}
async function clearPreference() {
  const pref = currentPreference();
  if (!isAdmin() || !pref) return;
  if (!confirm(`Clear the saved rail preference from ${selectedHotel.name} to ${selectedMeeting.name}?`)) return;
  try {
    await deleteDoc(doc(db, 'halls', pref.id));
    toast('Saved preferred connection cleared.');
  } catch (error) {
    toast('Could not clear the saved connection: ' + friendlyError(error), true);
  }
}

function openLogin() { els.loginModal.classList.add('open'); setTimeout(() => els.loginPassword.focus(), 50); }
function closeLogin() { els.loginModal.classList.remove('open'); }
function nextManualMarker() {
  const used = new Set(meetingPoints.map(m => markerLabel(m).toUpperCase()));
  let n = 1;
  while (used.has(`S${n}`)) n += 1;
  return `S${n}`;
}
function openAddLocation() {
  if (!canEdit('busAccess')) { openLogin(); return; }
  els.addLocationForm.reset();
  els.locationType.value = 'meeting-area';
  els.markerLabel.value = nextManualMarker();
  const center = map?.getCenter();
  if (center) { els.locationLat.value = center.lat.toFixed(6); els.locationLng.value = center.lng.toFixed(6); }
  els.coordinateMessage.textContent = 'Enter an address and select Locate Address, or position the map over the site and use the current map center.';
  els.addLocationModal.classList.add('open');
}
function closeAddLocation() { els.addLocationModal.classList.remove('open'); }
async function locateAddress() {
  const address = clean(els.locationAddress.value);
  if (!address) { toast('Enter the full address first.', true); return; }
  const button = document.getElementById('locateAddressButton');
  button.disabled = true;
  button.textContent = 'Locating…';
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'us');
    url.searchParams.set('addressdetails', '0');
    url.searchParams.set('q', address);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Address service returned ${response.status}.`);
    const results = await response.json();
    if (!results.length) throw new Error('The address was not found.');
    const lat = Number(results[0].lat), lng = Number(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('The address result did not include valid coordinates.');
    els.locationLat.value = lat.toFixed(6);
    els.locationLng.value = lng.toFixed(6);
    els.coordinateMessage.textContent = 'Address located. Review the marker position before saving.';
    map?.setView([lat, lng], 14, { animate: true });
    toast('Address located on the map.');
  } catch (error) {
    toast('Could not locate that address: ' + friendlyError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = 'Locate Address';
  }
}
function useMapCenter() {
  const center = map?.getCenter();
  if (!center) return;
  els.locationLat.value = center.lat.toFixed(6);
  els.locationLng.value = center.lng.toFixed(6);
  els.coordinateMessage.textContent = 'Current map center copied into the coordinates.';
  toast('Map-center coordinates copied.');
}
async function saveMeetingPoint(event) {
  event.preventDefault();
  if (!canEdit('busAccess')) { closeAddLocation(); openLogin(); return; }
  const lat = Number(els.locationLat.value), lng = Number(els.locationLng.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { toast('Enter valid latitude and longitude coordinates.', true); return; }
  const ref = doc(collection(db, 'halls'));
  pendingLocationId = ref.id;
  try {
    await setDoc(ref, {
      customLocation: true,
      locationType: els.locationType.value === 'kingdom-hall' ? 'kingdom-hall' : 'meeting-area',
      markerLabel: clean(els.markerLabel.value).toUpperCase(),
      number: clean(els.markerLabel.value).toUpperCase(),
      name: clean(els.locationName.value),
      address: clean(els.locationAddress.value),
      lat, lng,
      congregations: parseLines(els.locationCongregations.value),
      planningArea: 'south-dtc-45',
      busStatus: 'not-reviewed',
      createdByEmail: currentUser.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    closeAddLocation();
    toast('Meeting point added to the shared planning maps.');
  } catch (error) {
    pendingLocationId = null;
    toast('Could not add the meeting point: ' + friendlyError(error), true);
  }
}

function updateAuthUi() {
  const signedIn = Boolean(currentUser);
  els.loginButton.hidden = signedIn;
  els.signOutButton.hidden = !signedIn;
  els.addLocationButton.hidden = !canEdit('busAccess');
  els.savePreferenceButton.hidden = !isAdmin();
  els.railNoteWrap.hidden = !isAdmin();
  els.clearPreferenceButton.hidden = !(isAdmin() && currentPreference());
  if (signedIn && !isAdmin()) toast('This account has public viewing access only.', true);
  updatePlanner(Boolean(currentPreference()));
}

els.hotelSelect.addEventListener('change', () => selectHotel(els.hotelSelect.value, true, true));
els.meetingSelect.addEventListener('change', () => selectMeeting(els.meetingSelect.value, true, true));
els.originStationSelect.addEventListener('change', () => updatePlanner(false));
els.destinationStationSelect.addEventListener('change', () => updatePlanner(false));
els.firstMileMode.addEventListener('change', () => updatePlanner(false));
els.lastMileMode.addEventListener('change', () => updatePlanner(false));
els.closestStationsButton.addEventListener('click', () => useClosestStations(true));
els.loadSavedButton.addEventListener('click', () => applySavedOrClosest(false));
els.savePreferenceButton.addEventListener('click', savePreference);
els.clearPreferenceButton.addEventListener('click', clearPreference);
els.meetingSearch.addEventListener('input', renderMeetingList);
els.distanceFilter.addEventListener('change', renderMeetingList);
els.loginButton.addEventListener('click', openLogin);
document.getElementById('cancelLogin').addEventListener('click', closeLogin);
els.loginModal.addEventListener('click', event => { if (event.target === els.loginModal) closeLogin(); });
els.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, clean(els.loginEmail.value), els.loginPassword.value);
    els.loginPassword.value = '';
    closeLogin();
    toast('Signed in.');
  } catch (error) { toast(friendlyError(error), true); }
});
document.getElementById('resetPassword').addEventListener('click', async () => {
  try { await sendPasswordResetEmail(auth, clean(els.loginEmail.value) || ADMIN_EMAIL); toast('Password reset email sent.'); }
  catch (error) { toast(friendlyError(error), true); }
});
els.signOutButton.addEventListener('click', async () => { await signOut(auth); toast('Signed out.'); });
els.addLocationButton.addEventListener('click', openAddLocation);
document.getElementById('cancelAddLocation').addEventListener('click', closeAddLocation);
els.addLocationModal.addEventListener('click', event => { if (event.target === els.addLocationModal) closeAddLocation(); });
document.getElementById('locateAddressButton').addEventListener('click', locateAddress);
document.getElementById('useMapCenterButton').addEventListener('click', useMapCenter);
els.addLocationForm.addEventListener('submit', saveMeetingPoint);

populateHotelSelector();
populateStationSelectors();
renderStationGrid();
rebuildMeetingPoints();
initMap();
syncMeetingMarkers();
selectHotel(els.hotelSelect.value, false, false);
selectMeeting(els.meetingSelect.value || meetingPoints[0]?.id, false, true);

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  observeSiteAccess(auth, user => { currentUser = user; updateAuthUi(); });
  onSnapshot(collection(db, 'halls'), snapshot => {
    publicHallData.clear();
    snapshot.forEach(item => publicHallData.set(item.id, item.data()));
    rebuildMeetingPoints();
  }, error => toast('Saved meeting points and rail preferences could not be loaded: ' + friendlyError(error), true));
} catch (error) {
  toast('Firebase could not initialize: ' + friendlyError(error), true);
}

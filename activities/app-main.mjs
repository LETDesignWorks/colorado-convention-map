import {canEdit, canView, isOwner, observeSiteAccess} from '../assets/site-access.mjs?v=access-20261114-1';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, query, where, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HOTELS } from 'https://letdesignworks.github.io/colorado-convention-map/routes/hotels.js?v=20260910-1';
import { ACTIVITIES, ACTIVITY_POINTS, getActivity, getActivityPoint } from 'https://letdesignworks.github.io/colorado-convention-map/activities/data.js?v=rush-20261108-1';

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

let app;
let auth;
let db;
let map;
let currentUser = null;
let selectedActivity = null;
let currentPlan = null;
let currentPlanId = null;
let savedPlans = [];
let savedFieldRoutes = [];
let recordsUnsub = null;
let outboundLayer = null;
let returnLayer = null;
let hotelMarker = null;
const pointMarkers = new Map();
const geocodeCache = readCache();

const els = {
  form: document.getElementById('activityForm'),
  planName: document.getElementById('planName'),
  hotelSelect: document.getElementById('hotelSelect'),
  hotelAddress: document.getElementById('hotelAddress'),
  customOriginWrap: document.getElementById('customOriginWrap'),
  customOriginAddress: document.getElementById('customOriginAddress'),
  activitySelect: document.getElementById('activitySelect'),
  activityDescription: document.getElementById('activityDescription'),
  activityStart: document.getElementById('activityStart'),
  activityPickup: document.getElementById('activityPickup'),
  arriveEarly: document.getElementById('arriveEarly'),
  outboundAllowance: document.getElementById('outboundAllowance'),
  passengerReport: document.getElementById('passengerReport'),
  pickupLoading: document.getElementById('pickupLoading'),
  returnAllowance: document.getElementById('returnAllowance'),
  coachReset: document.getElementById('coachReset'),
  coachId: document.getElementById('coachId'),
  planStatus: document.getElementById('planStatus'),
  planNotes: document.getElementById('planNotes'),
  calculateButton: document.getElementById('calculateButton'),
  newPlanButton: document.getElementById('newPlanButton'),
  resultCard: document.getElementById('resultCard'),
  resultTitle: document.getElementById('resultTitle'),
  resultHotel: document.getElementById('resultHotel'),
  resultHotelAddress: document.getElementById('resultHotelAddress'),
  resultActivity: document.getElementById('resultActivity'),
  resultActivityPoints: document.getElementById('resultActivityPoints'),
  outboundDistance: document.getElementById('outboundDistance'),
  outboundBase: document.getElementById('outboundBase'),
  returnDistance: document.getElementById('returnDistance'),
  returnBase: document.getElementById('returnBase'),
  reportTime: document.getElementById('reportTime'),
  departTime: document.getElementById('departTime'),
  arrivalTime: document.getElementById('arrivalTime'),
  startTime: document.getElementById('startTime'),
  pickupTime: document.getElementById('pickupTime'),
  returnTime: document.getElementById('returnTime'),
  availableTime: document.getElementById('availableTime'),
  unavailableWindow: document.getElementById('unavailableWindow'),
  fieldServiceImpact: document.getElementById('fieldServiceImpact'),
  conflictBox: document.getElementById('conflictBox'),
  conflictList: document.getElementById('conflictList'),
  verificationNote: document.getElementById('verificationNote'),
  googleOutbound: document.getElementById('googleOutbound'),
  googleReturn: document.getElementById('googleReturn'),
  savePlanButton: document.getElementById('savePlanButton'),
  savedStatus: document.getElementById('savedStatus'),
  savedPlans: document.getElementById('savedPlans'),
  locationGrid: document.getElementById('locationGrid'),
  loginButton: document.getElementById('loginButton'),
  signOutButton: document.getElementById('signOutButton'),
  loginModal: document.getElementById('loginModal'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  toast: document.getElementById('toast')
};

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}
function clean(value = '') { return String(value ?? '').trim(); }
function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}
function isAdmin() { return canEdit('activities'); }
function readCache() {
  try { return JSON.parse(localStorage.getItem('conventionActivityGeocodes') || '{}'); }
  catch { return {}; }
}
function saveCache() {
  try { localStorage.setItem('conventionActivityGeocodes', JSON.stringify(geocodeCache)); }
  catch { /* Local storage may be unavailable. */ }
}
function localInputValue(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(date);
}
function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}
function formatDistance(meters) { return `${(meters / 1609.344).toFixed(1)} mi`; }
function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => { els.toast.className = 'toast'; }, 3800);
}
function friendlyError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'The email or password is not correct.';
  if (code.includes('permission-denied')) return 'Firebase denied this action. Confirm the administrator sign-in and Firestore rules.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'The network or service is temporarily unavailable.';
  if (code.includes('unauthorized-domain')) return 'Add letdesignworks.github.io to Firebase Authentication authorized domains.';
  return error?.message?.replace(/^Firebase:\s*/, '') || 'Unknown error';
}
function normalKey(value = '') { return clean(value).toLowerCase().replace(/\s+/g, ' '); }
function googleDirections(origin, destination) {
  const originQuery = origin.address || `${origin.lat},${origin.lng}`;
  const destinationQuery = destination.address || `${destination.lat},${destination.lng}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving`;
}

function initDefaults() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const pickup = new Date(start.getTime() + 3 * 60 * 60000);
  els.activityStart.value = localInputValue(start);
  els.activityPickup.value = localInputValue(pickup);
}
function populateHotels() {
  const regions = [...new Set(HOTELS.map(hotel => hotel.region))];
  els.hotelSelect.innerHTML = '<option value="">Choose a hotel…</option>' + regions.map(region =>
    `<optgroup label="${escapeHtml(region)}">${HOTELS.filter(hotel => hotel.region === region).map(hotel =>
      `<option value="${escapeHtml(hotel.id)}">${escapeHtml(hotel.id)} — ${escapeHtml(hotel.name)}</option>`
    ).join('')}</optgroup>`
  ).join('') + '<optgroup label="Other"><option value="custom">Other hotel or bus staging address</option></optgroup>';
}
function populateActivities() {
  els.activitySelect.innerHTML = '<option value="">Choose an activity…</option>' + ACTIVITIES.map(activity =>
    `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.marker)} — ${escapeHtml(activity.name)}</option>`
  ).join('');
}
function renderLocationGrid() {
  els.locationGrid.innerHTML = ACTIVITY_POINTS.map(point => {
    const roleClass = point.role === 'dropoff' ? 'dropoff' : point.role === 'pickup' ? 'pickup' : '';
    return `<button class="location-card" data-point-id="${escapeHtml(point.id)}" type="button">
      <span class="location-badge ${roleClass}">${escapeHtml(point.marker)}</span>
      <span><strong>${escapeHtml(point.name)}</strong><small>${escapeHtml(point.address)}</small><small>${escapeHtml(point.note)}</small></span>
    </button>`;
  }).join('');
  els.locationGrid.querySelectorAll('[data-point-id]').forEach(button => button.addEventListener('click', () => {
    const point = getActivityPoint(button.dataset.pointId);
    if (!point) return;
    const activity = getActivity(point.activityId);
    if (activity) selectActivity(activity.id, true);
    map.setView([point.lat, point.lng], 14, { animate: true });
    pointMarkers.get(point.id)?.openTooltip();
  }));
}

function pointIcon(point, selected = false) {
  const roleClass = point.role === 'dropoff' ? 'dropoff' : point.role === 'pickup' ? 'pickup' : '';
  return L.divIcon({
    className: '',
    html: `<div class="activity-marker ${roleClass}${selected ? ' selected' : ''}">${escapeHtml(point.marker)}</div>`,
    iconSize: [42, 42], iconAnchor: [21, 21]
  });
}
function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  for (const point of ACTIVITY_POINTS) {
    const marker = L.marker([point.lat, point.lng], { icon: pointIcon(point) }).addTo(map);
    marker.bindTooltip(`${point.marker} — ${point.name}`, { direction: 'top', offset: [0, -16] });
    marker.bindPopup(`<div class="popup-title">${escapeHtml(point.name)}</div><div class="popup-sub">${escapeHtml(point.address)}<br>${escapeHtml(point.note)}</div>`);
    marker.on('click', () => selectActivity(point.activityId, false));
    pointMarkers.set(point.id, marker);
  }
  const bounds = L.latLngBounds(ACTIVITY_POINTS.map(point => [point.lat, point.lng]));
  map.fitBounds(bounds, { padding: [42, 42], maxZoom: 10 });
  L.control.scale({ imperial: true, metric: false, position: 'bottomright' }).addTo(map);
}
function refreshPointIcons() {
  const activity = selectedActivity;
  const selectedIds = new Set(activity ? [activity.outboundPointId, activity.returnPointId] : []);
  for (const point of ACTIVITY_POINTS) pointMarkers.get(point.id)?.setIcon(pointIcon(point, selectedIds.has(point.id)));
}
function clearRouteLayers() {
  if (outboundLayer) { map.removeLayer(outboundLayer); outboundLayer = null; }
  if (returnLayer) { map.removeLayer(returnLayer); returnLayer = null; }
  if (hotelMarker) { map.removeLayer(hotelMarker); hotelMarker = null; }
}
function selectActivity(id, pan = false) {
  const activity = getActivity(id);
  if (!activity) return;
  selectedActivity = activity;
  els.activitySelect.value = activity.id;
  const outbound = getActivityPoint(activity.outboundPointId);
  const returning = getActivityPoint(activity.returnPointId);
  els.activityDescription.textContent = `${activity.description} Outbound: ${outbound?.name || '—'}. Return pickup: ${returning?.name || '—'}.`;
  refreshPointIcons();
  updatePlanPlaceholder();
  if (pan && outbound) map.setView([outbound.lat, outbound.lng], 12, { animate: true });
}
function handleHotelChange() {
  const value = els.hotelSelect.value;
  els.customOriginWrap.hidden = value !== 'custom';
  const hotel = HOTELS.find(item => item.id === value);
  els.hotelAddress.textContent = hotel ? `${hotel.address} • ${hotel.region}` : value === 'custom' ? 'Enter the hotel or bus staging address below.' : 'Select an international-delegate hotel.';
  updatePlanPlaceholder();
}
function updatePlanPlaceholder() {
  if (clean(els.planName.value)) return;
  const hotel = HOTELS.find(item => item.id === els.hotelSelect.value);
  const originLabel = hotel?.id || (els.hotelSelect.value === 'custom' ? 'Other hotel' : 'Hotel');
  els.planName.placeholder = selectedActivity ? `${originLabel} to ${selectedActivity.name}` : 'Example: H17 to Georgetown Loop — Tuesday';
}

async function resolveHotel() {
  const hotel = HOTELS.find(item => item.id === els.hotelSelect.value);
  if (hotel && Number.isFinite(hotel.lat) && Number.isFinite(hotel.lng)) return hotel;
  const address = hotel?.address || clean(els.customOriginAddress.value);
  if (!address) throw new Error('Choose a hotel or enter another hotel / staging address.');
  const cacheKey = normalKey(hotel?.id || address);
  if (geocodeCache[cacheKey]) return { ...(hotel || {}), ...geocodeCache[cacheKey], id: hotel?.id || 'H', name: hotel?.name || 'Other hotel / staging point', address };
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  url.searchParams.set('addressdetails', '0');
  url.searchParams.set('q', address);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocoding service returned ${response.status}.`);
  const results = await response.json();
  if (!results.length) throw new Error('The hotel / staging address could not be located.');
  const coords = { lat: Number(results[0].lat), lng: Number(results[0].lon) };
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) throw new Error('The geocoder returned invalid coordinates.');
  geocodeCache[cacheKey] = coords;
  saveCache();
  return { ...(hotel || {}), ...coords, id: hotel?.id || 'H', name: hotel?.name || 'Other hotel / staging point', address };
}
async function requestRoute(origin, destination) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Routing service returned ${response.status}.`);
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'No drivable route was found.');
  return data.routes[0];
}
function parseSchedule(outboundRoute, returnRoute) {
  const start = new Date(els.activityStart.value);
  const pickup = new Date(els.activityPickup.value);
  if (Number.isNaN(start.getTime()) || Number.isNaN(pickup.getTime())) throw new Error('Enter valid activity start and pickup times.');
  if (pickup <= start) throw new Error('The activity pickup time must be later than the activity start time.');

  const outboundBase = Math.ceil(outboundRoute.duration / 60);
  const returnBase = Math.ceil(returnRoute.duration / 60);
  const arriveEarly = numberValue(els.arriveEarly.value, 15);
  const outboundAllowance = numberValue(els.outboundAllowance.value, 20);
  const passengerReport = numberValue(els.passengerReport.value, 20);
  const pickupLoading = numberValue(els.pickupLoading.value, 15);
  const returnAllowance = numberValue(els.returnAllowance.value, 20);
  const coachReset = numberValue(els.coachReset.value, 15);
  const outboundPlanned = outboundBase + outboundAllowance;
  const returnPlanned = returnBase + returnAllowance;
  const targetArrival = new Date(start.getTime() - arriveEarly * 60000);
  const hotelDeparture = new Date(targetArrival.getTime() - outboundPlanned * 60000);
  const report = new Date(hotelDeparture.getTime() - passengerReport * 60000);
  const returnDeparture = new Date(pickup.getTime() + pickupLoading * 60000);
  const hotelReturn = new Date(returnDeparture.getTime() + returnPlanned * 60000);
  const available = new Date(hotelReturn.getTime() + coachReset * 60000);
  return {
    start, pickup, outboundBase, returnBase, arriveEarly, outboundAllowance, passengerReport,
    pickupLoading, returnAllowance, coachReset, outboundPlanned, returnPlanned, targetArrival,
    hotelDeparture, report, returnDeparture, hotelReturn, available
  };
}
function drawRoutes(outboundRoute, returnRoute, hotel, outboundPoint, returnPoint) {
  clearRouteLayers();
  const outboundLatLngs = outboundRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const returnLatLngs = returnRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  outboundLayer = L.polyline(outboundLatLngs, { color: '#0b5b9f', weight: 5, opacity: .88 }).addTo(map);
  returnLayer = L.polyline(returnLatLngs, { color: '#e76f32', weight: 5, opacity: .82, dashArray: '10 7' }).addTo(map);
  hotelMarker = L.marker([hotel.lat, hotel.lng], {
    icon: L.divIcon({ className: '', html: `<div class="hotel-marker">${escapeHtml(hotel.id || 'H')}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] })
  }).addTo(map).bindTooltip(hotel.name, { direction: 'top', offset: [0, -17] });
  pointMarkers.get(outboundPoint.id)?.setIcon(pointIcon(outboundPoint, true));
  pointMarkers.get(returnPoint.id)?.setIcon(pointIcon(returnPoint, true));
  const combined = L.latLngBounds([...outboundLatLngs, ...returnLatLngs]);
  map.fitBounds(combined, { padding: [35, 35] });
}
function sameHotel(fieldRoute, hotel) {
  if (fieldRoute.hotelId && hotel.id && normalKey(fieldRoute.hotelId) === normalKey(hotel.id)) return true;
  if (fieldRoute.hotelAddress && hotel.address && normalKey(fieldRoute.hotelAddress) === normalKey(hotel.address)) return true;
  return Boolean(fieldRoute.hotelName && hotel.name && normalKey(fieldRoute.hotelName) === normalKey(hotel.name));
}
function overlap(startA, endA, startB, endB) { return startA < endB && startB < endA; }
function findConflicts(plan) {
  const activityStart = plan.schedule.report;
  const activityEnd = plan.schedule.available;
  return savedFieldRoutes.filter(route => {
    if (!sameHotel(route, plan.hotel)) return false;
    const routeStart = new Date(route.reportLocal || route.departureLocal || route.meetingLocal);
    const routeEnd = new Date(route.meetingLocal || route.arrivalLocal || route.departureLocal);
    if (Number.isNaN(routeStart.getTime()) || Number.isNaN(routeEnd.getTime())) return false;
    return overlap(activityStart, activityEnd, routeStart, routeEnd);
  });
}
function renderConflicts(plan) {
  const conflicts = canView('activities') ? findConflicts(plan) : [];
  els.conflictBox.hidden = !conflicts.length;
  els.conflictList.innerHTML = conflicts.map(route => `<div class="conflict-item"><strong>${escapeHtml(route.routeName || 'Saved field-service route')}</strong><br>${escapeHtml(formatDateTime(route.reportLocal || route.departureLocal))} through ${escapeHtml(formatDateTime(route.meetingLocal || route.arrivalLocal))}</div>`).join('');
}
function renderResult(plan) {
  const { activity, hotel, outboundPoint, returnPoint, outboundRoute, returnRoute, schedule } = plan;
  els.resultTitle.textContent = plan.planName;
  els.resultHotel.textContent = hotel.name;
  els.resultHotelAddress.textContent = hotel.address;
  els.resultActivity.textContent = `${activity.marker} — ${activity.name}`;
  els.resultActivityPoints.textContent = outboundPoint.id === returnPoint.id ? outboundPoint.name : `Drop-off: ${outboundPoint.name} • Pickup: ${returnPoint.name}`;
  els.outboundDistance.textContent = formatDistance(outboundRoute.distance);
  els.outboundBase.textContent = formatMinutes(schedule.outboundBase);
  els.returnDistance.textContent = formatDistance(returnRoute.distance);
  els.returnBase.textContent = formatMinutes(schedule.returnBase);
  els.reportTime.textContent = formatDateTime(schedule.report);
  els.departTime.textContent = formatDateTime(schedule.hotelDeparture);
  els.arrivalTime.textContent = formatDateTime(schedule.targetArrival);
  els.startTime.textContent = formatDateTime(schedule.start);
  els.pickupTime.textContent = formatDateTime(schedule.pickup);
  els.returnTime.textContent = formatDateTime(schedule.hotelReturn);
  els.availableTime.textContent = formatDateTime(schedule.available);
  els.unavailableWindow.textContent = `${formatDateTime(schedule.report)} — ${formatDateTime(schedule.available)}`;
  els.fieldServiceImpact.textContent = `Using this same coach, a field-service assignment should have the bus back at ${hotel.name} before ${formatDateTime(schedule.report)}, or its passenger-report time should begin after ${formatDateTime(schedule.available)}.`;
  els.verificationNote.textContent = `${outboundPoint.note} ${returnPoint.id !== outboundPoint.id ? returnPoint.note : ''} The road estimates do not include live traffic, weather, construction, motorcoach restrictions, turning clearance, or curb permits.`;
  els.googleOutbound.href = googleDirections(hotel, outboundPoint);
  els.googleReturn.href = googleDirections(returnPoint, hotel);
  els.resultCard.hidden = false;
  renderConflicts(plan);
  updateSaveButton();
  drawRoutes(outboundRoute, returnRoute, hotel, outboundPoint, returnPoint);
  els.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function calculatePlan(event) {
  event?.preventDefault();
  const activity = getActivity(els.activitySelect.value);
  if (!activity) { toast('Choose a non-service activity.', true); return; }
  els.calculateButton.disabled = true;
  els.calculateButton.textContent = 'Calculating…';
  try {
    const hotel = await resolveHotel();
    const outboundPoint = getActivityPoint(activity.outboundPointId);
    const returnPoint = getActivityPoint(activity.returnPointId);
    if (!outboundPoint || !returnPoint) throw new Error('The selected activity is missing a route point.');
    const [outboundRoute, returnRoute] = await Promise.all([
      requestRoute(hotel, outboundPoint), requestRoute(returnPoint, hotel)
    ]);
    const schedule = parseSchedule(outboundRoute, returnRoute);
    const planName = clean(els.planName.value) || `${hotel.id || 'Hotel'} to ${activity.name}`;
    els.planName.value = planName;
    currentPlan = {
      id: currentPlanId, planName, activity, hotel, outboundPoint, returnPoint, outboundRoute,
      returnRoute, schedule, coachId: clean(els.coachId.value), status: els.planStatus.value,
      notes: clean(els.planNotes.value)
    };
    renderResult(currentPlan);
    toast('Activity bus window calculated.');
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    els.calculateButton.disabled = false;
    els.calculateButton.textContent = 'Calculate Activity Bus Window';
  }
}
function updateSaveButton() {
  if (!currentPlan) {
    els.savePlanButton.disabled = true;
    els.savePlanButton.textContent = 'Calculate Before Saving';
  } else if (!isAdmin()) {
    els.savePlanButton.disabled = false;
    els.savePlanButton.textContent = 'Sign In to Save';
  } else {
    els.savePlanButton.disabled = false;
    els.savePlanButton.textContent = currentPlanId ? 'Update Saved Plan' : 'Save Activity Plan';
  }
}
function serializePlan(plan) {
  const { schedule, outboundRoute, returnRoute, hotel, activity, outboundPoint, returnPoint } = plan;
  return {
    recordType: 'activity-bus-plan',
    planName: plan.planName,
    status: plan.status,
    coachId: plan.coachId,
    hotelId: hotel.id || 'custom',
    hotelName: hotel.name,
    hotelAddress: hotel.address,
    hotel: { lat: hotel.lat, lng: hotel.lng },
    activityId: activity.id,
    activityMarker: activity.marker,
    activityName: activity.name,
    outboundPointId: outboundPoint.id,
    outboundPointName: outboundPoint.name,
    outboundPointAddress: outboundPoint.address,
    outboundPoint: { lat: outboundPoint.lat, lng: outboundPoint.lng },
    returnPointId: returnPoint.id,
    returnPointName: returnPoint.name,
    returnPointAddress: returnPoint.address,
    returnPoint: { lat: returnPoint.lat, lng: returnPoint.lng },
    outboundDistanceMiles: Number((outboundRoute.distance / 1609.344).toFixed(2)),
    outboundBaseMinutes: schedule.outboundBase,
    outboundAllowance: schedule.outboundAllowance,
    outboundPlannedMinutes: schedule.outboundPlanned,
    returnDistanceMiles: Number((returnRoute.distance / 1609.344).toFixed(2)),
    returnBaseMinutes: schedule.returnBase,
    returnAllowance: schedule.returnAllowance,
    returnPlannedMinutes: schedule.returnPlanned,
    arriveEarly: schedule.arriveEarly,
    passengerReport: schedule.passengerReport,
    pickupLoading: schedule.pickupLoading,
    coachReset: schedule.coachReset,
    activityStartLocal: localInputValue(schedule.start),
    activityPickupLocal: localInputValue(schedule.pickup),
    reportLocal: localInputValue(schedule.report),
    departureLocal: localInputValue(schedule.hotelDeparture),
    targetArrivalLocal: localInputValue(schedule.targetArrival),
    returnDepartureLocal: localInputValue(schedule.returnDeparture),
    hotelReturnLocal: localInputValue(schedule.hotelReturn),
    availableLocal: localInputValue(schedule.available),
    timeZone: 'America/Denver',
    notes: plan.notes,
    updatedByEmail: currentUser.email,
    updatedAt: serverTimestamp()
  };
}
async function savePlan() {
  if (!isAdmin()) { openLogin(); return; }
  if (!currentPlan) { toast('Calculate the activity schedule before saving.', true); return; }
  const button = els.savePlanButton;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const reference = currentPlanId ? doc(db, 'reviews', currentPlanId) : doc(collection(db, 'reviews'));
    await setDoc(reference, {
      ...serializePlan(currentPlan),
      ...(currentPlanId ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });
    currentPlanId = reference.id;
    currentPlan.id = reference.id;
    toast('Activity bus plan saved.');
  } catch (error) {
    toast(`Could not save activity plan: ${friendlyError(error)}`, true);
  } finally {
    button.disabled = false;
    updateSaveButton();
  }
}
function subscribeRecords() {
  if (recordsUnsub) recordsUnsub();
  savedPlans = [];
  savedFieldRoutes = [];
  renderSavedPlans();
  if (!canView('activities') && !canView('routes')) return;
  els.savedStatus.textContent = 'Loading saved schedules…';
  const types = [...(canView('activities') ? ['activity-bus-plan'] : []), ...(canView('routes') ? ['bus-route'] : [])];
  recordsUnsub = onSnapshot(query(collection(db, 'reviews'), where('recordType', 'in', types)), snapshot => {
    savedPlans = [];
    savedFieldRoutes = [];
    snapshot.forEach(item => {
      const data = item.data();
      if (data.recordType === 'activity-bus-plan') savedPlans.push({ id: item.id, ...data });
      if (data.recordType === 'bus-route') savedFieldRoutes.push({ id: item.id, ...data });
    });
    savedPlans.sort((a, b) => String(a.activityStartLocal || '').localeCompare(String(b.activityStartLocal || '')));
    renderSavedPlans();
    if (currentPlan) renderConflicts(currentPlan);
  }, error => { els.savedStatus.textContent = `Saved schedules could not be loaded: ${friendlyError(error)}`; });
}
function renderSavedPlans() {
  if (!canView('activities')) {
    els.savedStatus.textContent = 'Sign in to view and manage saved activity plans.';
    els.savedPlans.innerHTML = '';
    return;
  }
  if (!savedPlans.length) {
    els.savedStatus.textContent = 'No activity bus plans have been saved yet.';
    els.savedPlans.innerHTML = '';
    return;
  }
  els.savedStatus.textContent = `${savedPlans.length} saved activity plan${savedPlans.length === 1 ? '' : 's'} • ${savedFieldRoutes.length} saved field-service route${savedFieldRoutes.length === 1 ? '' : 's'} available for conflict comparison`;
  els.savedPlans.innerHTML = savedPlans.map(plan => `<article class="saved-plan">
    <div class="saved-plan-head"><div><h3>${escapeHtml(plan.planName || plan.activityName || 'Activity plan')}</h3><p>${escapeHtml(plan.hotelName || 'Hotel')} ⇄ ${escapeHtml(plan.activityName || 'Activity')}</p></div><span class="status-pill ${escapeHtml(plan.status || 'draft')}">${escapeHtml((plan.status || 'draft').replaceAll('-', ' '))}</span></div>
    <span class="window">Unavailable ${escapeHtml(formatDateTime(plan.reportLocal))} — ${escapeHtml(formatDateTime(plan.availableLocal || plan.hotelReturnLocal))}</span>
    ${plan.coachId ? `<p>Coach / group: ${escapeHtml(plan.coachId)}</p>` : ''}
    <div class="saved-plan-actions"><button class="btn outline" data-load-plan="${escapeHtml(plan.id)}" type="button">Load</button><button class="btn outline danger" data-delete-plan="${escapeHtml(plan.id)}" ${isAdmin()?'':'disabled'} type="button">Delete</button></div>
  </article>`).join('');
  els.savedPlans.querySelectorAll('[data-load-plan]').forEach(button => button.addEventListener('click', () => loadPlan(button.dataset.loadPlan)));
  els.savedPlans.querySelectorAll('[data-delete-plan]').forEach(button => button.addEventListener('click', () => deletePlan(button.dataset.deletePlan)));
}
async function loadPlan(id) {
  const plan = savedPlans.find(item => item.id === id);
  if (!plan) return;
  currentPlanId = id;
  els.planName.value = plan.planName || '';
  els.coachId.value = plan.coachId || '';
  els.planStatus.value = plan.status || 'draft';
  els.planNotes.value = plan.notes || '';
  els.activityStart.value = plan.activityStartLocal || '';
  els.activityPickup.value = plan.activityPickupLocal || '';
  els.arriveEarly.value = plan.arriveEarly ?? 15;
  els.outboundAllowance.value = plan.outboundAllowance ?? 20;
  els.passengerReport.value = plan.passengerReport ?? 20;
  els.pickupLoading.value = plan.pickupLoading ?? 15;
  els.returnAllowance.value = plan.returnAllowance ?? 20;
  els.coachReset.value = plan.coachReset ?? 15;
  const hotel = HOTELS.find(item => item.id === plan.hotelId);
  if (hotel) {
    els.hotelSelect.value = hotel.id;
    els.customOriginWrap.hidden = true;
  } else {
    els.hotelSelect.value = 'custom';
    els.customOriginWrap.hidden = false;
    els.customOriginAddress.value = plan.hotelAddress || plan.hotelName || '';
    if (plan.hotel) {
      geocodeCache[normalKey(plan.hotelAddress || plan.hotelName)] = plan.hotel;
      saveCache();
    }
  }
  els.activitySelect.value = plan.activityId || '';
  selectActivity(plan.activityId, false);
  handleHotelChange();
  await calculatePlan();
  toast('Saved activity plan loaded for review or updating.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function deletePlan(id) {
  const plan = savedPlans.find(item => item.id === id);
  if (!plan || !isAdmin()) return;
  if (!window.confirm(`Delete “${plan.planName || 'this activity plan'}”?`)) return;
  try {
    await deleteDoc(doc(db, 'reviews', id));
    if (currentPlanId === id) { currentPlanId = null; updateSaveButton(); }
    toast('Activity bus plan deleted.');
  } catch (error) {
    toast(`Could not delete activity plan: ${friendlyError(error)}`, true);
  }
}
function resetPlanner() {
  currentPlan = null;
  currentPlanId = null;
  els.form.reset();
  initDefaults();
  els.arriveEarly.value = 15;
  els.outboundAllowance.value = 20;
  els.passengerReport.value = 20;
  els.pickupLoading.value = 15;
  els.returnAllowance.value = 20;
  els.coachReset.value = 15;
  els.planStatus.value = 'draft';
  els.resultCard.hidden = true;
  els.customOriginWrap.hidden = true;
  selectedActivity = null;
  clearRouteLayers();
  refreshPointIcons();
  const bounds = L.latLngBounds(ACTIVITY_POINTS.map(point => [point.lat, point.lng]));
  map.fitBounds(bounds, { padding: [42, 42], maxZoom: 10 });
  updateSaveButton();
  toast('New activity plan form ready.');
}

function openLogin() { els.loginModal.classList.add('open'); setTimeout(() => els.loginPassword.focus(), 50); }
function closeLogin() { els.loginModal.classList.remove('open'); }
els.loginButton.addEventListener('click', openLogin);
document.getElementById('cancelLogin').addEventListener('click', closeLogin);
els.loginModal.addEventListener('click', event => { if (event.target === els.loginModal) closeLogin(); });
els.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value);
    els.loginPassword.value = '';
    closeLogin();
    toast('Signed in.');
  } catch (error) { toast(friendlyError(error), true); }
});
document.getElementById('resetPassword').addEventListener('click', async () => {
  try {
    await sendPasswordResetEmail(auth, els.loginEmail.value.trim() || ADMIN_EMAIL);
    toast('Password reset email sent.');
  } catch (error) { toast(friendlyError(error), true); }
});
els.signOutButton.addEventListener('click', async () => { await signOut(auth); toast('Signed out.'); });
els.form.addEventListener('submit', calculatePlan);
els.hotelSelect.addEventListener('change', handleHotelChange);
els.activitySelect.addEventListener('change', () => selectActivity(els.activitySelect.value, true));
els.planName.addEventListener('input', updatePlanPlaceholder);
els.newPlanButton.addEventListener('click', resetPlanner);
els.savePlanButton.addEventListener('click', savePlan);

populateHotels();
populateActivities();
renderLocationGrid();
initDefaults();
initMap();
updateSaveButton();

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  observeSiteAccess(auth, user => {
    currentUser = user;
    els.loginButton.hidden = Boolean(user);
    els.signOutButton.hidden = !user;
    if (user && !isAdmin()) toast('This account has viewing access only.', true);
    subscribeRecords();
    updateSaveButton();
  });
} catch (error) {
  toast(`Firebase could not initialize: ${friendlyError(error)}`, true);
}

import {
  collection, query, where, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const ROUTER = 'https://valhalla1.openstreetmap.de/route';
const LOGO = new URL('../assets/denver-2027-logo.png', import.meta.url).href;
const ADMIN_EMAIL = 'michaeltarin@hotmail.com';
const COLORS = { walking: '#14845f', transit: '#2f6fb4', driving: '#d66a17' };
const CLIENT_ID = 'letdesignworks-denver2027-territories';
const GEOCODE_TIMEOUT_MS = 15000;

let api = null;
let map = null;
let db = null;
let routeLayer = null;
let meetingLayer = null;
let previewLayer = null;
let unsubscribeMeetingPoints = null;
let subscribedAsAdmin = false;
let dropMode = false;
let dropHandler = null;
let editingMeetingPointId = '';
let activeRoute = null;
let routeRevision = 0;
let currentContextKey = '';
const routeCache = new Map();
const meetingPoints = new Map();
const meetingMarkers = new Map();
const el = {};

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const travelMode = value => ['walking', 'transit', 'driving'].includes(value) ? value : 'driving';
const modeName = value => ({ walking: 'Walking', transit: 'RTD / transit', driving: 'Driving' })[travelMode(value)];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function toast(message, error = false) {
  if (api?.toast) api.toast(message, error);
}
function requireAdmin() {
  if (api?.isAdmin?.()) return true;
  api?.requireAdmin?.();
  toast('Administrator sign-in is required to add or change meeting points.', true);
  return false;
}
function formatMiles(miles) {
  const value = Number(miles);
  if (!Number.isFinite(value)) return '—';
  return value < .1 ? `${Math.max(1, Math.round(value * 5280))} ft` : `${value.toFixed(value < 10 ? 1 : 0)} mi`;
}
function formatTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 'Schedule dependent';
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} hr${remainder ? ` ${remainder} min` : ''}`;
}
function localDateTime() {
  const date = new Date(Date.now() + 30 * 60000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function friendlyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(date);
}
function pointQuery(point) {
  if (Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))) {
    return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
  }
  return clean(point?.address || point?.name);
}
function googleDirections(origin, destination, mode) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', pointQuery(origin));
  url.searchParams.set('destination', pointQuery(destination));
  url.searchParams.set('travelmode', travelMode(mode));
  return url.href;
}
function appleDirections(origin, destination, mode) {
  const normalized = travelMode(mode);
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('saddr', pointQuery(origin));
  url.searchParams.set('daddr', pointQuery(destination));
  url.searchParams.set('dirflg', normalized === 'transit' ? 'r' : normalized === 'walking' ? 'w' : 'd');
  return url.href;
}
function distanceMiles(a, b) {
  const toRad = degrees => Number(degrees) * Math.PI / 180;
  const lat1 = toRad(a?.lat), lat2 = toRad(b?.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(Number(b?.lng) - Number(a?.lng));
  if (![lat1, lat2, dLat, dLng].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function currentPlannerData() {
  return {
    hall: api?.getSelectedHall?.() || null,
    congregation: clean(api?.getSelectedCongregation?.()),
    planId: clean(api?.getCurrentPlanId?.()),
    territories: api?.getTerritories?.() || [],
    houses: api?.getHouses?.() || []
  };
}
function contextKey(data = currentPlannerData()) {
  return `${data.hall?.id || ''}|${data.congregation || ''}`;
}
function visibleMeetingPoints(data = currentPlannerData()) {
  return [...meetingPoints.values()]
    .filter(record => String(record.hallId || '') === String(data.hall?.id || '') && clean(record.congregation) === data.congregation)
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name), undefined, { numeric: true }));
}
function currentTerritory(data = currentPlannerData()) {
  return data.territories.find(item => String(item.id) === String(el.territory?.value || '')) || null;
}
function territoryHouses(territoryId, data = currentPlannerData()) {
  return data.houses
    .filter(house => house.included !== false && !house.avoid && String(house.territoryId || '') === String(territoryId || ''))
    .sort((a, b) => clean(a.address).localeCompare(clean(b.address), undefined, { numeric: true }));
}
function currentOrigin(data = currentPlannerData()) {
  const value = clean(el.origin?.value);
  if (value.startsWith('meeting:')) {
    const record = meetingPoints.get(value.slice(8));
    if (record) return {
      id: record.id, name: record.name, address: record.address,
      lat: Number(record.lat), lng: Number(record.lng), markerLabel: record.markerLabel || 'MP', type: 'meeting'
    };
  }
  const hall = data.hall;
  if (!hall || !Number.isFinite(Number(hall.lat)) || !Number.isFinite(Number(hall.lng))) return null;
  return {
    id: `hall:${hall.id}`, name: hall.name || 'Selected Kingdom Hall', address: hall.address || '',
    lat: Number(hall.lat), lng: Number(hall.lng), markerLabel: hall.markerLabel || hall.number || 'KH', type: 'hall'
  };
}
function territoryCenter(territory, houses) {
  const points = houses.filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)));
  if (points.length) {
    return {
      id: `center:${territory.id}`,
      name: `${territory.name} center`,
      address: 'Territory center',
      lat: points.reduce((sum, item) => sum + Number(item.lat), 0) / points.length,
      lng: points.reduce((sum, item) => sum + Number(item.lng), 0) / points.length,
      markerLabel: territory.name,
      type: 'territory-center'
    };
  }
  const geometry = territory?.geometry;
  if (geometry && globalThis.turf) {
    try {
      const feature = turf.feature(geometry.type === 'Feature' ? geometry.geometry : geometry);
      const [lng, lat] = turf.centroid(feature).geometry.coordinates;
      return { id: `center:${territory.id}`, name: `${territory.name} center`, address: 'Territory center', lat, lng, markerLabel: territory.name, type: 'territory-center' };
    } catch { /* no-op */ }
  }
  return null;
}
function currentDestination(data = currentPlannerData()) {
  const territory = currentTerritory(data);
  if (!territory) return null;
  const houses = territoryHouses(territory.id, data);
  const chosen = clean(el.destination?.value || 'auto');
  if (chosen && chosen !== 'auto' && chosen !== 'center') {
    const house = houses.find(item => String(item.id) === chosen);
    if (house) return {
      id: house.id, name: house.address, address: house.address,
      lat: Number(house.lat), lng: Number(house.lng), markerLabel: territory.name, type: 'house', territoryId: territory.id
    };
  }
  if (chosen === 'center') return territoryCenter(territory, houses);
  const origin = currentOrigin(data);
  const nearest = houses
    .filter(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
    .map(item => ({ item, miles: origin ? distanceMiles(origin, item) : 0 }))
    .sort((a, b) => a.miles - b.miles || clean(a.item.address).localeCompare(clean(b.item.address), undefined, { numeric: true }))[0]?.item;
  if (nearest) return {
    id: nearest.id, name: nearest.address, address: nearest.address,
    lat: Number(nearest.lat), lng: Number(nearest.lng), markerLabel: territory.name, type: 'house', territoryId: territory.id
  };
  return territoryCenter(territory, houses);
}

function setLink(anchor, href) {
  if (!anchor) return;
  if (href) {
    anchor.href = href;
    anchor.classList.remove('disabled');
    anchor.removeAttribute('aria-disabled');
  } else {
    anchor.removeAttribute('href');
    anchor.classList.add('disabled');
    anchor.setAttribute('aria-disabled', 'true');
  }
}
function updateDirectionLinks() {
  const data = currentPlannerData();
  const origin = currentOrigin(data);
  const destination = currentDestination(data);
  const mode = travelMode(el.mode?.value);
  setLink(el.google, origin && destination ? googleDirections(origin, destination, mode) : '');
  setLink(el.apple, origin && destination ? appleDirections(origin, destination, mode) : '');
  if (el.destinationNote) {
    el.destinationNote.textContent = destination
      ? `Directions will end at ${destination.address || destination.name}. Choose another assigned address when a different territory entry point is better.`
      : 'Create or select a territory with assigned addresses before building directions.';
  }
}
function populateOriginOptions() {
  if (!el.origin) return;
  const data = currentPlannerData();
  const previous = el.origin.value;
  const options = [];
  if (data.hall) options.push(`<option value="hall">Selected Hall — ${esc(data.hall.name || 'Kingdom Hall')}</option>`);
  visibleMeetingPoints(data).forEach(record => options.push(`<option value="meeting:${esc(record.id)}">Meeting point — ${esc(record.name)}</option>`));
  el.origin.innerHTML = options.length ? options.join('') : '<option value="">Select a Hall or add a meeting point</option>';
  if ([...el.origin.options].some(option => option.value === previous)) el.origin.value = previous;
  else if (data.hall) el.origin.value = 'hall';
}
function populateTerritoryOptions(preferred = '') {
  if (!el.territory) return;
  const data = currentPlannerData();
  const previous = preferred || el.territory.value;
  const options = data.territories
    .slice()
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name), undefined, { numeric: true }))
    .map(territory => `<option value="${esc(territory.id)}">${esc(territory.name)} (${Number(territory.houseIds?.length || territoryHouses(territory.id, data).length).toLocaleString()} homes)</option>`);
  el.territory.innerHTML = options.length ? options.join('') : '<option value="">Create a territory first</option>';
  if (options.length && data.territories.some(item => String(item.id) === String(previous))) el.territory.value = previous;
  else if (options.length) el.territory.value = data.territories.slice().sort((a, b) => clean(a.name).localeCompare(clean(b.name), undefined, { numeric: true }))[0].id;
  populateDestinationOptions();
}
function populateDestinationOptions() {
  if (!el.destination) return;
  const data = currentPlannerData();
  const territory = currentTerritory(data);
  const previous = el.destination.value;
  if (!territory) {
    el.destination.innerHTML = '<option value="">Select a territory first</option>';
    updateDirectionLinks();
    return;
  }
  const houses = territoryHouses(territory.id, data);
  const options = ['<option value="auto">Closest assigned address to the starting location (recommended)</option>'];
  houses.forEach(house => options.push(`<option value="${esc(house.id)}">${esc(house.address)}</option>`));
  if (!houses.length) options.push('<option value="center">Territory center</option>');
  el.destination.innerHTML = options.join('');
  if ([...el.destination.options].some(option => option.value === previous)) el.destination.value = previous;
  else el.destination.value = houses.length ? 'auto' : 'center';
  updateDirectionLinks();
}

function meetingPointIcon(record, selected = false) {
  return L.divIcon({
    className: '',
    html: `<div class="territory-meeting-pin${selected ? ' selected' : ''}"><span>MP</span><b>${esc(record.markerLabel || 'M')}</b></div>`,
    iconSize: [48, 48], iconAnchor: [24, 24]
  });
}
function routeEndpointIcon(label, end = false) {
  return L.divIcon({
    className: '',
    html: `<div class="territory-route-endpoint ${end ? 'end' : 'start'}">${esc(label)}</div>`,
    iconSize: [58, 34], iconAnchor: [29, 17]
  });
}
function bearing(a, b) {
  const radians = value => value * Math.PI / 180;
  const degrees = value => value * 180 / Math.PI;
  const y = Math.sin(radians(b[1] - a[1])) * Math.cos(radians(b[0]));
  const x = Math.cos(radians(a[0])) * Math.sin(radians(b[0])) - Math.sin(radians(a[0])) * Math.cos(radians(b[0])) * Math.cos(radians(b[1] - a[1]));
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}
function arrowIcon(color, angle) {
  return L.divIcon({
    className: '',
    html: `<div class="territory-route-arrow" style="transform:rotate(${angle}deg);color:${color}"><svg viewBox="0 0 32 32"><path d="M16 2L29 28L16 22L3 28Z"/></svg></div>`,
    iconSize: [32, 32], iconAnchor: [16, 16]
  });
}
function renderMeetingPointMarkers() {
  if (!meetingLayer) return;
  meetingLayer.clearLayers();
  meetingMarkers.clear();
  const selectedId = clean(el.origin?.value).startsWith('meeting:') ? clean(el.origin.value).slice(8) : '';
  visibleMeetingPoints().forEach(record => {
    if (!Number.isFinite(Number(record.lat)) || !Number.isFinite(Number(record.lng))) return;
    const marker = L.marker([Number(record.lat), Number(record.lng)], { icon: meetingPointIcon(record, record.id === selectedId), zIndexOffset: 620 }).addTo(meetingLayer);
    marker.bindPopup(`<strong>${esc(record.name)}</strong><br>${esc(record.address || 'Saved map point')}<br><small>Territory meeting point</small>`);
    marker.on('click', () => {
      el.origin.value = `meeting:${record.id}`;
      renderMeetingPointMarkers();
      populateDestinationOptions();
      updateDirectionLinks();
    });
    meetingMarkers.set(record.id, marker);
  });
}
function renderMeetingPointList() {
  if (!el.meetingList) return;
  const records = visibleMeetingPoints();
  if (!records.length) {
    el.meetingList.innerHTML = '<div class="empty">No additional meeting points have been saved for this congregation.</div>';
    return;
  }
  el.meetingList.innerHTML = records.map(record => `
    <article class="territory-meeting-row">
      <span class="territory-meeting-row-pin">MP</span>
      <div><strong>${esc(record.name)}</strong><small>${esc(record.address || `${Number(record.lat).toFixed(6)}, ${Number(record.lng).toFixed(6)}`)}</small>
        <div class="territory-meeting-actions">
          <button type="button" data-meeting-use="${esc(record.id)}">Use for directions</button>
          <button type="button" data-meeting-edit="${esc(record.id)}">Edit</button>
          <button type="button" class="danger" data-meeting-delete="${esc(record.id)}">Delete</button>
        </div>
      </div>
    </article>`).join('');
  el.meetingList.querySelectorAll('[data-meeting-use]').forEach(button => button.addEventListener('click', () => useMeetingPoint(button.dataset.meetingUse)));
  el.meetingList.querySelectorAll('[data-meeting-edit]').forEach(button => button.addEventListener('click', () => editMeetingPoint(button.dataset.meetingEdit)));
  el.meetingList.querySelectorAll('[data-meeting-delete]').forEach(button => button.addEventListener('click', () => removeMeetingPoint(button.dataset.meetingDelete)));
}
function useMeetingPoint(id) {
  const record = meetingPoints.get(id);
  if (!record) return;
  el.origin.value = `meeting:${id}`;
  renderMeetingPointMarkers();
  populateDestinationOptions();
  updateDirectionLinks();
  map?.setView([Number(record.lat), Number(record.lng)], Math.max(map.getZoom(), 15), { animate: true });
}
function clearMeetingPointForm() {
  editingMeetingPointId = '';
  if (el.meetingName) el.meetingName.value = '';
  if (el.meetingAddress) el.meetingAddress.value = '';
  if (el.meetingLat) el.meetingLat.value = '';
  if (el.meetingLng) el.meetingLng.value = '';
  if (el.meetingSave) el.meetingSave.textContent = 'Save Meeting Point';
  if (el.meetingMessage) {
    el.meetingMessage.textContent = 'Enter an address or drop a point on the map. The meeting point will be saved privately for this Hall and congregation.';
    el.meetingMessage.dataset.state = 'waiting';
  }
  previewLayer?.clearLayers();
}
function editMeetingPoint(id) {
  const record = meetingPoints.get(id);
  if (!record) return;
  editingMeetingPointId = id;
  el.meetingName.value = record.name || '';
  el.meetingAddress.value = record.address || '';
  el.meetingLat.value = Number(record.lat).toFixed(6);
  el.meetingLng.value = Number(record.lng).toFixed(6);
  el.meetingSave.textContent = 'Update Meeting Point';
  el.meetingMessage.textContent = `Editing ${record.name}. Change the information and select Update Meeting Point.`;
  el.meetingMessage.dataset.state = 'working';
  previewMeetingPoint(record);
  el.meetingName.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function removeMeetingPoint(id) {
  if (!requireAdmin()) return;
  const record = meetingPoints.get(id);
  if (!record || !confirm(`Delete the meeting point “${record.name}”?`)) return;
  try {
    await deleteDoc(doc(db, 'reviews', id));
    if (editingMeetingPointId === id) clearMeetingPointForm();
    toast(`${record.name} deleted.`);
  } catch (error) {
    toast(`Could not delete the meeting point: ${error?.message || 'Unknown error'}`, true);
  }
}
function previewMeetingPoint(point) {
  previewLayer?.clearLayers();
  const lat = Number(point?.lat), lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  L.marker([lat, lng], { icon: meetingPointIcon({ markerLabel: 'NEW' }, true), zIndexOffset: 800 }).addTo(previewLayer);
  map?.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
}
async function locateMeetingPointAddress() {
  if (!requireAdmin()) return;
  const address = clean(el.meetingAddress.value);
  if (!address) {
    toast('Enter the meeting-point address first.', true);
    el.meetingAddress.focus();
    return;
  }
  el.meetingLocate.disabled = true;
  el.meetingLocate.textContent = 'Locating…';
  el.meetingMessage.textContent = 'Locating the meeting-point address…';
  el.meetingMessage.dataset.state = 'working';
  try {
    const result = await api.geocodeAddress(address);
    const lat = Number(result.lat), lng = Number(result.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('The address service returned invalid coordinates.');
    el.meetingLat.value = lat.toFixed(6);
    el.meetingLng.value = lng.toFixed(6);
    el.meetingAddress.value = result.matchedAddress || address;
    previewMeetingPoint({ lat, lng });
    el.meetingMessage.textContent = `Address located using ${result.source || 'the address service'}. Verify the marker before saving.`;
    el.meetingMessage.dataset.state = 'success';
  } catch (error) {
    el.meetingMessage.textContent = `Could not locate the address: ${error?.message || 'Unknown error'}`;
    el.meetingMessage.dataset.state = 'error';
    toast('The meeting-point address could not be located.', true);
  } finally {
    el.meetingLocate.disabled = !api.isAdmin();
    el.meetingLocate.textContent = 'Locate Address';
  }
}
async function reverseGeocode(lat, lng) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('email', ADMIN_EMAIL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'Accept-Language': 'en' } });
    if (!response.ok) throw new Error(`Reverse geocoding returned HTTP ${response.status}.`);
    const result = await response.json();
    return clean(result.display_name) || `Map point at ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  } finally {
    clearTimeout(timer);
  }
}
function stopMeetingPointDrop(showNotice = false) {
  dropMode = false;
  if (dropHandler && map) map.off('click', dropHandler);
  dropHandler = null;
  map?.getContainer()?.classList.remove('territory-meeting-drop-active');
  if (el.meetingDrop) {
    el.meetingDrop.classList.remove('active');
    el.meetingDrop.textContent = 'Drop Meeting Point on Map';
  }
  if (showNotice) toast('Meeting-point map drop canceled.');
}
function toggleMeetingPointDrop() {
  if (!requireAdmin()) return;
  if (dropMode) {
    stopMeetingPointDrop(true);
    return;
  }
  dropMode = true;
  el.meetingDrop.classList.add('active');
  el.meetingDrop.textContent = 'Cancel Map Drop';
  map.getContainer().classList.add('territory-meeting-drop-active');
  el.meetingMessage.textContent = 'Tap the exact meeting location on the map. The nearest address will be filled automatically.';
  el.meetingMessage.dataset.state = 'working';
  dropHandler = async event => {
    stopMeetingPointDrop(false);
    const lat = Number(event.latlng.lat), lng = Number(event.latlng.lng);
    el.meetingLat.value = lat.toFixed(6);
    el.meetingLng.value = lng.toFixed(6);
    previewMeetingPoint({ lat, lng });
    el.meetingMessage.textContent = 'Finding the nearest street address…';
    el.meetingMessage.dataset.state = 'working';
    try {
      el.meetingAddress.value = await reverseGeocode(lat, lng);
      el.meetingMessage.textContent = 'Map point located. Confirm the generated address and save the meeting point.';
      el.meetingMessage.dataset.state = 'success';
    } catch (error) {
      el.meetingAddress.value = `Map point at ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      el.meetingMessage.textContent = `The exact map point is ready, but the address could not be generated: ${error?.message || 'Unknown error'}`;
      el.meetingMessage.dataset.state = 'error';
    }
  };
  map.on('click', dropHandler);
  toast('Tap the exact meeting point on the map.');
}
async function saveMeetingPoint() {
  if (!requireAdmin()) return;
  const data = currentPlannerData();
  if (!data.hall || !data.congregation) {
    toast('Select a Hall and congregation first.', true);
    return;
  }
  const name = clean(el.meetingName.value);
  const address = clean(el.meetingAddress.value);
  const lat = Number(el.meetingLat.value), lng = Number(el.meetingLng.value);
  if (!name) { toast('Enter a meeting-point name.', true); el.meetingName.focus(); return; }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { toast('Locate the address or drop the meeting point on the map first.', true); return; }
  const button = el.meetingSave;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const ref = editingMeetingPointId ? doc(db, 'reviews', editingMeetingPointId) : doc(collection(db, 'reviews'));
    await setDoc(ref, {
      recordType: 'territory-route-origin',
      name, address, lat, lng,
      markerLabel: 'MP',
      hallId: String(data.hall.id || ''),
      hallLabel: data.hall.markerLabel || data.hall.number || '',
      hallName: data.hall.name || '',
      congregation: data.congregation,
      updatedByEmail: api.getCurrentUser?.()?.email || ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
      ...(editingMeetingPointId ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });
    toast(`${name} saved as a territory meeting point.`);
    clearMeetingPointForm();
  } catch (error) {
    toast(`Could not save the meeting point: ${error?.message || 'Unknown error'}`, true);
  } finally {
    button.disabled = !api.isAdmin();
    button.textContent = editingMeetingPointId ? 'Update Meeting Point' : 'Save Meeting Point';
  }
}

function syncMeetingPointSubscription() {
  const nextDb = api?.getDb?.() || null;
  const nextAdmin = Boolean(api?.isAdmin?.());
  db = nextDb;
  if (!nextDb || !nextAdmin) {
    if (unsubscribeMeetingPoints) unsubscribeMeetingPoints();
    unsubscribeMeetingPoints = null;
    subscribedAsAdmin = false;
    meetingPoints.clear();
    populateOriginOptions();
    renderMeetingPointList();
    renderMeetingPointMarkers();
    return;
  }
  if (unsubscribeMeetingPoints && subscribedAsAdmin) return;
  subscribedAsAdmin = true;
  const request = query(collection(nextDb, 'reviews'), where('recordType', '==', 'territory-route-origin'));
  unsubscribeMeetingPoints = onSnapshot(request, snapshot => {
    meetingPoints.clear();
    snapshot.forEach(item => meetingPoints.set(item.id, { id: item.id, ...item.data() }));
    populateOriginOptions();
    renderMeetingPointList();
    renderMeetingPointMarkers();
    populateDestinationOptions();
  }, error => {
    toast(`Meeting points could not be loaded: ${error?.message || 'Unknown error'}`, true);
  });
}

function decodeShape(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e6, lng / 1e6]);
  }
  return points;
}
function stepMode(maneuver, fallback) {
  if (maneuver.transit_info) return 'transit';
  const value = clean(maneuver.travel_mode).toLowerCase();
  if (value.includes('pedestrian')) return 'walking';
  if (value.includes('transit')) return 'transit';
  if (value.includes('drive') || value.includes('auto')) return 'driving';
  return fallback;
}
function normalizeRouteResponse(json, requestedMode) {
  if (!json?.trip?.legs?.length) throw new Error(json?.error || json?.error_message || 'No route was returned.');
  const geometry = [], steps = [];
  json.trip.legs.forEach(leg => {
    const shape = leg.shape ? decodeShape(leg.shape) : [];
    if (geometry.length && shape.length) shape.shift();
    geometry.push(...shape);
    (leg.maneuvers || []).forEach(maneuver => {
      const transit = maneuver.transit_info || {};
      steps.push({
        instruction: clean(maneuver.instruction || maneuver.verbal_pre_transition_instruction || 'Continue on the route.'),
        distance: Number(maneuver.length),
        time: Number(maneuver.time),
        mode: stepMode(maneuver, requestedMode),
        detail: [transit.short_name, transit.long_name, transit.headsign ? `toward ${transit.headsign}` : '', transit.operator_name].filter(Boolean).join(' • ')
      });
    });
  });
  if (!geometry.length) throw new Error('The routing service returned no route shape.');
  return {
    geometry, steps,
    distance: Number(json.trip.summary?.length),
    time: Number(json.trip.summary?.time),
    provider: 'Valhalla / OpenStreetMap'
  };
}
async function fetchRoute(origin, destination, mode, departure) {
  const normalized = travelMode(mode);
  const key = [origin.id, destination.id, normalized, normalized === 'transit' ? departure : ''].join('|');
  if (routeCache.has(key)) return routeCache.get(key);
  const costing = normalized === 'walking' ? 'pedestrian' : normalized === 'transit' ? 'multimodal' : 'auto';
  const payload = {
    locations: [
      { lat: origin.lat, lon: origin.lng, type: 'break', name: origin.name },
      { lat: destination.lat, lon: destination.lng, type: 'break', name: destination.name }
    ],
    costing,
    units: 'miles',
    language: 'en-US',
    directions_type: 'instructions',
    id: `denver2027-territory-${origin.id}-${destination.id}-${normalized}`
  };
  if (normalized === 'transit') {
    payload.date_time = departure ? { type: 1, value: departure } : { type: 0 };
    payload.costing_options = { transit: { use_bus: 1, use_rail: 1, use_transfers: .35 }, pedestrian: { walking_speed: 4.8 } };
  }
  const url = new URL(ROUTER);
  url.searchParams.set('json', JSON.stringify(payload));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28000);
  let response;
  try {
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'X-Client-Id': CLIENT_ID } });
    } catch {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    }
  } finally {
    clearTimeout(timer);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error_code) throw new Error(json.error || json.error_message || `Routing returned HTTP ${response.status}.`);
  const route = normalizeRouteResponse(json, normalized);
  routeCache.set(key, route);
  return route;
}
function routeMidpoint(points) {
  const index = Math.max(1, Math.floor(points.length * .55));
  return { point: points[index], angle: bearing(points[index - 1], points[index]) };
}
function renderRouteOnMap(route) {
  routeLayer.clearLayers();
  const color = COLORS[route.mode];
  L.polyline(route.geometry, { color: '#fff', weight: 9, opacity: .92, lineCap: 'round' }).addTo(routeLayer);
  L.polyline(route.geometry, {
    color, weight: route.mode === 'transit' ? 6 : 5, opacity: .96,
    dashArray: route.mode === 'walking' ? '4 7' : route.mode === 'transit' ? '11 7' : null,
    lineCap: 'round'
  }).addTo(routeLayer);
  const midpoint = routeMidpoint(route.geometry);
  L.marker(midpoint.point, { icon: arrowIcon(color, midpoint.angle), interactive: false, zIndexOffset: 780 }).addTo(routeLayer);
  L.marker([route.origin.lat, route.origin.lng], { icon: routeEndpointIcon(route.origin.markerLabel || 'START'), interactive: false, zIndexOffset: 800 }).addTo(routeLayer);
  L.marker([route.destination.lat, route.destination.lng], { icon: routeEndpointIcon(route.territory?.name || 'T', true), interactive: false, zIndexOffset: 800 }).addTo(routeLayer);
  map.fitBounds(L.latLngBounds(route.geometry), { padding: [55, 55], maxZoom: 16 });
}
function renderDirectFallback(origin, destination, mode, territory) {
  routeLayer.clearLayers();
  const color = COLORS[travelMode(mode)];
  const geometry = [[origin.lat, origin.lng], [destination.lat, destination.lng]];
  L.polyline(geometry, { color: '#fff', weight: 8, opacity: .9 }).addTo(routeLayer);
  L.polyline(geometry, { color, weight: 4, opacity: .95, dashArray: '5 8' }).addTo(routeLayer);
  const midpoint = routeMidpoint(geometry);
  L.marker(midpoint.point, { icon: arrowIcon(color, midpoint.angle), interactive: false, zIndexOffset: 780 }).addTo(routeLayer);
  L.marker([origin.lat, origin.lng], { icon: routeEndpointIcon(origin.markerLabel || 'START'), interactive: false, zIndexOffset: 800 }).addTo(routeLayer);
  L.marker([destination.lat, destination.lng], { icon: routeEndpointIcon(territory?.name || 'T', true), interactive: false, zIndexOffset: 800 }).addTo(routeLayer);
  map.fitBounds(L.latLngBounds(geometry), { padding: [55, 55], maxZoom: 16 });
}
function stepHtml(step, index, routeMode) {
  return `<li class="territory-route-step" data-mode="${esc(step.mode || routeMode)}"><span class="territory-route-step-number">${index + 1}</span><span><strong>${esc(step.instruction)}</strong>${step.detail ? `<small>${esc(step.detail)}</small>` : ''}</span><span class="territory-route-step-distance">${formatMiles(step.distance)}${step.time > 0 ? `<br>${formatTime(step.time)}` : ''}</span></li>`;
}
function setRouteStatus(message, type = '') {
  el.routeMessage.className = `territory-route-message${type ? ` ${type}` : ''}`;
  el.routeMessage.innerHTML = message;
}
function showRouteDetails(route) {
  el.routeChip.textContent = `${modeName(route.mode)} route ready`;
  el.routeChip.className = 'count-chip route-ready';
  setRouteStatus(`<strong>${esc(route.origin.name)}</strong> to <strong>${esc(route.territory.name)}</strong><br>Arrival address: ${esc(route.destination.address || route.destination.name)}${route.mode === 'transit' && route.departure ? `<br>Planned departure: ${esc(friendlyDate(route.departure))}` : ''}`, 'success');
  el.metrics.hidden = false;
  el.metricMode.textContent = modeName(route.mode);
  el.metricDistance.textContent = formatMiles(route.distance);
  el.metricTime.textContent = formatTime(route.time);
  el.metricProvider.textContent = route.provider;
  el.directions.hidden = !route.steps.length;
  el.steps.innerHTML = route.steps.map((step, index) => stepHtml(step, index, route.mode)).join('');
  el.print.disabled = false;
  el.clear.disabled = false;
}
async function loadTerritoryRoute() {
  const data = currentPlannerData();
  const origin = currentOrigin(data);
  const territory = currentTerritory(data);
  const destination = currentDestination(data);
  const mode = travelMode(el.mode.value);
  const departure = el.departure.value;
  if (!origin) return toast('Choose the selected Hall or a saved meeting point.', true);
  if (!territory) return toast('Choose a territory.', true);
  if (!destination) return toast('The selected territory does not have a usable destination address.', true);
  const token = ++routeRevision;
  el.showRoute.disabled = true;
  el.showRoute.textContent = 'Building Route…';
  el.routeChip.textContent = 'Building route';
  el.routeChip.className = 'count-chip';
  setRouteStatus(`Building ${modeName(mode).toLowerCase()} directions along the mapped network…`, 'loading');
  el.metrics.hidden = true;
  el.directions.hidden = true;
  try {
    const result = await fetchRoute(origin, destination, mode, departure);
    if (token !== routeRevision) return;
    activeRoute = { ...result, origin, destination, mode, departure, territory };
    renderRouteOnMap(activeRoute);
    showRouteDetails(activeRoute);
    updateDirectionLinks();
    toast(`${modeName(mode)} directions to ${territory.name} loaded.`);
  } catch (error) {
    if (token !== routeRevision) return;
    activeRoute = null;
    renderDirectFallback(origin, destination, mode, territory);
    el.routeChip.textContent = 'Map links ready';
    el.routeChip.className = 'count-chip';
    setRouteStatus(`The street-following route could not be loaded: ${esc(error?.message || 'Unknown error')}. A dotted planning line is shown. Use Google Maps or Apple Maps for live directions.`, 'error');
    el.metrics.hidden = true;
    el.directions.hidden = true;
    el.print.disabled = true;
    el.clear.disabled = false;
    updateDirectionLinks();
    toast('The route service was unavailable. Map links are ready.', true);
  } finally {
    el.showRoute.disabled = false;
    el.showRoute.textContent = 'Show Route on Streets';
  }
}
function clearTerritoryRoute() {
  routeRevision += 1;
  activeRoute = null;
  routeLayer?.clearLayers();
  el.routeChip.textContent = 'No route';
  el.routeChip.className = 'count-chip';
  setRouteStatus('Choose a starting location, territory, arrival address, and travel method, then select <strong>Show Route on Streets</strong>.');
  el.metrics.hidden = true;
  el.directions.hidden = true;
  el.print.disabled = true;
  el.clear.disabled = true;
}
function printTerritoryRoute() {
  if (!activeRoute) return toast('Load a route before printing directions.', true);
  const route = activeRoute;
  const popup = window.open('', '_blank');
  if (!popup) return toast('Allow pop-ups for this site and try again.', true);
  const steps = route.steps.map((step, index) => `<li><span>${index + 1}</span><div><strong>${esc(step.instruction)}</strong>${step.detail ? `<small>${esc(step.detail)}</small>` : ''}</div><em>${formatMiles(step.distance)}${step.time > 0 ? `<br>${formatTime(step.time)}` : ''}</em></li>`).join('');
  const google = googleDirections(route.origin, route.destination, route.mode);
  const apple = appleDirections(route.origin, route.destination, route.mode);
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(route.territory.name)} Directions</title><style>*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#213348;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.sheet{width:min(8.3in,calc(100% - 24px));margin:12px auto;background:#fff;padding:22px;border-radius:16px}.head{display:grid;grid-template-columns:72px 1fr auto;gap:14px;align-items:center;border-bottom:3px solid #083f73;padding-bottom:12px}.head img{width:68px;height:68px;object-fit:contain}.head h1{margin:0;color:#083f73;font-size:22px}.head p{margin:5px 0 0;color:#627184;font-size:10px;line-height:1.4}.badge{background:${COLORS[route.mode]};color:#fff;border-radius:999px;padding:8px 12px;font-size:11px;font-weight:900}.summary{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin:14px 0}.summary div{border:1px solid #d8e2ea;border-radius:10px;padding:10px}.summary span{display:block;color:#718096;font-size:9px;text-transform:uppercase;font-weight:800}.summary strong{display:block;margin-top:4px;font-size:12px;color:#203e5d}.links{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.links a,.print{border:0;border-radius:9px;padding:9px 12px;text-decoration:none;font-weight:850;font-size:10px;cursor:pointer}.links a{background:#edf5fb;color:#0b5b9f}.print{background:#083f73;color:#fff}h2{color:#083f73;font-size:15px;margin:18px 0 9px}ol{list-style:none;padding:0;margin:0;display:grid;gap:7px}li{display:grid;grid-template-columns:28px 1fr auto;gap:9px;align-items:start;border:1px solid #d9e3eb;border-radius:10px;padding:9px}li>span{width:24px;height:24px;border-radius:50%;background:#083f73;color:#fff;display:grid;place-items:center;font-size:10px;font-weight:900}li strong{font-size:11px}li small{display:block;color:#68778a;font-size:9px;margin-top:3px}li em{font-style:normal;text-align:right;font-size:9px;color:#536478}.note{margin-top:14px;border-top:1px solid #d9e3eb;padding-top:10px;color:#6a7889;font-size:9px;line-height:1.45}@media print{body{background:#fff}.sheet{width:100%;margin:0;padding:.25in;border-radius:0}.print{display:none}}</style></head><body><main class="sheet"><header class="head"><img src="${esc(LOGO)}" alt="Denver 2027"><div><h1>${esc(route.territory.name)} Directions</h1><p>Denver 2027 Convention ministry territory</p></div><span class="badge">${esc(modeName(route.mode))}</span></header><section class="summary"><div><span>Starting location</span><strong>${esc(route.origin.name)}</strong><small>${esc(route.origin.address || pointQuery(route.origin))}</small></div><div><span>Territory arrival</span><strong>${esc(route.destination.address || route.destination.name)}</strong><small>${esc(route.territory.name)}</small></div><div><span>Distance</span><strong>${esc(formatMiles(route.distance))}</strong></div><div><span>Estimated time</span><strong>${esc(formatTime(route.time))}</strong></div>${route.mode === 'transit' && route.departure ? `<div><span>Planned departure</span><strong>${esc(friendlyDate(route.departure))}</strong></div>` : ''}</section><div class="links"><a href="${esc(google)}" target="_blank">Google Maps</a><a href="${esc(apple)}" target="_blank">Apple Maps</a><button class="print" onclick="window.print()">Print / Save as PDF</button></div><h2>Turn-by-turn directions</h2><ol>${steps || '<li><div><strong>Use the Google Maps or Apple Maps link for live directions.</strong></div></li>'}</ol><p class="note">Verify the route, access, construction, sidewalks, transit service, parking, and the selected territory arrival address locally before use.</p></main></body></html>`);
  popup.document.close();
}
function syncTransitDeparture() {
  const isTransit = travelMode(el.mode.value) === 'transit';
  el.departureWrap.hidden = !isTransit;
  if (isTransit && !el.departure.value) el.departure.value = localDateTime();
  updateDirectionLinks();
}

function injectDirectionsButtons() {
  const list = document.getElementById('territoryList');
  if (!list) return;
  list.querySelectorAll('.territory-row').forEach(row => {
    if (row.querySelector('[data-territory-directions]')) return;
    const zoom = row.querySelector('[data-territory-zoom]');
    const actions = row.querySelector('.row-actions');
    const territoryId = zoom?.dataset?.territoryZoom;
    if (!actions || !territoryId) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action territory-directions-row-button';
    button.dataset.territoryDirections = territoryId;
    button.textContent = 'Directions';
    button.addEventListener('click', () => {
      populateTerritoryOptions(territoryId);
      el.territory.value = territoryId;
      populateDestinationOptions();
      el.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setRouteStatus(`Ready to build directions to <strong>${esc(currentTerritory()?.name || 'the selected territory')}</strong>.`);
    });
    const pdf = actions.querySelector('[data-territory-pdf]');
    if (pdf) actions.insertBefore(button, pdf);
    else actions.appendChild(button);
  });
}
function refreshFromPlanner() {
  const data = currentPlannerData();
  const nextContext = contextKey(data);
  if (currentContextKey && currentContextKey !== nextContext) {
    clearTerritoryRoute();
    clearMeetingPointForm();
  }
  currentContextKey = nextContext;
  syncMeetingPointSubscription();
  populateOriginOptions();
  populateTerritoryOptions();
  renderMeetingPointList();
  renderMeetingPointMarkers();
  injectDirectionsButtons();
  updateDirectionLinks();
  const admin = Boolean(api.isAdmin());
  [el.meetingLocate, el.meetingDrop, el.meetingSave, el.meetingClear].forEach(control => { if (control) control.disabled = !admin; });
}
function bindElements() {
  Object.assign(el, {
    card: document.getElementById('territoryDirectionsCard'),
    routeChip: document.getElementById('territoryRouteStatusChip'),
    origin: document.getElementById('territoryRouteOrigin'),
    territory: document.getElementById('territoryRouteTerritory'),
    destination: document.getElementById('territoryRouteDestination'),
    destinationNote: document.getElementById('territoryRouteDestinationNote'),
    mode: document.getElementById('territoryRouteMode'),
    departureWrap: document.getElementById('territoryRouteDepartureWrap'),
    departure: document.getElementById('territoryRouteDeparture'),
    showRoute: document.getElementById('showTerritoryRouteButton'),
    clear: document.getElementById('clearTerritoryRouteButton'),
    google: document.getElementById('territoryRouteGoogleLink'),
    apple: document.getElementById('territoryRouteAppleLink'),
    print: document.getElementById('printTerritoryRouteButton'),
    routeMessage: document.getElementById('territoryRouteMessage'),
    metrics: document.getElementById('territoryRouteMetrics'),
    metricMode: document.getElementById('territoryRouteMetricMode'),
    metricDistance: document.getElementById('territoryRouteMetricDistance'),
    metricTime: document.getElementById('territoryRouteMetricTime'),
    metricProvider: document.getElementById('territoryRouteMetricProvider'),
    directions: document.getElementById('territoryRouteDirections'),
    steps: document.getElementById('territoryRouteSteps'),
    meetingName: document.getElementById('territoryMeetingPointName'),
    meetingAddress: document.getElementById('territoryMeetingPointAddress'),
    meetingLat: document.getElementById('territoryMeetingPointLat'),
    meetingLng: document.getElementById('territoryMeetingPointLng'),
    meetingLocate: document.getElementById('locateTerritoryMeetingPointButton'),
    meetingDrop: document.getElementById('dropTerritoryMeetingPointButton'),
    meetingSave: document.getElementById('saveTerritoryMeetingPointButton'),
    meetingClear: document.getElementById('clearTerritoryMeetingPointButton'),
    meetingMessage: document.getElementById('territoryMeetingPointMessage'),
    meetingList: document.getElementById('territoryMeetingPointList')
  });
  return Boolean(el.card && el.origin && el.territory && el.showRoute);
}
function wireEvents() {
  el.origin.addEventListener('change', () => {
    renderMeetingPointMarkers();
    populateDestinationOptions();
    updateDirectionLinks();
  });
  el.territory.addEventListener('change', () => {
    populateDestinationOptions();
    updateDirectionLinks();
  });
  el.destination.addEventListener('change', updateDirectionLinks);
  el.mode.addEventListener('change', syncTransitDeparture);
  el.departure.addEventListener('change', updateDirectionLinks);
  el.showRoute.addEventListener('click', loadTerritoryRoute);
  el.clear.addEventListener('click', clearTerritoryRoute);
  el.print.addEventListener('click', printTerritoryRoute);
  el.meetingLocate.addEventListener('click', locateMeetingPointAddress);
  el.meetingDrop.addEventListener('click', toggleMeetingPointDrop);
  el.meetingSave.addEventListener('click', saveMeetingPoint);
  el.meetingClear.addEventListener('click', clearMeetingPointForm);
  el.meetingAddress.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); locateMeetingPointAddress(); }
  });
  const list = document.getElementById('territoryList');
  if (list) new MutationObserver(injectDirectionsButtons).observe(list, { childList: true, subtree: true });
  window.addEventListener('territory-planner:data', refreshFromPlanner);
}
async function waitForPlannerApi() {
  for (let index = 0; index < 240; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getMap?.()) return candidate;
    await wait(50);
  }
  return null;
}
async function initialize() {
  api = await waitForPlannerApi();
  if (!api) return;
  if (!bindElements()) return;
  map = api.getMap();
  db = api.getDb?.() || null;
  routeLayer = L.layerGroup().addTo(map);
  meetingLayer = L.layerGroup().addTo(map);
  previewLayer = L.layerGroup().addTo(map);
  wireEvents();
  syncTransitDeparture();
  clearTerritoryRoute();
  refreshFromPlanner();
}

initialize();

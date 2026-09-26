import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const ADMIN_EMAIL = 'michaeltarin@hotmail.com';
const GEOCODE_DELAY_MS = 900;
const GEOCODE_TIMEOUT_MS = 12000;

let map = null;
let auth = null;
let db = null;
let currentUser = null;
let locations = [];
let hubs = [];
let activeRoute = null;
let selectedHubId = null;
let dropMode = null;
let hubPreviewMarker = null;
let hubGeocodeTimer = null;
let hubGeocodeRevision = 0;
let lastGeocodeRequestAt = 0;
let unsubscribeRecords = null;

const hubLayer = L.layerGroup();
const routeLayer = L.layerGroup();
const hubMarkers = new Map();

const ROUTE_COLORS = {
  walking: '#14845f',
  transit: '#2f6fb4',
  driving: '#d66a17'
};

let els = {};

function clean(value = '') { return String(value ?? '').trim(); }
function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}
function isAdmin() { return currentUser?.email?.toLowerCase() === ADMIN_EMAIL; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function toast(message, error = false) {
  const host = document.getElementById('toast');
  if (!host) return;
  host.textContent = message;
  host.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(host._timer);
  host._timer = setTimeout(() => { host.className = 'toast'; }, 4400);
}
function friendlyError(error) {
  const code = error?.code || '';
  if (code.includes('permission-denied')) return 'Firebase denied this action. Confirm the administrator sign-in.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'The network or Firebase service is temporarily unavailable.';
  return error?.message?.replace(/^Firebase:\s*/i, '') || 'Unknown error';
}
function requireAdmin() {
  if (isAdmin()) return true;
  document.getElementById('loginButton')?.click();
  toast('Administrator sign-in is required for this change.', true);
  return false;
}
function pointQuery(point) {
  if (Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))) {
    return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
  }
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
  url.searchParams.set('q', clean(point?.name || point?.address || 'Map location'));
  if (Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))) {
    url.searchParams.set('ll', `${Number(point.lat)},${Number(point.lng)}`);
  }
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
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const dLat = lat2 - lat1;
  const dLng = toRad(Number(b.lng) - Number(a.lng));
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function formatMiles(miles) {
  if (!Number.isFinite(miles)) return '—';
  if (miles < .1) return '<0.1 mi';
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}
function routeModeLabel(mode) {
  return ({ walking: 'Walking', transit: 'RTD / transit', driving: 'Driving' })[mode] || 'Driving';
}
function normalizedRouteMode(mode) {
  return ['walking', 'transit', 'driving'].includes(mode) ? mode : 'driving';
}
function routeColor(mode) { return ROUTE_COLORS[normalizedRouteMode(mode)]; }
function bearingDegrees(origin, destination) {
  const toRad = degrees => degrees * Math.PI / 180;
  const toDeg = radians => radians * 180 / Math.PI;
  const lat1 = toRad(Number(origin.lat));
  const lat2 = toRad(Number(destination.lat));
  const dLng = toRad(Number(destination.lng) - Number(origin.lng));
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function hubSvg() {
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 28L32 10l24 18"/><path d="M13 26v27h38V26"/><path d="M21 34h22v19H21z"/><path d="M25 40h14M25 45h14"/><circle cx="27" cy="55" r="3"/><circle cx="39" cy="55" r="3"/></svg>';
}
function hubIcon(record, selected = false) {
  return L.divIcon({
    className: '',
    html: `<div class="smpw-hub-pin${selected ? ' selected' : ''}">${hubSvg()}<b>${escapeHtml(record.markerLabel || 'HUB')}</b></div>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28]
  });
}
function routeArrowIcon(origin, destination, mode, highlighted = false) {
  const angle = bearingDegrees(origin, destination);
  const color = routeColor(mode);
  return L.divIcon({
    className: '',
    html: `<div class="smpw-route-arrow${highlighted ? ' highlighted' : ''}" style="transform:rotate(${angle}deg);color:${color}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2L29 28L16 22L3 28Z"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}
function hubPreviewIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="smpw-hub-preview"></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function injectStyles() {
  if (document.getElementById('smpw-hub-route-styles')) return;
  const style = document.createElement('style');
  style.id = 'smpw-hub-route-styles';
  style.textContent = `
    .smpw-drop-active{cursor:crosshair!important}.smpw-drop-button.active{background:#ffe7a8!important;color:#6b4600!important;border-color:#f3c45d!important}
    .smpw-hub-pin{width:50px;height:50px;border-radius:13px;background:#f0ebff;border:3px solid #fff;box-shadow:0 1px 8px #0008;display:grid;place-items:center;position:relative;color:#5c42a3}
    .smpw-hub-pin svg{width:37px;height:37px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .smpw-hub-pin b{position:absolute;right:-8px;bottom:-7px;min-width:28px;height:22px;border-radius:11px;background:#5c42a3;color:#fff;border:2px solid #fff;font-size:8px;display:grid;place-items:center;padding:0 5px}.smpw-hub-pin.selected{outline:4px solid #ffd84f;transform:scale(1.08)}
    .smpw-hub-preview{width:28px;height:28px;border-radius:8px;background:#8c6fd0;border:4px solid #fff;box-shadow:0 1px 8px #0008}
    .smpw-route-arrow{width:30px;height:30px;display:grid;place-items:center;filter:drop-shadow(0 1px 2px #fff) drop-shadow(0 1px 3px #0006);transform-origin:50% 50%}.smpw-route-arrow svg{width:27px;height:27px;fill:currentColor;stroke:#fff;stroke-width:2}.smpw-route-arrow.highlighted{filter:drop-shadow(0 0 3px #fff) drop-shadow(0 0 5px #ffd84f)}
    .legend-hub{width:31px;height:31px;border-radius:8px;background:#f0ebff;border:1px solid #9b88cc;display:grid;place-items:center;color:#5c42a3}.legend-hub svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.route-legend-line{border-top:4px dotted #2f6fb4!important}
    .summary-grid.smpw-route-summary{grid-template-columns:repeat(6,1fr)}
    .smpw-route-card .route-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.smpw-route-card .route-grid .full{grid-column:1/-1}.smpw-route-card .route-message{border:1px solid #d7e1ea;border-radius:11px;background:#f7fafc;padding:10px;font-size:11px;line-height:1.45;color:#506176;margin:8px 0}.smpw-route-card .route-message strong{color:#203e5d}.smpw-route-links{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.smpw-route-note{font-size:9px!important;margin-top:8px!important;color:#6b7889!important}
    .smpw-hub-list{display:grid;gap:8px;max-height:430px;overflow:auto}.smpw-hub-row{border:1px solid #d8e2ea;border-radius:13px;background:#fff;padding:10px;display:grid;grid-template-columns:45px 1fr;gap:9px;cursor:pointer}.smpw-hub-row:hover,.smpw-hub-row.active{border-color:#8e7dc2;background:#f8f5ff}.smpw-hub-row-icon{width:42px;height:42px;border-radius:10px;background:#f0ebff;border:1px solid #a998d2;display:grid;place-items:center;color:#5c42a3;position:relative}.smpw-hub-row-icon svg{width:31px;height:31px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.smpw-hub-row-icon em{position:absolute;right:-7px;bottom:-5px;min-width:25px;height:20px;border-radius:10px;background:#5c42a3;color:#fff;font-style:normal;font-size:7px;font-weight:900;display:grid;place-items:center;padding:0 4px;border:2px solid #fff}.smpw-hub-row small{display:block;font-size:9px;color:#6a788a;line-height:1.35;margin-top:3px}.smpw-hub-row strong{font-size:12px;color:#253a50}.smpw-hub-links,.smpw-hub-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.smpw-hub-links a,.smpw-hub-actions button{border:0;background:transparent;color:#0b5b9f;font-size:9px;font-weight:850;padding:0;cursor:pointer}.smpw-hub-actions button.danger{color:#982f29}
    .hub-coordinate-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.hub-coordinate-actions .btn{flex:1 1 165px}.hub-address-status[data-state="working"]{color:#8a5a00}.hub-address-status[data-state="success"]{color:#166640}.hub-address-status[data-state="error"]{color:#982f29}
    @media(max-width:1120px){.summary-grid.smpw-route-summary{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:560px){.summary-grid.smpw-route-summary,.smpw-route-card .route-grid,.smpw-route-links{grid-template-columns:1fr}.smpw-route-card .route-grid .full{grid-column:auto}.hub-coordinate-actions{display:grid}.hub-coordinate-actions .btn{width:100%}}
  `;
  document.head.appendChild(style);
}

function injectUi() {
  injectStyles();
  const nav = document.querySelector('.navlinks');
  const signOut = document.getElementById('signOutButton');
  if (nav && !document.getElementById('dropLocationButton')) {
    const fragment = document.createDocumentFragment();
    const dropLocation = document.createElement('button');
    dropLocation.className = 'btn ghost smpw-drop-button';
    dropLocation.id = 'dropLocationButton';
    dropLocation.type = 'button';
    dropLocation.hidden = true;
    dropLocation.textContent = '⌖ Drop SMPW Location';
    fragment.appendChild(dropLocation);
    const addHub = document.createElement('button');
    addHub.className = 'btn ghost';
    addHub.id = 'addHubButton';
    addHub.type = 'button';
    addHub.hidden = true;
    addHub.textContent = '＋ Add SMPW Hub';
    fragment.appendChild(addHub);
    const dropHub = document.createElement('button');
    dropHub.className = 'btn ghost smpw-drop-button';
    dropHub.id = 'dropHubButton';
    dropHub.type = 'button';
    dropHub.hidden = true;
    dropHub.textContent = '⌖ Drop SMPW Hub';
    fragment.appendChild(dropHub);
    nav.insertBefore(fragment, signOut || null);
  }

  const legend = document.querySelector('.map-legend');
  if (legend && !legend.querySelector('.legend-hub')) {
    legend.insertAdjacentHTML('beforeend', `<div><span class="legend-hub">${hubSvg()}</span>SMPW cart hub</div><div><span class="legend-line route-legend-line"></span>Dotted hub route / arrow</div>`);
  }

  const summaryGrid = document.querySelector('.summary-grid');
  if (summaryGrid && !document.getElementById('hubCount')) {
    summaryGrid.classList.add('smpw-route-summary');
    summaryGrid.insertAdjacentHTML('beforeend', '<article><span>Hubs</span><strong id="hubCount">0</strong></article><article><span>Saved routes</span><strong id="routeCount">0</strong></article>');
  }

  const toggleGrid = document.querySelector('.toggle-grid');
  if (toggleGrid && !document.getElementById('showHubs')) {
    toggleGrid.insertAdjacentHTML('beforeend', '<label><input id="showHubs" type="checkbox" checked/> SMPW hubs</label><label><input id="showRoutes" type="checkbox" checked/> Hub routes</label>');
  }
  const layerButtons = document.querySelector('.layers-card .button-grid');
  if (layerButtons && !document.getElementById('fitHubsButton')) {
    layerButtons.insertAdjacentHTML('beforeend', '<button class="btn outline" id="fitHubsButton" type="button">Fit Hubs &amp; Routes</button>');
  }

  const directory = document.querySelector('.directory-card');
  if (directory && !document.getElementById('routeLocationSelect')) {
    directory.insertAdjacentHTML('beforebegin', `
      <section class="card smpw-route-card">
        <div class="card-heading"><div><span class="eyebrow">HUB TO CART ROUTE</span><h2>Directions from an SMPW hub</h2></div><span class="count-chip">Walking • RTD • Driving</span></div>
        <div class="route-grid">
          <div class="field full"><label for="routeLocationSelect">SMPW cart location</label><select id="routeLocationSelect"><option value="">Choose a cart location…</option></select></div>
          <div class="field"><label for="routeHubSelect">Pickup hub</label><select id="routeHubSelect"><option value="">Choose a hub…</option></select></div>
          <div class="field"><label for="routeModeSelect">Directions method</label><select id="routeModeSelect"><option value="walking">Walking</option><option value="transit">RTD / transit</option><option value="driving" selected>Driving</option></select></div>
        </div>
        <div class="route-message" id="routeSummary">Add at least one SMPW hub and one cart location to create a route.</div>
        <div class="button-grid">
          <button class="btn primary" id="showRouteButton" type="button">Show Dotted Route</button>
          <button class="btn save" id="saveRouteButton" type="button" hidden>Save Route Assignment</button>
        </div>
        <div class="smpw-route-links" id="routeLinks" hidden><a class="btn outline" id="routeGoogleLink" target="_blank" rel="noopener">Google Maps Directions</a><a class="btn outline" id="routeAppleLink" target="_blank" rel="noopener">Apple Maps Directions</a></div>
        <p class="smpw-route-note">The dotted arrow is a planning connection from the hub to the cart location. Open Google Maps or Apple Maps for the actual walking, public-transit, or driving route.</p>
      </section>
    `);
    directory.insertAdjacentHTML('afterend', `
      <section class="card smpw-hub-directory-card">
        <div class="card-heading"><div><span class="eyebrow">SMPW HUB DIRECTORY</span><h2>Cart pickup hubs</h2></div><span id="hubDirectoryCount" class="count-chip">0 shown</span></div>
        <div id="hubList" class="smpw-hub-list"><div class="empty">No SMPW hubs have been added yet.</div></div>
      </section>
    `);
  }

  if (!document.getElementById('hubModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal" id="hubModal" role="dialog" aria-modal="true" aria-labelledby="hubModalTitle">
        <div class="modal-card wide">
          <div class="modal-heading"><div><span class="eyebrow">SMPW HUB</span><h2 id="hubModalTitle">Add SMPW Cart Hub</h2></div><button class="icon-button" id="closeHubModal" type="button" aria-label="Close">×</button></div>
          <form id="hubForm">
            <input id="hubId" type="hidden"/>
            <div class="form-grid">
              <div class="field"><label for="hubMarkerLabel">Map marker</label><input id="hubMarkerLabel" maxlength="10" placeholder="HUB1" required/></div>
              <div class="field"><label for="hubStatus">Status</label><select id="hubStatus"><option value="proposed">Proposed</option><option value="review">Needs site review</option><option value="approved">Approved</option><option value="unavailable">Not available</option></select></div>
              <div class="field full"><label for="hubName">Hub name</label><input id="hubName" maxlength="160" placeholder="Example: Downtown SMPW Cart Hub" required/></div>
              <div class="field full"><label for="hubAddress">Street address or pickup description</label><input id="hubAddress" autocomplete="street-address" maxlength="240" placeholder="Enter an address or drop the hub on the map" required/><small id="hubAddressStatus" class="hub-address-status">Pause after typing the complete address and the coordinates will update automatically.</small></div>
              <div class="field"><label for="hubLat">Latitude</label><input id="hubLat" type="number" step="any" min="-90" max="90" required/></div>
              <div class="field"><label for="hubLng">Longitude</label><input id="hubLng" type="number" step="any" min="-180" max="180" required/></div>
              <div class="field full hub-coordinate-actions"><button class="btn outline" id="hubLocateAddressButton" type="button">Refresh Address Coordinates</button><button class="btn outline" id="hubUseMapCenterButton" type="button">Use Current Map Center</button><a class="btn outline" id="hubVerifyGoogleLink" target="_blank" rel="noopener" hidden>Verify in Google Maps</a><a class="btn outline" id="hubVerifyAppleLink" target="_blank" rel="noopener" hidden>Verify in Apple Maps</a></div>
              <div class="field"><label for="hubCartCount">Carts available at hub</label><input id="hubCartCount" type="number" min="0" max="999" value="0"/></div>
              <div class="field"><label for="hubPickupHours">Pickup / return hours</label><input id="hubPickupHours" maxlength="180" placeholder="Example: 6:30 AM–7:00 PM"/></div>
              <div class="field full"><label for="hubNotes">Public planning notes</label><textarea id="hubNotes" maxlength="1800" placeholder="Pickup procedure, parking, storage entrance, responsible team, accessibility, or return instructions"></textarea></div>
            </div>
            <div class="modal-actions"><button class="btn outline" id="cancelHub" type="button">Cancel</button><button class="btn save" id="saveHubButton" type="submit">Save SMPW Hub</button></div>
          </form>
        </div>
      </div>
    `);
  }
}

function cacheElements() {
  const ids = [
    'dropLocationButton', 'addHubButton', 'dropHubButton', 'showHubs', 'showRoutes', 'fitHubsButton',
    'hubCount', 'routeCount', 'routeLocationSelect', 'routeHubSelect', 'routeModeSelect', 'routeSummary',
    'showRouteButton', 'saveRouteButton', 'routeLinks', 'routeGoogleLink', 'routeAppleLink',
    'hubDirectoryCount', 'hubList', 'hubModal', 'hubModalTitle', 'closeHubModal', 'hubForm', 'hubId',
    'hubMarkerLabel', 'hubStatus', 'hubName', 'hubAddress', 'hubAddressStatus', 'hubLat', 'hubLng',
    'hubLocateAddressButton', 'hubUseMapCenterButton', 'hubVerifyGoogleLink', 'hubVerifyAppleLink',
    'hubCartCount', 'hubPickupHours', 'hubNotes', 'cancelHub', 'saveHubButton'
  ];
  els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
}

async function waitForMap() {
  if (window.__DENVER2027_SMPW_MAP__) return window.__DENVER2027_SMPW_MAP__;
  return await new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled || !value) return; settled = true; resolve(value); };
    window.addEventListener('denver2027-smpw-map-ready', event => finish(event.detail?.map), { once: true });
    const timer = setInterval(() => {
      if (window.__DENVER2027_SMPW_MAP__) {
        clearInterval(timer);
        finish(window.__DENVER2027_SMPW_MAP__);
      }
    }, 100);
  });
}
async function waitForServices() {
  if (window.__DENVER2027_SMPW_FIREBASE__) return window.__DENVER2027_SMPW_FIREBASE__;
  return await new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled || !value?.auth || !value?.db) return; settled = true; resolve(value); };
    window.addEventListener('denver2027-smpw-firebase-ready', event => finish(event.detail), { once: true });
    const timer = setInterval(() => {
      if (window.__DENVER2027_SMPW_FIREBASE__) {
        clearInterval(timer);
        finish(window.__DENVER2027_SMPW_FIREBASE__);
      }
    }, 100);
  });
}

function setHubPreview(lat, lng, pan = true) {
  if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
  clearHubPreview();
  hubPreviewMarker = L.marker([Number(lat), Number(lng)], { icon: hubPreviewIcon(), zIndexOffset: 1200 }).addTo(map);
  if (pan) map.setView([Number(lat), Number(lng)], Math.max(map.getZoom(), 16), { animate: true });
}
function clearHubPreview() {
  if (hubPreviewMarker && map) map.removeLayer(hubPreviewMarker);
  hubPreviewMarker = null;
}
function setDropMode(mode) {
  if (!requireAdmin() || !map) return;
  dropMode = dropMode === mode ? null : mode;
  map.getContainer().classList.toggle('smpw-drop-active', Boolean(dropMode));
  els.dropLocationButton?.classList.toggle('active', dropMode === 'location');
  els.dropHubButton?.classList.toggle('active', dropMode === 'hub');
  if (dropMode === 'location') toast('Tap the map where the SMPW cart should be placed. The nearest address will be generated automatically.');
  else if (dropMode === 'hub') toast('Tap the map where carts will be picked up. The nearest address will be generated automatically.');
  else toast('Map-drop mode cancelled.');
}
function cancelDropMode() {
  dropMode = null;
  map?.getContainer().classList.remove('smpw-drop-active');
  els.dropLocationButton?.classList.remove('active');
  els.dropHubButton?.classList.remove('active');
}

async function throttleGeocoder() {
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
  if (wait) await sleep(wait);
  lastGeocodeRequestAt = Date.now();
}
async function fetchJsonWithTimeout(url, timeoutMs = GEOCODE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Address search returned ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
function conciseReverseAddress(result, lat, lng) {
  const address = result?.address || {};
  const streetName = address.road || address.pedestrian || address.residential || address.footway || address.path || '';
  const street = [address.house_number, streetName].filter(Boolean).join(' ');
  const city = address.city || address.town || address.village || address.municipality || address.suburb || address.county || '';
  const parts = [street, city, address.state, address.postcode].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : clean(result?.display_name) || `Map point at ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}
async function reverseGeocodePoint(lat, lng) {
  await throttleGeocoder();
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', Number(lat).toFixed(7));
  url.searchParams.set('lon', Number(lng).toFixed(7));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  const result = await fetchJsonWithTimeout(url);
  return { address: conciseReverseAddress(result, lat, lng), displayName: result?.display_name || '' };
}
async function forwardGeocodeAddress(address) {
  await throttleGeocoder();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', address);
  const results = await fetchJsonWithTimeout(url);
  if (!Array.isArray(results) || !results.length) throw new Error('No address match was found.');
  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    address: conciseReverseAddress(results[0], results[0].lat, results[0].lon),
    displayName: results[0].display_name || address
  };
}

async function handleMapDrop(event) {
  if (!dropMode) return;
  const mode = dropMode;
  cancelDropMode();
  if (mode === 'location') await openDroppedLocation(event.latlng.lat, event.latlng.lng);
  else await openHubModal(null, { lat: event.latlng.lat, lng: event.latlng.lng, reverse: true });
}
async function openDroppedLocation(lat, lng) {
  if (!requireAdmin()) return;
  document.getElementById('addLocationButton')?.click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (document.getElementById('smpwLocationModal')?.classList.contains('open')) break;
    await sleep(30);
  }
  const latInput = document.getElementById('locationLat');
  const lngInput = document.getElementById('locationLng');
  const addressInput = document.getElementById('locationAddress');
  const addressStatus = document.getElementById('addressStatus');
  const saveButton = document.getElementById('saveLocationButton');
  if (!latInput || !lngInput || !addressInput) return;
  latInput.value = Number(lat).toFixed(6);
  lngInput.value = Number(lng).toFixed(6);
  lngInput.dispatchEvent(new Event('input', { bubbles: true }));
  addressInput.value = '';
  if (addressStatus) {
    addressStatus.textContent = 'Finding the nearest street address for the dropped map point…';
    addressStatus.dataset.state = 'working';
  }
  if (saveButton) saveButton.disabled = true;
  try {
    const result = await reverseGeocodePoint(lat, lng);
    addressInput.value = result.address;
    if (addressStatus) {
      addressStatus.textContent = `Address generated from the map point: ${result.address}. Confirm the preview marker and edit the description if needed.`;
      addressStatus.dataset.state = 'success';
    }
    toast('The SMPW location was dropped on the map and its address was generated.');
  } catch (error) {
    if (addressStatus) {
      addressStatus.textContent = `The map point was saved in the coordinates, but the address could not be generated: ${friendlyError(error)} Enter the address manually.`;
      addressStatus.dataset.state = 'error';
    }
    toast('The coordinates were placed, but the address must be entered manually.', true);
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

function nextHubLabel() {
  const used = new Set(hubs.map(hub => clean(hub.markerLabel).toUpperCase()).filter(Boolean));
  let number = 1;
  while (used.has(`HUB${number}`)) number += 1;
  return `HUB${number}`;
}
function updateHubVerifyLinks() {
  const point = {
    name: clean(els.hubName.value) || 'SMPW cart hub',
    address: clean(els.hubAddress.value),
    lat: Number(els.hubLat.value),
    lng: Number(els.hubLng.value)
  };
  const valid = Number.isFinite(point.lat) && Number.isFinite(point.lng);
  els.hubVerifyGoogleLink.hidden = !valid;
  els.hubVerifyAppleLink.hidden = !valid;
  if (valid) {
    els.hubVerifyGoogleLink.href = googleSearch(point);
    els.hubVerifyAppleLink.href = appleSearch(point);
  }
}
async function openHubModal(id = null, draft = null) {
  if (!requireAdmin()) return;
  clearTimeout(hubGeocodeTimer);
  clearHubPreview();
  els.hubForm.reset();
  els.hubId.value = '';
  els.hubMarkerLabel.value = nextHubLabel();
  els.hubStatus.value = 'proposed';
  els.hubCartCount.value = '0';
  els.hubAddressStatus.textContent = 'Pause after typing the complete address and the coordinates will update automatically.';
  els.hubAddressStatus.dataset.state = 'waiting';
  const record = id ? hubs.find(item => item.id === id) : null;
  if (record) {
    els.hubModalTitle.textContent = 'Edit SMPW Cart Hub';
    els.hubId.value = record.id;
    els.hubMarkerLabel.value = record.markerLabel || '';
    els.hubStatus.value = record.status || 'proposed';
    els.hubName.value = record.name || '';
    els.hubAddress.value = record.address || '';
    els.hubLat.value = record.lat;
    els.hubLng.value = record.lng;
    els.hubCartCount.value = Number(record.cartCount) || 0;
    els.hubPickupHours.value = record.pickupHours || '';
    els.hubNotes.value = record.notes || '';
    setHubPreview(record.lat, record.lng, false);
  } else {
    els.hubModalTitle.textContent = 'Add SMPW Cart Hub';
    const center = draft || map.getCenter();
    els.hubLat.value = Number(center.lat).toFixed(6);
    els.hubLng.value = Number(center.lng).toFixed(6);
    setHubPreview(center.lat, center.lng, Boolean(draft));
  }
  updateHubVerifyLinks();
  els.hubModal.classList.add('open');
  setTimeout(() => els.hubName.focus(), 50);
  if (draft?.reverse) {
    els.hubAddress.value = '';
    els.hubAddressStatus.textContent = 'Finding the nearest street address for the dropped hub point…';
    els.hubAddressStatus.dataset.state = 'working';
    els.saveHubButton.disabled = true;
    try {
      const result = await reverseGeocodePoint(draft.lat, draft.lng);
      els.hubAddress.value = result.address;
      els.hubAddressStatus.textContent = `Address generated from the dropped hub point: ${result.address}. Confirm or edit it before saving.`;
      els.hubAddressStatus.dataset.state = 'success';
      toast('The SMPW hub was dropped on the map and its address was generated.');
    } catch (error) {
      els.hubAddressStatus.textContent = `The hub coordinates are ready, but the address could not be generated: ${friendlyError(error)} Enter the address manually.`;
      els.hubAddressStatus.dataset.state = 'error';
      toast('The hub coordinates were placed, but the address must be entered manually.', true);
    } finally {
      els.saveHubButton.disabled = false;
    }
  }
}
function closeHubModal() {
  els.hubModal.classList.remove('open');
  clearTimeout(hubGeocodeTimer);
  hubGeocodeRevision += 1;
  clearHubPreview();
}
function scheduleHubGeocode() {
  clearTimeout(hubGeocodeTimer);
  hubGeocodeRevision += 1;
  els.hubLat.value = '';
  els.hubLng.value = '';
  clearHubPreview();
  updateHubVerifyLinks();
  const address = clean(els.hubAddress.value);
  els.hubAddressStatus.textContent = address.length >= 8 ? 'Waiting for you to finish typing the address…' : 'Enter the complete street address, city, state, and ZIP.';
  els.hubAddressStatus.dataset.state = 'waiting';
  if (address.length >= 12) {
    const revision = hubGeocodeRevision;
    hubGeocodeTimer = setTimeout(() => locateHubAddress(true, revision), GEOCODE_DELAY_MS);
  }
}
async function locateHubAddress(automatic = false, scheduledRevision = null) {
  const address = clean(els.hubAddress.value);
  if (address.length < 8) {
    if (!automatic) toast('Enter the complete hub address first.', true);
    return;
  }
  const revision = scheduledRevision ?? ++hubGeocodeRevision;
  els.hubLocateAddressButton.disabled = true;
  els.hubLocateAddressButton.textContent = 'Locating…';
  els.hubAddressStatus.textContent = 'Locating the hub address and updating its map coordinates…';
  els.hubAddressStatus.dataset.state = 'working';
  try {
    const result = await forwardGeocodeAddress(address);
    if (revision !== hubGeocodeRevision) return;
    if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) throw new Error('The address search returned invalid coordinates.');
    els.hubLat.value = result.lat.toFixed(6);
    els.hubLng.value = result.lng.toFixed(6);
    els.hubAddressStatus.textContent = `Matched address: ${result.displayName}. Confirm the preview marker before saving.`;
    els.hubAddressStatus.dataset.state = 'success';
    setHubPreview(result.lat, result.lng, true);
    updateHubVerifyLinks();
    if (!automatic) toast('Hub address coordinates updated.');
  } catch (error) {
    if (revision !== hubGeocodeRevision) return;
    els.hubAddressStatus.textContent = `Could not locate the hub address automatically: ${friendlyError(error)} Use the map center or enter coordinates manually.`;
    els.hubAddressStatus.dataset.state = 'error';
    if (!automatic) toast(`Could not locate the hub address: ${friendlyError(error)}`, true);
  } finally {
    els.hubLocateAddressButton.disabled = false;
    els.hubLocateAddressButton.textContent = 'Refresh Address Coordinates';
  }
}
function useHubMapCenter() {
  const center = map.getCenter();
  els.hubLat.value = center.lat.toFixed(6);
  els.hubLng.value = center.lng.toFixed(6);
  els.hubAddressStatus.textContent = 'Current map-center coordinates copied. Confirm the marker is at the cart pickup entrance.';
  els.hubAddressStatus.dataset.state = 'success';
  setHubPreview(center.lat, center.lng, false);
  updateHubVerifyLinks();
  toast('Hub coordinates copied from the current map center.');
}
async function saveHub(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const lat = Number(els.hubLat.value);
  const lng = Number(els.hubLng.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    toast('Locate the hub address or enter valid latitude and longitude coordinates.', true);
    return;
  }
  const id = clean(els.hubId.value);
  const ref = id ? doc(db, 'halls', id) : doc(collection(db, 'halls'));
  els.saveHubButton.disabled = true;
  els.saveHubButton.textContent = 'Saving…';
  try {
    await setDoc(ref, {
      recordType: 'smpw-hub',
      markerLabel: clean(els.hubMarkerLabel.value).toUpperCase(),
      name: clean(els.hubName.value),
      address: clean(els.hubAddress.value),
      lat,
      lng,
      status: els.hubStatus.value,
      cartCount: Math.max(0, Math.min(999, Number(els.hubCartCount.value) || 0)),
      pickupHours: clean(els.hubPickupHours.value),
      notes: clean(els.hubNotes.value),
      updatedByEmail: currentUser.email,
      updatedAt: serverTimestamp(),
      ...(id ? {} : { createdByEmail: currentUser.email, createdAt: serverTimestamp() })
    }, { merge: true });
    selectedHubId = ref.id;
    closeHubModal();
    toast(id ? 'SMPW hub updated.' : 'SMPW hub added.');
  } catch (error) {
    toast(`Could not save the SMPW hub: ${friendlyError(error)}`, true);
  } finally {
    els.saveHubButton.disabled = false;
    els.saveHubButton.textContent = 'Save SMPW Hub';
  }
}
async function deleteHub(id) {
  if (!requireAdmin()) return;
  const hub = hubs.find(item => item.id === id);
  if (!hub) return;
  const assigned = locations.filter(location => clean(location.smpwHubId) === id);
  const message = assigned.length
    ? `Delete hub “${hub.name}”? This will also clear the saved hub assignment from ${assigned.length} SMPW location${assigned.length === 1 ? '' : 's'}.`
    : `Delete hub “${hub.name}”?`;
  if (!confirm(message)) return;
  try {
    await Promise.all([
      deleteDoc(doc(db, 'halls', id)),
      ...assigned.map(location => setDoc(doc(db, 'halls', location.id), {
        smpwHubId: '', smpwTravelMode: '', updatedByEmail: currentUser.email, updatedAt: serverTimestamp()
      }, { merge: true }))
    ]);
    if (selectedHubId === id) selectedHubId = null;
    if (activeRoute?.hubId === id) activeRoute = null;
    toast('SMPW hub deleted and its saved route assignments cleared.');
  } catch (error) {
    toast(`Could not delete the SMPW hub: ${friendlyError(error)}`, true);
  }
}

function hubPopup(record) {
  return `<div class="popup-title">${escapeHtml(record.markerLabel || 'HUB')} — ${escapeHtml(record.name)}</div><div class="popup-sub">${escapeHtml(record.address)}${record.cartCount ? `<br>${escapeHtml(record.cartCount)} cart${Number(record.cartCount) === 1 ? '' : 's'} available` : ''}${record.pickupHours ? `<br>Pickup / return: ${escapeHtml(record.pickupHours)}` : ''}</div><div class="popup-actions"><a href="${googleSearch(record)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(record)}" target="_blank" rel="noopener">Apple Maps</a></div>`;
}
function renderHubs() {
  if (!map) return;
  hubLayer.clearLayers();
  hubMarkers.clear();
  for (const hub of hubs) {
    const marker = L.marker([hub.lat, hub.lng], { icon: hubIcon(hub, hub.id === selectedHubId), title: hub.name, zIndexOffset: 650 }).addTo(hubLayer);
    marker.bindPopup(hubPopup(hub));
    marker.on('click', () => selectHub(hub.id, false));
    hubMarkers.set(hub.id, marker);
  }
  updateCounts();
}
function selectHub(id, pan = true) {
  const hub = hubs.find(item => item.id === id);
  if (!hub) return;
  selectedHubId = id;
  renderHubs();
  renderHubList();
  if (pan) map.setView([hub.lat, hub.lng], Math.max(map.getZoom(), 15), { animate: true });
  hubMarkers.get(id)?.openPopup();
}
function renderHubList() {
  if (!els.hubList) return;
  els.hubDirectoryCount.textContent = `${hubs.length} shown`;
  if (!hubs.length) {
    els.hubList.innerHTML = '<div class="empty">No SMPW hubs have been added yet.</div>';
    return;
  }
  els.hubList.innerHTML = hubs.map(hub => `
    <article class="smpw-hub-row${hub.id === selectedHubId ? ' active' : ''}" data-hub-id="${escapeHtml(hub.id)}">
      <div class="smpw-hub-row-icon">${hubSvg()}<em>${escapeHtml(hub.markerLabel || 'HUB')}</em></div>
      <div><strong>${escapeHtml(hub.name)}</strong><small>${escapeHtml(hub.address)}</small><small>${hub.cartCount ? `${escapeHtml(hub.cartCount)} cart${Number(hub.cartCount) === 1 ? '' : 's'} • ` : ''}${hub.pickupHours ? escapeHtml(hub.pickupHours) : 'Pickup hours not entered'}</small>
        <div class="smpw-hub-links"><a href="${googleSearch(hub)}" target="_blank" rel="noopener">Google Maps</a><a href="${appleSearch(hub)}" target="_blank" rel="noopener">Apple Maps</a></div>
        ${isAdmin() ? `<div class="smpw-hub-actions"><button type="button" data-edit-hub="${escapeHtml(hub.id)}">Edit</button><button type="button" class="danger" data-delete-hub="${escapeHtml(hub.id)}">Delete</button></div>` : ''}
      </div>
    </article>`).join('');
  els.hubList.querySelectorAll('[data-hub-id]').forEach(row => row.addEventListener('click', event => {
    if (event.target.closest('a,button')) return;
    selectHub(row.dataset.hubId, true);
  }));
  els.hubList.querySelectorAll('[data-edit-hub]').forEach(button => button.addEventListener('click', () => openHubModal(button.dataset.editHub)));
  els.hubList.querySelectorAll('[data-delete-hub]').forEach(button => button.addEventListener('click', () => deleteHub(button.dataset.deleteHub)));
}

function savedRouteForLocation(location) {
  const hub = hubs.find(item => item.id === clean(location.smpwHubId));
  if (!hub) return null;
  return { location, hub, mode: normalizedRouteMode(location.smpwTravelMode) };
}
function routeKey(route) { return `${route.location.id}|${route.hub.id}|${normalizedRouteMode(route.mode)}`; }
function drawRoute(route, highlighted = false) {
  const mode = normalizedRouteMode(route.mode);
  const color = routeColor(mode);
  const line = L.polyline([[route.hub.lat, route.hub.lng], [route.location.lat, route.location.lng]], {
    color,
    weight: highlighted ? 5 : 3,
    opacity: highlighted ? .95 : .62,
    dashArray: highlighted ? '3 9' : '2 10',
    lineCap: 'round'
  }).addTo(routeLayer);
  const distance = distanceMiles(route.hub, route.location);
  line.bindPopup(`<div class="popup-title">${escapeHtml(route.hub.markerLabel || 'HUB')} → ${escapeHtml(route.location.markerLabel || 'S')}</div><div class="popup-sub">${escapeHtml(routeModeLabel(mode))} planning route • ${escapeHtml(formatMiles(distance))} straight-line<br>${escapeHtml(route.hub.name)} to ${escapeHtml(route.location.name)}</div><div class="popup-actions"><a href="${googleDirections(route.hub, route.location, mode)}" target="_blank" rel="noopener">Google Directions</a><a href="${appleDirections(route.hub, route.location, mode)}" target="_blank" rel="noopener">Apple Directions</a></div>`);
  L.marker([route.location.lat, route.location.lng], {
    icon: routeArrowIcon(route.hub, route.location, mode, highlighted),
    interactive: false,
    zIndexOffset: 580
  }).addTo(routeLayer);
}
function renderRoutes() {
  if (!map) return;
  routeLayer.clearLayers();
  const savedRoutes = locations.map(savedRouteForLocation).filter(Boolean);
  const active = activeRoute && locations.find(item => item.id === activeRoute.locationId) && hubs.find(item => item.id === activeRoute.hubId)
    ? {
        location: locations.find(item => item.id === activeRoute.locationId),
        hub: hubs.find(item => item.id === activeRoute.hubId),
        mode: normalizedRouteMode(activeRoute.mode)
      }
    : null;
  const activeKey = active ? routeKey(active) : '';
  for (const route of savedRoutes) drawRoute(route, routeKey(route) === activeKey);
  if (active && !savedRoutes.some(route => routeKey(route) === activeKey)) drawRoute(active, true);
  updateCounts();
}
function populateRouteSelectors() {
  if (!els.routeLocationSelect) return;
  const previousLocation = els.routeLocationSelect.value || activeRoute?.locationId || '';
  const previousHub = els.routeHubSelect.value || activeRoute?.hubId || '';
  els.routeLocationSelect.innerHTML = '<option value="">Choose a cart location…</option>' + locations.map(location => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.markerLabel || 'S')} — ${escapeHtml(location.name)}</option>`).join('');
  els.routeHubSelect.innerHTML = '<option value="">Choose a hub…</option>' + hubs.map(hub => `<option value="${escapeHtml(hub.id)}">${escapeHtml(hub.markerLabel || 'HUB')} — ${escapeHtml(hub.name)}</option>`).join('');
  if (locations.some(item => item.id === previousLocation)) els.routeLocationSelect.value = previousLocation;
  if (hubs.some(item => item.id === previousHub)) els.routeHubSelect.value = previousHub;
  const selectedLocation = locations.find(item => item.id === els.routeLocationSelect.value);
  if (selectedLocation?.smpwHubId && hubs.some(item => item.id === selectedLocation.smpwHubId) && !els.routeHubSelect.value) {
    els.routeHubSelect.value = selectedLocation.smpwHubId;
    els.routeModeSelect.value = normalizedRouteMode(selectedLocation.smpwTravelMode);
  }
  updateRoutePlanner(false);
}
function updateRoutePlanner(showOnMap = true) {
  const location = locations.find(item => item.id === els.routeLocationSelect.value);
  const hub = hubs.find(item => item.id === els.routeHubSelect.value);
  const mode = normalizedRouteMode(els.routeModeSelect.value);
  els.saveRouteButton.hidden = !isAdmin();
  if (!location || !hub) {
    activeRoute = null;
    els.routeLinks.hidden = true;
    els.routeSummary.textContent = !locations.length ? 'Add an SMPW cart location first.' : !hubs.length ? 'Add an SMPW hub first.' : 'Choose both a cart location and a pickup hub.';
    renderRoutes();
    return;
  }
  activeRoute = { locationId: location.id, hubId: hub.id, mode };
  const distance = distanceMiles(hub, location);
  const saved = clean(location.smpwHubId) === hub.id && normalizedRouteMode(location.smpwTravelMode) === mode;
  els.routeSummary.innerHTML = `<strong>${escapeHtml(hub.markerLabel || 'HUB')} — ${escapeHtml(hub.name)}</strong> to <strong>${escapeHtml(location.markerLabel || 'S')} — ${escapeHtml(location.name)}</strong><br>${escapeHtml(routeModeLabel(mode))} • ${escapeHtml(formatMiles(distance))} straight-line${saved ? ' • Saved assignment' : ' • Preview only'}`;
  els.routeGoogleLink.href = googleDirections(hub, location, mode);
  els.routeAppleLink.href = appleDirections(hub, location, mode);
  els.routeLinks.hidden = false;
  renderRoutes();
  if (showOnMap && map) map.fitBounds([[hub.lat, hub.lng], [location.lat, location.lng]], { padding: [70, 70], maxZoom: 15 });
}
async function saveRouteAssignment() {
  if (!requireAdmin()) return;
  const location = locations.find(item => item.id === els.routeLocationSelect.value);
  const hub = hubs.find(item => item.id === els.routeHubSelect.value);
  const mode = normalizedRouteMode(els.routeModeSelect.value);
  if (!location || !hub) { toast('Choose both an SMPW cart location and a hub.', true); return; }
  els.saveRouteButton.disabled = true;
  els.saveRouteButton.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'halls', location.id), {
      smpwHubId: hub.id,
      smpwHubLabel: hub.markerLabel || '',
      smpwTravelMode: mode,
      updatedByEmail: currentUser.email,
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast(`Saved ${routeModeLabel(mode)} directions from ${hub.name} to ${location.name}.`);
  } catch (error) {
    toast(`Could not save the hub route: ${friendlyError(error)}`, true);
  } finally {
    els.saveRouteButton.disabled = false;
    els.saveRouteButton.textContent = 'Save Route Assignment';
  }
}
function fitHubsAndRoutes() {
  const points = [...hubs.map(item => [item.lat, item.lng])];
  for (const location of locations) {
    if (hubs.some(hub => hub.id === clean(location.smpwHubId))) points.push([location.lat, location.lng]);
  }
  if (!points.length) { toast('Add a hub or save a hub-to-cart route first.', true); return; }
  map.fitBounds(points, { padding: [50, 50], maxZoom: 14 });
}
function syncLayer(checkbox, layer) {
  if (!map) return;
  if (checkbox.checked) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else if (map.hasLayer(layer)) map.removeLayer(layer);
}
function updateCounts() {
  if (els.hubCount) els.hubCount.textContent = hubs.length;
  if (els.routeCount) els.routeCount.textContent = locations.filter(location => hubs.some(hub => hub.id === clean(location.smpwHubId))).length;
}

function subscribeRecords() {
  if (unsubscribeRecords) unsubscribeRecords();
  unsubscribeRecords = onSnapshot(collection(db, 'halls'), snapshot => {
    const nextLocations = [];
    const nextHubs = [];
    snapshot.forEach(item => {
      const data = item.data();
      const lat = Number(data.lat);
      const lng = Number(data.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (data.recordType === 'smpw-location') nextLocations.push({ id: item.id, ...data, lat, lng });
      if (data.recordType === 'smpw-hub') nextHubs.push({ id: item.id, ...data, lat, lng });
    });
    locations = nextLocations.sort((a, b) => clean(a.markerLabel).localeCompare(clean(b.markerLabel), undefined, { numeric: true }));
    hubs = nextHubs.sort((a, b) => clean(a.markerLabel).localeCompare(clean(b.markerLabel), undefined, { numeric: true }));
    if (selectedHubId && !hubs.some(item => item.id === selectedHubId)) selectedHubId = null;
    renderHubs();
    renderHubList();
    populateRouteSelectors();
    renderRoutes();
    updateCounts();
  }, error => toast(`SMPW hubs and routes could not be loaded: ${friendlyError(error)}`, true));
}
function updateAuthUi() {
  const admin = isAdmin();
  els.dropLocationButton.hidden = !admin;
  els.addHubButton.hidden = !admin;
  els.dropHubButton.hidden = !admin;
  els.saveRouteButton.hidden = !admin;
  renderHubList();
}

function wireEvents() {
  els.dropLocationButton.addEventListener('click', () => setDropMode('location'));
  els.addHubButton.addEventListener('click', () => openHubModal());
  els.dropHubButton.addEventListener('click', () => setDropMode('hub'));
  els.showHubs.addEventListener('change', () => syncLayer(els.showHubs, hubLayer));
  els.showRoutes.addEventListener('change', () => syncLayer(els.showRoutes, routeLayer));
  els.fitHubsButton.addEventListener('click', fitHubsAndRoutes);
  els.routeLocationSelect.addEventListener('change', () => {
    const location = locations.find(item => item.id === els.routeLocationSelect.value);
    if (location?.smpwHubId && hubs.some(hub => hub.id === location.smpwHubId)) {
      els.routeHubSelect.value = location.smpwHubId;
      els.routeModeSelect.value = normalizedRouteMode(location.smpwTravelMode);
    }
    updateRoutePlanner(true);
  });
  els.routeHubSelect.addEventListener('change', () => updateRoutePlanner(true));
  els.routeModeSelect.addEventListener('change', () => updateRoutePlanner(true));
  els.showRouteButton.addEventListener('click', () => updateRoutePlanner(true));
  els.saveRouteButton.addEventListener('click', saveRouteAssignment);
  els.closeHubModal.addEventListener('click', closeHubModal);
  els.cancelHub.addEventListener('click', closeHubModal);
  els.hubModal.addEventListener('click', event => { if (event.target === els.hubModal) closeHubModal(); });
  els.hubForm.addEventListener('submit', saveHub);
  els.hubAddress.addEventListener('input', scheduleHubGeocode);
  els.hubName.addEventListener('input', updateHubVerifyLinks);
  els.hubLat.addEventListener('input', () => {
    updateHubVerifyLinks();
    const lat = Number(els.hubLat.value), lng = Number(els.hubLng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setHubPreview(lat, lng, false);
  });
  els.hubLng.addEventListener('input', () => {
    updateHubVerifyLinks();
    const lat = Number(els.hubLat.value), lng = Number(els.hubLng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setHubPreview(lat, lng, false);
  });
  els.hubLocateAddressButton.addEventListener('click', () => locateHubAddress(false));
  els.hubUseMapCenterButton.addEventListener('click', useHubMapCenter);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && dropMode) cancelDropMode(); });
}

async function initialize() {
  injectUi();
  cacheElements();
  wireEvents();
  map = await waitForMap();
  hubLayer.addTo(map);
  routeLayer.addTo(map);
  map.on('click', handleMapDrop);
  const services = await waitForServices();
  auth = services.auth;
  db = services.db;
  onAuthStateChanged(auth, user => { currentUser = user; updateAuthUi(); });
  subscribeRecords();
}

initialize().catch(error => toast(`SMPW hub and route tools could not start: ${friendlyError(error)}`, true));

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, writeBatch, serverTimestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from '../bus-access/data.js?v=foxfield-congregations-20261111-1';
import { CONGREGATIONS, CONGREGATION_SOURCE } from './congregations-data.mjs?v=homes-20261113-1';
import { HOME_POINTS } from './home-points.mjs?v=homes-20261113-1';
import {homeFor, addressKey, validPoint, distanceMiles, rankCongregations, suggestionsFor, groupHomes, addressPayload, findAddress} from './location-model.mjs?v=homes-20261113-1';
import {initCongregationLocations} from './location-ui.mjs?v=homes-20261113-1';

import {createDriveTimes} from './drive-times.mjs?v=homes-20261113-1';
import {downloadAssignmentWorkbook} from './excel-export.mjs?v=homes-20261113-1';

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
const BASE_LOCATIONS = HALLS.map(hall => ({
  ...hall,
  id: String(hall.id),
  markerLabel: String(hall.number),
  locationType: 'kingdom-hall',
  customLocation: false
}));

let app;
let auth;
let db;
let map;
let boundaryLayer;
let currentUser = null;
let locations = [...BASE_LOCATIONS];
let selectedMeetingPointId = '';
let nearestMeetingPointId = '';
let assignmentsUnsubscribe = null;
let publicReady=false, locationUi;
const addressProfiles = new Map();

const publicLocationData = new Map();
const assignments = new Map();
const markers = new Map();
const selectedCongregations = new Set();
const drives=createDriveTimes({onChange:()=>renderCongregationList()});
const driveState=(c,id)=>drives.state(resolveHome(c),locations.find(p=>p.id===id));
const loadDrives=(id,retry=false)=>drives.ensure(CONGREGATIONS.map(resolveHome),locations.find(p=>p.id===id),{retry});
async function requireEligible(congregations,destination){
  await drives.ensure(congregations.map(resolveHome),destination);
  const blocked=congregations.filter(c=>!driveState(c,destination.id).allowed);
  if(blocked.length)throw Error(`${blocked.length} congregation${blocked.length===1?' is':'s are'} over 1 hr 20 min or still need a verified address / travel time. Review the travel-time flags before assigning.`);
}

const els = {
  searchInput: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  meetingFilter: document.getElementById('meetingFilter'),
  stats: document.getElementById('stats'),
  assignmentDestination: document.getElementById('assignmentDestination'),
  congregationList: document.getElementById('congregationList'),
  visibleCount: document.getElementById('visibleCount'),
  meetingPointList: document.getElementById('meetingPointList'),
  meetingPointCount: document.getElementById('meetingPointCount'),
  selectedPointTitle: document.getElementById('selectedPointTitle'),
  selectedPointCount: document.getElementById('selectedPointCount'),
  selectedPointDetail: document.getElementById('selectedPointDetail'),
  selectedPointCongregations: document.getElementById('selectedPointCongregations'),
  selectedPointActions: document.getElementById('selectedPointActions'),
  filterToPointButton: document.getElementById('filterToPointButton'),
  openPointMapLink: document.getElementById('openPointMapLink'),
  signedOutNote: document.getElementById('signedOutNote'),
  adminControls: document.getElementById('adminControls'),
  selectionCount: document.getElementById('selectionCount'),
  selectAllShownButton: document.getElementById('selectAllShownButton'),
  clearSelectionButton: document.getElementById('clearSelectionButton'),
  assignSelectedButton: document.getElementById('assignSelectedButton'),
  unassignSelectedButton: document.getElementById('unassignSelectedButton'),
  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),
  loginButton: document.getElementById('loginButton'),
  signOutButton: document.getElementById('signOutButton'),
  loginModal: document.getElementById('loginModal'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  toast: document.getElementById('toast')
};

function clean(value = '') {
  return String(value ?? '').trim();
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function isAdmin() {
  return currentUser?.email?.toLowerCase() === ADMIN_EMAIL;
}

function markerLabel(location) {
  return clean(location.markerLabel || location.number || 'M');
}

function locationTypeLabel(location) {
  if (location.locationType === 'meeting-area') return 'Other meeting area';
  if (location.customLocation) return 'Added Kingdom Hall';
  return 'Current Kingdom Hall';
}

function assignmentDocumentId(congregationId) {
  return `congregation-${String(congregationId).toLowerCase()}`;
}

function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => { els.toast.className = 'toast'; }, 3800);
}

function friendlyError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'The email or password is not correct.';
  if (code.includes('permission-denied')) return 'Firebase denied this change. Confirm the administrator sign-in and published Firestore rules.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'The network or Firebase service is temporarily unavailable.';
  if (code.includes('unauthorized-domain')) return 'Add letdesignworks.github.io under Firebase Authentication → Settings → Authorized domains.';
  return error?.message?.replace(/^Firebase:\s*/, '') || 'Unknown error';
}

function normalizeAddress(address = '') {
  return String(address)
    .toLowerCase()
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bcircle\b/g, 'cir')
    .replace(/\btrail\b/g, 'trl')
    .replace(/\s+/g, ' ')
    .replace(/[.,#]/g, '')
    .trim();
}

function streetAddressKey(address = '') {
  return normalizeAddress(String(address).split(',')[0]);
}

function homeLocationFor(congregation) {
  const key = addressKey(resolveHome(congregation).address);
  return key ? locations.find(location => addressKey(location.address) === key) || null : null;
}

function resolveHome(congregation){return homeFor(congregation,addressProfiles.get(congregation.id),[...locations,...HOME_POINTS]);}

function normalizeCustomLocation(id, data) {
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  if (data.customLocation !== true || !validPoint(data.lat,data.lng)) return null;
  const congregations = Array.isArray(data.congregations) ? data.congregations.map(clean).filter(Boolean) : [];
  return {
    id: String(id),
    markerLabel: clean(data.markerLabel || data.number || 'M'),
    number: clean(data.markerLabel || data.number || 'M'),
    name: clean(data.name || 'Added meeting point'),
    address: clean(data.address || ''),
    lat,
    lng,
    congregations,
    congregationCount: congregations.length,
    locationType: data.locationType === 'meeting-area' ? 'meeting-area' : 'kingdom-hall',
    planningArea: data.planningArea || 'other',
    customLocation: true
  };
}

function rebuildLocations() {
  const custom = [];
  for (const [id, data] of publicLocationData.entries()) {
    const location = normalizeCustomLocation(id, data);
    if (location) custom.push(location);
  }
  custom.sort((a, b) => markerLabel(a).localeCompare(markerLabel(b), undefined, { numeric: true }));
  locations = [...BASE_LOCATIONS, ...custom];
  populateMeetingPointOptions();
  syncMarkers();
  renderMeetingPointList();
  renderSelectedMeetingPoint();
}

function assignmentFor(congregationId) {
  return assignments.get(String(congregationId)) || null;
}

function meetingPointForAssignment(assignment) {
  if (!assignment) return null;
  return locations.find(location => location.id === String(assignment.meetingPointId)) || null;
}

function assignedCongregationsAt(locationId) {
  return CONGREGATIONS.filter(congregation => assignmentFor(congregation.id)?.meetingPointId === String(locationId));
}

function assignedCountAt(locationId) {
  let count = 0;
  for (const assignment of assignments.values()) {
    if (String(assignment.meetingPointId) === String(locationId)) count += 1;
  }
  return count;
}

function meetingPointIcon(location) {
  const count = assignedCountAt(location.id);
  const selected = location.id === selectedMeetingPointId;
  const className = location.locationType === 'meeting-area'
    ? 'meeting-area'
    : (location.customLocation ? 'added-hall' : '');
  return L.divIcon({
    className: '',
    html: `<div class="meeting-map-pin ${className}${selected ? ' selected' : ''}">
      <span>${escapeHtml(markerLabel(location))}</span>
      ${count ? `<span class="assignment-count">${count}</span>` : ''}
    </div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -20]
  });
}

function initMap() {
  if (!window.L) {
    document.getElementById('map').innerHTML = '<div style="padding:24px">The map library could not load. The congregation assignment list remains available.</div>';
    return;
  }

  map = L.map('map', { zoomControl: true, attributionControl: true }).setView(DTC, 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  boundaryLayer = L.polygon(DTC_BOUNDARY, {
    color: '#0b4da2',
    weight: 2.5,
    dashArray: '9 7',
    fillColor: '#4d9cdb',
    fillOpacity: .035,
    interactive: false
  }).addTo(map);

  L.marker(DTC, {
    icon: L.divIcon({
      className: '',
      html: '<div class="center-star">★</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    })
  }).addTo(map).bindPopup('<div class="popup-title">DTC Center Point</div><div class="popup-sub">I-25 & E. Belleview Avenue</div>');

  map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
  syncMarkers();
}

function syncMarkers() {
  if (!map) return;
  const active = new Set(locations.map(location => location.id));

  for (const [id, marker] of markers.entries()) {
    if (!active.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }

  for (const location of locations) {
    let marker = markers.get(location.id);
    const count = assignedCountAt(location.id);
    const tooltip = `${markerLabel(location)} — ${location.name} • ${count} assigned`;

    if (!marker) {
      marker = L.marker([location.lat, location.lng], { icon: meetingPointIcon(location) }).addTo(map);
      marker.on('click', () => selectMeetingPoint(location.id, true));
      marker.bindTooltip(escapeHtml(tooltip), { direction: 'top', offset: [0, -16] });
      markers.set(location.id, marker);
    } else {
      marker.setLatLng([location.lat, location.lng]);
      marker.setIcon(meetingPointIcon(location));
      marker.setTooltipContent(escapeHtml(tooltip));
    }
  }
}

function sortedLocations() {
  return [...locations].sort((a, b) => markerLabel(a).localeCompare(markerLabel(b), undefined, { numeric: true }));
}

function optionGroup(label, items) {
  if (!items.length) return '';
  return `<optgroup label="${escapeHtml(label)}">${items.map(location =>
    `<option value="${escapeHtml(location.id)}">${escapeHtml(markerLabel(location))} — ${escapeHtml(location.name)}</option>`
  ).join('')}</optgroup>`;
}

function populateMeetingPointOptions() {
  const previousDestination = els.assignmentDestination.value;
  const previousFilter = els.meetingFilter.value;

  const base = sortedLocations().filter(location => !location.customLocation);
  const addedHalls = sortedLocations().filter(location => location.customLocation && location.locationType !== 'meeting-area');
  const meetingAreas = sortedLocations().filter(location => location.locationType === 'meeting-area');

  const groupedOptions =
    optionGroup('Current Kingdom Halls', base) +
    optionGroup('Added Kingdom Halls', addedHalls) +
    optionGroup('Other meeting areas', meetingAreas);

  els.assignmentDestination.innerHTML =
    '<option value="">Choose a Kingdom Hall or meeting area…</option>' + groupedOptions;

  els.meetingFilter.innerHTML =
    '<option value="all">All meeting points</option>' +
    '<option value="unassigned">Unassigned congregations</option>' +
    groupedOptions;

  if ([...els.assignmentDestination.options].some(option => option.value === previousDestination)) {
    els.assignmentDestination.value = previousDestination;
  } else if (selectedMeetingPointId && [...els.assignmentDestination.options].some(option => option.value === selectedMeetingPointId)) {
    els.assignmentDestination.value = selectedMeetingPointId;
  }

  if ([...els.meetingFilter.options].some(option => option.value === previousFilter)) {
    els.meetingFilter.value = previousFilter;
  } else {
    els.meetingFilter.value = 'all';
  }
}

function selectMeetingPoint(id, pan = false, keepFilters = false) {
  const location = locations.find(item => item.id === String(id));
  if (!location) return;

  selectedMeetingPointId = location.id;
  nearestMeetingPointId = location.id;
  void loadDrives(location.id);
  if(!keepFilters){els.searchInput.value='';els.statusFilter.value='all';els.meetingFilter.value='all';document.getElementById('addressFilter').value='all';}
  if (isAdmin()) els.assignmentDestination.value = location.id;
  syncMarkers();
  renderMeetingPointList();
  renderSelectedMeetingPoint();

  locationUi?.meetingPointChosen(location);
  renderCongregationList();
  if (pan && map) {
    const nearest=filteredCongregations().map(c=>resolveHome(c).point).filter(Boolean).slice(0,10);
    map.fitBounds([[location.lat,location.lng],...nearest.map(p=>[p.lat,p.lng])],{padding:[55,55],maxZoom:13});
    markers.get(location.id)?.openTooltip();
  }
}

function renderSelectedMeetingPoint() {
  const location = locations.find(item => item.id === selectedMeetingPointId);
  if (!location) {
    els.selectedPointTitle.textContent = 'Select a meeting point';
    els.selectedPointCount.textContent = '0 assigned';
    els.selectedPointDetail.textContent = 'Tap a marker or choose a meeting point below to see its assignment list.';
    els.selectedPointCongregations.innerHTML = '';
    els.selectedPointActions.hidden = true;
    return;
  }

  const assigned = assignedCongregationsAt(location.id);
  els.selectedPointTitle.textContent = `${markerLabel(location)} — ${location.name}`;
  els.selectedPointCount.textContent = `${assigned.length} assigned`;
  els.selectedPointDetail.innerHTML = `<strong>${escapeHtml(locationTypeLabel(location))}</strong><span class="address">${escapeHtml(location.address || 'Saved map coordinates')}</span>`;
  els.selectedPointCongregations.innerHTML = assigned.length
    ? assigned.map(congregation => `<div class="assigned-name">${escapeHtml(congregation.name)}</div>`).join('')
    : '<div class="empty-list">No congregations have been assigned to this meeting point.</div>';
  els.selectedPointActions.hidden = false;
  els.openPointMapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address || `${location.lat},${location.lng}`)}`;
}

function renderMeetingPointList() {
  const points = sortedLocations();
  els.meetingPointCount.textContent = `${points.length} points`;
  els.meetingPointList.innerHTML = points.map(location => {
    const count = assignedCountAt(location.id);
    const markerClass = location.locationType === 'meeting-area'
      ? 'meeting'
      : (location.customLocation ? 'added' : '');
    return `<button class="meeting-point-row${location.id === selectedMeetingPointId ? ' active' : ''}" type="button" data-point="${escapeHtml(location.id)}">
      <span class="point-marker ${markerClass}">${escapeHtml(markerLabel(location))}</span>
      <span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.address || locationTypeLabel(location))}</small></span>
      <span class="point-count${count ? ' has-assignments' : ''}">${count}</span>
    </button>`;
  }).join('');

  els.meetingPointList.querySelectorAll('[data-point]').forEach(button => {
    button.addEventListener('click', () => selectMeetingPoint(button.dataset.point, true));
  });
}

function filteredCongregations() {
  const query = clean(els.searchInput.value).toLowerCase();
  const status = els.statusFilter.value;
  const meeting = els.meetingFilter.value;

  const visible = CONGREGATIONS.filter(congregation => {
    const assignment = assignmentFor(congregation.id);
    const point = meetingPointForAssignment(assignment);
    const isAssigned = Boolean(assignment);

    const home=resolveHome(congregation), addressFilter=document.getElementById('addressFilter').value;
    if(addressFilter!=='all'&&home.status!==addressFilter)return false;
    if (status === 'assigned' && !isAssigned) return false;
    if (status === 'unassigned' && isAssigned) return false;
    if (meeting === 'unassigned' && isAssigned) return false;
    if (meeting !== 'all' && meeting !== 'unassigned' && String(assignment?.meetingPointId) !== meeting) return false;

    if (!query) return true;
    return [
      congregation.name,
      congregation.sourceName,
      home.address,
      congregation.number,
      congregation.language,
      assignment?.meetingPointName,
      assignment?.meetingPointAddress,
      point?.name,
      point?.address
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  const reference=locations.find(p=>p.id===nearestMeetingPointId);
  return rankCongregations(visible,reference,resolveHome);
}

function renderStats() {
  const total = CONGREGATIONS.length;
  const assigned = CONGREGATIONS.filter(congregation => assignmentFor(congregation.id)).length;
  const unassigned = total - assigned;
  const percent = total ? Math.round((assigned / total) * 100) : 0;

  els.stats.innerHTML = `
    <span class="stat">${total} congregations</span>
    <span class="stat assigned">${assigned} assigned</span>
    <span class="stat unassigned">${unassigned} unassigned</span>
    ${selectedCongregations.size ? `<span class="stat">${selectedCongregations.size} selected</span>` : ''}
  `;
  els.progressBar.style.width = `${percent}%`;
  els.progressText.textContent = `${assigned} of ${total} assigned (${percent}%)`;
}

function renderSelectionControls() {
  const count = selectedCongregations.size;
  const blocked=[...selectedCongregations].map(id=>CONGREGATIONS.find(c=>c.id===id)).filter(c=>!driveState(c,els.assignmentDestination.value).allowed);
  document.getElementById('selectionTravelStatus').hidden=!blocked.length;
  document.getElementById('selectionTravelStatus').textContent=blocked.length?`${blocked.length} selected need a travel-time check or exceed 1 hr 20 min. Change the meeting point or remove them from the selection.`:'';
  els.selectionCount.textContent = `${count} selected`;
  els.assignSelectedButton.disabled = !isAdmin() || !publicReady || count === 0 || !els.assignmentDestination.value || blocked.length>0;
  els.unassignSelectedButton.disabled = !isAdmin() || !publicReady || count === 0;
  els.clearSelectionButton.disabled = count === 0;
  renderStats();
}

function renderCongregationList() {
  const visible = filteredCongregations();
  els.visibleCount.textContent = `${visible.length} shown`;
  const near=locations.find(p=>p.id===nearestMeetingPointId);
  document.getElementById('directoryOrder').textContent=near?'Closest to '+markerLabel(near)+' — '+near.name+' · straight-line distance; addresses without pins appear last.':'Alphabetical order. Select a meeting point to list congregations nearest to it.';
  document.getElementById('clearNearestSort').hidden=!near;
  const travelPoint=locations.find(p=>p.id===selectedMeetingPointId);
  const times=travelPoint?CONGREGATIONS.map(c=>driveState(c,travelPoint.id)):[];
  document.getElementById('driveTimeStatus').textContent=travelPoint?`To ${travelPoint.name}: ${times.filter(t=>t.status==='within').length} within 1 hr 20 min · ${times.filter(t=>t.status==='over').length} over limit · ${times.filter(t=>!['within','over'].includes(t.status)).length} need a check. Road estimates exclude live traffic, stops and bus delays.`:'Select a meeting point to check the 1 hr 20 min drive-time limit.';
  document.getElementById('retryDriveTimes').hidden=!travelPoint;

  els.congregationList.innerHTML = visible.map(congregation => {
    const assignment = assignmentFor(congregation.id);
    const point = meetingPointForAssignment(assignment);
    const homeLocation = homeLocationFor(congregation);
    const home = resolveHome(congregation);
    const addressLabels={missing:'Missing address', 'pin-needed':'Address needs map pin', review:'Address needs review', mapped:'Address mapped'};
    const assigned = Boolean(assignment);
    const selected = selectedCongregations.has(congregation.id);
    const travel=driveState(congregation,selectedMeetingPointId);

    const assignmentName = point?.name || assignment?.meetingPointName || 'Assigned location not found';
    const assignmentLabel = point ? markerLabel(point) : assignment?.meetingPointLabel || '';
    const assignmentAddress = point?.address || assignment?.meetingPointAddress || '';

    return `<div class="congregation-row${assigned ? ' assigned' : ''}${selected ? ' selected' : ''}${travel.status==='over'?' over-limit':''}" data-congregation="${escapeHtml(congregation.id)}">
      <input type="checkbox" aria-label="Select ${escapeHtml(congregation.name)}" data-select="${escapeHtml(congregation.id)}" ${selected ? 'checked' : ''} ${isAdmin()&&(selected||!selectedMeetingPointId||travel.allowed) ? '' : 'disabled'}>
      <div class="congregation-main">
        <button class="congregation-name" data-open-home="${escapeHtml(congregation.id)}" type="button">${escapeHtml(congregation.name)}</button>
        <small>${escapeHtml([congregation.number?"No. "+congregation.number:"",congregation.language].filter(Boolean).join(" · "))}</small>
        <small>Current congregation address: ${escapeHtml(home.address||"Not provided")}</small>
        ${near?`<small class="proximity-chip">${home.point?distanceMiles(home.point,near).toFixed(1)+' mi to this meeting point (straight-line)':'Distance unavailable — add an address and map pin'}</small>`:''}
        <span class="address-chip ${home.status}">${addressLabels[home.status]}</span>
        ${selectedMeetingPointId?`<small class="travel-chip ${travel.status}">${escapeHtml(travel.label)}</small>`:''}
        <button class="text-button" data-edit-home="${escapeHtml(congregation.id)}" type="button">${home.address?"Edit address / pin":"Add address"}</button>
        ${homeLocation ? `<small class="home-map-chip">Home Hall on map: ${escapeHtml(markerLabel(homeLocation))} — ${escapeHtml(homeLocation.name)}</small>` : ''}
      </div>
      <div class="assignment-status">
        <span class="status-chip ${assigned ? 'assigned' : 'unassigned'}">${assigned ? 'Assigned' : 'Unassigned'}</span>
        ${assigned ? `<strong>${escapeHtml(assignmentLabel ? `${assignmentLabel} — ${assignmentName}` : assignmentName)}</strong><small>${escapeHtml(assignmentAddress)}</small>` : '<small>No meeting point selected</small>'}
      </div>
    </div>`;
  }).join('') || '<div class="no-results">No congregations match the current filters.</div>';

  els.congregationList.querySelectorAll('[data-select]').forEach(checkbox => {
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedCongregations.add(checkbox.dataset.select);
      else selectedCongregations.delete(checkbox.dataset.select);
      checkbox.closest('.congregation-row')?.classList.toggle('selected', checkbox.checked);
      renderSelectionControls();
      locationUi?.render();
    });
  });

  els.congregationList.querySelectorAll('[data-congregation]').forEach(row => {
    row.addEventListener('click', event => {
      if (event.target.closest('input,button,a,select')) return;
      const id = row.dataset.congregation;
      locationUi?.select(id,true);
    });
  });

  els.congregationList.querySelectorAll('[data-open-home]').forEach(button=>button.addEventListener('click',()=>locationUi?.select(button.dataset.openHome,true)));
  els.congregationList.querySelectorAll('[data-edit-home]').forEach(button=>button.addEventListener('click',()=>locationUi?.edit(button.dataset.editHome)));
  renderStats();
  renderSelectionControls();
  locationUi?.render();
}

function renderAll() {
  renderCongregationList();
  renderMeetingPointList();
  renderSelectedMeetingPoint();
  syncMarkers();
}

async function assignSelected() {
  if (!isAdmin()) {
    openLogin();
    return;
  }

  if(!publicReady){toast('Wait for shared assignment data before saving.',true);return;}
  const destination = locations.find(location => location.id === els.assignmentDestination.value);
  if (!destination) {
    toast('Choose a meeting point before assigning congregations.', true);
    return;
  }
  if (!selectedCongregations.size) {
    toast('Select at least one congregation.', true);
    return;
  }

  const selected = CONGREGATIONS.filter(congregation => selectedCongregations.has(congregation.id));
  try{await requireEligible(selected,destination);}catch(error){toast(error.message,true);return;}
  const batch = writeBatch(db);
  const nowFields = {
    recordType: 'congregation-assignment',
    meetingPointId: destination.id,
    meetingPointLabel: markerLabel(destination),
    meetingPointName: destination.name,
    meetingPointAddress: destination.address || '',
    meetingPointType: destination.locationType,
    assigned: true,
    updatedByEmail: currentUser.email,
    updatedAt: serverTimestamp()
  };

  for (const congregation of selected) {
    batch.set(doc(db, 'halls', assignmentDocumentId(congregation.id)), {
      ...nowFields,
      congregationId: congregation.id,
      congregationName: congregation.name,
      sourceName: congregation.sourceName,
      homeAddress: resolveHome(congregation).address
    }, { merge: true });
  }

  els.assignSelectedButton.disabled = true;
  els.assignSelectedButton.textContent = 'Saving…';
  try {
    await batch.commit();
    selectedCongregations.clear();
    renderCongregationList();
    selectedMeetingPointId = destination.id;
    toast(`${selected.length} congregation${selected.length === 1 ? '' : 's'} assigned to ${markerLabel(destination)} — ${destination.name}.`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    els.assignSelectedButton.textContent = 'Assign Selected';
    renderSelectionControls();
  }
}

async function clearSelectedAssignments() {
  if (!isAdmin()) {
    openLogin();
    return;
  }
  if(!publicReady){toast('Wait for shared assignment data before clearing assignments.',true);return;}
  const selected = CONGREGATIONS.filter(congregation => selectedCongregations.has(congregation.id));
  const assignedSelected = selected.filter(congregation => assignmentFor(congregation.id));
  if (!assignedSelected.length) {
    toast('None of the selected congregations currently has an assignment.', true);
    return;
  }

  if (!confirm(`Clear the meeting-point assignment for ${assignedSelected.length} congregation${assignedSelected.length === 1 ? '' : 's'}?`)) return;

  const batch = writeBatch(db);
  for (const congregation of assignedSelected) {
    batch.delete(doc(db, 'halls', assignmentDocumentId(congregation.id)));
  }

  els.unassignSelectedButton.disabled = true;
  els.unassignSelectedButton.textContent = 'Clearing…';
  try {
    await batch.commit();
    selectedCongregations.clear();
    toast(`${assignedSelected.length} congregation assignment${assignedSelected.length === 1 ? '' : 's'} cleared.`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    els.unassignSelectedButton.textContent = 'Clear Selected Assignments';
    renderSelectionControls();
  }
}

function selectAllShown() {
  if (!isAdmin()) {
    openLogin();
    return;
  }
  for (const congregation of filteredCongregations()) if(!selectedMeetingPointId||driveState(congregation,selectedMeetingPointId).allowed) selectedCongregations.add(congregation.id);
  renderCongregationList();
}

function clearSelection() {
  selectedCongregations.clear();
  renderCongregationList();
}

function updateAuthUi() {
  const admin = isAdmin();
  els.loginButton.hidden = Boolean(currentUser);
  els.signOutButton.hidden = !currentUser;
  els.adminControls.hidden = !admin;
  els.signedOutNote.hidden = admin;

  if (currentUser && !admin) {
    els.signedOutNote.hidden = false;
    els.signedOutNote.textContent = `Signed in as ${currentUser.email}. This account has view-only access.`;
  } else if (!currentUser) {
    els.signedOutNote.textContent = 'Sign in to select congregations and save meeting-point assignments.';
  }

  if (!admin) selectedCongregations.clear();
  renderCongregationList();
}

function openLogin() {
  els.loginModal.classList.add('open');
  setTimeout(() => els.loginPassword.focus(), 50);
}

function closeLogin() {
  els.loginModal.classList.remove('open');
}

function subscribeToPublicData() {
  if (assignmentsUnsubscribe) assignmentsUnsubscribe();
  assignmentsUnsubscribe = onSnapshot(collection(db, 'halls'), {includeMetadataChanges:true}, snapshot => {
    publicLocationData.clear();
    assignments.clear();
    addressProfiles.clear();
    publicReady=!snapshot.metadata.fromCache;

    snapshot.forEach(item => {
      const data = item.data();
      if (data.recordType === 'congregation-assignment' && data.congregationId) {
        assignments.set(String(data.congregationId), { id: item.id, ...data });
      } else if(data.recordType==='congregation-address' && data.congregationId){
        addressProfiles.set(String(data.congregationId),data);
      } else {
        publicLocationData.set(item.id, data);
      }
    });

    document.getElementById('sharedDataStatus').textContent=snapshot.metadata.fromCache?'Showing cached shared data. Reconnect before saving changes.':'Shared assignments and address edits are up to date.';
    rebuildLocations();
    renderAll();
    if(selectedMeetingPointId)void loadDrives(selectedMeetingPointId);
  }, error => {
    publicReady=false;locationUi?.render();
    document.getElementById('sharedDataStatus').textContent='Shared data could not load. Saved assignments and address edits may be unavailable. Refresh to retry.';
    toast(`Assignment information could not be loaded: ${friendlyError(error)}`, true);
  });
}

document.getElementById('clearNearestSort').addEventListener('click',()=>{nearestMeetingPointId='';renderCongregationList();});
document.getElementById('addressFilter').addEventListener('change',renderCongregationList);
els.searchInput.addEventListener('input', renderCongregationList);
els.statusFilter.addEventListener('change', renderCongregationList);
els.meetingFilter.addEventListener('change', () => {
  const value = els.meetingFilter.value;
  if (value !== 'all' && value !== 'unassigned') selectMeetingPoint(value, true, true);
  renderCongregationList();
});
els.assignmentDestination.addEventListener('change', () => {
  const value = els.assignmentDestination.value;
  if (value) selectMeetingPoint(value, true);
  renderSelectionControls();
});
els.selectAllShownButton.addEventListener('click', selectAllShown);
els.clearSelectionButton.addEventListener('click', clearSelection);
els.assignSelectedButton.addEventListener('click', assignSelected);
els.unassignSelectedButton.addEventListener('click', clearSelectedAssignments);
els.filterToPointButton.addEventListener('click', () => {
  if (!selectedMeetingPointId) return;
  els.meetingFilter.value = selectedMeetingPointId;
  renderCongregationList();
});
els.loginButton.addEventListener('click', openLogin);
document.getElementById('cancelLogin').addEventListener('click', closeLogin);
els.loginModal.addEventListener('click', event => {
  if (event.target === els.loginModal) closeLogin();
});
els.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value);
    els.loginPassword.value = '';
    closeLogin();
    toast('Administrator signed in.');
  } catch (error) {
    toast(friendlyError(error), true);
  }
});
document.getElementById('resetPassword').addEventListener('click', async () => {
  try {
    await sendPasswordResetEmail(auth, els.loginEmail.value.trim() || ADMIN_EMAIL);
    toast('Password reset email sent.');
  } catch (error) {
    toast(friendlyError(error), true);
  }
});
els.signOutButton.addEventListener('click', async () => {
  await signOut(auth);
  toast('Signed out.');
});

initMap();
locationUi=initCongregationLocations({map,congregations:CONGREGATIONS,source:CONGREGATION_SOURCE,getLocations:()=>locations,resolveHome,getProfile:id=>addressProfiles.get(id),getAssignment:assignmentFor,getStatuses:()=>publicLocationData,isReady:()=>publicReady,isAdmin,openLogin,refresh:renderAll,getVisible:filteredCongregations,getSelected:()=>selectedCongregations,getMeetingPoint:()=>selectedMeetingPointId,driveState,loadDrives,saveAddress,saveAssignment,escapeHtml,toast,selectMeetingPoint});
populateMeetingPointOptions();
renderAll();

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, user => {
    currentUser = user;
    updateAuthUi();
  });
  subscribeToPublicData();
} catch (error) {
  toast(`Firebase could not initialize: ${friendlyError(error)}`, true);
}


async function saveAddress(congregation,values,version){
  if(!isAdmin()||!db||!publicReady)throw Error('Sign in and wait for shared data before saving.');
  const payload=addressPayload(congregation,values.address,values.lat,values.lng);
  const ref=doc(db,'halls','congregation-address-'+congregation.id.toLowerCase());
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(ref),current=snap.exists()?snap.data():{};
    if((current.addressVersion||0)!==version)throw Error('This address was changed elsewhere. Close and reopen the editor to review the latest address.');
    transaction.set(ref,{...payload,addressVersion:version+1,updatedAt:serverTimestamp(),updatedByEmail:currentUser.email},{merge:true});
  });
}
async function saveAssignment(congregation,pointId){
  if(!isAdmin()||!db||!publicReady)throw Error('Sign in and wait for shared data before saving.');
  const destination=locations.find(p=>p.id===pointId);if(!destination)throw Error('Choose an available meeting point.');
  await requireEligible([congregation],destination);
  const batch=writeBatch(db);
  batch.set(doc(db,'halls',assignmentDocumentId(congregation.id)),{recordType:'congregation-assignment',meetingPointId:destination.id,meetingPointLabel:markerLabel(destination),meetingPointName:destination.name,meetingPointAddress:destination.address||'',meetingPointType:destination.locationType,assigned:true,congregationId:congregation.id,congregationName:congregation.name,sourceName:congregation.sourceName,homeAddress:resolveHome(congregation).address,updatedByEmail:currentUser.email,updatedAt:serverTimestamp()},{merge:true});
  await batch.commit();
}

document.getElementById('retryDriveTimes').addEventListener('click',()=>{void loadDrives(selectedMeetingPointId,true);});
document.getElementById('showSelectedHomes').addEventListener('click',()=>locationUi?.fitSelected());
document.getElementById('exportAssignments').addEventListener('click',async()=>{
  const button=document.getElementById('exportAssignments');button.disabled=true;button.textContent='Preparing Excel…';
  try{
    const point=locations.find(p=>p.id===selectedMeetingPointId);
    await loadDrives(selectedMeetingPointId);
    downloadAssignmentWorkbook({congregations:CONGREGATIONS,visible:filteredCongregations(),selected:selectedCongregations,locations,resolveHome,assignmentFor,driveState,point,sharedReady:publicReady});
    toast('Excel export ready. It includes the current directory, all congregations, selections and meeting points.');
  }catch(error){toast('Excel export failed: '+error.message,true);}finally{button.disabled=false;button.textContent='Export Excel';}
});

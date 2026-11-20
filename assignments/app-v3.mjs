import {initHostingPlanner} from './hosting-app.mjs?v=daily-hosting-20261120-1';
import {isApprovedMeeting} from './hosting-model.mjs';
import {mountMeetingListToggle} from './meeting-list-toggle.mjs';
import {SERVICE_DAYS,SERVICE_DAYS_TYPE,readServiceDays,serviceDaysId,serviceDaysPayload,serviceDaysLabel} from './service-days-model.mjs';
import {createServiceDaysEditor} from './service-days-ui.mjs';
import {withMeetingStatus,tagMeetingIcon} from '../assets/meeting-suitability-model.mjs';
import {loadRail} from '../assets/rail-network.mjs';
import {railMeetingPoints} from '../assets/rail-meeting-points.mjs';
import {createTravelRegister} from '../assets/travel-register-ui.mjs?v=visual-20261115-1';
import {catalog as travelCatalog,CENTERS} from '../assets/planning-common.mjs?v=suitability-20261115-1';
import {addLandmarkReferences} from '../assets/landmark-markers.mjs?v=landmark-size-20261115-1';
import {canEdit, canView, isOwner, observeSiteAccess} from '../assets/site-access.mjs?v=access-20261114-1';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, getDocFromServer, collection, doc, onSnapshot, query, where, writeBatch, serverTimestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from '../bus-access/data.js?v=foxfield-congregations-20261111-1';
import { CONGREGATIONS, CONGREGATION_SOURCE } from './congregations-data.mjs?v=homes-20261113-1';
import { HOME_POINTS } from './home-points.mjs?v=homes-20261113-1';
import {homeFor, addressKey, validPoint, distanceMiles, rankCongregations, suggestionsFor, groupHomes, addressPayload, findAddress} from './location-model.mjs?v=daily-hosting-20261120-1';
import {initCongregationLocations,focusMapPoint} from './location-ui.mjs?v=daily-hosting-20261120-1';

import {createDriveTimes,prepareAssignmentDrives} from './drive-times.mjs?v=travel-override-20261115-1';
import {downloadAssignmentWorkbook} from './excel-export.mjs?v=assigned-travel-20261115-1';
import {buildAssignmentReport} from './report-model.mjs?v=reports-20261115-1';
import {createAssignmentReport} from './report-ui.mjs?v=reports-20261115-1';
import {printAssignmentReport} from './report-pdf.mjs?v=reports-20261115-1';

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
let centerMarker;
let focusedMeetingPointId='';
let currentUser = null;
let railLocations=[],railLoading=false;
let locations = [...BASE_LOCATIONS];
let selectedMeetingPointId = '';
let nearestMeetingPointId = '';
let assignmentsUnsubscribe = null;
let publicReady=false, locationUi, hostingPlanner;
function approvedDestination(point){return Boolean(point)&&isApprovedMeeting(withMeetingStatus(point.id,{...point,...publicLocationData.get(String(point.id))}));}
function hostingData(){return {ready:publicReady,congregations:CONGREGATIONS.map(c=>({...c,home:resolveHome(c)})),locations:locations.map(p=>withMeetingStatus(p.id,{...p,...publicLocationData.get(String(p.id)),id:String(p.id)})),centers:CENTERS,assignments:[...assignments].map(([id,a])=>({...a,congregationId:id}))};}
let reportDataLoaded=false, reportDataError='', excelExportBusy=false, pdfExportBusy=false;
const addressProfiles = new Map();

const publicLocationData = new Map();
const assignments = new Map();
const markers = new Map();
const selectedCongregations = new Set();
const serviceDayProfiles=new Map();let serviceDayFocus='',serviceDaysSupported=false,serviceDayAccessRevision=0;
const serviceDaysFor=id=>readServiceDays(serviceDayProfiles.get(id));
const canSaveServiceDays=()=>isAdmin()&&(isOwner()||serviceDaysSupported);
const serviceDayUi=createServiceDaysEditor(document.getElementById('serviceDaysCard'),{save:async(list,days)=>{
 if(!canSaveServiceDays()||!publicReady)throw Error('Sign in and wait for current shared data before saving days.');
 const batch=writeBatch(db);for(const c of list)batch.set(doc(db,'halls',serviceDaysId(c.id)),{...serviceDaysPayload(c,days),updatedAt:serverTimestamp()});await batch.commit();for(const c of list)serviceDayProfiles.set(c.id,serviceDaysPayload(c,days));renderAll();
}});
function renderServiceDays(){serviceDayUi.update({congregations:CONGREGATIONS,selected:[...selectedCongregations],focus:serviceDayFocus,profiles:serviceDayProfiles,canEdit:canSaveServiceDays(),ready:publicReady,needsRules:isAdmin()&&!isOwner()&&!serviceDaysSupported});}
async function checkServiceDaysAccess(){const token=++serviceDayAccessRevision;serviceDaysSupported=isOwner();renderServiceDays();if(!db||!isAdmin()||isOwner())return;try{await getDocFromServer(doc(db,'siteAccessCapabilities','serviceDaysV1'));if(token===serviceDayAccessRevision)serviceDaysSupported=true;}catch{}if(token===serviceDayAccessRevision)renderServiceDays();}
const revealedCongregations=new Set();let assignmentBusy=false,selectionRevision=0,travelRevision=0,travelUnsubscribers=[],travelRecords=[];
const routeRegister=createTravelRegister(document.getElementById('assignmentTravelRegister'));
function updateTravelRegister(){routeRegister.update({records:travelRecords,locations:[...travelCatalog([...publicLocationData].map(([id,data])=>({...data,id}))),...railLocations],congregations:CONGREGATIONS,access:canView('routes')});}
function subscribeTravelRegister(){
 const token=++travelRevision;travelUnsubscribers.forEach(f=>f());travelUnsubscribers=[];travelRecords=[];updateTravelRegister();
 if(!db||!canView('routes'))return;const lists=new Map();
 for(const type of ['bus-route','route-plan'])travelUnsubscribers.push(onSnapshot(query(collection(db,'reviews'),where('recordType','==',type)),snapshot=>{if(token!==travelRevision)return;lists.set(type,snapshot.docs.map(d=>({...d.data(),id:d.id})));travelRecords=[...lists.values()].flat();updateTravelRegister();},error=>{if(token!==travelRevision)return;lists.delete(type);travelRecords=[...lists.values()].flat();updateTravelRegister();toast('Travel route register could not load: '+error.message,true);}));
}
function selectFromMap(id){
 revealedCongregations.add(id);
 if(isAdmin()){if(selectedCongregations.has(id))selectedCongregations.delete(id);else selectedCongregations.add(id);}
 renderCongregationList();
}
const drives=createDriveTimes({onChange:()=>renderCongregationList()});
const driveState=(c,id)=>drives.state(resolveHome(c),locations.find(p=>p.id===id));
let travelOverridePointId='';
function travelOverrideEnabled(pointId){return Boolean(pointId)&&isAdmin()&&publicReady&&travelOverridePointId===String(pointId);}
function canAssignTravel(travel,pointId){return travel.allowed||(travel.status==='over'&&travelOverrideEnabled(pointId));}
function setTravelOverride(pointId,enabled){
 if(assignmentBusy||!isAdmin()||!publicReady)return;
 if(enabled&&!locations.some(p=>p.id===String(pointId)))return;
 travelOverridePointId=enabled?String(pointId):'';selectionRevision++;renderCongregationList();
}
const availableMeetingPoints=()=>locations.filter(approvedDestination);
function mapTravelState(c){
 if(selectedMeetingPointId)return driveState(c,selectedMeetingPointId);
 if(!reportDataLoaded||railLoading)return {status:'pending',allowed:false,label:'Loading meeting locations before checking travel time'};
 return drives.stateAny(resolveHome(c),availableMeetingPoints());
}
function loadMeetingCoverage(retry=false){if(!reportDataLoaded||railLoading)return;return drives.ensureAny(CONGREGATIONS.map(resolveHome),availableMeetingPoints(),{retry});}
const loadDrives=(id,retry=false)=>drives.ensure(CONGREGATIONS.map(resolveHome),locations.find(p=>p.id===id),{retry});
async function requireEligible(congregations,destination){
  if(!approvedDestination(destination))throw Error('Choose a currently approved meeting point. Conditional, unsuitable and unreviewed locations cannot receive new assignments.');
  await drives.ensure(congregations.map(resolveHome),destination);
  if(!approvedDestination(destination))throw Error('This meeting point is no longer approved. Choose an approved location.');
  const blocked=congregations.filter(c=>!canAssignTravel(driveState(c,destination.id),destination.id));
  if(blocked.length)throw Error(`${blocked.length} congregation${blocked.length===1?' is':'s are'} over 1 hr 20 min or still need a verified address / travel time. Enable the travel-limit override for this meeting point to allow longer trips. Missing addresses and unavailable travel times must still be resolved.`);
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

const reportUi=createAssignmentReport(document.getElementById('assignmentReport'),{
  onChange:()=>renderAssignmentReport(), onValidityChange:()=>updateReportExportButtons()
});
function currentAssignmentReport(delegatesPerCongregation=reportUi.getValue()){
  return buildAssignmentReport({congregations:CONGREGATIONS,locations,assignmentFor,serviceDaysFor,delegatesPerCongregation,sharedReady:publicReady});
}
function updateReportExportButtons(){
  const unavailable=!reportDataLoaded||!reportUi.valid();
  document.getElementById('exportAssignments').disabled=unavailable||excelExportBusy;
  document.getElementById('exportAssignmentPdf').disabled=unavailable||pdfExportBusy;
}
function renderAssignmentReport(){
  reportUi.update(currentAssignmentReport(),{available:reportDataLoaded,unavailableMessage:reportDataError});
  updateReportExportButtons();
}
function reportExportFactor(){
  if(!reportDataLoaded)throw Error('Wait for saved assignments and service days to load before exporting.');
  return reportUi.validatedValue();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function isAdmin() { return canEdit('assignments'); }

function markerLabel(location) {
  return clean(location.markerLabel || location.number || 'M');
}

function locationTypeLabel(location) {
  if(location.locationType==='rail-station')return 'Light rail / RTD station';
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
  custom.sort((a, b) => Number(a.locationType==='rail-station')-Number(b.locationType==='rail-station')||markerLabel(a).localeCompare(markerLabel(b), undefined, { numeric: true })||a.name.localeCompare(b.name));
  locations = [...BASE_LOCATIONS, ...custom, ...railLocations];
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
  const className = location.locationType==='rail-station'?'rail-station':location.locationType === 'meeting-area'
    ? 'meeting-area'
    : (location.customLocation ? 'added-hall' : '');
  return tagMeetingIcon(L.divIcon({
    className: '',
    html: `<div class="meeting-map-pin ${className}${selected ? ' selected' : ''}">
      <span>${escapeHtml(markerLabel(location))}</span>
      ${count ? `<span class="assignment-count">${count}</span>` : ''}
    </div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -20]
  }),location);
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

  centerMarker = addLandmarkReferences(map);
  centerMarker.eachLayer(marker=>marker.on('click',()=>focusMapPoint(map,marker.getLatLng())));

  map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
  syncMarkers();
}

function syncMarkers() {
  if (!map) return;
  const visibleLocations=focusedMeetingPointId?locations.filter(p=>p.id===focusedMeetingPointId):locations.filter(p=>p.locationType!=='rail-station'||document.getElementById('showRailMeetingPoints').checked||p.id===selectedMeetingPointId);
  const active = new Set(visibleLocations.map(location => location.id));
  for(const layer of [boundaryLayer,centerMarker])if(layer){if(focusedMeetingPointId)map.removeLayer(layer);else if(!map.hasLayer(layer))layer.addTo(map);}

  for (const [id, marker] of markers.entries()) {
    if (!active.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }

  for (const location of visibleLocations) {
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

  const base = sortedLocations().filter(location => !location.customLocation&&location.locationType!=='rail-station');
  const addedHalls = sortedLocations().filter(location => location.customLocation && location.locationType !== 'meeting-area');
  const meetingAreas = sortedLocations().filter(location => location.locationType === 'meeting-area');

  const groupedOptions =
    optionGroup('Current Kingdom Halls', base) +
    optionGroup('Added Kingdom Halls', addedHalls) +
    optionGroup('Other meeting areas', meetingAreas) + optionGroup('Light rail / RTD stations',sortedLocations().filter(p=>p.locationType==='rail-station'));

  els.assignmentDestination.innerHTML =
    '<option value="">Choose an approved meeting point…</option>' + optionGroup('Current Kingdom Halls',base.filter(approvedDestination)) + optionGroup('Added Kingdom Halls',addedHalls.filter(approvedDestination)) + optionGroup('Other meeting areas',meetingAreas.filter(approvedDestination)) + optionGroup('Light rail / RTD stations',sortedLocations().filter(p=>p.locationType==='rail-station'&&approvedDestination(p)));

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

function selectMeetingPoint(id, pan = false, keepFilters = false, overview = false) {
  const location = locations.find(item => item.id === String(id));
  if (!location) return;

  if(selectedMeetingPointId!==location.id)travelOverridePointId='';
  selectedMeetingPointId = location.id;
  selectionRevision++;
  nearestMeetingPointId = location.id;
  routeRegister.meeting(location.id);
  if(focusedMeetingPointId)focusedMeetingPointId=location.id;
  void loadDrives(location.id);
  if(!keepFilters){els.searchInput.value='';els.statusFilter.value='all';els.meetingFilter.value='all';document.getElementById('addressFilter').value='all';}
  if(focusedMeetingPointId)els.meetingFilter.value=location.id;
  if (isAdmin()) els.assignmentDestination.value = approvedDestination(location)?location.id:'';
  syncMarkers();
  renderMeetingPointList();
  renderSelectedMeetingPoint();

  locationUi?.meetingPointChosen(location);
  renderCongregationList();
  renderMeetingFocus();
  if (pan && map) {
    if(overview){
      const homes=assignedCongregationsAt(location.id).map(c=>resolveHome(c).point).filter(Boolean);
      map.fitBounds([[location.lat,location.lng],...homes.map(p=>[p.lat,p.lng])],{padding:[55,55],maxZoom:13});
    }else focusMapPoint(map,location);
    markers.get(location.id)?.openTooltip();
  }
}

function focusMeetingPoint(id=selectedMeetingPointId,overview=true){
  if(!locations.some(p=>p.id===id))return;
  focusedMeetingPointId=id;
  els.searchInput.value='';els.statusFilter.value='all';els.meetingFilter.value=id;document.getElementById('addressFilter').value='all';
  selectMeetingPoint(id,true,true,overview);
  document.getElementById('map').scrollIntoView({behavior:'smooth',block:'center'});
}
function clearMeetingFocus(fit=false){
  focusedMeetingPointId='';els.meetingFilter.value='all';
  renderAll();
  if(fit&&map){
    const points=[...locations,...CONGREGATIONS.map(c=>resolveHome(c).point).filter(Boolean)].filter(p=>validPoint(p.lat,p.lng));
    if(points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[55,55],maxZoom:13});
  }
}
function renderMeetingFocus(){
  const note=document.getElementById('assignmentMapNote'),point=locations.find(p=>p.id===focusedMeetingPointId);
  note.classList.toggle('meeting-focused',Boolean(point));
  if(!point){
    note.textContent='Select a point to zoom to its area. Press Esc to clear the current selection and choose something else. Magenta homes with green check marks are assigned. Blue highlights show selections; purple homes are unassigned. Gray homes exceed 1 hr 20 min to the selected location, or to every available location when none is selected. Green lines show saved assignments; dashed purple lines show suggestions.';
    return;
  }
  const assigned=assignedCongregationsAt(point.id),mapped=assigned.filter(c=>resolveHome(c).point).length,missing=assigned.length-mapped;
  note.innerHTML='<strong>'+escapeHtml(markerLabel(point)+' — '+point.name)+'</strong><br>'+assigned.length+' assigned congregation'+(assigned.length===1?'':'s')+' · '+mapped+' with map pins'+(missing?' · '+missing+' need an address or map pin':'')+'<br>Green lines show saved assignments, not driving routes. Press Esc to leave this selection.<br><button type="button" class="text-button" id="showAllMeetingLocations">Show all locations</button>';
  document.getElementById('showAllMeetingLocations').addEventListener('click',()=>clearMeetingFocus(true));
}

function unassignButton(congregation) {
  if (!isAdmin()) return '';
  return '<button type="button" class="text-button unassign-button" data-unassign="'+escapeHtml(congregation.id)+'" aria-label="Unassign '+escapeHtml(congregation.name)+' from its meeting point" '+(publicReady?'':'disabled')+'>Unassign</button>';
}
function bindUnassignButtons(container) {
  container.querySelectorAll('[data-unassign]').forEach(button=>button.addEventListener('click',async event=>{
    event.stopPropagation();button.disabled=true;button.textContent='Unassigning…';
    try{await locationUi?.unassign(button.dataset.unassign);}
    finally{button.disabled=!isAdmin()||!publicReady;button.textContent='Unassign';}
  }));
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
  els.selectedPointDetail.innerHTML = (approvedDestination(location)?'<p>Approved for field service hosting.</p>':'<p class="hp-approval-warning">Not approved for new assignments. Review any existing congregation assignments at this location.</p>')+`<strong>${escapeHtml(locationTypeLabel(location))}</strong><span class="address">${escapeHtml(location.address || 'Saved map coordinates')}</span>${location.railNote?'<small>'+escapeHtml(location.railNote)+'</small>':''}`;
  els.selectedPointCongregations.innerHTML = assigned.length
    ? assigned.map(congregation => `<div class="assigned-name"><span>${escapeHtml(congregation.name)}</span>${unassignButton(congregation)}</div>`).join('')
    : '<div class="empty-list">No congregations have been assigned to this meeting point.</div>';
  bindUnassignButtons(els.selectedPointCongregations);
  els.selectedPointActions.hidden = false;
  els.openPointMapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address || `${location.lat},${location.lng}`)}`;
}

function renderMeetingPointList() {
  const search=clean(document.getElementById('meetingPointSearch').value).toLowerCase();
  const points = sortedLocations().filter(p=>!search||(p.name+' '+p.address+' '+(p.lines||[]).join(' ')).toLowerCase().includes(search));
  els.meetingPointCount.textContent = `${points.length} points`;
  els.meetingPointList.innerHTML = points.map(location => {
    const count = assignedCountAt(location.id);
    const markerClass = location.locationType==='rail-station'?'rail-station':location.locationType === 'meeting-area'
      ? 'meeting'
      : (location.customLocation ? 'added' : '');
    return `<button class="meeting-point-row${location.id === selectedMeetingPointId ? ' active' : ''}" type="button" data-point="${escapeHtml(location.id)}">
      <span class="point-marker ${markerClass}">${escapeHtml(markerLabel(location))}</span>
      <span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.address || locationTypeLabel(location))}${approvedDestination(location)?' · Approved':' · Not approved for new assignments'}</small></span>
      <span class="point-count${count ? ' has-assignments' : ''}">${count}</span>
    </button>`;
  }).join('');

  els.meetingPointList.querySelectorAll('[data-point]').forEach(button => {
    button.addEventListener('click', () => selectMeetingPoint(button.dataset.point, true));
  });
}

function filteredCongregations({forMap=false}={}) {
  const query = clean(els.searchInput.value).toLowerCase();
  const status = els.statusFilter.value;
  const meeting = els.meetingFilter.value;

  const visible = CONGREGATIONS.filter(congregation => {
    const assignment = assignmentFor(congregation.id);
    if(focusedMeetingPointId&&String(assignment?.meetingPointId)!==focusedMeetingPointId)return false;
    if(!forMap&&(revealedCongregations.has(congregation.id)||selectedCongregations.has(congregation.id)))return true;
    if(!forMap&&assignment&&!document.getElementById('showAssignedDirectory').checked&&!focusedMeetingPointId&&status!=='assigned'&&meeting==='all')return false;
    const point = meetingPointForAssignment(assignment);
    const isAssigned = Boolean(assignment);
    const dayFilter=document.getElementById('serviceDayFilter').value;
    if(dayFilter==='unset'&&serviceDaysFor(congregation.id).length)return false;
    if(dayFilter!=='all'&&dayFilter!=='unset'&&!serviceDaysFor(congregation.id).includes(dayFilter))return false;

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
  const ranked=rankCongregations(visible,reference,resolveHome);
  if(!forMap){const revealed=c=>revealedCongregations.has(c.id)||selectedCongregations.has(c.id);ranked.sort((a,b)=>Number(revealed(b))-Number(revealed(a)));}
  return ranked;
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
  renderServiceDays();
  const count = selectedCongregations.size;
  const pointId=els.assignmentDestination.value,selected=[...selectedCongregations].map(id=>CONGREGATIONS.find(c=>c.id===id)).filter(Boolean);
  const over=selected.filter(c=>driveState(c,pointId).status==='over'),blocked=selected.filter(c=>!canAssignTravel(driveState(c,pointId),pointId));
  const unresolved=selected.filter(c=>!['within','over'].includes(driveState(c,pointId).status));
  for(const id of ['overrideTravelLimit','mapOverrideTravelLimit']){const control=document.getElementById(id);control.checked=travelOverrideEnabled(pointId);control.disabled=!isAdmin()||!publicReady||assignmentBusy||!pointId;}
  const travelMessage=[over.length?(over.length+' selected exceed 1 hr 20 min. '+(travelOverrideEnabled(pointId)?'Override enabled for this meeting point; you can assign these congregations.':'Check “Allow assignments over 1 hr 20 min” to assign them.')):'',unresolved.length?unresolved.length+' selected still need a verified address or available travel time.':''].filter(Boolean).join(' ');
  document.getElementById('selectionTravelStatus').hidden=!travelMessage;
  document.getElementById('selectionTravelStatus').textContent=travelMessage;
  els.selectionCount.textContent = `${count} selected`;
  els.assignSelectedButton.disabled = !isAdmin() || !publicReady || count === 0 || !els.assignmentDestination.value || blocked.length>0 || !approvedDestination(locations.find(p=>p.id===pointId));
  els.unassignSelectedButton.disabled = !isAdmin() || !publicReady || count === 0;
  els.clearSelectionButton.disabled = count === 0;
  const point=locations.find(p=>p.id===els.assignmentDestination.value);
  document.getElementById('mapSelectionCount').textContent=count+' selected';
  document.getElementById('mapSelectionNames').textContent=CONGREGATIONS.filter(c=>selectedCongregations.has(c.id)).map(c=>c.name).join(' · ');
  document.getElementById('mapAssignmentDestination').textContent=point?'Assign to: '+point.name:'Click a meeting-point marker to choose the destination.';
  document.getElementById('mapAssignSelected').disabled=assignmentBusy||els.assignSelectedButton.disabled;
  document.getElementById('mapUnassignSelected').disabled=assignmentBusy||els.unassignSelectedButton.disabled;
  document.getElementById('mapAssignmentStatus').textContent=assignmentBusy?'Saving assignments…':!isAdmin()?'Sign in to select and assign congregations.':travelMessage?travelMessage:'Select one or several congregation pins, then a meeting point.';
  els.assignSelectedButton.disabled=assignmentBusy||els.assignSelectedButton.disabled;
  els.unassignSelectedButton.disabled=assignmentBusy||els.unassignSelectedButton.disabled;
  renderStats();
}

function renderCongregationList() {
  if(!selectedMeetingPointId)void loadMeetingCoverage();
  const visible = filteredCongregations();
  els.visibleCount.textContent = `${visible.length} shown`;
  const near=locations.find(p=>p.id===nearestMeetingPointId);
  document.getElementById('directoryOrder').textContent=near?'Closest to '+markerLabel(near)+' — '+near.name+' · straight-line distance; addresses without pins appear last.':'Alphabetical order. Select a meeting point to list congregations nearest to it.';
  document.getElementById('clearNearestSort').hidden=!near;
  const travelPoint=locations.find(p=>p.id===selectedMeetingPointId);
  const times=CONGREGATIONS.map(mapTravelState);
  document.getElementById('driveTimeStatus').textContent=travelPoint?`To ${travelPoint.name}: ${times.filter(t=>t.status==='within').length} within 1 hr 20 min · ${times.filter(t=>t.status==='over').length} over limit · ${times.filter(t=>!['within','over'].includes(t.status)).length} need a check. Road estimates exclude live traffic, stops and bus delays.`:`${times.filter(t=>t.status==='over').length} congregations are over 1 hr 20 min from every available meeting location and shown in gray. ${times.filter(t=>t.status==='within').length} have a location within the limit; ${times.filter(t=>!['within','over'].includes(t.status)).length} still need a check. Unsuitable locations are excluded. Road estimates exclude live traffic.`;
  document.getElementById('retryDriveTimes').hidden=!travelPoint&&!times.some(t=>t.status==='unknown');

  els.congregationList.innerHTML = visible.map(congregation => {
    const assignment = assignmentFor(congregation.id);
    const point = meetingPointForAssignment(assignment);
    const homeLocation = homeLocationFor(congregation);
    const home = resolveHome(congregation);
    const addressLabels={missing:'Missing address', 'pin-needed':'Address needs map pin', review:'Address needs review', mapped:'Address mapped'};
    const assigned = Boolean(assignment);
    const selected = selectedCongregations.has(congregation.id);
    const travel=mapTravelState(congregation);

    const assignmentName = point?.name || assignment?.meetingPointName || 'Assigned location not found';
    const assignmentLabel = point ? markerLabel(point) : assignment?.meetingPointLabel || '';
    const assignmentAddress = point?.address || assignment?.meetingPointAddress || '';

    return `<div class="congregation-row${assigned ? ' assigned' : ''}${selected ? ' selected' : ''}${travel.status==='over'?' over-limit':''}" data-congregation="${escapeHtml(congregation.id)}">
      <input type="checkbox" aria-label="Select ${escapeHtml(congregation.name)}" data-select="${escapeHtml(congregation.id)}" ${selected ? 'checked' : ''} ${isAdmin()&&(selected||!selectedMeetingPointId||canAssignTravel(travel,selectedMeetingPointId)) ? '' : 'disabled'}>
      <div class="congregation-main">
        <button class="congregation-name" data-open-home="${escapeHtml(congregation.id)}" type="button">${escapeHtml(congregation.name)}</button><span class="selection-indicator" data-selection-indicator hidden>Selected congregation</span>
        <small>${escapeHtml([congregation.number?"No. "+congregation.number:"",congregation.language].filter(Boolean).join(" · "))}</small>
        <small class="service-days-label">Service days: ${escapeHtml(serviceDaysLabel(serviceDaysFor(congregation.id)))}</small>
        <small>Current congregation address: ${escapeHtml(home.address||"Not provided")}</small>
        ${near?`<small class="proximity-chip">${home.point?distanceMiles(home.point,near).toFixed(1)+' mi to this meeting point (straight-line)':'Distance unavailable — add an address and map pin'}</small>`:''}
        <span class="address-chip ${home.status}">${addressLabels[home.status]}</span>
        ${selectedMeetingPointId||travel.status==='over'?`<small class="travel-chip ${travel.status}">${escapeHtml(travel.label)}</small>`:''}
        <button class="text-button" data-edit-home="${escapeHtml(congregation.id)}" type="button">${home.address?"Edit address / pin":"Add address"}</button>
        ${homeLocation ? `<small class="home-map-chip">Home Hall on map: ${escapeHtml(markerLabel(homeLocation))} — ${escapeHtml(homeLocation.name)}</small>` : ''}
      </div>
      <div class="assignment-status">
        <span class="status-chip ${assigned ? 'assigned' : 'unassigned'}">${assigned ? '✓ Assigned' : 'Unassigned'}</span>
        ${assigned ? `<strong>${escapeHtml(assignmentLabel ? `${assignmentLabel} — ${assignmentName}` : assignmentName)}</strong><small>${escapeHtml(assignmentAddress)}</small>${unassignButton(congregation)}` : '<small>No meeting point selected</small>'}
      </div>
    </div>`;
  }).join('') || '<div class="no-results">No congregations match the current filters.</div>';

  bindUnassignButtons(els.congregationList);
  els.congregationList.querySelectorAll('[data-select]').forEach(checkbox => {
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      selectionRevision++;
      if (checkbox.checked) selectedCongregations.add(checkbox.dataset.select);
      else selectedCongregations.delete(checkbox.dataset.select);
      checkbox.closest('.congregation-row')?.classList.toggle('selected', checkbox.checked);
      renderSelectionControls();
      locationUi?.selectionChanged(checkbox.dataset.select,checkbox.checked);
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
  if(focusedMeetingPointId&&!locations.some(p=>p.id===focusedMeetingPointId)){focusedMeetingPointId='';els.meetingFilter.value='all';}
  renderCongregationList();
  renderMeetingPointList();
  renderSelectedMeetingPoint();
  syncMarkers();
  renderMeetingFocus();
  updateTravelRegister();
  renderAssignmentReport();
  hostingPlanner?.update();
}

async function assignSelected() {
  if(assignmentBusy)return;
  if(!isAdmin()){openLogin();return;}
  if(!publicReady){toast('Wait for shared assignment data before saving.',true);return;}
  const destination=locations.find(p=>p.id===els.assignmentDestination.value);
  const selected=CONGREGATIONS.filter(c=>selectedCongregations.has(c.id));
  if(!destination||!selected.length){toast('Select congregations and a meeting point first.',true);return;}
  const revision=selectionRevision;
  assignmentBusy=true;renderSelectionControls();
  try{
    await requireEligible(selected,destination);
    if(!isAdmin()||!publicReady)throw Error('Sign in and wait for shared data before saving.');
    const batch=writeBatch(db),updates=[];
    for(const congregation of selected){const data={recordType:'congregation-assignment',meetingPointId:destination.id,meetingPointLabel:markerLabel(destination),meetingPointName:destination.name,meetingPointAddress:destination.address||'',meetingPointType:destination.locationType,assigned:true,updatedByEmail:currentUser.email,updatedAt:serverTimestamp(),congregationId:congregation.id,congregationName:congregation.name,sourceName:congregation.sourceName,homeAddress:resolveHome(congregation).address};batch.set(doc(db,'halls',assignmentDocumentId(congregation.id)),data,{merge:true});updates.push([congregation.id,data]);}
    await batch.commit();
    for(const [id,data]of updates){assignments.set(id,data);if(revision===selectionRevision){selectedCongregations.delete(id);revealedCongregations.delete(id);}}
    if(revision===selectionRevision){selectedMeetingPointId=destination.id;travelOverridePointId='';}
    toast(selected.length+' congregation'+(selected.length===1?'':'s')+' assigned to '+destination.name+'.');
  }catch(error){toast(friendlyError(error),true);}finally{assignmentBusy=false;renderAll();}
}

async function clearSelectedAssignments() {
  if(assignmentBusy)return;
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

  assignmentBusy=true;renderSelectionControls();
  els.unassignSelectedButton.disabled = true;
  els.unassignSelectedButton.textContent = 'Clearing…';
  try {
    await batch.commit();
    for(const c of assignedSelected){assignments.delete(c.id);selectedCongregations.delete(c.id);revealedCongregations.delete(c.id);}
    toast(`${assignedSelected.length} congregation assignment${assignedSelected.length === 1 ? '' : 's'} cleared.`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    assignmentBusy=false;els.unassignSelectedButton.textContent = 'Unassign Selected';
    renderAll();
  }
}

function selectAllShown() {
  if (!isAdmin()) {
    openLogin();
    return;
  }
  for (const congregation of filteredCongregations()) if(!selectedMeetingPointId||canAssignTravel(driveState(congregation,selectedMeetingPointId),selectedMeetingPointId)) selectedCongregations.add(congregation.id);
  renderCongregationList();
}

function clearSelection() {
  travelOverridePointId='';selectionRevision++;
  revealedCongregations.clear();selectedCongregations.clear();
  locationUi?.clearSelection();
  renderCongregationList();
}

function exitSelection(){
  travelOverridePointId='';selectionRevision++;
  selectedMeetingPointId='';nearestMeetingPointId='';focusedMeetingPointId='';serviceDayFocus='';
  revealedCongregations.clear();selectedCongregations.clear();
  els.assignmentDestination.value='';els.meetingFilter.value='all';
  routeRegister.meeting('');
  map?.stop?.();map?.closePopup?.();map?.closeTooltip?.();
  for(const marker of markers.values())marker.closeTooltip?.();
  locationUi?.clearSelection();
  renderAll();
}

function handleSelectionEscape(event){
  if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||event.repeat)return;
  if(els.loginModal.classList.contains('open')){
    event.preventDefault();closeLogin();els.loginButton.focus();return;
  }
  if(locationUi?.dismissEditor()){
    event.preventDefault();return;
  }
  event.preventDefault();
  exitSelection();
  document.getElementById('map').focus({preventScroll:true});
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
    addressProfiles.clear();serviceDayProfiles.clear();
    publicReady=!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites;
    reportDataLoaded=reportDataLoaded||publicReady||!snapshot.empty;
    reportDataError='';

    snapshot.forEach(item => {
      const data = item.data().recordType?item.data():withMeetingStatus(item.id,item.data());
      if(data.recordType===SERVICE_DAYS_TYPE&&data.congregationId){serviceDayProfiles.set(String(data.congregationId),data);}
      else if (data.recordType === 'congregation-assignment' && data.congregationId) {
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
    publicReady=false;locationUi?.render();hostingPlanner?.update();
    reportDataError='Saved assignments and service days could not load. Refresh to retry before exporting a report.';
    renderAssignmentReport();
    document.getElementById('sharedDataStatus').textContent='Shared data could not load. Saved assignments and address edits may be unavailable. Refresh to retry.';
    toast(`Assignment information could not be loaded: ${friendlyError(error)}`, true);
  });
}

async function loadRailMeetingPoints(){
 if(railLoading)return;railLoading=true;document.getElementById('retryRailMeetingPoints').disabled=true;
 document.getElementById('railMeetingStatus').textContent='Loading rail station meeting points…';
 try{railLocations=railMeetingPoints(await loadRail());rebuildLocations();renderAll();if(selectedMeetingPointId)void loadDrives(selectedMeetingPointId);document.getElementById('railMeetingStatus').textContent=railLocations.length+' RTD rail stations shown. A station must be marked approved before receiving new assignments.';document.getElementById('retryRailMeetingPoints').hidden=true;}
 catch(error){document.getElementById('railMeetingStatus').textContent='Rail stations could not load. Your existing assignments are retained.';document.getElementById('retryRailMeetingPoints').hidden=false;}
 finally{railLoading=false;document.getElementById('retryRailMeetingPoints').disabled=false;renderAll();}
}
document.getElementById('showRailMeetingPoints').addEventListener('change',syncMarkers);
document.getElementById('meetingPointSearch').addEventListener('input',renderMeetingPointList);
document.getElementById('retryRailMeetingPoints').addEventListener('click',loadRailMeetingPoints);
mountMeetingListToggle(document.getElementById('toggleMeetingPointList'),document.getElementById('meetingPointListContent'));
document.getElementById('serviceDayFilter').innerHTML='<option value="all">All service days</option><option value="unset">Service days not set</option>'+SERVICE_DAYS.map(d=>'<option>'+d+'</option>').join('');
document.getElementById('serviceDayFilter').addEventListener('change',renderCongregationList);
document.getElementById('showAssignedDirectory').addEventListener('change',()=>{revealedCongregations.clear();renderCongregationList();});
for(const id of ['overrideTravelLimit','mapOverrideTravelLimit'])document.getElementById(id).addEventListener('change',event=>setTravelOverride(els.assignmentDestination.value,event.target.checked));
document.getElementById('mapAssignSelected').addEventListener('click',assignSelected);
document.getElementById('mapUnassignSelected').addEventListener('click',clearSelectedAssignments);
document.getElementById('mapClearSelection').addEventListener('click',clearSelection);
document.getElementById('clearNearestSort').addEventListener('click',()=>{nearestMeetingPointId='';renderCongregationList();});
document.getElementById('addressFilter').addEventListener('change',renderCongregationList);
els.searchInput.addEventListener('input', renderCongregationList);
els.statusFilter.addEventListener('change', renderCongregationList);
els.meetingFilter.addEventListener('change', () => {
  const value = els.meetingFilter.value;
  if (value !== 'all' && value !== 'unassigned'){focusMeetingPoint(value,false);return;}
  focusedMeetingPointId='';
  renderAll();
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
els.filterToPointButton.addEventListener('click',()=>focusMeetingPoint());
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
    toast('Signed in.');
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
locationUi=initCongregationLocations({map,congregations:CONGREGATIONS,source:CONGREGATION_SOURCE,getLocations:()=>locations,getAddressPoints:()=>[...locations,...HOME_POINTS],resolveHome,getProfile:id=>addressProfiles.get(id),getAssignment:assignmentFor,getStatuses:()=>publicLocationData,isReady:()=>publicReady,isApproved:approvedDestination,isAdmin,openLogin,refresh:renderAll,getVisible:()=>filteredCongregations({forMap:true}),mapSelect:selectFromMap,getSelected:()=>selectedCongregations,onCongregationSelected:id=>{selectionRevision++;serviceDayFocus=id;renderServiceDays();},getMeetingPoint:()=>selectedMeetingPointId,getFocusedMeetingPoint:()=>focusedMeetingPointId,clearMeetingFocus,driveState,canAssignTravel,travelOverrideEnabled,setTravelOverride,mapTravelState,loadDrives,saveAddress,saveAssignment,unassignCongregation,escapeHtml,toast,selectMeetingPoint});
// Capture Escape before Leaflet consumes it while the map has keyboard focus.
document.addEventListener('keydown',handleSelectionEscape,true);
populateMeetingPointOptions();
renderAll();
void loadRailMeetingPoints();

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  hostingPlanner=initHostingPlanner({root:document.getElementById('dailyHosting'),auth,db,getData:hostingData,showMeeting:id=>{selectMeetingPoint(id,true);document.getElementById('map').scrollIntoView({behavior:'smooth',block:'center'});},showCongregation:id=>{locationUi?.select(id,true);document.getElementById('map').scrollIntoView({behavior:'smooth',block:'center'});}});
  observeSiteAccess(auth, user => {
    travelOverridePointId='';currentUser = user;
    updateAuthUi();subscribeTravelRegister();void checkServiceDaysAccess();
  });
  subscribeToPublicData();
} catch (error) {
  reportDataError='Shared data could not connect. Refresh to retry before exporting a report.';
  renderAssignmentReport();
  toast(`Firebase could not initialize: ${friendlyError(error)}`, true);
}


async function saveAddress(congregation,values,version){
  if(!isAdmin()||!db||!publicReady)throw Error('Sign in and wait for shared data before saving.');
  const payload={...addressPayload(congregation,values.address,values.lat,values.lng),pinSource:values.pinSource||'Administrator-confirmed address pin'};
  const ref=doc(db,'halls','congregation-address-'+congregation.id.toLowerCase());
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(ref),current=snap.exists()?snap.data():{};
    if((current.addressVersion||0)!==version)throw Error('This address was changed elsewhere. Close and reopen the editor to review the latest address.');
    transaction.set(ref,{...payload,addressVersion:version+1,updatedAt:serverTimestamp(),updatedByEmail:currentUser.email},{merge:true});
  });
  // The confirmed write is immediately available to the map, even before a later snapshot.
  addressProfiles.set(congregation.id,{...payload,addressVersion:version+1});
  renderAll();
  if(selectedMeetingPointId)void loadDrives(selectedMeetingPointId);
}
async function unassignCongregation(congregation){
  if(!isAdmin()||!db||!publicReady)throw Error('Sign in and wait for shared data before unassigning.');
  const expected=assignmentFor(congregation.id);
  if(!expected)return;
  const ref=doc(db,'halls',assignmentDocumentId(congregation.id));
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(ref);
    if(!snap.exists())return;
    const current=snap.data();
    if(current.recordType!=='congregation-assignment'||String(current.congregationId)!==String(congregation.id))throw Error('This record is not a congregation assignment. Refresh the page before trying again.');
    if(String(current.meetingPointId||'')!==String(expected.meetingPointId||''))throw Error('This congregation was assigned to another meeting point elsewhere. Review its current assignment before unassigning.');
    transaction.delete(ref);
  });
  // Delete only this assignment. Addresses, map pins, and meeting locations stay intact.
  if(assignmentFor(congregation.id)===expected)assignments.delete(String(congregation.id));
  selectedCongregations.delete(congregation.id);
}
async function saveAssignment(congregation,pointId){
  if(!isAdmin()||!db||!publicReady)throw Error('Sign in and wait for shared data before saving.');
  const revision=selectionRevision;
  const destination=locations.find(p=>p.id===pointId);if(!destination)throw Error('Choose an available meeting point.');
  await requireEligible([congregation],destination);
  if(!isAdmin()||!db||!publicReady)throw Error('Sign in and wait for shared data before saving.');
  const batch=writeBatch(db);
  batch.set(doc(db,'halls',assignmentDocumentId(congregation.id)),{recordType:'congregation-assignment',meetingPointId:destination.id,meetingPointLabel:markerLabel(destination),meetingPointName:destination.name,meetingPointAddress:destination.address||'',meetingPointType:destination.locationType,assigned:true,congregationId:congregation.id,congregationName:congregation.name,sourceName:congregation.sourceName,homeAddress:resolveHome(congregation).address,updatedByEmail:currentUser.email,updatedAt:serverTimestamp()},{merge:true});
  await batch.commit();
  assignments.set(congregation.id,{meetingPointId:destination.id,meetingPointName:destination.name,meetingPointAddress:destination.address||''});if(revision===selectionRevision){selectedCongregations.delete(congregation.id);revealedCongregations.delete(congregation.id);travelOverridePointId='';}renderAll();
}

document.getElementById('retryDriveTimes').addEventListener('click',()=>{if(selectedMeetingPointId)void loadDrives(selectedMeetingPointId,true);else void loadMeetingCoverage(true);});
document.getElementById('showSelectedHomes').addEventListener('click',()=>locationUi?.fitSelected());
document.getElementById('exportAssignments').addEventListener('click',async()=>{
  if(excelExportBusy)return;
  const button=document.getElementById('exportAssignments');excelExportBusy=true;updateReportExportButtons();button.textContent='Preparing Excel…';
  try{
    reportExportFactor();
    const point=locations.find(p=>p.id===selectedMeetingPointId);
    await loadDrives(selectedMeetingPointId);
    await prepareAssignmentDrives({congregations:CONGREGATIONS,locations,assignmentFor,resolveHome,drives,onProgress:(done,total)=>{button.textContent='Checking assigned travel '+done+' / '+total+'…';}});
    const delegatesPerCongregation=reportExportFactor();
    downloadAssignmentWorkbook({congregations:CONGREGATIONS,visible:filteredCongregations(),selected:selectedCongregations,locations,resolveHome,assignmentFor,driveState,point,serviceDaysFor,sharedReady:publicReady,delegatesPerCongregation});
    toast('Excel export ready. By meeting location lists each location, its congregations, driving time and road miles. Overview has the charts; edit C5 there to adjust delegates.');
  }catch(error){toast('Excel export failed: '+error.message,true);}finally{excelExportBusy=false;updateReportExportButtons();button.textContent='Export Excel';}
});

document.getElementById('exportAssignmentPdf').addEventListener('click',async()=>{
  if(pdfExportBusy)return;
  const button=document.getElementById('exportAssignmentPdf');
  try{
    const report=currentAssignmentReport(reportExportFactor());
    pdfExportBusy=true;updateReportExportButtons();button.textContent='Preparing PDF…';
    await printAssignmentReport(report);
    toast('Report opened. Choose Save as PDF in the print dialog; the report also has a Print / Save PDF button.');
  }catch(error){toast('PDF report could not open: '+error.message,true);}finally{pdfExportBusy=false;updateReportExportButtons();button.textContent='Print / Save PDF';}
});

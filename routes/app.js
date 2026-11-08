import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from '../bus-access/data.js?v=pin-audit-20261108-1';
import { HOTELS } from './hotels.js';
import { RTD_STATIONS } from './stations.js?v=rtd-20261108-1';
import { denverInput, formatDenver, buildTravelSchedule, validPoint, safeWebUrl, TICKETS, parkingAdvice } from './travel-plan.mjs?v=rtd-20261108-1';

const firebaseConfig={
  apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',
  authDomain:'convention-fs.firebaseapp.com',
  projectId:'convention-fs',
  storageBucket:'convention-fs.firebasestorage.app',
  messagingSenderId:'29365992209',
  appId:'1:29365992209:web:0bd35e723688b37d776ab0',
  measurementId:'G-054BLBBE0F'
};
const ADMIN_EMAIL='michaeltarin@hotmail.com';
const STATUS_COLORS={
  'not-reviewed':'#667085','inspection-scheduled':'#0b4da2',approved:'#0e9453',
  conditional:'#d99a00','not-suitable':'#c9362b'
};
const SPECIAL_LOCATIONS=[
  {id:'special-ccc',markerLabel:'CCC',name:'Colorado Convention Center',address:'700 14th St, Denver, CO 80202',lat:39.74248,lng:-104.99567,locationType:'landmark'},
  {id:'special-dtc',markerLabel:'DTC',name:'DTC Center Point',address:'I-25 & E. Belleview Ave, Denver, CO',lat:DTC[0],lng:DTC[1],locationType:'landmark'}
];

let app,auth,db,map,boundaryLayer,routeLayer,originMarker,destinationMarker;
let stationDraftMarker=null;
let currentUser=null,currentRoute=null,currentRouteId=null,savedRoutes=[],savedRoutesUnsub=null;
let locations=[],selectedDestination=null,customDestination=null;
let customStations=readStations(), cloudStations=[], formRevision=0;
const publicHallData=new Map();
const locationMarkers=new Map();
const geocodeCache=readCache();

const els={
  form:document.getElementById('plannerForm'),routeName:document.getElementById('routeName'),hotelSelect:document.getElementById('hotelSelect'),
  hotelAddress:document.getElementById('hotelAddress'),customOriginWrap:document.getElementById('customOriginWrap'),customOriginAddress:document.getElementById('customOriginAddress'),
  destinationSelect:document.getElementById('destinationSelect'),destinationAddress:document.getElementById('destinationAddress'),customDestinationWrap:document.getElementById('customDestinationWrap'),
  customDestinationName:document.getElementById('customDestinationName'),customDestinationAddress:document.getElementById('customDestinationAddress'),
  customDestinationLat:document.getElementById('customDestinationLat'),customDestinationLng:document.getElementById('customDestinationLng'),pickBanner:document.getElementById('pickBanner'),
  meetingAt:document.getElementById('meetingAt'),travelAllowance:document.getElementById('travelAllowance'),arrivalBuffer:document.getElementById('arrivalBuffer'),
  boardingBuffer:document.getElementById('boardingBuffer'),routeNotes:document.getElementById('routeNotes'),calculateButton:document.getElementById('calculateButton'),
  newRouteButton:document.getElementById('newRouteButton'),resultCard:document.getElementById('resultCard'),resultTitle:document.getElementById('resultTitle'),
  distanceResult:document.getElementById('distanceResult'),baseTimeResult:document.getElementById('baseTimeResult'),plannedTimeResult:document.getElementById('plannedTimeResult'),
  totalLeadResult:document.getElementById('totalLeadResult'),reportTimeResult:document.getElementById('reportTimeResult'),departureTimeResult:document.getElementById('departureTimeResult'),
  arrivalTimeResult:document.getElementById('arrivalTimeResult'),meetingTimeResult:document.getElementById('meetingTimeResult'),coordinateNotice:document.getElementById('coordinateNotice'),
  googleDirections:document.getElementById('googleDirections'),appleDirections:document.getElementById('appleDirections'),saveRouteButton:document.getElementById('saveRouteButton'),
  savedRoutes:document.getElementById('savedRoutes'),savedRouteStatus:document.getElementById('savedRouteStatus'),loginButton:document.getElementById('loginButton'),
  signOutButton:document.getElementById('signOutButton'),loginModal:document.getElementById('loginModal'),loginForm:document.getElementById('loginForm'),
  loginEmail:document.getElementById('loginEmail'),loginPassword:document.getElementById('loginPassword'),toast:document.getElementById('toast')
};

for(const id of ['tripPurpose','tripScope','rtdSetup','stationAdvice','stationEditor','stationName','stationAddress','stationLat','stationLng','stationParking','stationSource','parkingNotes','ticketMethod','reminderLeadMinutes','extraReminders','travelPlanDetails','meetingResultLabel','meetingAtLabel','meetingHelp','destinationLabel','arrivalBufferLabel']) els[id]=document.getElementById(id);

function escapeHtml(value=''){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function clean(value=''){return String(value??'').trim();}
function numberValue(value,fallback=0){const n=Number(value);return Number.isFinite(n)?Math.max(0,n):fallback;}
function isAdmin(){return currentUser?.email?.toLowerCase()===ADMIN_EMAIL;}
function toast(message,error=false){els.toast.textContent=message;els.toast.className='toast show'+(error?' error':'');clearTimeout(els.toast._timer);els.toast._timer=setTimeout(()=>els.toast.className='toast',3600);}
function friendlyError(error){const code=error?.code||'';if(code.includes('invalid-credential'))return'The email or password is not correct.';if(code.includes('permission-denied'))return'Firebase denied this action. Confirm the administrator sign-in and Firestore rules.';if(code.includes('network-request-failed')||code.includes('unavailable'))return'The network or service is temporarily unavailable.';if(code.includes('unauthorized-domain'))return'Add letdesignworks.github.io to Firebase Authentication authorized domains.';return error?.message?.replace(/^Firebase:\s*/,'')||'Unknown error';}
function readCache(){try{return JSON.parse(localStorage.getItem('conventionHotelGeocodes')||'{}');}catch{return{};}}
function saveCache(){try{localStorage.setItem('conventionHotelGeocodes',JSON.stringify(geocodeCache));}catch{/* storage may be unavailable */}}
const localInputValue=denverInput;
const formatDateTime=formatDenver;

function formatMinutes(minutes){const m=Math.max(0,Math.round(minutes));if(m<60)return`${m} min`;const h=Math.floor(m/60),r=m%60;return r?`${h} hr ${r} min`:`${h} hr`;}
function markerLabel(location){return clean(location.markerLabel||location.number||'M');}
function locationTypeLabel(location){if(location.locationType==='rtd-station')return'RTD station';if(location.locationType==='meeting-area')return'Meeting area';if(location.locationType==='landmark')return'Planning landmark';return'Kingdom Hall';}
function locationColor(location){if(location.locationType==='rtd-station')return'#167957';if(location.locationType==='landmark')return'#6c4dc2';return STATUS_COLORS[publicHallData.get(String(location.id))?.busStatus||'not-reviewed']||'#667085';}
function originQuery(origin){return origin.address||`${origin.lat},${origin.lng}`;}
function destinationQuery(destination){if(destination.locationType==='rtd-station')return `${destination.lat},${destination.lng}`;return destination.address||`${destination.lat},${destination.lng}`;}
function googleUrl(origin,destination){return`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery(origin))}&destination=${encodeURIComponent(destinationQuery(destination))}&travelmode=driving`;}
function appleUrl(origin,destination){return`https://maps.apple.com/?saddr=${encodeURIComponent(originQuery(origin))}&daddr=${encodeURIComponent(destinationQuery(destination))}&dirflg=d`;}

function initDefaults(){
  els.meetingAt.value=localInputValue(new Date(Date.now()+86400000)).slice(0,10)+'T09:00';
}
function originLocations(){return [...HOTELS,...locations.filter(l=>l.locationType!=='rtd-station').map(l=>({...l,id:'location:'+l.id}))];}
function populateHotels(){
  const previous=els.hotelSelect.value;
  const regions=[...new Set(HOTELS.map(h=>h.region))];
  els.hotelSelect.innerHTML='<option value="">Choose a starting location…</option>'+regions.map(region=>'<optgroup label="'+escapeHtml(region)+'">'+HOTELS.filter(h=>h.region===region).map(h=>'<option value="'+h.id+'">'+h.id+' — '+escapeHtml(h.name)+'</option>').join('')+'</optgroup>').join('')+'<optgroup label="Kingdom Halls and saved locations">'+locations.filter(l=>l.locationType!=='rtd-station').map(l=>'<option value="location:'+escapeHtml(l.id)+'">'+escapeHtml(markerLabel(l)+' — '+l.name)+'</option>').join('')+'</optgroup><optgroup label="Other"><option value="custom">Other starting address</option></optgroup>';
  if([...els.hotelSelect.options].some(o=>o.value===previous))els.hotelSelect.value=previous;
}

function normalizeCustomLocation(id,data){
  const lat=Number(data.lat),lng=Number(data.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||data.customLocation!==true)return null;
  return{id:String(id),markerLabel:clean(data.markerLabel||data.number||'M'),name:clean(data.name||'Added planning location'),address:clean(data.address||''),lat,lng,locationType:data.locationType==='meeting-area'?'meeting-area':'kingdom-hall',customLocation:true};
}
function rebuildLocations(){
  const base=HALLS.map(h=>({...h,id:String(h.id),markerLabel:String(h.number),locationType:'kingdom-hall',customLocation:false}));
  const custom=[];for(const[id,data]of publicHallData.entries()){const item=normalizeCustomLocation(id,data);if(item)custom.push(item);}
  custom.sort((a,b)=>markerLabel(a).localeCompare(markerLabel(b),undefined,{numeric:true}));
  const stations=new Map([...RTD_STATIONS,...customStations,...cloudStations].map(x=>[x.id,x]));
  locations=[...SPECIAL_LOCATIONS,...base,...custom,...stations.values()];
  populateHotels();populateDestinations();syncLocationMarkers();
  if(selectedDestination){const updated=locations.find(l=>l.id===selectedDestination.id);if(updated){selectedDestination=updated;renderStationAdvice();}}
}
function populateDestinations(){
  const previous=els.destinationSelect.value;
  if(isRtd()){
    els.destinationSelect.innerHTML='<option value="">Choose an RTD station…</option>'+locations.filter(l=>l.locationType==='rtd-station').map(l=>'<option value="'+escapeHtml(l.id)+'">'+escapeHtml(l.name)+'</option>').join('');
    if([...els.destinationSelect.options].some(o=>o.value===previous))els.destinationSelect.value=previous;
    return;
  }
  const landmarks=locations.filter(x=>x.locationType==='landmark');
  const siteLocations=locations.filter(x=>x.locationType!=='landmark'&&x.locationType!=='rtd-station');
  els.destinationSelect.innerHTML='<option value="">Choose a meeting location…</option>'+`<optgroup label="Planning landmarks">${landmarks.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('')}</optgroup>`+`<optgroup label="Kingdom Halls and saved meeting areas">${siteLocations.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(markerLabel(l))} — ${escapeHtml(l.name)}</option>`).join('')}</optgroup>`+'<optgroup label="Other"><option value="custom-map-point">Choose any point on the map</option></optgroup>';
  if(previous&&[...els.destinationSelect.options].some(o=>o.value===previous))els.destinationSelect.value=previous;
}

function locationIcon(location,selected=false){const label=markerLabel(location),meeting=location.locationType==='meeting-area'||location.locationType==='landmark';return L.divIcon({className:'',html:`<div class="location-pin${meeting?' meeting':''}${selected?' selected':''}" style="background:${locationColor(location)}">${escapeHtml(label)}</div>`,iconSize:[35,35],iconAnchor:[17,17]});}
function initMap(){
  map=L.map('map',{zoomControl:true,attributionControl:true}).setView(DTC,10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  boundaryLayer=L.polygon(DTC_BOUNDARY,{color:'#0b4da2',weight:2.5,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.035,interactive:false}).addTo(map);
  L.marker(DTC,{icon:L.divIcon({className:'',html:'<div class="center-star">★</div>',iconSize:[34,34],iconAnchor:[17,17]})}).addTo(map).bindPopup('<div class="popup-title">DTC Center Point</div><div class="popup-sub">I-25 & E. Belleview Avenue</div>');
  map.fitBounds(boundaryLayer.getBounds(),{padding:[20,20]});
  map.on('click',event=>{
    if(isRtd()&&els.stationEditor.open){els.stationLat.value=event.latlng.lat.toFixed(6);els.stationLng.value=event.latlng.lng.toFixed(6);previewStationPoint();toast('Station coordinates selected. Review the address, then add the station.');return;}
    if(els.destinationSelect.value!=='custom-map-point')return;
    invalidateRoute();
    customDestination={id:'custom-map-point',markerLabel:'M',name:clean(els.customDestinationName.value)||'Custom meeting point',address:clean(els.customDestinationAddress.value),lat:event.latlng.lat,lng:event.latlng.lng,locationType:'meeting-area',customPoint:true};
    els.customDestinationLat.value=event.latlng.lat.toFixed(6);els.customDestinationLng.value=event.latlng.lng.toFixed(6);els.pickBanner.textContent='Meeting point placed. Drag or tap elsewhere to adjust it.';
    setDestinationMarker(customDestination);selectedDestination=customDestination;updateRouteName();
  });
}
function syncLocationMarkers(){
  if(!map)return;const active=new Set(locations.map(x=>x.id));
  for(const[id,marker]of locationMarkers.entries())if(!active.has(id)){map.removeLayer(marker);locationMarkers.delete(id);}
  for(const location of locations){if(location.id==='special-dtc')continue;let marker=locationMarkers.get(location.id);if(!marker){marker=L.marker([location.lat,location.lng],{icon:locationIcon(location)}).addTo(map);marker.on('click',()=>selectDestination(location.id,true));marker.bindTooltip(`${markerLabel(location)} — ${location.name}`,{direction:'top',offset:[0,-14]});locationMarkers.set(location.id,marker);}else{marker.setLatLng([location.lat,location.lng]);marker.setIcon(locationIcon(location,selectedDestination?.id===location.id));}}
}
function setOriginMarker(origin){if(originMarker)map.removeLayer(originMarker);originMarker=L.marker([origin.lat,origin.lng],{icon:L.divIcon({className:'',html:`<div class="origin-pin">${escapeHtml(origin.id?.startsWith('H')?origin.id:'S')}</div>`,iconSize:[39,39],iconAnchor:[19,19]})}).addTo(map).bindTooltip(origin.name,{direction:'top',offset:[0,-16]});}
function setDestinationMarker(destination){if(destinationMarker)map.removeLayer(destinationMarker);destinationMarker=L.marker([destination.lat,destination.lng],{draggable:Boolean(destination.customPoint),icon:L.divIcon({className:'',html:'<div class="meeting-pin">'+(destination.locationType==='rtd-station'?'RTD':'M')+'</div>',iconSize:[39,39],iconAnchor:[19,19]})}).addTo(map).bindTooltip(destination.name,{direction:'top',offset:[0,-16]});if(destination.customPoint)destinationMarker.on('dragend',event=>{invalidateRoute();const p=event.target.getLatLng();customDestination.lat=p.lat;customDestination.lng=p.lng;els.customDestinationLat.value=p.lat.toFixed(6);els.customDestinationLng.value=p.lng.toFixed(6);});}
function clearRouteLayer(){if(routeLayer){map.removeLayer(routeLayer);routeLayer=null;}}

function selectDestination(id,pan=false){
  const location=locations.find(x=>x.id===String(id));if(!location)return;
  invalidateRoute();
  if((location.locationType==='rtd-station')!==isRtd()){els.tripPurpose.value=location.locationType==='rtd-station'?'rtd':'meeting';handlePurposeChange();}
  els.destinationSelect.value=location.id;els.customDestinationWrap.hidden=true;selectedDestination=location;customDestination=null;
  els.destinationAddress.textContent=`${locationTypeLabel(location)} • ${location.address||'Saved map coordinates'}`;
  setDestinationMarker(location);syncLocationMarkers();updateRouteName();renderStationAdvice();
  if(pan)map.setView([location.lat,location.lng],Math.max(map.getZoom(),13),{animate:true});
}
function handleDestinationChange(){
  const value=els.destinationSelect.value;
  if(value==='custom-map-point'){
    els.customDestinationWrap.hidden=false;els.destinationAddress.textContent='Tap the map or enter coordinates for the meeting point.';selectedDestination=customDestination;
    if(customDestination)setDestinationMarker(customDestination);else{if(destinationMarker){map.removeLayer(destinationMarker);destinationMarker=null;}els.pickBanner.textContent='Tap the map to place the meeting point.';}
  }else if(value){selectDestination(value,false);}else{selectedDestination=null;els.customDestinationWrap.hidden=true;els.destinationAddress.textContent='Select a Kingdom Hall, saved meeting area, planning landmark, or custom point.';if(destinationMarker){map.removeLayer(destinationMarker);destinationMarker=null;}syncLocationMarkers();}
  updateRouteName();
}
function handleHotelChange(){
  const value=els.hotelSelect.value;els.customOriginWrap.hidden=value!=='custom';
  const hotel=originLocations().find(h=>h.id===value);els.hotelAddress.textContent=hotel?`${hotel.address}${hotel.region?" • "+hotel.region:""}`:value==='custom'?'Enter the starting address below.':'';
  updateRouteName();
  if(hotel)setOriginMarker(hotel);else if(originMarker){map.removeLayer(originMarker);originMarker=null;}
}
function updateCustomDestination(){
  if(!validPoint(els.customDestinationLat.value,els.customDestinationLng.value)){customDestination=null;return;}const lat=Number(els.customDestinationLat.value),lng=Number(els.customDestinationLng.value);
  customDestination={id:'custom-map-point',markerLabel:'M',name:clean(els.customDestinationName.value)||'Custom meeting point',address:clean(els.customDestinationAddress.value),lat,lng,locationType:'meeting-area',customPoint:true};selectedDestination=customDestination;setDestinationMarker(customDestination);updateRouteName();
}
function updateRouteName(){if(clean(els.routeName.value))return;const hotel=originLocations().find(h=>h.id===els.hotelSelect.value);const originName=hotel?hotel.name:'Starting location';const dest=selectedDestination;els.routeName.placeholder=dest?`${originName} to ${markerLabel(dest)} ${dest.name}`:'Example: H17 to Highlands Ranch morning field service';}

async function geocodeOrigin(){
  const hotel=originLocations().find(h=>h.id===els.hotelSelect.value);
  if(!els.hotelSelect.value)throw new Error('Choose a starting location.');
  if(hotel?.id.startsWith('location:'))return {...hotel,geocodeSource:'verified map location'};
  const address=hotel?.address||clean(els.customOriginAddress.value);if(!address)throw new Error('Choose a hotel or enter a starting address.');
  const cacheKey=(hotel?.id||address).toLowerCase();if(geocodeCache[cacheKey])return{...(hotel||{}),...geocodeCache[cacheKey],id:hotel?.id||'H',name:hotel?.name||'Starting location',address,geocodeSource:'cached'};
  const fallback=hotel&&Number.isFinite(hotel.lat)&&Number.isFinite(hotel.lng)?{lat:hotel.lat,lng:hotel.lng}:null;
  try{
    const url=new URL('https://nominatim.openstreetmap.org/search');url.searchParams.set('format','jsonv2');url.searchParams.set('limit','1');url.searchParams.set('countrycodes','us');url.searchParams.set('addressdetails','0');url.searchParams.set('q',address);
    const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`Geocoding service returned ${response.status}.`);
    const results=await response.json();if(!results.length)throw new Error('Address was not found.');
    const coords={lat:Number(results[0].lat),lng:Number(results[0].lon)};if(!Number.isFinite(coords.lat)||!Number.isFinite(coords.lng))throw new Error('Invalid geocoding result.');
    geocodeCache[cacheKey]=coords;saveCache();return{...(hotel||{}),...coords,id:hotel?.id||'H',name:hotel?.name||'Other hotel / starting point',address,geocodeSource:'Nominatim'};
  }catch(error){if(fallback)return{...hotel,...fallback,address,geocodeSource:'approximate fallback',geocodeWarning:`The hotel geocoder was unavailable, so the route used a stored approximate point near ${hotel.name}. Verify the final directions.`};throw new Error(`The starting address could not be located. ${friendlyError(error)}`);}
}
function resolveDestination(){
  if(els.destinationSelect.value==='custom-map-point'){
    updateCustomDestination();if(!customDestination)throw new Error('Tap the map or enter valid coordinates for the meeting location.');return customDestination;
  }
  const location=locations.find(x=>x.id===els.destinationSelect.value);if(!location)throw new Error(isRtd()?'Choose an RTD station.':'Choose a meeting location.');return location;
}
async function requestRoute(origin,destination){
  const coords=`${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url=`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`Routing service returned ${response.status}.`);
  const data=await response.json();if(data.code!=='Ok'||!data.routes?.length)throw new Error(data.message||'No drivable route was found.');return data.routes[0];
}
function buildSchedule(baseMinutes){
  return buildTravelSchedule({meetingLocal:els.meetingAt.value,baseMinutes,travelAllowance:els.travelAllowance.value,arrivalBuffer:els.arrivalBuffer.value,boardingBuffer:els.boardingBuffer.value,reminderLeadMinutes:els.reminderLeadMinutes.value});
}

function renderRouteResult(route,origin,destination,schedule){
  const baseMinutes=Math.ceil(route.duration/60),distanceMiles=route.distance/1609.344;
  currentRoute={routeId:currentRouteId,routeName:clean(els.routeName.value)||`${origin.name} → ${destination.name}`,origin,destination,distanceMiles,baseMinutes,...schedule,notes:clean(els.routeNotes.value),geometry:route.geometry,tripPurpose:els.tripPurpose.value,parkingNotes:clean(els.parkingNotes.value),ticketMethod:els.ticketMethod.value,extraReminders:clean(els.extraReminders.value)};
  renderTravelPlan(currentRoute);
  els.routeName.value=currentRoute.routeName;els.resultTitle.textContent=currentRoute.routeName;els.distanceResult.textContent=`${distanceMiles.toFixed(1)} mi`;els.baseTimeResult.textContent=formatMinutes(baseMinutes);els.plannedTimeResult.textContent=formatMinutes(schedule.plannedTravel);els.totalLeadResult.textContent=formatMinutes(schedule.totalLead);els.reportTimeResult.textContent=formatDateTime(schedule.report);els.departureTimeResult.textContent=formatDateTime(schedule.departure);els.arrivalTimeResult.textContent=formatDateTime(schedule.arrival);els.meetingTimeResult.textContent=formatDateTime(schedule.meeting);
  const warnings=[];if(origin.geocodeWarning)warnings.push(origin.geocodeWarning);warnings.push('This estimate does not use live traffic and does not account for motorcoach height, weight, turn-radius, loading, or road restrictions.');els.coordinateNotice.textContent=warnings.join(' ');els.coordinateNotice.classList.add('show');
  els.googleDirections.href=googleUrl(origin,destination);els.appleDirections.href=appleUrl(origin,destination);els.resultCard.hidden=false;updateSaveButton();drawRoute(route.geometry,origin,destination);els.resultCard.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function drawRoute(geometry,origin,destination){clearRouteLayer();const latLngs=geometry.coordinates.map(([lng,lat])=>[lat,lng]);routeLayer=L.polyline(latLngs,{color:'#0b5b9f',weight:5,opacity:.86}).addTo(map);setOriginMarker(origin);setDestinationMarker(destination);map.fitBounds(routeLayer.getBounds(),{padding:[35,35]});}
async function calculateRoute(event){
  event?.preventDefault();const revision=formRevision;currentRoute=null;els.resultCard.hidden=true;updateSaveButton();els.calculateButton.disabled=true;els.calculateButton.textContent='Calculating…';
  try{const origin=await geocodeOrigin();const destination=resolveDestination();const route=await requestRoute(origin,destination);if(revision!==formRevision)throw new Error('The plan changed while calculating. Calculate again with the new choices.');const schedule=buildSchedule(Math.ceil(route.duration/60));renderRouteResult(route,origin,destination,schedule);toast('Route and departure schedule calculated.');}
  catch(error){toast(friendlyError(error),true);}
  finally{els.calculateButton.disabled=false;els.calculateButton.textContent='Calculate Route';}
}

function updateSaveButton(){
  if(!currentRoute){els.saveRouteButton.disabled=true;els.saveRouteButton.textContent='Calculate Before Saving';return;}
  if(!isAdmin()){els.saveRouteButton.disabled=false;els.saveRouteButton.textContent='Sign In to Save';return;}
  els.saveRouteButton.disabled=false;els.saveRouteButton.textContent=currentRouteId?'Update Saved Route':'Save Route';
}
function serializeRoute(route){return{
  recordType:'bus-route',tripPurpose:route.tripPurpose||'meeting',stationSnapshot:route.tripPurpose==='rtd'?route.destination:null,parkingNotes:route.parkingNotes||'',ticketMethod:route.ticketMethod||'mobile',extraReminders:route.extraReminders||'',reminderLeadMinutes:route.reminderLeadMinutes??30,routeName:route.routeName,hotelId:route.origin.id||'custom',hotelName:route.origin.name,hotelAddress:route.origin.address,
  origin:{lat:route.origin.lat,lng:route.origin.lng},destinationId:route.destination.id,destinationLabel:markerLabel(route.destination),destinationName:route.destination.name,
  destinationAddress:route.destination.address||'',destinationType:route.destination.locationType||'meeting-area',destination:{lat:route.destination.lat,lng:route.destination.lng},
  distanceMiles:Number(route.distanceMiles.toFixed(2)),baseMinutes:route.baseMinutes,travelAllowance:route.travelAllowance,plannedTravelMinutes:route.plannedTravel,
  arrivalBuffer:route.arrivalBuffer,boardingBuffer:route.boardingBuffer,totalLeadMinutes:route.totalLead,meetingLocal:localInputValue(route.meeting),departureLocal:localInputValue(route.departure),
  arrivalLocal:localInputValue(route.arrival),reportLocal:localInputValue(route.report),timeZone:'America/Denver',notes:route.notes,updatedByEmail:currentUser.email,updatedAt:serverTimestamp()
};}
async function saveRoute(){
  if(!isAdmin()){openLogin();return;}if(!currentRoute){toast('Calculate the route before saving.',true);return;}
  const button=els.saveRouteButton;button.disabled=true;button.textContent='Saving…';
  try{const ref=currentRouteId?doc(db,'reviews',currentRouteId):doc(collection(db,'reviews'));await setDoc(ref,{...serializeRoute(currentRoute),...(currentRouteId?{}:{createdAt:serverTimestamp()})},{merge:true});currentRouteId=ref.id;currentRoute.routeId=ref.id;toast(currentRouteId?'Route saved.':'Route saved.');updateSaveButton();}
  catch(error){toast('Could not save route: '+friendlyError(error),true);}
  finally{button.disabled=false;updateSaveButton();}
}
function subscribeSavedRoutes(){
  if(savedRoutesUnsub){savedRoutesUnsub();savedRoutesUnsub=null;}savedRoutes=[];cloudStations=[];rebuildLocations();renderSavedRoutes();if(!isAdmin())return;
  els.savedRouteStatus.textContent='Loading saved routes…';
  savedRoutesUnsub=onSnapshot(collection(db,'reviews'),snapshot=>{savedRoutes=[];cloudStations=[];snapshot.forEach(s=>{const data=s.data();if(data.recordType==='bus-route')savedRoutes.push({id:s.id,...data});if(data.recordType==='rtd-station'){const station=normalizeStation({...data,id:s.id});if(station)cloudStations.push(station);}});rebuildLocations();savedRoutes.sort((a,b)=>String(a.meetingLocal||'').localeCompare(String(b.meetingLocal||'')));renderSavedRoutes();},error=>{els.savedRouteStatus.textContent='Saved routes could not be loaded: '+friendlyError(error);});
}
function renderSavedRoutes(){
  if(!isAdmin()){els.savedRouteStatus.textContent='Sign in to view and manage saved routes.';els.savedRoutes.innerHTML='';return;}
  if(!savedRoutes.length){els.savedRouteStatus.textContent='No routes have been saved yet.';els.savedRoutes.innerHTML='';return;}
  els.savedRouteStatus.textContent=`${savedRoutes.length} saved route${savedRoutes.length===1?'':'s'}`;
  els.savedRoutes.innerHTML=savedRoutes.map(route=>`<article class="saved-route"><div class="saved-route-head"><div><h3>${escapeHtml(route.routeName||'Saved route')}</h3><p>${escapeHtml(route.hotelName||'Hotel')} → ${escapeHtml(route.destinationName||'Meeting location')}</p></div><strong>${escapeHtml(Number(route.distanceMiles||0).toFixed(1))} mi</strong></div><div class="schedule"><span>Depart ${escapeHtml(formatDateTime(route.departureLocal))}</span><span>Meeting ${escapeHtml(formatDateTime(route.meetingLocal))}</span><span>${escapeHtml(formatMinutes(route.plannedTravelMinutes||route.baseMinutes||0))} planned travel</span></div>${route.notes?`<p>${escapeHtml(route.notes)}</p>`:''}<div class="saved-route-actions"><button class="btn outline" data-load-route="${route.id}" type="button">Load Route</button><button class="btn outline danger" data-delete-route="${route.id}" type="button">Delete</button></div></article>`).join('');
  els.savedRoutes.querySelectorAll('[data-load-route]').forEach(b=>b.addEventListener('click',()=>loadSavedRoute(b.dataset.loadRoute)));
  els.savedRoutes.querySelectorAll('[data-delete-route]').forEach(b=>b.addEventListener('click',()=>deleteSavedRoute(b.dataset.deleteRoute)));
}
async function loadSavedRoute(id){
  const route=savedRoutes.find(r=>r.id===id);if(!route)return;
  els.tripPurpose.value=route.tripPurpose==='rtd'?'rtd':'meeting';
  if(route.stationSnapshot&&!locations.some(l=>l.id===route.destinationId)){const station=normalizeStation(route.stationSnapshot);if(station){customStations.push(station);rebuildLocations();}}
  handlePurposeChange();currentRouteId=id;
  els.parkingNotes.value=route.parkingNotes||'';els.ticketMethod.value=route.ticketMethod||'mobile';els.extraReminders.value=route.extraReminders||'';els.reminderLeadMinutes.value=route.reminderLeadMinutes??30;els.routeName.value=route.routeName||'';els.routeNotes.value=route.notes||'';els.meetingAt.value=route.meetingLocal||'';els.travelAllowance.value=route.travelAllowance??15;els.arrivalBuffer.value=route.arrivalBuffer??15;els.boardingBuffer.value=route.boardingBuffer??15;
  const hotel=originLocations().find(h=>h.id===route.hotelId);if(hotel){els.hotelSelect.value=hotel.id;els.customOriginWrap.hidden=true;geocodeCache[hotel.id.toLowerCase()]={lat:route.origin?.lat??hotel.lat,lng:route.origin?.lng??hotel.lng};saveCache();}else{els.hotelSelect.value='custom';els.customOriginWrap.hidden=false;els.customOriginAddress.value=route.hotelAddress||route.hotelName||'';if(route.origin)geocodeCache[(route.hotelAddress||route.hotelName||'custom').toLowerCase()]=route.origin;}
  const existing=locations.find(l=>l.id===route.destinationId);if(existing){els.destinationSelect.value=existing.id;selectDestination(existing.id,false);}else{els.destinationSelect.value='custom-map-point';customDestination={id:'custom-map-point',markerLabel:route.destinationLabel||'M',name:route.destinationName||'Custom meeting point',address:route.destinationAddress||'',lat:Number(route.destination?.lat),lng:Number(route.destination?.lng),locationType:route.destinationType||'meeting-area',customPoint:true};els.customDestinationName.value=customDestination.name;els.customDestinationAddress.value=customDestination.address;els.customDestinationLat.value=customDestination.lat;els.customDestinationLng.value=customDestination.lng;handleDestinationChange();}
  handleHotelChange();await calculateRoute();toast('Saved route loaded for review or updating.');window.scrollTo({top:0,behavior:'smooth'});
}
async function deleteSavedRoute(id){const route=savedRoutes.find(r=>r.id===id);if(!route||!isAdmin())return;if(!confirm(`Delete “${route.routeName||'this route'}”?`))return;try{await deleteDoc(doc(db,'reviews',id));if(currentRouteId===id){currentRouteId=null;updateSaveButton();}toast('Saved route deleted.');}catch(error){toast('Could not delete route: '+friendlyError(error),true);}}
function resetPlanner(){currentRoute=null;currentRouteId=null;els.form.reset();handlePurposeChange();initDefaults();els.travelAllowance.value=15;els.arrivalBuffer.value=15;els.boardingBuffer.value=15;els.resultCard.hidden=true;els.customOriginWrap.hidden=true;els.customDestinationWrap.hidden=true;selectedDestination=null;customDestination=null;if(originMarker){map.removeLayer(originMarker);originMarker=null;}if(destinationMarker){map.removeLayer(destinationMarker);destinationMarker=null;}clearRouteLayer();syncLocationMarkers();map.fitBounds(boundaryLayer.getBounds(),{padding:[20,20]});updateSaveButton();toast('New route form ready.');}

function isRtd(){return els.tripPurpose.value==='rtd';}
function invalidateRoute(){formRevision++;currentRoute=null;els.resultCard.hidden=true;clearRouteLayer();updateSaveButton();}
function normalizeStation(value){
  if(!value||!clean(value.id)||!clean(value.name)||!clean(value.address)||!validPoint(value.lat,value.lng))return null;
  return {id:String(value.id),markerLabel:'RTD',name:clean(value.name),address:clean(value.address),lat:Number(value.lat),lng:Number(value.lng),locationType:'rtd-station',parkingNotes:clean(value.parkingNotes),sourceUrl:safeWebUrl(value.sourceUrl),...(Number.isFinite(value.parkingSpaces)?{parkingSpaces:value.parkingSpaces}:{})};
}
function readStations(){try{return JSON.parse(localStorage.getItem('conventionRtdStations')||'[]').map(normalizeStation).filter(Boolean);}catch{return[];}}
function syncRtdFields(){
  els.rtdSetup.querySelectorAll('input,select,textarea').forEach(input=>{input.disabled=!isRtd()||(els.stationEditor.contains(input)&&!els.stationEditor.open);});
  previewStationPoint();
}
function previewStationPoint(){
  if(stationDraftMarker){map.removeLayer(stationDraftMarker);stationDraftMarker=null;}
  if(isRtd()&&els.stationEditor.open&&validPoint(els.stationLat.value,els.stationLng.value))stationDraftMarker=L.circleMarker([Number(els.stationLat.value),Number(els.stationLng.value)],{radius:12,color:'#167957',weight:4,fillColor:'#fff',fillOpacity:.8}).addTo(map).bindTooltip('New station point',{permanent:true,direction:'top'});
}
function handlePurposeChange(){
  invalidateRoute();selectedDestination=null;customDestination=null;els.destinationSelect.value='';els.customDestinationWrap.hidden=true;
  if(destinationMarker){map.removeLayer(destinationMarker);destinationMarker=null;}
  els.rtdSetup.hidden=!isRtd();
  syncRtdFields();
  els.tripScope.textContent=isRtd()?'Driving connection only: starting location → RTD station. Rail travel after the station is outside this plan.':'Plan the drive to your meeting location.';
  els.destinationLabel.textContent=isRtd()?'RTD station':'Meeting for field service location';
  els.meetingAtLabel.textContent=isRtd()?'Station meeting date and time (Denver)':'Meeting for field service date and time';
  els.meetingHelp.textContent=isRtd()?'Enter the time friends must be ready at the station. If your meeting is elsewhere, first choose the station rendezvous time using RTD’s schedule. All times below use Denver time.':'Enter the meeting time in Denver local time. All schedule times use America/Denver.';
  els.arrivalBufferLabel.textContent=isRtd()?'Parking, ticket and platform preparation':'Arrive before meeting';
  els.destinationAddress.textContent=isRtd()?'Choose a station or add one below.':'Select a Kingdom Hall, saved meeting area, planning landmark, or custom point.';
  populateDestinations();renderStationAdvice();syncLocationMarkers();
}
function sourceLink(url,label){const safe=safeWebUrl(url);return safe?'<a href="'+escapeHtml(safe)+'" target="_blank" rel="noopener">'+escapeHtml(label)+'</a>':'';}
function renderStationAdvice(){
  const station=selectedDestination?.locationType==='rtd-station'?selectedDestination:null;
  els.stationAdvice.innerHTML=station?'<strong>'+escapeHtml(station.name)+'</strong><p>'+escapeHtml(parkingAdvice(station))+'</p>'+(station.parkingNotes?'<p>'+escapeHtml(station.parkingNotes)+'</p>':'')+sourceLink(station.sourceUrl,'Official station details'): 'Select a station to see parking guidance. Added stations can include your own parking and gathering instructions.';
}
async function addStation(){
  const station=normalizeStation({id:'rtd-custom-'+crypto.randomUUID(),name:els.stationName.value,address:els.stationAddress.value,lat:els.stationLat.value,lng:els.stationLng.value,parkingNotes:els.stationParking.value,sourceUrl:els.stationSource.value});
  if(!station){toast('Enter a station name, full address and valid map coordinates.',true);return;}
  if(clean(els.stationSource.value)&&!station.sourceUrl){toast('Use an https:// link for station details.',true);return;}
  const button=document.getElementById('addStation');button.disabled=true;
  try{
    if(isAdmin()){
      await setDoc(doc(db,'reviews',station.id),{...station,recordType:'rtd-station',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedByEmail:currentUser.email});
      if(!cloudStations.some(x=>x.id===station.id))cloudStations.push(station);
    }else{
      const next=[...customStations,station];localStorage.setItem('conventionRtdStations',JSON.stringify(next));customStations=next;
    }
    rebuildLocations();selectDestination(station.id,true);els.stationEditor.open=false;
    for(const key of ['stationName','stationAddress','stationLat','stationLng','stationParking','stationSource'])els[key].value='';
    toast(isAdmin()?'Station saved to the planning site.':'Station added in this browser.');
  }catch(error){toast('Could not add station: '+friendlyError(error),true);}finally{button.disabled=false;}
}
function renderTravelPlan(plan){
  const rtd=plan.tripPurpose==='rtd',station=plan.destination;
  els.meetingResultLabel.textContent=rtd?'Ready for station meeting':'Meeting for field service';
  let html='<p class="plan-endpoints"><strong>Start:</strong> '+escapeHtml(plan.origin.name)+' — '+escapeHtml(plan.origin.address)+'<br><strong>'+(rtd?'RTD station':'Destination')+':</strong> '+escapeHtml(station.name)+' — '+escapeHtml(station.address||'Selected map point')+'</p>';
  html+='<section><h3>Preparation reminder</h3><p class="reminder-time">'+escapeHtml(formatDateTime(plan.reminder))+'</p><p>Get ready before friends report at the starting location. Check live traffic and confirm the gathering point.'+(rtd?' Check station service alerts and have your fare method ready.':'')+'</p>';
  const reminders=plan.extraReminders.split('\n').map(clean).filter(Boolean);
  if(reminders.length)html+='<ul>'+reminders.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>';
  html+='<p>Reminders appear only in this plan; no notifications are sent.</p></section>';
  if(rtd){
    const ticket=TICKETS[plan.ticketMethod]||TICKETS.mobile;
    html+='<section><h3>Parking and station arrival</h3><p>'+escapeHtml(parkingAdvice(station))+'</p>';
    if(station.parkingNotes)html+='<p>'+escapeHtml(station.parkingNotes)+'</p>';
    if(plan.parkingNotes)html+='<p><strong>Instructions for friends:</strong> '+escapeHtml(plan.parkingNotes)+'</p>';
    html+='<p>'+escapeHtml(String(plan.arrivalBuffer))+' minutes are reserved after arrival for parking or drop-off, getting a ticket and reaching the meeting point. RTD spaces are for permitted vehicles; arrange motorcoach loading separately.</p>';
    if(station.parkingSpaces!==0)html+='<p>Check your vehicle’s RTD district status and posted charges. If payment is required, pay before boarding using the lot’s pay station or Parking.com with the correct license plate and zone.</p>';
    html+='<p>'+sourceLink(station.sourceUrl,'Station details')+' · '+sourceLink('https://www.rtd-denver.com/how-to-ride/parking','RTD parking rules and payment')+'</p></section>';
    html+='<section><h3>Tickets: '+escapeHtml(ticket.label)+'</h3><p>'+escapeHtml(ticket.text)+'</p><p>'+sourceLink(ticket.url,'RTD ticket instructions')+' · '+sourceLink('https://www.rtd-denver.com/fares-passes/fares','Current fares and discounts')+'</p></section>';
    html+='<p><strong>Trip ends at the station.</strong> The rail journey, train departures and arrival at a later meeting are not calculated. '+sourceLink('https://app.rtd-denver.com/','Check RTD schedules and service alerts')+'</p>';
  }
  if(plan.notes)html+='<section><h3>Route notes</h3><p>'+escapeHtml(plan.notes)+'</p></section>';
  els.travelPlanDetails.innerHTML=html;
}

function openLogin(){els.loginModal.classList.add('open');setTimeout(()=>els.loginPassword.focus(),50);}
function closeLogin(){els.loginModal.classList.remove('open');}
els.loginButton.addEventListener('click',openLogin);document.getElementById('cancelLogin').addEventListener('click',closeLogin);els.loginModal.addEventListener('click',event=>{if(event.target===els.loginModal)closeLogin();});
els.loginForm.addEventListener('submit',async event=>{event.preventDefault();try{await signInWithEmailAndPassword(auth,els.loginEmail.value.trim(),els.loginPassword.value);els.loginPassword.value='';closeLogin();toast('Administrator signed in.');}catch(error){toast(friendlyError(error),true);}});
document.getElementById('resetPassword').addEventListener('click',async()=>{try{await sendPasswordResetEmail(auth,els.loginEmail.value.trim()||ADMIN_EMAIL);toast('Password reset email sent.');}catch(error){toast(friendlyError(error),true);}});
els.signOutButton.addEventListener('click',async()=>{await signOut(auth);toast('Signed out.');});
els.form.addEventListener('input',invalidateRoute);els.form.addEventListener('change',invalidateRoute);
els.tripPurpose.addEventListener('change',handlePurposeChange);
els.stationEditor.addEventListener('toggle',syncRtdFields);
els.stationLat.addEventListener('change',previewStationPoint);els.stationLng.addEventListener('change',previewStationPoint);
document.getElementById('addStation').addEventListener('click',addStation);
document.getElementById('inspectStation').addEventListener('click',()=>{if(!clean(els.stationAddress.value)){toast('Enter the station street address first.',true);return;}window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(els.stationName.value+', '+els.stationAddress.value),'_blank','noopener');});
document.getElementById('printPlan').addEventListener('click',()=>{if(currentRoute)window.print();});
els.form.addEventListener('submit',calculateRoute);els.hotelSelect.addEventListener('change',handleHotelChange);els.destinationSelect.addEventListener('change',handleDestinationChange);els.customDestinationName.addEventListener('input',()=>{if(customDestination){customDestination.name=clean(els.customDestinationName.value)||'Custom meeting point';setDestinationMarker(customDestination);}});els.customDestinationAddress.addEventListener('input',()=>{if(customDestination)customDestination.address=clean(els.customDestinationAddress.value);});els.customDestinationLat.addEventListener('change',updateCustomDestination);els.customDestinationLng.addEventListener('change',updateCustomDestination);els.newRouteButton.addEventListener('click',resetPlanner);els.saveRouteButton.addEventListener('click',saveRoute);

populateHotels();initDefaults();initMap();rebuildLocations();
if(new URLSearchParams(location.search).get('mode')==='rtd')els.tripPurpose.value='rtd';
handlePurposeChange();
try{
  app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,user=>{currentUser=user;els.loginButton.hidden=Boolean(user);els.signOutButton.hidden=!user;if(user&&!isAdmin())toast('This account has viewing access only.',true);subscribeSavedRoutes();updateSaveButton();});
  onSnapshot(collection(db,'halls'),snapshot=>{publicHallData.clear();snapshot.forEach(s=>publicHallData.set(s.id,s.data()));rebuildLocations();},error=>toast('The saved meeting-location list could not be loaded: '+friendlyError(error),true));
}catch(error){toast('Firebase could not initialize: '+friendlyError(error),true);}
updateSaveButton();

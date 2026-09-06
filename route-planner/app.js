import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp,
  query, where
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from '../bus-access/data.js';
import { HOTELS } from './hotels.js';

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
const DENVER_TZ='America/Denver';
const HOTEL_CACHE_KEY='convention-fs-hotel-geocode-v1';
const ROUTE_COLORS=['#0b5b9f','#0e8454','#7a4ba3','#c86a17','#9d354c'];

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
await setPersistence(auth,browserLocalPersistence);

const BASE_LOCATIONS=HALLS.map(h=>({
  ...h,id:String(h.id),locationType:'kingdom-hall',markerLabel:String(h.number),customLocation:false
}));
let locations=[...BASE_LOCATIONS];
let publicHallData=new Map();
let currentUser=null;
let savedRoutes=[];
let savedRoutesUnsubscribe=null;
let activeRouteId=null;
let currentResult=null;
let map,routeLayer,originMarker,destinationMarker;
const locationMarkers=new Map();

const routeForm=document.getElementById('routeForm');
const hotelSelect=document.getElementById('hotelSelect');
const destinationSelect=document.getElementById('destinationSelect');
const meetingDateTime=document.getElementById('meetingDateTime');
const resultCard=document.getElementById('resultCard');
const saveRouteButton=document.getElementById('saveRouteButton');
const serviceNote=document.getElementById('serviceNote');

function escapeHtml(value=''){
  return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function clean(value=''){return String(value??'').trim();}
function isAdmin(){return currentUser?.email?.toLowerCase()===ADMIN_EMAIL;}
function findHotel(id){return HOTELS.find(h=>h.id===id);}
function findLocation(id){return locations.find(l=>l.id===String(id));}
function markerLabel(location){return clean(location.markerLabel||location.number||'M');}
function typeLabel(location){return location.locationType==='meeting-area'?'Meeting area':'Kingdom Hall';}
function toast(message,error=false){
  const el=document.getElementById('toast');
  el.textContent=message;
  el.className='toast show'+(error?' error':'');
  clearTimeout(el._timer);
  el._timer=setTimeout(()=>el.className='toast',3800);
}
function friendlyError(error){
  const code=error?.code||'';
  if(code.includes('invalid-credential'))return'The email or password is not correct.';
  if(code.includes('permission-denied'))return'Firebase denied this action. Confirm the Firestore rules and administrator email.';
  if(code.includes('unauthorized-domain'))return'Add letdesignworks.github.io under Firebase Authentication → Settings → Authorized domains.';
  if(code.includes('network-request-failed')||code.includes('unavailable'))return'The network or routing service is temporarily unavailable.';
  return error?.message?.replace(/^Firebase:\s*/,'')||'Unknown error';
}
function mapsDirectionsUrl(origin,destination){
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.address)}&destination=${encodeURIComponent(destination.address)}&travelmode=driving`;
}
function appleDirectionsUrl(origin,destination){
  return `https://maps.apple.com/?saddr=${encodeURIComponent(origin.address)}&daddr=${encodeURIComponent(destination.address)}&dirflg=d`;
}
function numberValue(id,defaultValue=0){
  const n=Number(document.getElementById(id).value);
  return Number.isFinite(n)?n:defaultValue;
}

function denverParts(date){
  const formatter=new Intl.DateTimeFormat('en-CA',{
    timeZone:DENVER_TZ,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  });
  return Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
function zonedLocalToDate(value){
  const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)return new Date(NaN);
  const target={year:+match[1],month:+match[2],day:+match[3],hour:+match[4],minute:+match[5],second:0};
  const targetUtc=Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute,0);
  let guess=targetUtc;
  for(let i=0;i<4;i++){
    const p=denverParts(new Date(guess));
    const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    const correction=targetUtc-represented;
    guess+=correction;
    if(Math.abs(correction)<1000)break;
  }
  return new Date(guess);
}
function dateToLocalInput(date){
  const p=denverParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function formatDenver(date,includeDate=true){
  if(!(date instanceof Date))date=new Date(date);
  return new Intl.DateTimeFormat('en-US',{
    timeZone:DENVER_TZ,
    ...(includeDate?{weekday:'short',month:'short',day:'numeric'}:{}),
    hour:'numeric',minute:'2-digit'
  }).format(date);
}
function setDefaultMeetingTime(){
  const p=denverParts(new Date());
  const next=new Date(Date.UTC(+p.year,+p.month-1,+p.day+1,9,0,0));
  const y=next.getUTCFullYear();
  const m=String(next.getUTCMonth()+1).padStart(2,'0');
  const d=String(next.getUTCDate()).padStart(2,'0');
  meetingDateTime.value=`${y}-${m}-${d}T09:00`;
}

function populateHotels(){
  const selected=hotelSelect.value;
  hotelSelect.innerHTML='<option value="">Select a hotel…</option>';
  const groups=[...new Set(HOTELS.map(h=>h.group))];
  for(const group of groups){
    const optgroup=document.createElement('optgroup');
    optgroup.label=group;
    for(const hotel of HOTELS.filter(h=>h.group===group)){
      const option=document.createElement('option');
      option.value=hotel.id;
      option.textContent=`${hotel.marker} — ${hotel.name}`;
      optgroup.appendChild(option);
    }
    hotelSelect.appendChild(optgroup);
  }
  if(HOTELS.some(h=>h.id===selected))hotelSelect.value=selected;
  updateHotelAddress();
}
function normalizeCustom(id,data){
  const lat=Number(data.lat),lng=Number(data.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
  const congregations=Array.isArray(data.congregations)?data.congregations:[];
  return{
    id:String(id),number:clean(data.number||data.markerLabel||'M'),
    markerLabel:clean(data.markerLabel||data.number||'M'),
    name:clean(data.name||'Added planning location'),
    address:clean(data.address||`${lat}, ${lng}`),lat,lng,
    congregations,congregationCount:congregations.length,
    locationType:data.locationType==='meeting-area'?'meeting-area':'kingdom-hall',
    customLocation:true
  };
}
function rebuildLocations(){
  const custom=[];
  for(const [id,data] of publicHallData.entries()){
    if(data.customLocation===true){
      const item=normalizeCustom(id,data);
      if(item)custom.push(item);
    }
  }
  custom.sort((a,b)=>markerLabel(a).localeCompare(markerLabel(b),undefined,{numeric:true}));
  locations=[...BASE_LOCATIONS,...custom];
  populateDestinations();
  syncLocationMarkers();
}
function populateDestinations(){
  const previous=destinationSelect.value;
  destinationSelect.innerHTML='<option value="">Select a Kingdom Hall or meeting area…</option>';
  const groups=[
    ['Kingdom Halls',locations.filter(l=>l.locationType!=='meeting-area')],
    ['Other Meeting Areas',locations.filter(l=>l.locationType==='meeting-area')]
  ];
  for(const [label,items] of groups){
    if(!items.length)continue;
    const optgroup=document.createElement('optgroup');
    optgroup.label=label;
    for(const location of items){
      const option=document.createElement('option');
      option.value=location.id;
      option.textContent=`${markerLabel(location)} — ${location.name}${location.customLocation?' • Added':''}`;
      optgroup.appendChild(option);
    }
    destinationSelect.appendChild(optgroup);
  }
  if(locations.some(l=>l.id===previous))destinationSelect.value=previous;
  const requested=new URLSearchParams(location.search).get('destination');
  if(requested&&locations.some(l=>l.id===requested))destinationSelect.value=requested;
  updateDestinationAddress();
}
function updateHotelAddress(){
  const hotel=findHotel(hotelSelect.value);
  document.getElementById('hotelAddress').textContent=hotel?`${hotel.address} • ${hotel.crossStreets}`:'Select one of the international delegate hotels.';
  if(hotel&&!clean(document.getElementById('routeName').value)){
    const destination=findLocation(destinationSelect.value);
    if(destination)document.getElementById('routeName').value=`${hotel.marker} to ${markerLabel(destination)} — Field Service`;
  }
}
function updateDestinationAddress(){
  const destination=findLocation(destinationSelect.value);
  document.getElementById('destinationAddress').textContent=destination?`${destination.address} • ${typeLabel(destination)}`:'Kingdom Halls and administrator-added meeting areas appear here.';
  if(destination&&!clean(document.getElementById('routeName').value)){
    const hotel=findHotel(hotelSelect.value);
    if(hotel)document.getElementById('routeName').value=`${hotel.marker} to ${markerLabel(destination)} — Field Service`;
  }
  if(destination&&map){
    map.panTo([destination.lat,destination.lng],{animate:true});
  }
}

function locationIcon(location){
  const meeting=location.locationType==='meeting-area';
  return L.divIcon({
    className:'',
    html:`<div class="location-marker${meeting?' meeting':''}">${escapeHtml(markerLabel(location))}</div>`,
    iconSize:[30,30],iconAnchor:[15,15]
  });
}
function syncLocationMarkers(){
  if(!map)return;
  const active=new Set(locations.map(l=>l.id));
  for(const [id,marker] of locationMarkers.entries()){
    if(!active.has(id)){map.removeLayer(marker);locationMarkers.delete(id);}
  }
  for(const location of locations){
    let marker=locationMarkers.get(location.id);
    if(!marker){
      marker=L.marker([location.lat,location.lng],{icon:locationIcon(location),opacity:.72}).addTo(map);
      marker.on('click',()=>{
        destinationSelect.value=location.id;
        updateDestinationAddress();
        document.querySelector('.side-panel').scrollTo({top:0,behavior:'smooth'});
      });
      marker.bindTooltip(`${markerLabel(location)}. ${location.name}`,{direction:'top'});
      locationMarkers.set(location.id,marker);
    }else{
      marker.setLatLng([location.lat,location.lng]);
      marker.setIcon(locationIcon(location));
    }
  }
}
function initMap(){
  if(!window.L){
    document.getElementById('map').innerHTML='<div style="padding:24px">The map library could not load. The route form remains available.</div>';
    return;
  }
  map=L.map('map',{zoomControl:true,attributionControl:true}).setView(DTC,10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  L.polygon(DTC_BOUNDARY,{
    color:'#0b5b9f',weight:2,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.025,interactive:false
  }).addTo(map);
  syncLocationMarkers();
  map.fitBounds(L.latLngBounds(DTC_BOUNDARY),{padding:[20,20]});
  L.control.scale({imperial:true,metric:false,position:'bottomright'}).addTo(map);
}
function clearRouteMap(){
  if(routeLayer){map.removeLayer(routeLayer);routeLayer=null;}
  if(originMarker){map.removeLayer(originMarker);originMarker=null;}
  if(destinationMarker){map.removeLayer(destinationMarker);destinationMarker=null;}
}
function drawRoute(result){
  if(!map)return;
  clearRouteMap();
  const origin=[result.originLat,result.originLng];
  const destination=[result.destinationLat,result.destinationLng];
  originMarker=L.marker(origin,{icon:L.divIcon({className:'',html:`<div class="route-origin-marker">${escapeHtml(result.hotelMarker)}</div>`,iconSize:[40,40],iconAnchor:[20,20]})}).addTo(map).bindTooltip(result.hotelName,{direction:'top'});
  destinationMarker=L.marker(destination,{icon:L.divIcon({className:'',html:'<div class="route-destination-marker">★</div>',iconSize:[42,42],iconAnchor:[21,21]})}).addTo(map).bindTooltip(result.destinationName,{direction:'top'});
  const points=(Array.isArray(result.routeCoordinates)&&result.routeCoordinates.length>1)
    ?result.routeCoordinates.map(p=>[p[1],p[0]]):[origin,destination];
  routeLayer=L.polyline(points,{color:ROUTE_COLORS[0],weight:6,opacity:.86,dashArray:result.routeCoordinates?.length>1?null:'9 7'}).addTo(map);
  map.fitBounds(routeLayer.getBounds(),{padding:[48,48],maxZoom:13});
}

function readHotelCache(){
  try{return JSON.parse(localStorage.getItem(HOTEL_CACHE_KEY)||'{}');}catch{return{};}
}
function saveHotelCache(cache){
  try{localStorage.setItem(HOTEL_CACHE_KEY,JSON.stringify(cache));}catch{}
}
async function fetchWithTimeout(url,options={},timeout=18000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);}
}
async function geocodeHotel(hotel){
  const cache=readHotelCache();
  if(cache[hotel.id]&&Number.isFinite(cache[hotel.id].lat)&&Number.isFinite(cache[hotel.id].lng))return cache[hotel.id];
  const queryText=`${hotel.name}, ${hotel.address}`;
  try{
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(queryText)}`;
    const response=await fetchWithTimeout(url,{headers:{Accept:'application/json','Accept-Language':'en'}});
    if(response.ok){
      const items=await response.json();
      if(items?.length){
        const result={lat:Number(items[0].lat),lng:Number(items[0].lon),source:'Nominatim'};
        if(Number.isFinite(result.lat)&&Number.isFinite(result.lng)){cache[hotel.id]=result;saveHotelCache(cache);return result;}
      }
    }
  }catch{}
  try{
    const url=`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(queryText)}`;
    const response=await fetchWithTimeout(url,{headers:{Accept:'application/json'}});
    if(response.ok){
      const data=await response.json();
      const coordinates=data?.features?.[0]?.geometry?.coordinates;
      if(Array.isArray(coordinates)){
        const result={lat:Number(coordinates[1]),lng:Number(coordinates[0]),source:'Photon'};
        if(Number.isFinite(result.lat)&&Number.isFinite(result.lng)){cache[hotel.id]=result;saveHotelCache(cache);return result;}
      }
    }
  }catch{}
  throw new Error('The hotel address could not be located automatically. Try again, or verify the route manually in Google Maps.');
}
function simplifyCoordinates(coordinates,maxPoints=220){
  if(!Array.isArray(coordinates)||coordinates.length<=maxPoints)return coordinates||[];
  const step=(coordinates.length-1)/(maxPoints-1);
  const output=[];
  for(let i=0;i<maxPoints;i++)output.push(coordinates[Math.round(i*step)]);
  return output;
}
async function requestRoadRoute(origin,destination){
  const url=`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response=await fetchWithTimeout(url,{headers:{Accept:'application/json'}},22000);
  if(!response.ok)throw new Error(`The routing service returned ${response.status}.`);
  const data=await response.json();
  const route=data?.routes?.[0];
  if(!route)throw new Error('No road route was returned between these locations.');
  return{
    distanceMeters:Number(route.distance),
    durationSeconds:Number(route.duration),
    coordinates:simplifyCoordinates(route.geometry?.coordinates||[])
  };
}

function renderResult(result){
  currentResult=result;
  resultCard.hidden=false;
  document.getElementById('resultTitle').textContent=result.manualOverride?'Departure Using Confirmed Drive Time':'Recommended Bus Departure';
  document.getElementById('estimateChip').textContent=result.manualOverride?'Confirmed time override':'Road-network estimate';
  document.getElementById('resultHotel').textContent=`${result.hotelMarker} — ${result.hotelName}`;
  document.getElementById('resultHotelAddress').textContent=result.hotelAddress;
  document.getElementById('resultDestination').textContent=`${result.destinationMarker} — ${result.destinationName}`;
  document.getElementById('resultDestinationAddress').textContent=result.destinationAddress;
  document.getElementById('distanceValue').textContent=Number.isFinite(result.distanceMiles)?`${result.distanceMiles.toFixed(1)} mi`:'Not available';
  document.getElementById('driveTimeValue').textContent=`${Math.round(result.driveMinutes)} min`;
  document.getElementById('contingencyValue').textContent=`${result.routeBuffer} min`;
  document.getElementById('reportTimeValue').textContent=formatDenver(result.reportTime);
  document.getElementById('leaveTimeValue').textContent=formatDenver(result.leaveTime);
  document.getElementById('arrivalTimeValue').textContent=formatDenver(result.arrivalTime);
  document.getElementById('meetingTimeValue').textContent=formatDenver(result.meetingTime);
  document.getElementById('calculationExplanation').innerHTML=
    `The bus departure is calculated by subtracting <strong>${Math.round(result.driveMinutes)} minutes of drive time</strong>, `+
    `<strong>${result.routeBuffer} minutes of contingency</strong>, and <strong>${result.arriveEarly} minutes of early-arrival time</strong> from the meeting time. `+
    `Passengers are asked to report <strong>${result.loadingBuffer} minutes before the bus departure</strong>.`;
  document.getElementById('googleRouteLink').href=mapsDirectionsUrl({address:result.hotelAddress},{address:result.destinationAddress});
  document.getElementById('appleRouteLink').href=appleDirectionsUrl({address:result.hotelAddress},{address:result.destinationAddress});
  saveRouteButton.textContent=activeRouteId?'Update Saved Route':'Save Route';
  document.getElementById('saveMessage').textContent=isAdmin()
    ?(activeRouteId?'This will update the loaded saved route.':'This route can now be saved to Firebase.')
    :'Sign in as the administrator to save this route to Firebase.';
  drawRoute(result);
  resultCard.scrollIntoView({behavior:'smooth',block:'start'});
}
function currentFormValues(){
  return{
    routeName:clean(document.getElementById('routeName').value),
    assignedTo:document.getElementById('assignedTo').value,
    routeStatus:document.getElementById('routeStatus').value,
    routeNotes:clean(document.getElementById('routeNotes').value),
    meetingDateTime:meetingDateTime.value,
    arriveEarly:numberValue('arriveEarly',15),
    routeBuffer:numberValue('routeBuffer',15),
    loadingBuffer:numberValue('loadingBuffer',20),
    manualMinutes:numberValue('manualMinutes',0)
  };
}

async function calculateRoute(event){
  event?.preventDefault();
  const hotel=findHotel(hotelSelect.value);
  const destination=findLocation(destinationSelect.value);
  const meetingTime=zonedLocalToDate(meetingDateTime.value);
  if(!hotel||!destination){toast('Select both a hotel and a meeting location.',true);return;}
  if(Number.isNaN(meetingTime.getTime())){toast('Select a valid meeting date and time.',true);return;}
  const values=currentFormValues();
  const button=document.getElementById('calculateButton');
  button.disabled=true;button.textContent='Calculating…';
  serviceNote.hidden=true;
  try{
    const origin=await geocodeHotel(hotel);
    let roadRoute=null;
    try{
      roadRoute=await requestRoadRoute(origin,{lat:destination.lat,lng:destination.lng});
    }catch(error){
      if(!values.manualMinutes)throw error;
      serviceNote.textContent='The road-routing service was unavailable, so this schedule uses your confirmed drive-time override and a straight line on the map.';
      serviceNote.hidden=false;
    }
    const baselineMinutes=roadRoute?Math.ceil(roadRoute.durationSeconds/60):values.manualMinutes;
    const driveMinutes=values.manualMinutes||baselineMinutes;
    const arrivalTime=new Date(meetingTime.getTime()-values.arriveEarly*60000);
    const leaveTime=new Date(arrivalTime.getTime()-(driveMinutes+values.routeBuffer)*60000);
    const reportTime=new Date(leaveTime.getTime()-values.loadingBuffer*60000);
    const result={
      hotelId:hotel.id,hotelMarker:hotel.marker,hotelName:hotel.name,hotelAddress:hotel.address,
      destinationId:destination.id,destinationMarker:markerLabel(destination),destinationName:destination.name,
      destinationAddress:destination.address,destinationType:typeLabel(destination),
      originLat:origin.lat,originLng:origin.lng,destinationLat:destination.lat,destinationLng:destination.lng,
      distanceMiles:roadRoute?roadRoute.distanceMeters/1609.344:null,
      baselineMinutes,driveMinutes,manualOverride:Boolean(values.manualMinutes),
      routeCoordinates:roadRoute?.coordinates||[],
      meetingTime,arrivalTime,leaveTime,reportTime,
      meetingTimeIso:meetingTime.toISOString(),arrivalTimeIso:arrivalTime.toISOString(),
      leaveTimeIso:leaveTime.toISOString(),reportTimeIso:reportTime.toISOString(),
      arriveEarly:values.arriveEarly,routeBuffer:values.routeBuffer,loadingBuffer:values.loadingBuffer,
      routeName:values.routeName||`${hotel.marker} to ${markerLabel(destination)} — Field Service`,
      assignedTo:values.assignedTo,routeStatus:values.routeStatus,routeNotes:values.routeNotes,
      calculationSource:values.manualMinutes?'manual-override':(roadRoute?'osrm':'manual-override')
    };
    if(!values.routeName)document.getElementById('routeName').value=result.routeName;
    renderResult(result);
  }catch(error){
    toast('Route calculation failed: '+friendlyError(error),true);
    serviceNote.textContent='Use “Verify in Google Maps” after selecting the locations, or enter a confirmed drive-time override and calculate again.';
    serviceNote.hidden=false;
  }finally{
    button.disabled=false;button.textContent='Calculate Route & Departure';
  }
}

async function saveCurrentRoute(){
  if(!currentResult){toast('Calculate a route before saving it.',true);return;}
  if(!isAdmin()){openLogin();toast('Administrator sign-in is required to save routes.',true);return;}
  const values=currentFormValues();
  const routeRef=activeRouteId?doc(db,'reviews',activeRouteId):doc(collection(db,'reviews'));
  saveRouteButton.disabled=true;saveRouteButton.textContent='Saving…';
  try{
    const payload={
      recordType:'route-plan',visibility:'private',
      routeName:values.routeName||currentResult.routeName,
      assignedTo:values.assignedTo,routeStatus:values.routeStatus,routeNotes:values.routeNotes,
      hotelId:currentResult.hotelId,hotelMarker:currentResult.hotelMarker,
      hotelName:currentResult.hotelName,hotelAddress:currentResult.hotelAddress,
      destinationId:currentResult.destinationId,destinationMarker:currentResult.destinationMarker,
      destinationName:currentResult.destinationName,destinationAddress:currentResult.destinationAddress,
      destinationType:currentResult.destinationType,
      originLat:currentResult.originLat,originLng:currentResult.originLng,
      destinationLat:currentResult.destinationLat,destinationLng:currentResult.destinationLng,
      distanceMiles:currentResult.distanceMiles??null,
      baselineMinutes:currentResult.baselineMinutes,driveMinutes:currentResult.driveMinutes,
      manualOverride:currentResult.manualOverride,calculationSource:currentResult.calculationSource,
      routeCoordinates:currentResult.routeCoordinates||[],
      meetingTimeIso:currentResult.meetingTimeIso,arrivalTimeIso:currentResult.arrivalTimeIso,
      leaveTimeIso:currentResult.leaveTimeIso,reportTimeIso:currentResult.reportTimeIso,
      meetingDateTimeLocal:meetingDateTime.value,
      arriveEarly:values.arriveEarly,routeBuffer:values.routeBuffer,loadingBuffer:values.loadingBuffer,
      updatedByEmail:currentUser.email,updatedAt:serverTimestamp(),
      ...(activeRouteId?{}:{createdAt:serverTimestamp()})
    };
    await setDoc(routeRef,payload,{merge:true});
    activeRouteId=routeRef.id;
    currentResult={...currentResult,...payload};
    toast('Bus route saved to Firebase.');
    renderResult(currentResult);
  }catch(error){
    toast('Could not save the route: '+friendlyError(error),true);
  }finally{
    saveRouteButton.disabled=false;saveRouteButton.textContent='Update Saved Route';
  }
}
function statusLabel(status){
  return status==='confirmed'?'Confirmed':status==='needs-verification'?'Needs verification':'Draft';
}
function renderSavedRoutes(){
  const signedOut=document.getElementById('savedRoutesSignedOut');
  const list=document.getElementById('savedRoutesList');
  if(!isAdmin()){
    signedOut.hidden=false;list.hidden=true;list.innerHTML='';return;
  }
  signedOut.hidden=true;list.hidden=false;
  if(!savedRoutes.length){
    list.innerHTML='<div class="signed-out-copy">No routes have been saved yet. Calculate a route above, then select Save Route.</div>';
    return;
  }
  list.innerHTML=savedRoutes.map(route=>{
    const status=route.routeStatus||'draft';
    return`<article class="saved-route">
      <div class="saved-route-head">
        <div><h3>${escapeHtml(route.routeName||`${route.hotelMarker} to ${route.destinationMarker}`)}</h3>
        <p>${escapeHtml(route.hotelMarker||'Hotel')} ${escapeHtml(route.hotelName||'')} → ${escapeHtml(route.destinationMarker||'')} ${escapeHtml(route.destinationName||'')}</p></div>
        <span class="status-pill status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
      </div>
      <div class="schedule">Leave ${escapeHtml(formatDenver(route.leaveTimeIso))} • Meet ${escapeHtml(formatDenver(route.meetingTimeIso))}</div>
      <p>${Math.round(Number(route.driveMinutes)||0)} min drive${Number.isFinite(Number(route.distanceMiles))?` • ${Number(route.distanceMiles).toFixed(1)} mi`:''}${route.assignedTo?` • Assigned to ${escapeHtml(route.assignedTo)}`:''}</p>
      <div class="saved-route-actions">
        <button class="btn secondary" type="button" data-load-route="${escapeHtml(route.id)}">Load / Edit</button>
        <a class="btn secondary" target="_blank" rel="noopener" href="${mapsDirectionsUrl({address:route.hotelAddress},{address:route.destinationAddress})}">Google Maps</a>
        <button class="btn secondary" type="button" data-delete-route="${escapeHtml(route.id)}">Delete</button>
      </div>
    </article>`;
  }).join('');
  list.querySelectorAll('[data-load-route]').forEach(button=>button.addEventListener('click',()=>loadSavedRoute(button.dataset.loadRoute)));
  list.querySelectorAll('[data-delete-route]').forEach(button=>button.addEventListener('click',()=>removeSavedRoute(button.dataset.deleteRoute)));
}
function loadSavedRoute(id){
  const route=savedRoutes.find(r=>r.id===id);
  if(!route)return;
  activeRouteId=id;
  hotelSelect.value=route.hotelId||'';
  destinationSelect.value=route.destinationId||'';
  meetingDateTime.value=route.meetingDateTimeLocal||dateToLocalInput(new Date(route.meetingTimeIso));
  document.getElementById('arriveEarly').value=route.arriveEarly??15;
  document.getElementById('routeBuffer').value=route.routeBuffer??15;
  document.getElementById('loadingBuffer').value=route.loadingBuffer??20;
  document.getElementById('manualMinutes').value=route.manualOverride?route.driveMinutes:'';
  document.getElementById('routeName').value=route.routeName||'';
  document.getElementById('assignedTo').value=route.assignedTo||'';
  document.getElementById('routeStatus').value=route.routeStatus||'draft';
  document.getElementById('routeNotes').value=route.routeNotes||'';
  updateHotelAddress();updateDestinationAddress();
  const result={
    ...route,
    meetingTime:new Date(route.meetingTimeIso),arrivalTime:new Date(route.arrivalTimeIso),
    leaveTime:new Date(route.leaveTimeIso),reportTime:new Date(route.reportTimeIso),
    routeCoordinates:route.routeCoordinates||[]
  };
  renderResult(result);
  toast('Saved route loaded. Recalculate to refresh the road estimate, or update the saved plan.');
}
async function removeSavedRoute(id){
  const route=savedRoutes.find(r=>r.id===id);
  if(!route||!isAdmin())return;
  if(!window.confirm(`Delete “${route.routeName||'this saved route'}”?`))return;
  try{
    await deleteDoc(doc(db,'reviews',id));
    if(activeRouteId===id){activeRouteId=null;saveRouteButton.textContent='Save Route';}
    toast('Saved route deleted.');
  }catch(error){toast('Could not delete the route: '+friendlyError(error),true);}
}
function startSavedRoutesListener(){
  if(savedRoutesUnsubscribe){savedRoutesUnsubscribe();savedRoutesUnsubscribe=null;}
  if(!isAdmin()){savedRoutes=[];renderSavedRoutes();return;}
  const routeQuery=query(collection(db,'reviews'),where('recordType','==','route-plan'));
  savedRoutesUnsubscribe=onSnapshot(routeQuery,snapshot=>{
    savedRoutes=snapshot.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.meetingTimeIso||'').localeCompare(String(b.meetingTimeIso||'')));
    renderSavedRoutes();
  },error=>{
    toast('Could not load saved routes: '+friendlyError(error),true);
    savedRoutes=[];renderSavedRoutes();
  });
}

function clearPlanner(){
  activeRouteId=null;currentResult=null;resultCard.hidden=true;
  routeForm.reset();populateHotels();populateDestinations();setDefaultMeetingTime();
  document.getElementById('arriveEarly').value=15;
  document.getElementById('routeBuffer').value=15;
  document.getElementById('loadingBuffer').value=20;
  clearRouteMap();
  if(map)map.fitBounds(L.latLngBounds(DTC_BOUNDARY),{padding:[20,20]});
  serviceNote.hidden=true;
}
function openLogin(){document.getElementById('loginModal').classList.add('open');setTimeout(()=>document.getElementById('loginPassword').focus(),50);}
function closeLogin(){document.getElementById('loginModal').classList.remove('open');}

routeForm.addEventListener('submit',calculateRoute);
hotelSelect.addEventListener('change',updateHotelAddress);
destinationSelect.addEventListener('change',updateDestinationAddress);
document.getElementById('clearButton').addEventListener('click',clearPlanner);
saveRouteButton.addEventListener('click',saveCurrentRoute);
document.getElementById('loginButton').addEventListener('click',openLogin);
document.getElementById('cancelLogin').addEventListener('click',closeLogin);
document.getElementById('loginModal').addEventListener('click',event=>{if(event.target.id==='loginModal')closeLogin();});
document.getElementById('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    await signInWithEmailAndPassword(auth,document.getElementById('loginEmail').value.trim(),document.getElementById('loginPassword').value);
    document.getElementById('loginPassword').value='';
    closeLogin();toast('Administrator signed in.');
  }catch(error){toast(friendlyError(error),true);}
});
document.getElementById('resetPassword').addEventListener('click',async()=>{
  const email=clean(document.getElementById('loginEmail').value)||ADMIN_EMAIL;
  try{await sendPasswordResetEmail(auth,email);toast('Password reset email sent.');}
  catch(error){toast(friendlyError(error),true);}
});
document.getElementById('signOutButton').addEventListener('click',async()=>{await signOut(auth);toast('Signed out.');});

onAuthStateChanged(auth,user=>{
  currentUser=user;
  document.getElementById('loginButton').hidden=Boolean(user);
  document.getElementById('signOutButton').hidden=!user;
  if(user&&!isAdmin())toast('This account has viewing access only.',true);
  document.getElementById('saveMessage').textContent=isAdmin()?'Calculate a route, then save it to Firebase.':'Sign in as the administrator to save route plans.';
  startSavedRoutesListener();
});

onSnapshot(collection(db,'halls'),snapshot=>{
  publicHallData=new Map(snapshot.docs.map(d=>[d.id,d.data()]));
  rebuildLocations();
},error=>{
  toast('Added meeting locations could not be loaded: '+friendlyError(error),true);
  locations=[...BASE_LOCATIONS];populateDestinations();syncLocationMarkers();
});

populateHotels();
populateDestinations();
setDefaultMeetingTime();
initMap();
renderSavedRoutes();

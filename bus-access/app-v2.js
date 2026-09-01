import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, onSnapshot, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from './data.js';

const firebaseConfig={apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'};
const ADMIN_EMAIL='michaeltarin@hotmail.com';
const STATUS={
  'not-reviewed':{label:'Not reviewed',color:'#667085'},
  'inspection-scheduled':{label:'Inspection scheduled',color:'#0b4da2'},
  approved:{label:'Approved',color:'#0e9453'},
  conditional:{label:'Conditional',color:'#d99a00'},
  'not-suitable':{label:'Not suitable',color:'#c9362b'}
};
const BUS_SIZE_LABELS={'passenger-van':'Passenger van',shuttle:'Shuttle bus','school-bus':'School bus','40-foot-motorcoach':'40-foot motorcoach','45-foot-motorcoach':'45-foot motorcoach'};
const TYPE_LABELS={'kingdom-hall':'Kingdom Hall','meeting-area':'Other meeting area'};
const BASE_LOCATIONS=HALLS.map(h=>({...h,id:String(h.id),markerLabel:String(h.number),locationType:'kingdom-hall',planningArea:'dtc-45',customLocation:false}));

let app,auth,db,map,boundaryLayer,currentUser=null,selectedId=null,locations=[...BASE_LOCATIONS],pendingSelectId=null;
const publicData=new Map();
const markers=new Map();
const detail=document.getElementById('detail');
const hallList=document.getElementById('hallList');
const statusFilter=document.getElementById('statusFilter');
const searchInput=document.getElementById('searchInput');
const firebaseWarning=document.getElementById('firebaseWarning');
const addLocationButton=document.getElementById('addLocationButton');
const locationModal=document.getElementById('locationModal');
const locationForm=document.getElementById('locationForm');

function escapeHtml(value=''){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function clean(value=''){return String(value??'').trim();}
function parseLines(value=''){return String(value).split(/[\n;]+/).map(v=>v.trim()).filter(Boolean);}
function isAdmin(){return currentUser?.email?.toLowerCase()===ADMIN_EMAIL;}
function findLocation(id){return locations.find(x=>x.id===String(id));}
function markerLabel(location){return clean(location.markerLabel||location.number||'A');}
function typeLabel(location){return TYPE_LABELS[location.locationType]||'Planning location';}
function statusKey(id){return publicData.get(String(id))?.busStatus||'not-reviewed';}
function statusInfo(id){return STATUS[statusKey(id)]||STATUS['not-reviewed'];}
function toast(message,error=false){const t=document.getElementById('toast');t.textContent=message;t.className='toast show'+(error?' error':'');clearTimeout(t._timer);t._timer=setTimeout(()=>t.className='toast',3600);}
function showFirebaseWarning(message){firebaseWarning.textContent=message;firebaseWarning.classList.toggle('show',Boolean(message));}
function mapQuery(location){return clean(location.address)||`${location.lat},${location.lng}`;}
function mapsUrl(location){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery(location))}`;}
function directionsUrl(location){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapQuery(location))}`;}
function streetViewUrl(location){return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location.lat},${location.lng}`;}
function appleUrl(location){return `https://maps.apple.com/?q=${encodeURIComponent(mapQuery(location))}`;}
function friendlyError(error){const code=error?.code||'';if(code.includes('invalid-credential'))return'The email or password is not correct.';if(code.includes('permission-denied'))return'Firestore denied this action. Check the published security rules and administrator email.';if(code.includes('network-request-failed')||code.includes('unavailable'))return'The network or Firebase service is temporarily unavailable.';if(code.includes('unauthorized-domain'))return'Add letdesignworks.github.io under Firebase Authentication → Settings → Authorized domains.';return error?.message?.replace(/^Firebase:\s*/,'')||'Unknown error';}

function normalizeCustom(id,data){
  const lat=Number(data.lat),lng=Number(data.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
  const congregations=Array.isArray(data.congregations)?data.congregations.map(clean).filter(Boolean):parseLines(data.congregations||'');
  return{id:String(id),number:clean(data.markerLabel||data.number||'A'),markerLabel:clean(data.markerLabel||data.number||'A'),name:clean(data.name||'Added planning location'),address:clean(data.address||''),lat,lng,congregations,congregationCount:congregations.length,locationType:data.locationType==='meeting-area'?'meeting-area':'kingdom-hall',planningArea:data.planningArea||'other',customLocation:true};
}
function rebuildLocations(){
  const custom=[];
  for(const[id,data]of publicData.entries())if(data.customLocation===true){const item=normalizeCustom(id,data);if(item)custom.push(item);}
  custom.sort((a,b)=>markerLabel(a).localeCompare(markerLabel(b),undefined,{numeric:true}));
  locations=[...BASE_LOCATIONS,...custom];
}
function markerIcon(location,selected=false){
  const info=statusInfo(location.id),label=markerLabel(location),meeting=location.locationType==='meeting-area';
  return L.divIcon({className:'',html:`<div class="marker-pin${meeting?' meeting-marker':''}${label.length>2?' long-label':''}${selected?' selected':''}" style="background:${info.color}">${escapeHtml(label)}</div>`,iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-19]});
}
function createMarker(location){
  const marker=L.marker([location.lat,location.lng],{icon:markerIcon(location)}).addTo(map);
  marker.on('click',()=>selectLocation(location.id,true));
  marker.bindTooltip(`${markerLabel(location)}. ${location.name}`,{direction:'top',offset:[0,-14]});
  markers.set(location.id,marker);
}
function syncMarkers(){
  if(!map)return;
  const active=new Set(locations.map(x=>x.id));
  for(const[id,marker]of markers.entries())if(!active.has(id)){map.removeLayer(marker);markers.delete(id);}
  for(const location of locations){
    let marker=markers.get(location.id);
    if(!marker){createMarker(location);marker=markers.get(location.id);}else{marker.setLatLng([location.lat,location.lng]);marker.setTooltipContent(`${markerLabel(location)}. ${location.name}`);}
    marker.setIcon(markerIcon(location,location.id===selectedId));
  }
}
function initMap(){
  if(!window.L){document.getElementById('map').innerHTML='<div style="padding:25px">The map library could not load. The location directory and review forms remain available.</div>';return;}
  map=L.map('map',{zoomControl:true,attributionControl:true}).setView(DTC,10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  boundaryLayer=L.polygon(DTC_BOUNDARY,{color:'#0b4da2',weight:3,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.06,interactive:false}).addTo(map);
  L.marker(DTC,{icon:L.divIcon({className:'',html:'<div class="center-star">★</div>',iconSize:[38,38],iconAnchor:[19,19]})}).addTo(map).bindPopup('<div class="pop-title">DTC Center Point</div><div class="pop-address">I-25 & E. Belleview Avenue</div>');
  syncMarkers();
  map.fitBounds(boundaryLayer.getBounds(),{padding:[18,18]});
}
function filteredLocations(){
  const q=searchInput.value.trim().toLowerCase(),sf=statusFilter.value;
  return locations.filter(location=>{if(sf!=='all'&&statusKey(location.id)!==sf)return false;if(!q)return true;return[location.name,location.address,typeLabel(location),...(location.congregations||[]),markerLabel(location)].join(' ').toLowerCase().includes(q);});
}
function updateMarkers(){
  syncMarkers();
  const visible=new Set(filteredLocations().map(x=>x.id));
  for(const location of locations){const marker=markers.get(location.id);if(!marker)continue;marker.setIcon(markerIcon(location,location.id===selectedId));marker.setOpacity(visible.has(location.id)?1:.18);}
}
function renderStats(){
  const counts={'not-reviewed':0,'inspection-scheduled':0,approved:0,conditional:0,'not-suitable':0};
  for(const location of locations)counts[statusKey(location.id)]++;
  const added=locations.filter(x=>x.customLocation).length;
  document.getElementById('stats').innerHTML=`<span class="stat">${locations.length} locations</span>${added?`<span class="stat">${added} added</span>`:''}<span class="stat">${counts.approved} approved</span><span class="stat">${counts.conditional} conditional</span><span class="stat">${counts['not-reviewed']} not reviewed</span>`;
}
function renderList(){
  const items=filteredLocations();
  document.getElementById('visibleCount').textContent=`${items.length} shown`;
  hallList.innerHTML=items.map(location=>{const info=statusInfo(location.id);return`<button type="button" class="list-item" data-location="${escapeHtml(location.id)}"><span class="mini${location.locationType==='meeting-area'?' meeting-mini':''}" style="background:${info.color}">${escapeHtml(markerLabel(location))}</span><span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.address||typeLabel(location))}</small></span><span class="list-status"><em>${escapeHtml(typeLabel(location))}</em><span class="mini-status" style="background:${info.color}">${escapeHtml(info.label)}</span></span></button>`;}).join('')||'<div class="no-results">No locations match this filter.</div>';
  hallList.querySelectorAll('[data-location]').forEach(button=>button.addEventListener('click',()=>selectLocation(button.dataset.location,true)));
  renderStats();updateMarkers();
}

async function selectLocation(id,pan=false){
  selectedId=String(id);const location=findLocation(selectedId);if(!location)return;
  if(pan&&map){map.setView([location.lat,location.lng],Math.max(map.getZoom(),13),{animate:true});markers.get(location.id)?.openTooltip();}
  history.replaceState(null,'',`#location-${encodeURIComponent(location.id)}`);updateMarkers();await renderDetail(location);
  if(window.innerWidth<851)document.getElementById('panel').scrollIntoView({behavior:'smooth',block:'start'});
}
function congregationsBlock(location){const list=location.congregations||[];if(!list.length)return'';return`<div class="congs"><strong>${list.length} congregation${list.length===1?'':'s'} or group${list.length===1?'':'s'}:</strong> ${escapeHtml(list.join('; '))}</div>`;}
function publicCard(location){
  const data=publicData.get(location.id)||{},info=statusInfo(location.id),updated=data.updatedAt?.toDate?.();
  return`<div class="card"><div class="hall-head"><div class="number${location.locationType==='meeting-area'?' meeting-number':''}" style="background:${info.color}">${escapeHtml(markerLabel(location))}</div><div><span class="type-chip">${escapeHtml(typeLabel(location))}${location.customLocation?' • Added location':''}</span><h2>${escapeHtml(location.name)}</h2><p class="address">${escapeHtml(location.address||'Map coordinates saved')}</p></div></div><div class="status-line"><span class="status" style="background:${info.color}">${escapeHtml(info.label)}</span>${data.busSize?`<span class="meta">Largest bus reviewed: <strong>${escapeHtml(BUS_SIZE_LABELS[data.busSize]||data.busSize)}</strong></span>`:''}</div>${congregationsBlock(location)}${data.publicSummary?`<p class="public-summary">${escapeHtml(data.publicSummary)}</p>`:''}${updated?`<div class="meta">Public status updated ${updated.toLocaleDateString()}</div>`:''}<div class="action-grid"><a class="btn light" href="${mapsUrl(location)}" target="_blank" rel="noopener">Google Maps</a><a class="btn light" href="${directionsUrl(location)}" target="_blank" rel="noopener">Directions</a><a class="btn light" href="${appleUrl(location)}" target="_blank" rel="noopener">Apple Maps</a></div><a class="street-card" href="${streetViewUrl(location)}" target="_blank" rel="noopener"><div class="street-icon">🏛️</div><div><strong>Open Google Street View</strong><span>Exterior imagery opens in Google Maps. Availability and camera position depend on Street View coverage.</span></div></a></div>`;
}
const options=(value,list)=>list.map(([v,label])=>`<option value="${escapeHtml(v)}" ${String(value)===String(v)?'selected':''}>${escapeHtml(label)}</option>`).join('');
function contactSection(review){
  const c1=review.contact1||{},c2=review.contact2||{};
  return`<div class="subsection"><h4>Kingdom Hall / Site Contacts <span class="private-chip">Administrator only</span></h4><p class="private-note">These names, phone numbers, and email addresses are stored in the private review record and are not shown to public visitors.</p><div class="contact-box"><strong>Point of Contact 1</strong><div class="form-grid"><div class="field"><label>Name</label><input maxlength="100" name="contact1Name" value="${escapeHtml(c1.name||review.contact1Name||'')}"></div><div class="field"><label>Phone number</label><input maxlength="40" name="contact1Phone" type="tel" value="${escapeHtml(c1.phone||review.contact1Phone||'')}"></div><div class="field full"><label>Email</label><input maxlength="160" name="contact1Email" type="email" value="${escapeHtml(c1.email||review.contact1Email||'')}"></div></div></div><div class="contact-box"><strong>Point of Contact 2</strong><div class="form-grid"><div class="field"><label>Name</label><input maxlength="100" name="contact2Name" value="${escapeHtml(c2.name||review.contact2Name||'')}"></div><div class="field"><label>Phone number</label><input maxlength="40" name="contact2Phone" type="tel" value="${escapeHtml(c2.phone||review.contact2Phone||'')}"></div><div class="field full"><label>Email</label><input maxlength="160" name="contact2Email" type="email" value="${escapeHtml(c2.email||review.contact2Email||'')}"></div></div></div></div>`;
}
function adminForm(location,data,review){
  const ynr=[['','Select…'],['yes','Yes'],['no','No'],['review','Needs review'],['unknown','Unknown']],statusOptions=Object.entries(STATUS).map(([v,x])=>[v,x.label]);
  return`<form class="card" id="reviewForm" data-id="${escapeHtml(location.id)}"><h3 class="section-title"><span>Administrator Bus Review</span><span class="admin-chip">Signed in</span></h3>${location.customLocation?`<div class="edit-location-row"><span>This is an administrator-added location.</span><button class="btn light" id="editLocationButton" type="button">Edit Location Details</button></div>`:''}<div class="form-grid"><div class="field"><label>Public bus-access status</label><select name="busStatus" required>${options(data.busStatus||'not-reviewed',statusOptions)}</select></div><div class="field"><label>Largest bus reviewed</label><select name="busSize">${options(data.busSize||'',[['','Not selected'],['passenger-van','Passenger van'],['shuttle','Shuttle bus'],['school-bus','School bus'],['40-foot-motorcoach','40-foot motorcoach'],['45-foot-motorcoach','45-foot motorcoach']])}</select></div><div class="field"><label>Entrance suitable</label><select name="entrance">${options(review.entrance||'',ynr)}</select></div><div class="field"><label>Exit suitable</label><select name="exit">${options(review.exit||'',ynr)}</select></div><div class="field"><label>Turnaround available</label><select name="turnaround">${options(review.turnaround||'',ynr)}</select></div><div class="field"><label>Passenger loading area</label><select name="loadingArea">${options(review.loadingArea||'',ynr)}</select></div><div class="field"><label>Bus parking available</label><select name="busParking">${options(review.busParking||'',ynr)}</select></div><div class="field"><label>Overhead clearance</label><select name="overhead">${options(review.overhead||'',ynr)}</select></div><div class="field"><label>Property permission</label><select name="propertyPermission">${options(review.propertyPermission||'',[['','Select…'],['confirmed','Confirmed'],['needed','Needed'],['not-required','Not required'],['unknown','Unknown']])}</select></div><div class="field"><label>Onsite verification</label><select name="onsiteVerification">${options(review.onsiteVerification||'',[['','Select…'],['complete','Complete'],['scheduled','Scheduled'],['needed','Needed']])}</select></div><div class="field full"><label>Public summary (visible to everyone)</label><textarea maxlength="600" name="publicSummary" placeholder="Example: Suitable for a 45-foot motorcoach using the east entrance. Loading only; no overnight parking.">${escapeHtml(data.publicSummary||'')}</textarea></div></div>${contactSection(review)}<div class="form-grid"><div class="field full"><label>Internal inspection notes (administrator only)</label><textarea maxlength="2500" name="internalNotes" placeholder="Measurements, follow-up items, access concerns, or other private planning notes.">${escapeHtml(review.internalNotes||'')}</textarea></div><div class="field"><label>Reviewer name</label><input maxlength="80" name="reviewerName" value="${escapeHtml(review.reviewerName||'Michael Tarin')}"></div><div class="field"><label>Review date</label><input name="reviewDate" type="date" value="${escapeHtml(review.reviewDate||new Date().toISOString().slice(0,10))}"></div></div><div class="form-actions"><button class="btn light" id="openStreetFromForm" type="button">Inspect Street View</button><button class="btn blue" type="submit">Save Review</button></div></form>`;
}
async function renderDetail(location){
  let review={};
  if(isAdmin())try{const snapshot=await getDoc(doc(db,'reviews',location.id));if(snapshot.exists())review=snapshot.data();}catch(error){toast('Could not load the private review: '+friendlyError(error),true);}
  const data=publicData.get(location.id)||{};
  detail.innerHTML=publicCard(location)+(isAdmin()?adminForm(location,data,review):`<div class="card"><h3 class="section-title">Bus Access Review</h3><div class="login-state">The map is publicly viewable. Sign in as the administrator to enter or change bus-access information and private site contacts.</div><button class="btn blue" id="detailLogin" style="margin-top:10px" type="button">Administrator Sign In</button></div>`);
  document.getElementById('detailLogin')?.addEventListener('click',openLogin);
  document.getElementById('reviewForm')?.addEventListener('submit',saveReview);
  document.getElementById('editLocationButton')?.addEventListener('click',()=>openLocationEditor(location));
}
async function saveReview(event){
  event.preventDefault();if(!isAdmin()){toast('Administrator sign-in is required.',true);return;}
  const form=event.currentTarget,location=findLocation(form.dataset.id);if(!location)return;
  const values=Object.fromEntries(new FormData(form).entries()),button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Saving…';
  try{
    const batch=writeBatch(db);
    batch.set(doc(db,'halls',location.id),{number:location.number,markerLabel:markerLabel(location),name:location.name,address:location.address,lat:location.lat,lng:location.lng,locationType:location.locationType,planningArea:location.planningArea||'dtc-45',customLocation:Boolean(location.customLocation),congregationCount:(location.congregations||[]).length,congregations:location.congregations||[],busStatus:values.busStatus,busSize:values.busSize,publicSummary:clean(values.publicSummary),updatedAt:serverTimestamp(),updatedBy:'Transportation review team'},{merge:true});
    batch.set(doc(db,'reviews',location.id),{hallNumber:markerLabel(location),entrance:values.entrance,exit:values.exit,turnaround:values.turnaround,loadingArea:values.loadingArea,busParking:values.busParking,overhead:values.overhead,propertyPermission:values.propertyPermission,onsiteVerification:values.onsiteVerification,contact1:{name:clean(values.contact1Name),phone:clean(values.contact1Phone),email:clean(values.contact1Email)},contact2:{name:clean(values.contact2Name),phone:clean(values.contact2Phone),email:clean(values.contact2Email)},internalNotes:clean(values.internalNotes),reviewerName:clean(values.reviewerName),reviewDate:values.reviewDate,updatedByEmail:currentUser.email,updatedAt:serverTimestamp()},{merge:true});
    pendingSelectId=location.id;await batch.commit();toast(`${typeLabel(location)} ${markerLabel(location)} review saved.`);
  }catch(error){toast('Save failed: '+friendlyError(error),true);}finally{button.disabled=false;button.textContent='Save Review';}
}

function nextLabel(type='kingdom-hall'){
  const prefix=type==='meeting-area'?'M':'K',used=new Set(locations.map(markerLabel).map(x=>x.toUpperCase()));let n=1;while(used.has(`${prefix}${n}`))n++;return`${prefix}${n}`;
}
function resetLocationForm(){locationForm.reset();locationForm.elements.locationId.value='';locationForm.elements.locationType.value='kingdom-hall';locationForm.elements.markerLabel.value=nextLabel('kingdom-hall');locationForm.elements.lat.value=DTC[0];locationForm.elements.lng.value=DTC[1];locationForm.elements.planningArea.value='dtc-45';document.getElementById('deleteLocationButton').hidden=true;document.getElementById('locationModalTitle').textContent='Add Kingdom Hall or Meeting Area';document.getElementById('locationModalHelp').textContent='Add a location to the public map. Bus review details and private contacts can be entered after the location is saved.';locationForm.querySelector('button[type=submit]').textContent='Save Location';}
function openLocationEditor(location=null){
  if(!isAdmin()){openLogin();toast('Administrator sign-in is required.',true);return;}
  resetLocationForm();
  if(location){locationForm.elements.locationId.value=location.id;locationForm.elements.locationType.value=location.locationType;locationForm.elements.markerLabel.value=markerLabel(location);locationForm.elements.name.value=location.name;locationForm.elements.address.value=location.address;locationForm.elements.lat.value=location.lat;locationForm.elements.lng.value=location.lng;locationForm.elements.congregations.value=(location.congregations||[]).join('\n');locationForm.elements.planningArea.value=location.planningArea||'other';document.getElementById('deleteLocationButton').hidden=!location.customLocation;document.getElementById('locationModalTitle').textContent='Edit Added Location';document.getElementById('locationModalHelp').textContent='Changes to the name, marker, address, coordinates, or congregation list will update the public map.';locationForm.querySelector('button[type=submit]').textContent='Update Location';}
  locationModal.classList.add('open');setTimeout(()=>locationForm.elements.name.focus(),60);
}
function closeLocationModal(){locationModal.classList.remove('open');}
async function saveLocation(event){
  event.preventDefault();if(!isAdmin()){toast('Administrator sign-in is required.',true);return;}
  const values=Object.fromEntries(new FormData(locationForm).entries()),lat=Number(values.lat),lng=Number(values.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)){toast('Enter valid latitude and longitude coordinates.',true);return;}
  const congregations=parseLines(values.congregations),existingId=clean(values.locationId),reference=existingId?doc(db,'halls',existingId):doc(collection(db,'halls')),button=locationForm.querySelector('button[type=submit]');button.disabled=true;button.textContent=existingId?'Updating…':'Adding…';
  try{const batch=writeBatch(db);batch.set(reference,{customLocation:true,locationType:values.locationType==='meeting-area'?'meeting-area':'kingdom-hall',number:clean(values.markerLabel),markerLabel:clean(values.markerLabel),name:clean(values.name),address:clean(values.address),lat,lng,congregations,congregationCount:congregations.length,planningArea:values.planningArea||'other',busStatus:publicData.get(reference.id)?.busStatus||'not-reviewed',busSize:publicData.get(reference.id)?.busSize||'',publicSummary:publicData.get(reference.id)?.publicSummary||'',updatedAt:serverTimestamp(),updatedBy:'Transportation review team',...(existingId?{}:{createdAt:serverTimestamp()})},{merge:true});pendingSelectId=reference.id;await batch.commit();closeLocationModal();toast(existingId?'Location updated.':'New location added. Complete its bus-access review next.');}catch(error){toast('Could not save the location: '+friendlyError(error),true);}finally{button.disabled=false;button.textContent=existingId?'Update Location':'Save Location';}
}
async function deleteLocation(){
  const id=clean(locationForm.elements.locationId.value),location=findLocation(id);if(!location?.customLocation||!isAdmin())return;
  if(!window.confirm(`Remove ${location.name} from the planning map? Its private review and contacts will also be deleted.`))return;
  try{const batch=writeBatch(db);batch.delete(doc(db,'halls',id));batch.delete(doc(db,'reviews',id));await batch.commit();closeLocationModal();selectedId=null;history.replaceState(null,'','./');detail.innerHTML='<div class="card empty"><div><strong>Location removed</strong><br><small>Select another marker to continue.</small></div></div>';toast('Added location removed.');}catch(error){toast('Could not remove the location: '+friendlyError(error),true);}
}

function openLogin(){document.getElementById('loginModal').classList.add('open');setTimeout(()=>document.getElementById('loginPassword').focus(),50);}
function closeLogin(){document.getElementById('loginModal').classList.remove('open');}
document.getElementById('loginButton').addEventListener('click',openLogin);
document.getElementById('cancelLogin').addEventListener('click',closeLogin);
document.getElementById('loginModal').addEventListener('click',event=>{if(event.target.id==='loginModal')closeLogin();});
document.getElementById('loginForm').addEventListener('submit',async event=>{event.preventDefault();try{await signInWithEmailAndPassword(auth,document.getElementById('loginEmail').value.trim(),document.getElementById('loginPassword').value);document.getElementById('loginPassword').value='';closeLogin();toast('Administrator signed in.');}catch(error){toast(friendlyError(error),true);}});
document.getElementById('resetPassword').addEventListener('click',async()=>{const email=document.getElementById('loginEmail').value.trim()||ADMIN_EMAIL;try{await sendPasswordResetEmail(auth,email);toast('Password reset email sent.');}catch(error){toast(friendlyError(error),true);}});
document.getElementById('signOutButton').addEventListener('click',async()=>{await signOut(auth);toast('Signed out.');});
addLocationButton.addEventListener('click',()=>openLocationEditor());
document.getElementById('cancelLocation').addEventListener('click',closeLocationModal);
locationModal.addEventListener('click',event=>{if(event.target.id==='locationModal')closeLocationModal();});
locationForm.addEventListener('submit',saveLocation);
document.getElementById('deleteLocationButton').addEventListener('click',deleteLocation);
document.getElementById('useMapCenter').addEventListener('click',()=>{if(!map)return;const center=map.getCenter();locationForm.elements.lat.value=center.lat.toFixed(6);locationForm.elements.lng.value=center.lng.toFixed(6);toast('Current map-center coordinates added.');});
locationForm.elements.locationType.addEventListener('change',event=>{const field=locationForm.elements.markerLabel;if(!field.value||/^[KM]\d+$/i.test(field.value))field.value=nextLabel(event.target.value);});
searchInput.addEventListener('input',renderList);statusFilter.addEventListener('change',renderList);

document.addEventListener('click',event=>{if(event.target.id==='openStreetFromForm'){const location=findLocation(selectedId);if(location)window.open(streetViewUrl(location),'_blank','noopener');}});

try{
  app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,async user=>{currentUser=user;const admin=isAdmin();document.getElementById('loginButton').hidden=Boolean(user);document.getElementById('signOutButton').hidden=!user;addLocationButton.hidden=!admin;if(user&&!admin)toast('This account has public viewing access only.',true);if(selectedId&&findLocation(selectedId))await renderDetail(findLocation(selectedId));});
  onSnapshot(collection(db,'halls'),snapshot=>{publicData.clear();snapshot.forEach(item=>publicData.set(item.id,item.data()));rebuildLocations();showFirebaseWarning('');renderList();if(pendingSelectId&&findLocation(pendingSelectId)){const id=pendingSelectId;pendingSelectId=null;selectLocation(id,true);}else if(selectedId&&findLocation(selectedId))renderDetail(findLocation(selectedId));else if(locations.length)selectLocation(locations[0].id,false);},error=>{showFirebaseWarning('The public status database could not be read. The map is showing the built-in Hall list with “Not reviewed” defaults. '+friendlyError(error));rebuildLocations();renderList();});
}catch(error){showFirebaseWarning('Firebase could not initialize. '+friendlyError(error));renderList();}

initMap();renderList();
let requestedId=null;if(location.hash.startsWith('#location-'))requestedId=decodeURIComponent(location.hash.slice(10));else{const legacy=location.hash.match(/hall-(.+)/);if(legacy)requestedId=decodeURIComponent(legacy[1]);}
selectLocation(findLocation(requestedId)?.id||locations[0].id,false);

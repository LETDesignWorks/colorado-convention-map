import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, onSnapshot, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from './data.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',
  authDomain: 'convention-fs.firebaseapp.com',
  projectId: 'convention-fs',
  storageBucket: 'convention-fs.firebasestorage.app',
  messagingSenderId: '29365992209',
  appId: '1:29365992209:web:0bd35e723688b37d776ab0',
  measurementId: 'G-054BLBBE0F'
};
const ADMIN_EMAIL='michaeltarin@hotmail.com';
const STATUS={
  'not-reviewed':{label:'Not reviewed',color:'#667085'},
  'inspection-scheduled':{label:'Inspection scheduled',color:'#0b4da2'},
  'approved':{label:'Approved',color:'#0e9453'},
  'conditional':{label:'Conditional',color:'#d99a00'},
  'not-suitable':{label:'Not suitable',color:'#c9362b'}
};
const BUS_SIZE_LABELS={
  'passenger-van':'Passenger van',
  'shuttle':'Shuttle bus',
  'school-bus':'School bus',
  '40-foot-motorcoach':'40-foot motorcoach',
  '45-foot-motorcoach':'45-foot motorcoach'
};

let app,auth,db,map,boundaryLayer,selectedId=null,currentUser=null;
const publicData=new Map();
const markers=new Map();
const detail=document.getElementById('detail');
const hallList=document.getElementById('hallList');
const statusFilter=document.getElementById('statusFilter');
const searchInput=document.getElementById('searchInput');
const firebaseWarning=document.getElementById('firebaseWarning');

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function hallStatus(id){return publicData.get(String(id))?.busStatus || 'not-reviewed';}
function statusInfo(id){return STATUS[hallStatus(id)] || STATUS['not-reviewed'];}
function isAdmin(){return currentUser?.email?.toLowerCase()===ADMIN_EMAIL;}
function toast(message,error=false){const t=document.getElementById('toast');t.textContent=message;t.className='toast show'+(error?' error':'');clearTimeout(t._timer);t._timer=setTimeout(()=>t.className='toast',3200);}
function showFirebaseWarning(message){firebaseWarning.textContent=message;firebaseWarning.classList.toggle('show',Boolean(message));}
function mapsUrl(h){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address)}`;}
function directionsUrl(h){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address)}`;}
function streetViewUrl(h){return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${h.lat},${h.lng}`;}
function appleUrl(h){return `https://maps.apple.com/?q=${encodeURIComponent(h.address)}`;}
function markerIcon(h,selected=false){const info=statusInfo(h.id);return L.divIcon({className:'',html:`<div class="marker-pin${selected?' selected':''}" style="background:${info.color}">${h.number}</div>`,iconSize:[36,36],iconAnchor:[18,18],popupAnchor:[0,-18]});}

function initMap(){
  if(!window.L){document.getElementById('map').innerHTML='<div style="padding:25px">The map library could not load. The Hall directory and Firebase review tools remain available below.</div>';return;}
  map=L.map('map',{zoomControl:true,attributionControl:true}).setView(DTC,10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  boundaryLayer=L.polygon(DTC_BOUNDARY,{color:'#0b4da2',weight:3,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.06,interactive:false}).addTo(map);
  L.marker(DTC,{icon:L.divIcon({className:'',html:'<div class="center-star">★</div>',iconSize:[38,38],iconAnchor:[19,19]})}).addTo(map).bindPopup('<div class="pop-title">DTC Center Point</div><div class="pop-address">I-25 & E. Belleview Avenue</div>');
  for(const h of HALLS){
    const m=L.marker([h.lat,h.lng],{icon:markerIcon(h)}).addTo(map);
    m.on('click',()=>selectHall(h.id,true));
    m.bindTooltip(`${h.number}. ${h.name}`,{direction:'top',offset:[0,-14]});
    markers.set(h.id,m);
  }
  map.fitBounds(boundaryLayer.getBounds(),{padding:[18,18]});
}

function filteredHalls(){
  const q=searchInput.value.trim().toLowerCase();const sf=statusFilter.value;
  return HALLS.filter(h=>{
    const status=hallStatus(h.id);
    if(sf!=='all'&&status!==sf)return false;
    if(!q)return true;
    return [h.name,h.address,...h.congregations,String(h.number)].join(' ').toLowerCase().includes(q);
  });
}
function updateMarkers(){
  const visible=new Set(filteredHalls().map(h=>h.id));
  for(const h of HALLS){
    const m=markers.get(h.id);if(!m)continue;
    m.setIcon(markerIcon(h,h.id===selectedId));
    m.setOpacity(visible.has(h.id)?1:.18);
  }
}
function renderStats(){
  const counts={'not-reviewed':0,'inspection-scheduled':0,approved:0,conditional:0,'not-suitable':0};
  for(const h of HALLS)counts[hallStatus(h.id)]++;
  document.getElementById('stats').innerHTML=`<span class="stat">${HALLS.length} halls</span><span class="stat">${counts.approved} approved</span><span class="stat">${counts.conditional} conditional</span><span class="stat">${counts['not-reviewed']} not reviewed</span>`;
}
function renderList(){
  const hs=filteredHalls();document.getElementById('visibleCount').textContent=`${hs.length} shown`;
  hallList.innerHTML=hs.map(h=>{const i=statusInfo(h.id);return `<button type="button" class="list-item" data-hall="${h.id}"><span class="mini" style="background:${i.color}">${h.number}</span><span><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(h.address)}</small></span><span class="mini-status" style="background:${i.color}">${escapeHtml(i.label)}</span></button>`}).join('')||'<div style="font-size:12px;color:#667085;padding:10px">No locations match this filter.</div>';
  hallList.querySelectorAll('[data-hall]').forEach(b=>b.addEventListener('click',()=>selectHall(b.dataset.hall,true)));
  renderStats();updateMarkers();
}

async function selectHall(id,pan=false){
  selectedId=String(id);const h=HALLS.find(x=>x.id===selectedId);if(!h)return;
  if(pan&&map){map.setView([h.lat,h.lng],Math.max(map.getZoom(),13),{animate:true});markers.get(h.id)?.openTooltip();}
  history.replaceState(null,'',`#hall-${h.id}`);updateMarkers();await renderDetail(h);
  if(window.innerWidth<851)document.getElementById('panel').scrollIntoView({behavior:'smooth',block:'start'});
}

function publicCard(h){
  const data=publicData.get(h.id)||{};const i=statusInfo(h.id);const updated=data.updatedAt?.toDate?.();
  return `<div class="card">
    <div class="hall-head"><div class="number" style="background:${i.color}">${h.number}</div><div><h2>${escapeHtml(h.name)}</h2><p class="address">${escapeHtml(h.address)}</p></div></div>
    <div class="status-line"><span class="status" style="background:${i.color}">${escapeHtml(i.label)}</span>${data.busSize?`<span class="meta">Largest bus reviewed: <strong>${escapeHtml(BUS_SIZE_LABELS[data.busSize]||data.busSize)}</strong></span>`:''}</div>
    <div class="congs"><strong>${h.congregationCount} congregation${h.congregationCount===1?'':'s'}:</strong> ${escapeHtml(h.congregations.join('; '))}</div>
    ${data.publicSummary?`<p class="public-summary">${escapeHtml(data.publicSummary)}</p>`:''}
    ${updated?`<div class="meta">Public status updated ${updated.toLocaleDateString()}</div>`:''}
    <div class="action-grid"><a class="btn light" href="${mapsUrl(h)}" target="_blank" rel="noopener">Google Maps</a><a class="btn light" href="${directionsUrl(h)}" target="_blank" rel="noopener">Directions</a><a class="btn light" href="${appleUrl(h)}" target="_blank" rel="noopener">Apple Maps</a></div>
    <a class="street-card" href="${streetViewUrl(h)}" target="_blank" rel="noopener"><div class="street-icon">🏛️</div><div><strong>Open Google Street View</strong><span>Exterior imagery opens in Google Maps. An in-page image can be added after a restricted Google Maps API key is configured.</span></div></a>
  </div>`;
}

const options=(value,list)=>list.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('');
async function renderDetail(h){
  let review={};
  if(isAdmin()){try{const s=await getDoc(doc(db,'reviews',h.id));if(s.exists())review=s.data();}catch(e){toast('Could not load the private review: '+friendlyError(e),true);}}
  const data=publicData.get(h.id)||{};
  detail.innerHTML=publicCard(h)+(isAdmin()?adminForm(h,data,review):`<div class="card"><h3 class="section-title">Bus Access Review</h3><div class="login-state">The map is publicly viewable. Sign in as the administrator to enter or change bus-access information.</div><button type="button" class="btn blue" id="detailLogin" style="margin-top:10px">Administrator Sign In</button></div>`);
  document.getElementById('detailLogin')?.addEventListener('click',openLogin);
  document.getElementById('reviewForm')?.addEventListener('submit',saveReview);
}
function adminForm(h,data,review){
  const ynr=[['','Select…'],['yes','Yes'],['no','No'],['review','Needs review'],['unknown','Unknown']];
  const statusOpts=Object.entries(STATUS).map(([v,x])=>[v,x.label]);
  return `<form class="card" id="reviewForm" data-id="${h.id}"><h3 class="section-title"><span>Administrator Bus Review</span><span class="admin-chip">Signed in</span></h3>
    <div class="form-grid">
      <div class="field"><label>Public bus-access status</label><select name="busStatus" required>${options(data.busStatus||'not-reviewed',statusOpts)}</select></div>
      <div class="field"><label>Largest bus reviewed</label><select name="busSize">${options(data.busSize||'', [['','Not selected'],['passenger-van','Passenger van'],['shuttle','Shuttle bus'],['school-bus','School bus'],['40-foot-motorcoach','40-foot motorcoach'],['45-foot-motorcoach','45-foot motorcoach']])}</select></div>
      <div class="field"><label>Entrance suitable</label><select name="entrance">${options(review.entrance||'',ynr)}</select></div>
      <div class="field"><label>Exit suitable</label><select name="exit">${options(review.exit||'',ynr)}</select></div>
      <div class="field"><label>Turnaround available</label><select name="turnaround">${options(review.turnaround||'',ynr)}</select></div>
      <div class="field"><label>Passenger loading area</label><select name="loadingArea">${options(review.loadingArea||'',ynr)}</select></div>
      <div class="field"><label>Bus parking available</label><select name="busParking">${options(review.busParking||'',ynr)}</select></div>
      <div class="field"><label>Overhead clearance</label><select name="overhead">${options(review.overhead||'',ynr)}</select></div>
      <div class="field"><label>Property permission</label><select name="propertyPermission">${options(review.propertyPermission||'', [['','Select…'],['confirmed','Confirmed'],['needed','Needed'],['not-required','Not required'],['unknown','Unknown']])}</select></div>
      <div class="field"><label>Onsite verification</label><select name="onsiteVerification">${options(review.onsiteVerification||'', [['','Select…'],['complete','Complete'],['scheduled','Scheduled'],['needed','Needed']])}</select></div>
      <div class="field full"><label>Public summary (visible to everyone)</label><textarea name="publicSummary" maxlength="600" placeholder="Example: Suitable for a 45-foot motorcoach using the east entrance. Loading only; no overnight parking.">${escapeHtml(data.publicSummary||'')}</textarea></div>
      <div class="field full"><label>Internal inspection notes (administrator only)</label><textarea name="internalNotes" maxlength="2500" placeholder="Measurements, contact information, follow-up items, or concerns. This is saved in the private reviews collection.">${escapeHtml(review.internalNotes||'')}</textarea></div>
      <div class="field"><label>Reviewer name</label><input name="reviewerName" maxlength="80" value="${escapeHtml(review.reviewerName||'Michael Tarin')}"></div>
      <div class="field"><label>Review date</label><input name="reviewDate" type="date" value="${escapeHtml(review.reviewDate||new Date().toISOString().slice(0,10))}"></div>
    </div>
    <div class="form-actions"><button class="btn light" type="button" id="openStreetFromForm">Inspect Street View</button><button class="btn blue" type="submit">Save Review</button></div>
  </form>`;
}
async function saveReview(e){
  e.preventDefault();if(!isAdmin()){toast('Administrator sign-in is required.',true);return;}
  const form=e.currentTarget;const h=HALLS.find(x=>x.id===form.dataset.id);const fd=new FormData(form);const v=Object.fromEntries(fd.entries());
  const saveButton=form.querySelector('button[type=submit]');saveButton.disabled=true;saveButton.textContent='Saving…';
  try{
    const batch=writeBatch(db);
    batch.set(doc(db,'halls',h.id),{number:h.number,name:h.name,address:h.address,lat:h.lat,lng:h.lng,congregationCount:h.congregationCount,congregations:h.congregations,busStatus:v.busStatus,busSize:v.busSize,publicSummary:v.publicSummary.trim(),updatedAt:serverTimestamp(),updatedBy:'Transportation review team'},{merge:true});
    batch.set(doc(db,'reviews',h.id),{hallNumber:h.number,entrance:v.entrance,exit:v.exit,turnaround:v.turnaround,loadingArea:v.loadingArea,busParking:v.busParking,overhead:v.overhead,propertyPermission:v.propertyPermission,onsiteVerification:v.onsiteVerification,internalNotes:v.internalNotes.trim(),reviewerName:v.reviewerName.trim(),reviewDate:v.reviewDate,updatedByEmail:currentUser.email,updatedAt:serverTimestamp()},{merge:true});
    await batch.commit();toast(`Kingdom Hall ${h.number} review saved.`);await renderDetail(h);
  }catch(err){toast('Save failed: '+friendlyError(err),true);}
  finally{saveButton.disabled=false;saveButton.textContent='Save Review';}
}
function friendlyError(err){
  const code=err?.code||'';
  if(code.includes('invalid-credential'))return 'The email or password is not correct.';
  if(code.includes('permission-denied'))return 'Firestore denied this action. Check the published security rules and administrator email.';
  if(code.includes('network-request-failed')||code.includes('unavailable'))return 'The network or Firebase service is temporarily unavailable.';
  if(code.includes('unauthorized-domain'))return 'Add letdesignworks.github.io under Firebase Authentication → Settings → Authorized domains.';
  return err?.message?.replace(/^Firebase:\s*/,'')||'Unknown error';
}

function openLogin(){document.getElementById('loginModal').classList.add('open');setTimeout(()=>document.getElementById('loginPassword').focus(),50);}
function closeLogin(){document.getElementById('loginModal').classList.remove('open');}
document.getElementById('loginButton').addEventListener('click',openLogin);document.getElementById('cancelLogin').addEventListener('click',closeLogin);
document.getElementById('loginModal').addEventListener('click',e=>{if(e.target.id==='loginModal')closeLogin();});
document.getElementById('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmailAndPassword(auth,document.getElementById('loginEmail').value.trim(),document.getElementById('loginPassword').value);document.getElementById('loginPassword').value='';closeLogin();toast('Administrator signed in.');}catch(err){toast(friendlyError(err),true);}});
document.getElementById('resetPassword').addEventListener('click',async()=>{const email=document.getElementById('loginEmail').value.trim()||ADMIN_EMAIL;try{await sendPasswordResetEmail(auth,email);toast('Password reset email sent.');}catch(err){toast(friendlyError(err),true);}});
document.getElementById('signOutButton').addEventListener('click',async()=>{await signOut(auth);toast('Signed out.');});
searchInput.addEventListener('input',renderList);statusFilter.addEventListener('change',renderList);

try{
  app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,async user=>{currentUser=user;const admin=isAdmin();document.getElementById('loginButton').hidden=Boolean(user);document.getElementById('signOutButton').hidden=!user;if(user&&!admin)toast('This account has public viewing access only.',true);if(selectedId)await renderDetail(HALLS.find(h=>h.id===selectedId));});
  onSnapshot(collection(db,'halls'),snap=>{publicData.clear();snap.forEach(d=>publicData.set(d.id,d.data()));showFirebaseWarning('');renderList();if(selectedId)renderDetail(HALLS.find(h=>h.id===selectedId));},err=>{showFirebaseWarning('The public status database could not be read. The map is showing the built-in Hall list with “Not reviewed” defaults. '+friendlyError(err));renderList();});
}catch(err){showFirebaseWarning('Firebase could not initialize. '+friendlyError(err));renderList();}

initMap();renderList();
const hashMatch=location.hash.match(/hall-(\d+)/);selectHall(hashMatch?.[1]||HALLS[0].id,false);
document.addEventListener('click',e=>{if(e.target.id==='openStreetFromForm'){const h=HALLS.find(x=>x.id===selectedId);window.open(streetViewUrl(h),'_blank','noopener');}});

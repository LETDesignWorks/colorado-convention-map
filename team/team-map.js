import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getFirestore, collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { HALLS, DTC_BOUNDARY, DTC } from '../bus-access/data.js';

const firebaseConfig={apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'};
const EVERGREEN=[39.6333,-105.3172];
const STATUS={
  'not-reviewed':{label:'Not reviewed',color:'#667085'},
  'inspection-scheduled':{label:'Inspection scheduled',color:'#0b4da2'},
  approved:{label:'Approved',color:'#0e9453'},
  conditional:{label:'Conditional',color:'#d99a00'},
  'not-suitable':{label:'Not suitable',color:'#c9362b'}
};
const BUS_SIZE={'passenger-van':'Passenger van',shuttle:'Shuttle bus','school-bus':'School bus','40-foot-motorcoach':'40-foot motorcoach','45-foot-motorcoach':'45-foot motorcoach'};
const ASSIGNMENTS={
  seth:{
    name:'Seth',
    title:'Seth — Evergreen-Area Hall Assignments',
    description:'Five Kingdom Halls closest to the Evergreen reference area, ordered by approximate map proximity.',
    area:'Evergreen / west and southwest metro',
    ids:['18','6','16','7','4'],
    distances:{'18':'8.8 mi','6':'11.0 mi','16':'12.8 mi','7':'15.9 mi','4':'16.0 mi'},
    showEvergreen:true
  },
  johnathan:{
    name:'Johnathan',
    title:'Johnathan — North Metro Hall Assignments',
    description:'Eight north, north-central, and northeast metro Kingdom Hall locations grouped to reduce duplicate travel.',
    area:'North / north-central / northeast metro',
    ids:['14','2','3','5','17','10','1','13']
  },
  michael:{
    name:'Michael',
    title:'Michael — South & Southeast Hall Assignments',
    description:'Nine south, southeast, and east metro Kingdom Hall locations. Michael receives the extra Hall because the remaining total is odd.',
    area:'South / southeast / east metro',
    ids:['8','15','9','19','11','20','21','23','26']
  }
};

const member=document.body.dataset.member;
const assignment=ASSIGNMENTS[member]||ASSIGNMENTS.michael;
const assigned=assignment.ids.map(id=>HALLS.find(h=>String(h.id)===id)).filter(Boolean);
const publicData=new Map();
const markers=new Map();
let map,selectedId=null;

const escapeHtml=(value='')=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const statusKey=id=>publicData.get(String(id))?.busStatus||'not-reviewed';
const statusInfo=id=>STATUS[statusKey(id)]||STATUS['not-reviewed'];
const mapsUrl=h=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address)}`;
const directionsUrl=h=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address)}`;
const streetViewUrl=h=>`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${h.lat},${h.lng}`;
const appleUrl=h=>`https://maps.apple.com/?q=${encodeURIComponent(h.address)}`;
const reviewUrl=h=>`../bus-access/#location-${encodeURIComponent(h.id)}`;

function markerIcon(h,selected=false){
  const info=statusInfo(h.id);
  return L.divIcon({className:'',html:`<div class="marker-pin${selected?' selected':''}" style="background:${info.color}">${h.number}</div>`,iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-19]});
}

function initMap(){
  if(!window.L){document.getElementById('map').innerHTML='<div style="padding:24px">The map library could not load. The assigned Hall list remains available.</div>';return;}
  map=L.map('map',{zoomControl:true,attributionControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  L.polygon(DTC_BOUNDARY,{color:'#0b4da2',weight:2.5,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.035,interactive:false}).addTo(map);
  L.marker(DTC,{icon:L.divIcon({className:'',html:'<div class="center-star">★</div>',iconSize:[38,38],iconAnchor:[19,19]})}).addTo(map).bindPopup('<div class="popup-title">DTC Center Point</div><div class="popup-sub">I-25 & E. Belleview Avenue</div>');
  if(assignment.showEvergreen){
    L.marker(EVERGREEN,{icon:L.divIcon({className:'',html:'<div class="evergreen-pin"></div>',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(map).bindPopup('<div class="popup-title">Evergreen Reference Area</div><div class="popup-sub">Used only to select Seth’s five nearest Hall locations.</div>');
  }
  for(const h of assigned){
    const marker=L.marker([h.lat,h.lng],{icon:markerIcon(h)}).addTo(map);
    marker.bindTooltip(`${h.number}. ${h.name}`,{direction:'top',offset:[0,-15]});
    marker.on('click',()=>selectHall(String(h.id),true));
    markers.set(String(h.id),marker);
  }
  const points=assigned.map(h=>[h.lat,h.lng]);
  if(assignment.showEvergreen)points.push(EVERGREEN);
  map.fitBounds(L.latLngBounds(points),{padding:[42,42],maxZoom:11});
  L.control.scale({imperial:true,metric:false,position:'bottomright'}).addTo(map);
}

function renderHeader(){
  document.title=`${assignment.title} | 2027 Convention`;
  document.getElementById('memberName').textContent=assignment.title;
  document.getElementById('teamDescription').textContent=assignment.description;
  document.getElementById('assignmentCount').textContent=`${assigned.length} Hall${assigned.length===1?'':'s'}`;
  document.getElementById('areaName').textContent=assignment.area;
}

function renderProgress(){
  const reviewed=assigned.filter(h=>statusKey(h.id)!=='not-reviewed').length;
  document.getElementById('progress').textContent=`${reviewed} of ${assigned.length} reviewed`;
}

function renderList(){
  const list=document.getElementById('hallList');
  list.innerHTML=assigned.map((h,index)=>{
    const info=statusInfo(h.id);
    const proximity=assignment.distances?.[String(h.id)]?` • ${assignment.distances[String(h.id)]} from Evergreen`:'';
    return `<button class="hall-row${String(h.id)===selectedId?' active':''}" data-id="${h.id}" type="button"><span class="num" style="background:${info.color}">${h.number}</span><span><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(h.address)}${escapeHtml(proximity)}</small></span><span class="order">Stop ${index+1}<br>${escapeHtml(info.label)}</span></button>`;
  }).join('');
  list.querySelectorAll('[data-id]').forEach(button=>button.addEventListener('click',()=>selectHall(button.dataset.id,true)));
  renderProgress();
}

function renderDetail(h){
  const data=publicData.get(String(h.id))||{};
  const info=statusInfo(h.id);
  const index=assigned.findIndex(x=>String(x.id)===String(h.id));
  const proximity=assignment.distances?.[String(h.id)]?`Approximate straight-line map distance from Evergreen reference: ${assignment.distances[String(h.id)]}.`:'';
  const updated=data.updatedAt?.toDate?.();
  document.getElementById('detail').innerHTML=`<div class="card"><div class="eyebrow">${escapeHtml(assignment.name)} assignment ${index+1} of ${assigned.length}</div><h2>${h.number}. ${escapeHtml(h.name)}</h2><p class="address">${escapeHtml(h.address)}</p><div class="status-row"><span class="status" style="background:${info.color}">${escapeHtml(info.label)}</span>${data.busSize?`<span class="small">Largest bus reviewed: <strong>${escapeHtml(BUS_SIZE[data.busSize]||data.busSize)}</strong></span>`:''}</div>${proximity?`<div class="small">${escapeHtml(proximity)}</div>`:''}<div class="congs"><strong>${h.congregationCount} congregation${h.congregationCount===1?'':'s'}:</strong> ${escapeHtml(h.congregations.join('; '))}</div>${data.publicSummary?`<div class="summary">${escapeHtml(data.publicSummary)}</div>`:''}${updated?`<div class="small">Status updated ${updated.toLocaleDateString()}</div>`:''}<div class="actions"><a class="btn outline" href="${directionsUrl(h)}" target="_blank" rel="noopener">Google Directions</a><a class="btn outline" href="${appleUrl(h)}" target="_blank" rel="noopener">Apple Maps</a><a class="btn outline" href="${mapsUrl(h)}" target="_blank" rel="noopener">Google Maps</a><a class="btn outline" href="${streetViewUrl(h)}" target="_blank" rel="noopener">Street View</a><a class="btn primary-action" href="${reviewUrl(h)}">Open Hall in Bus Access Review Map →</a></div></div>`;
}

function selectHall(id,pan=false){
  selectedId=String(id);
  const h=assigned.find(x=>String(x.id)===selectedId);
  if(!h)return;
  for(const item of assigned)markers.get(String(item.id))?.setIcon(markerIcon(item,String(item.id)===selectedId));
  if(pan&&map){map.setView([h.lat,h.lng],Math.max(map.getZoom(),13),{animate:true});markers.get(selectedId)?.openTooltip();}
  history.replaceState(null,'',`#hall-${selectedId}`);
  renderDetail(h);renderList();
  if(window.innerWidth<931)document.getElementById('sidebar').scrollIntoView({behavior:'smooth',block:'start'});
}

function startFirebase(){
  try{
    const app=initializeApp(firebaseConfig);
    const db=getFirestore(app);
    onSnapshot(collection(db,'halls'),snapshot=>{
      publicData.clear();snapshot.forEach(doc=>publicData.set(doc.id,doc.data()));
      document.getElementById('firebaseWarning').classList.remove('show');
      renderList();
      for(const h of assigned)markers.get(String(h.id))?.setIcon(markerIcon(h,String(h.id)===selectedId));
      if(selectedId){const h=assigned.find(x=>String(x.id)===selectedId);if(h)renderDetail(h);}
    },error=>{
      const warning=document.getElementById('firebaseWarning');warning.textContent='Live bus-access status could not be loaded. The assignment map and Hall links are still available.';warning.classList.add('show');
      console.warn(error);renderList();
    });
  }catch(error){
    const warning=document.getElementById('firebaseWarning');warning.textContent='Firebase could not initialize. The assignment map and Hall links are still available.';warning.classList.add('show');console.warn(error);
  }
}

renderHeader();initMap();renderList();startFirebase();
const hash=location.hash.match(/hall-(\d+)/)?.[1];
selectHall(hash&&assignment.ids.includes(hash)?hash:assignment.ids[0],false);

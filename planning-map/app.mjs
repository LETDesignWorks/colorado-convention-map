import {railMeetingPoints} from '../assets/rail-meeting-points.mjs';
import {landmarkIcon,sizeLandmarksForZoom} from '../assets/landmark-markers.mjs?v=landmark-size-20261115-1';
import {catalog,escapeHtml as esc,icon,mapBase,railLayers,HOTELS,ACTIVITY_POINTS,DTC_BOUNDARY,CENTERS} from '../assets/planning-common.mjs';
import {loadRail} from '../assets/rail-network.mjs';
import {CONGREGATIONS} from '../assignments/congregations-data.mjs';
import {HOME_POINTS} from '../assignments/home-points.mjs';
import {homeFor,groupHomes,validPoint} from '../assignments/location-model.mjs';
import {MODES} from '../travel-routes/model.mjs';
import {PRIVATE_LAYERS,permittedTypes,savedRoute,territoryShapes} from './model.mjs';
import {auth,canView,observeSiteAccess,watchHalls,watchRecords} from '../assets/planning-cloud.mjs';
const $=id=>document.getElementById(id),map=mapBase('map'),layers=new Map(),records=new Map(),statusByLayer=new Map();
sizeLandmarksForZoom(map);
const definitions=[
 ['landmarks','Convention Center / DTC landmarks','#174c77',true],
 ['meetings','Meeting locations / bus status','#bd7825',true],
 ['congregations','Congregations · assigned ✓','#b42391',true],
 ['connections','Congregation assignments','#19834a',false],
 ['hotels','Hotels','#245bab',true],['activities','Activities / gatherings','#bd4d3e',true],
 ['stations','All rail stations','#654990',true],['railLines','Rail lines','#654990',false],
 ['railPreferences','Saved rail connections','#7354a3',false],
 ['smpw','SMPW locations','#007e78',false],
 ['territories','Saved territory boundaries','#9256aa',false],
 ['travel','Saved Travel / Field Service routes','#087f8c',false],
 ['activitiesRoutes','Delegate activity routes','#b97b23',false],
 ['multistop','Activity Planning routes','#ab4a45',false],
 ['team','Team review assignments','#536a91',false],
 ['dtc','DTC planning area','#526c7e',false]
];
let prefs={};try{prefs=JSON.parse(localStorage.getItem('denver2027.full-map.layers')||'{}');}catch{}
for(const [id,,,on] of definitions){const layer=L.featureGroup();layers.set(id,layer);if(prefs[id]??on)layer.addTo(map);}
let halls=[],locations=catalog(),rail=null,unsubs=[],accessRevision=0;
function message(text){$('mapStatus').textContent=text;}
function controls(){
 $('layers').innerHTML=definitions.map(([id,label,color])=>'<label><input type="checkbox" data-layer="'+id+'" '+(map.hasLayer(layers.get(id))?'checked':'')+'><span><i class="layer-dot" style="background:'+color+'"></i>'+esc(label)+'</span><small>'+esc(statusByLayer.get(id)||layers.get(id).getLayers().length)+'</small></label>').join('');
}
$('layers').onchange=e=>{const id=e.target.dataset.layer;if(!id)return;const layer=layers.get(id);if(e.target.checked)layer.addTo(map);else map.removeLayer(layer);prefs[id]=e.target.checked;try{localStorage.setItem('denver2027.full-map.layers',JSON.stringify(prefs));}catch{}};
function pointMarker(p,layer,symbol,color,text=''){if(!validPoint(p.lat,p.lng))return;return L.marker([Number(p.lat),Number(p.lng)],{icon:landmarkIcon(p,{step:symbol,fallback:icon(symbol,color)})}).addTo(layers.get(layer)).bindPopup('<b>'+esc(p.name||'Location')+'</b><br>'+esc(p.address||'')+text);}
function link(path,label){return '<br><a href="'+new URL('../'+path,import.meta.url).href+'">'+label+'</a>';}
function renderPublic(){
 for(const id of ['landmarks','meetings','congregations','connections','hotels','activities','railPreferences','smpw','team','dtc'])layers.get(id).clearLayers();
 locations=catalog(halls);const meetingPlaces=locations.filter(p=>p.group==='Field service / meeting places'),meetings=[...meetingPlaces,...railMeetingPoints(rail)];
 const filter=$('meeting').value;
 $('meeting').innerHTML='<option value="">All meeting locations</option>'+meetings.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===filter?' selected':'')+'>'+esc(p.name)+'</option>').join('');
 const statuses={'approved':'#0e9453','conditional':'#c39620','not-suitable':'#bc3530','inspection-scheduled':'#2866a0','not-reviewed':'#667085'};
 for(const p of meetingPlaces)pointMarker(p,'meetings',String(p.number||p.markerLabel||'M'),statuses[p.busStatus]||'#667085','<br>Bus: '+esc(p.busStatus||'not reviewed')+link('bus-access/#location-'+encodeURIComponent(p.id),'Review location')+link('travel-routes/?destination='+encodeURIComponent(p.id),'Plan travel here'));
 for(const p of HOTELS)pointMarker(p,'hotels','▣','#245bab',link('travel-routes/?origin='+encodeURIComponent(p.id),'Plan from this hotel'));
 for(const p of ACTIVITY_POINTS)pointMarker(p,'activities','★','#bd4d3e',link('travel-routes/?destination='+encodeURIComponent(p.id),'Plan travel here'));
 for(const p of CENTERS)pointMarker(p,'landmarks','','#174c77',link('travel-routes/?destination='+encodeURIComponent(p.id),'Plan travel here'));
 const assignments=new Map(halls.filter(p=>p.recordType==='congregation-assignment').map(p=>[String(p.congregationId),p]));
 const profiles=new Map(halls.filter(p=>p.recordType==='congregation-address').map(p=>[String(p.congregationId),p]));
 const selected=CONGREGATIONS.filter(c=>(!filter||String(assignments.get(c.id)?.meetingPointId)===filter));
 const resolve=c=>homeFor(c,profiles.get(c.id),[...locations,...HOME_POINTS]);
 let missing=0;for(const c of selected)if(!resolve(c).point)missing++;
 for(const home of groupHomes(selected,resolve)){
  const assigned=home.congregations.filter(c=>assignments.has(c.id)),color=assigned.length?'#b42391':'#7c3aed';
  const pin=icon('⌂',color,'congregation-pin');
  if(assigned.length)pin.options.html+='<b class="assigned-tick">✓'+(home.congregations.length>1?assigned.length+'/'+home.congregations.length:'')+'</b>';
  L.marker([home.lat,home.lng],{icon:pin}).addTo(layers.get('congregations')).bindPopup('<b>'+esc(home.address)+'</b><ul>'+home.congregations.map(c=>'<li>'+esc(c.name)+(assignments.has(c.id)?' <b>✓ Assigned</b> → '+esc(assignments.get(c.id).meetingPointName||'Meeting point'):' · Unassigned')+'</li>').join('')+'</ul>'+link('assignments/','View / edit assignments'));
  for(const c of assigned){const assignment=assignments.get(c.id),destination=meetings.find(p=>p.id===String(assignment.meetingPointId));if(destination&&validPoint(destination.lat,destination.lng))L.polyline([[home.lat,home.lng],[destination.lat,destination.lng]],{color:'#19834a',weight:2,opacity:.65}).addTo(layers.get('connections')).bindPopup(esc(c.name)+' → '+esc(destination.name)+'<br>Assignment connection, not a driving route');}
 }
 $('homeStatus').innerHTML=missing?missing+' congregation'+(missing===1?'':'s')+' need an address or map pin. '+link('assignments/','Add missing addresses'):'All congregations in this view have map pins.';
 for(const p of halls.filter(p=>p.recordType==='smpw-location'))pointMarker(p,'smpw','▤','#007e78',link('smpw/','Open SMPW'));
 for(const pref of halls.filter(p=>p.recordType==='south-dtc-rail-connection')){
  const a=HOTELS.find(p=>p.id===pref.hotelId),b=meetings.find(p=>p.id===String(pref.meetingPointId));
  const s=rail?.stations.find(p=>p.name.toLowerCase().replace(/station/g,'').trim()===String(pref.originStationName||'').toLowerCase().replace(/station/g,'').trim());
  const t=rail?.stations.find(p=>p.name.toLowerCase().replace(/station/g,'').trim()===String(pref.destinationStationName||'').toLowerCase().replace(/station/g,'').trim());
  const points=[a,s,t,b].filter(p=>p&&validPoint(p.lat,p.lng));if(points.length>1)L.polyline(points.map(p=>[p.lat,p.lng]),{color:'#7354a3',weight:3,dashArray:'6,7'}).addTo(layers.get('railPreferences')).bindPopup(esc(pref.hotelName)+' → '+esc(pref.meetingPointName)+'<br>Saved preference connection; open Travel Routes for timetable and walking directions.'+link('south-dtc-rail/','Open rail preference'));
 }
 for(const [name,ids,color] of [['Seth',['18','6','16','7','4'],'#4d6d91'],['Johnathan',['14','2','3','5','17','10','1','13'],'#578d75'],['Michael',['8','15','9','19','11','20','21','23','26'],'#8a6299']])for(const id of ids){const p=meetings.find(p=>p.id===id);if(p)pointMarker(p,'team',name.slice(0,1),color,'<br>Review assigned to '+name+link('team/','Team assignments'));}
 if(DTC_BOUNDARY?.length)L.polygon(DTC_BOUNDARY,{color:'#526c7e',fillOpacity:.08,weight:2}).addTo(layers.get('dtc')).bindPopup('DTC planning reference area');
 renderPrivate();controls();
}
function renderPrivate(){
 for(const id of Object.keys(PRIVATE_LAYERS))layers.get(id).clearLayers();
 for(const {layer,type} of permittedTypes(canView)){
  for(const record of records.get(type)||[]){
   if(record.deletedAt)continue;
   if(layer==='territories'){
    for(const shape of territoryShapes(record)){try{L.geoJSON(shape.geometry,{style:{color:'#9256aa',fillOpacity:.12,weight:2}}).addTo(layers.get(layer)).bindPopup('<b>'+esc(shape.name)+'</b>'+link('territories/?hall='+encodeURIComponent(record.hallId||''),'Open territory plan'));}catch{}}
   }else{
    const r=savedRoute(record),popup='<b>'+esc(r.name||'Saved route')+'</b>'+link(r.source+'/','Open planner');
    const points=r.points.filter(p=>validPoint(p.lat,p.lng));
    let hasPath=false;
    for(const leg of r.legs)for(const s of leg.segments||[]){if(!s.points?.length)continue;hasPath=true;const mode=MODES[s.mode]||MODES.bus;
     L.polyline(s.points,{color:s.color||mode.color,weight:4,opacity:.65,dashArray:s.estimated?'5,7':null}).addTo(layers.get(layer)).bindPopup(popup);
     const middle=s.points[Math.floor(s.points.length/2)];L.marker(middle,{icon:icon(mode.icon,mode.color,'transport-icon')}).addTo(layers.get(layer)).bindPopup(popup);
    }
    if(!hasPath&&points.length>1)L.polyline(points.map(p=>[p.lat,p.lng]),{color:'#087f8c',weight:3,dashArray:'5,8'}).addTo(layers.get(layer)).bindPopup(popup+'<br>Saved stop connection; recalculate in Travel Routes for the road path.');
    points.forEach((p,i)=>{const mode=MODES[p.mode]||MODES[r.legs[i]?.mode]||MODES[r.legs.at(-1)?.mode]||MODES.bus;pointMarker(p,layer,mode.icon,mode.color,popup);});
    for(const p of points.filter(p=>p.id==='encouraging-gathering'))pointMarker(p,'activities','★','#bd4d3e',popup);
   }
  }
 }
 controls();
}
$('meeting').onchange=()=>renderPublic();
$('fitVisible').onclick=()=>{const visible=definitions.filter(([id])=>map.hasLayer(layers.get(id))).flatMap(([id])=>layers.get(id).getLayers());if(visible.length){const bounds=L.featureGroup(visible).getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[30,30],maxZoom:15});}};
$('showAll').onclick=()=>{for(const [id]of definitions){layers.get(id).addTo(map);prefs[id]=true;}try{localStorage.setItem('denver2027.full-map.layers',JSON.stringify(prefs));}catch{}controls();};
$('hideAll').onclick=()=>{for(const [id]of definitions){map.removeLayer(layers.get(id));prefs[id]=false;}try{localStorage.setItem('denver2027.full-map.layers',JSON.stringify(prefs));}catch{}controls();};
$('printMap').onclick=()=>window.print();
$('search').oninput=()=>{
 const q=$('search').value.trim().toLowerCase();if(q.length<2){$('searchResults').innerHTML='';return;}
 const results=[...locations,...(rail?.stations||[])].filter(p=>validPoint(p.lat,p.lng)&&(p.name+' '+p.address).toLowerCase().includes(q)).slice(0,12);
 $('searchResults').innerHTML=results.map((p,i)=>'<button class="secondary" data-result="'+i+'">'+esc(p.name)+'</button>').join('');
 $('searchResults').querySelectorAll('button').forEach(b=>b.onclick=()=>{const p=results[Number(b.dataset.result)];map.setView([p.lat,p.lng],15);L.popup().setLatLng([p.lat,p.lng]).setContent('<b>'+esc(p.name)+'</b><br>'+esc(p.address)).openOn(map);});
};
renderPublic();
watchHalls(list=>{halls=list;renderPublic();message('Shared meeting places, assignments and location updates are loaded. Toggle layers to build your view.');},()=>message('Shared location updates could not load. Showing reference locations; assignments may be unavailable.'));
loadRail().then(data=>{rail=data;const rendered=railLayers(data,map,{stations:false,lines:false});
 for(const [target,source] of [['stations','stations'],['railLines','lines']]){layers.get(target).clearLayers();rendered[source].eachLayer(l=>layers.get(target).addLayer(l));}
 $('railReference').textContent=data.stations.length+' RTD stations · reference '+data.generatedAt.slice(0,10)+'. Rail lines show the published alignment; check current service before travel.';renderPublic();
}).catch(()=>{$('railReference').textContent='Rail reference did not load. Refresh the page to retry.';statusByLayer.set('stations','Unavailable');statusByLayer.set('railLines','Unavailable');controls();});
observeSiteAccess(auth,()=>{
 const token=++accessRevision;unsubs.forEach(f=>f());unsubs=[];records.clear();
 for(const [id,v]of Object.entries(PRIVATE_LAYERS))statusByLayer.set(id,canView(v.section)?'Loading…':'Sign in / access');
 renderPublic();const types=permittedTypes(canView);
 $('privateStatus').textContent=types.length?'Your permitted saved planning layers are available below.':'Sign in to show saved travel, activity and territory plans.';
 for(const {layer,type}of types)unsubs.push(watchRecords(type,list=>{if(token!==accessRevision)return;records.set(type,list);statusByLayer.delete(layer);renderPublic();},()=>{if(token!==accessRevision)return;records.delete(type);statusByLayer.set(layer,'Unavailable');renderPublic();}));
});


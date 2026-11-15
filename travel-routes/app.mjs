import {catalog,escapeHtml as esc,icon,mapBase,railLayers} from '../assets/planning-common.mjs';
import {loadRail,refreshStationLocations} from '../assets/rail-network.mjs';
import {findAddress,validPoint} from '../assignments/location-model.mjs';
import {denverInput,formatDenver} from '../routes/travel-plan.mjs';
import {MODES,calculateSchedule,legacyPlan,serializePlan,validatePlan,durationMinutes,durationDisplay,clearStopPin,LOCATION_GROUPS,filterLocations,locationGroupLabel} from './model.mjs?v=travel-controls-20261114-1';
import {createRoutingKeyStore} from './key-store.mjs';
import {createRouter,nearestStation} from './providers.mjs';
import {auth,canEdit,canView,observeSiteAccess,watchHalls,watchRecords,saveRoute,removeRoute} from '../assets/planning-cloud.mjs';
const $=id=>document.getElementById(id),clone=x=>structuredClone(x),map=mapBase('map'),journey=L.featureGroup().addTo(map);
const fields=['name','timing','time','boarding','allowance','arrivalBuffer','transfer','wait','reminder','notes','parking','tickets','extraReminders'];
let locations=catalog(),rail=null,railMap=null,stops=[],result=null,activePlan=null,activeId=null,generation=0,request=null,picking=null,records=[],unsubscribers=[],lookupGeneration=0,customStations=[],loadedShared=false,saving=false;
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const blank=()=>({id:'custom',name:'',address:'',lat:null,lng:null,mode:'bus',dwell:0,dwellUnit:'minutes',locationGroup:'all',pinRemoved:false,startTime:'',showRail:false,railFrom:'',railTo:''});
function initial(){const tomorrow=new Date(Date.now()+86400000);const date=denverInput(tomorrow).slice(0,10);return {name:'',timing:'arrive',time:date+'T09:00',boarding:15,allowance:10,arrivalBuffer:10,transfer:10,wait:15,reminder:30,notes:'',parking:'',tickets:'mobile',extraReminders:'',stops:[{...blank(),...locations.find(p=>p.id==='H1')},{...blank(),...locations.find(p=>p.id==='ccc')}]};}
function drawStopPins(){
 journey.clearLayers();
 for(const [i,s]of stops.entries())if(validPoint(s.lat,s.lng))L.marker([Number(s.lat),Number(s.lng)],{icon:icon(String(i+1)),zIndexOffset:600}).addTo(journey).bindPopup('<b>'+esc(s.name||'Location '+(i+1))+'</b><br>'+esc(s.address));
}
function invalidate(){generation++;lookupGeneration++;picking=null;request?.abort();request=null;result=null;activePlan=null;$('results').hidden=true;$('calculate').disabled=false;drawStopPins();updateSave();status('Locations or timing changed. Calculate the journey to update the schedule.');}
function apply(plan,id=null){invalidate();activeId=id;loadedShared=!!id;stops=plan.stops.map(s=>({...blank(),...clone(s)}));for(const key of fields)$(key).value=plan[key]??'';$('third').checked=stops.length>=3;$('fourth').checked=stops.length>=4;$('preset').value='custom';renderStops();drawStopPins();updateSave();status(id?'Saved route loaded. Recalculate to use the current locations and timetable.':'Choose your locations, transport and critical start times.');}
function readPlan(){const plan=Object.fromEntries(fields.map(k=>[k,$(k).value]));for(const k of ['boarding','allowance','arrivalBuffer','transfer','wait','reminder'])plan[k]=Number(plan[k]);plan.stops=clone(stops);return plan;}
function option(p,value){const label=(p.group==='Field service / meeting places'&&(p.number||p.markerLabel)?(p.markerLabel||p.number)+' · ':'')+p.name;return '<option value="'+esc(p.id)+'"'+(p.id===value?' selected':'')+'>'+esc(label)+'</option>';}
function locationOptions(s){
 const list=filterLocations([...locations,...(s.showRail?[...(rail?.stations||[]),...customStations].map(p=>({...p,group:'Rail stations'})):[])],s.locationGroup||'all'),groups=new Map();
 for(const p of list){if(!groups.has(p.group))groups.set(p.group,[]);groups.get(p.group).push(p);}
 let html='<option value="custom"'+(s.id==='custom'?' selected':'')+'>Independent address / map pin</option>';
 if(s.id!=='custom'&&!list.some(p=>p.id===s.id))html+='<optgroup label="Current selection">'+option(s,s.id)+'</optgroup>';
 for(const [group,items]of groups)html+='<optgroup label="'+esc(locationGroupLabel(group))+'">'+items.map(p=>option(p,s.id)).join('')+'</optgroup>';
 return html;
}
function stationOptions(id){return '<option value="">Nearest served station</option>'+(rail?.stations||[]).map(s=>'<option value="'+esc(s.id)+'"'+(s.id===id?' selected':'')+'>'+esc(s.name)+(s.lines.length?' · '+esc(s.lines.join('/')):' · no timetable service')+'</option>').join('');}
function renderStops(){
 $('fourth').disabled=!$('third').checked;
 $('stops').innerHTML=stops.map((s,i)=>{
 const custom=s.pinRemoved||s.id==='custom'||s.id==='encouraging-gathering'||!locations.some(p=>p.id===s.id)&&!rail?.stations.some(p=>p.id===s.id);
 return '<section class="panel stop-card" data-stop="'+i+'"><div class="stop-heading"><span class="stop-number">'+(i+1)+'</span><h2>'+(i===0?'Starting point':'Destination '+i)+'</h2></div>'+
 '<label>Location type<select data-action="locationGroup">'+LOCATION_GROUPS.map(([id,label])=>'<option value="'+esc(id)+'"'+((s.locationGroup||'all')===id?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
 '<label><input type="checkbox" data-field="showRail" '+(s.showRail?'checked':'')+'> Show light / commuter rail stations in Select location</label><label>Select location<select data-action="location">'+locationOptions(s)+'</select></label>'+
 (custom?'<label>Location name<input data-field="name" value="'+esc(s.name)+'" maxlength="140"></label><label>Address<input data-field="address" value="'+esc(s.address)+'" placeholder="Street, city, Colorado" maxlength="250"></label><div class="button-row"><button type="button" class="secondary" data-action="lookup">Find address</button><button type="button" class="secondary" data-action="pin">Place pin on map</button></div><div class="lookup-results"></div><div class="two"><label>Latitude<input data-field="lat" type="number" step="any" value="'+esc(s.lat??'')+'"></label><label>Longitude<input data-field="lng" type="number" step="any" value="'+esc(s.lng??'')+'"></label></div>':'<p class="hint">'+esc(s.address)+'<br>'+esc(s.note||'')+'</p>')+
 (validPoint(s.lat,s.lng)?'<button type="button" class="secondary danger remove-pin" data-action="removePin">Remove this pin</button>':'<p class="hint pin-needed">No pin set. Find the address or place a new pin before calculating. You can save these changes as a draft.</p>')+
 (picking===i?'<button type="button" class="secondary" data-action="cancelPin">Cancel pin placement</button>':'')+
 '<div class="critical"><label><input type="checkbox" data-action="critical" '+(s.startTime?'checked':'')+'> Fixed start time · activity / field service</label><label '+(!s.startTime?'hidden':'')+'>Must start at · Denver<input data-field="startTime" type="datetime-local" value="'+esc(s.startTime)+'"></label></div>'+
 '<div class="two duration-controls"><label>Activity / stop duration<input data-field="dwell" type="number" required min="0" max="'+(s.dwellUnit==='hours'?24:1440)+'" step="any" value="'+durationDisplay(s)+'"></label><label>Unit<select data-field="dwellUnit"><option value="minutes"'+(s.dwellUnit!=='hours'?' selected':'')+'>Minutes</option><option value="hours"'+(s.dwellUnit==='hours'?' selected':'')+'>Hours</option></select></label></div><p class="hint">For example, 1.5 hours = 90 minutes.</p>'+
 (i<stops.length-1?'<div class="leg-choice"><label>Travel from here to location '+(i+2)+' by<select data-field="mode">'+Object.entries(MODES).map(([v,m])=>'<option value="'+v+'"'+(s.mode===v?' selected':'')+'>'+m.icon+' '+m.name+'</option>').join('')+'</select></label>'+
 (s.mode==='rail'?'<div class="rail-options"><label>Board at<select data-field="railFrom">'+stationOptions(s.railFrom)+'</select></label><label>Leave train at<select data-field="railTo">'+stationOptions(s.railTo)+'</select></label><p class="hint">Includes walking to and from the selected stations. You can override either nearest station.</p></div>':'')+'</div>':'')+'</section>';
 }).join('');
}
$('stops').addEventListener('input',e=>{
 const card=e.target.closest('[data-stop]'),field=e.target.dataset.field;if(!card||!field)return;
 const s=stops[Number(card.dataset.stop)];
 if(field==='dwell'){try{s.dwell=durationMinutes(e.target.value,s.dwellUnit);e.target.setCustomValidity('');}catch(error){s.dwell=null;e.target.setCustomValidity(error.message);}}
 else s[field]=e.target.type==='checkbox'?e.target.checked:['lat','lng'].includes(field)?(e.target.value===''?null:Number(e.target.value)):e.target.value;
 invalidate();
 if(['mode','showRail','railFrom','railTo','dwellUnit'].includes(field)){if(field==='showRail'){if(s.showRail)s.locationGroup='Rail stations';else if(s.locationGroup==='Rail stations')s.locationGroup='all';}if(field==='mode'&&s.mode==='rail'){s.showRail=true;$('showStations').checked=true;toggleRail();}renderStops();}
});
$('stops').addEventListener('change',e=>{
 const card=e.target.closest('[data-stop]'),action=e.target.dataset.action;if(!card||!action)return;const i=Number(card.dataset.stop),s=stops[i];
 if(action==='locationGroup'){s.locationGroup=e.target.value;if(s.locationGroup==='Rail stations'){s.showRail=true;$('showStations').checked=true;toggleRail();}else if(s.locationGroup!=='all')s.showRail=false;invalidate();renderStops();return;}
 if(action==='location'){
  const p=[...locations,...(rail?.stations||[]),...customStations].find(p=>p.id===e.target.value);
  stops[i]={...s,...(p||{id:'custom',name:'',address:'',lat:null,lng:null}),pinRemoved:false};
  if(stops[i].id==='encouraging-gathering'&&!s.startTime)stops[i].dwell=60;
  invalidate();renderStops();$('fit').click();
 }else if(action==='critical'){s.startTime=e.target.checked?$('time').value:'';invalidate();renderStops();}
});
$('stops').addEventListener('click',async e=>{
 const button=e.target.closest('button'),card=button?.closest('[data-stop]');if(!card)return;const i=Number(card.dataset.stop),s=stops[i],action=button.dataset.action;
 if(action==='removePin'){stops[i]=clearStopPin(s);invalidate();renderStops();status('Pin removed from location '+(i+1)+'. Use Save draft / pin changes to keep this removal, or place a replacement pin.');return;}
 if(action==='cancelPin'){picking=null;renderStops();status('Pin placement canceled.');return;}
 if(action==='pin'){picking=i;renderStops();status('Click the map to place the pin for location '+(i+1)+'.');$('map').scrollIntoView({behavior:'smooth',block:'center'});return;}
 if(action==='lookup'){
  const token=++lookupGeneration,address=s.address;button.disabled=true;const container=card.querySelector('.lookup-results');container.textContent='Finding address suggestions…';
  try{const list=await findAddress(address,{signal:AbortSignal.timeout(20000)});if(token!==lookupGeneration||stops[i]!==s||s.address!==address)return;
   container.innerHTML=list.map((p,j)=>'<button type="button" class="secondary" data-candidate="'+j+'">'+esc(p.address)+(p.approximate?' · approximate street / area':'')+'<br><small>'+p.lat.toFixed(6)+', '+p.lng.toFixed(6)+'</small></button>').join('');
   container.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const p=list[Number(b.dataset.candidate)];Object.assign(s,{address:p.address,lat:p.lat,lng:p.lng,pinRemoved:false});invalidate();renderStops();map.setView([p.lat,p.lng],15);status('Address pin confirmed. Calculate the journey when ready.');}));
  }catch(err){container.textContent='Address lookup unavailable or no match. Enter latitude / longitude, or place a pin on the map.';}finally{button.disabled=false;}
 }
});
map.on('click',e=>{if(picking===null)return;const i=picking;picking=null;if(!stops[i])return;stops[i].lat=Number(e.latlng.lat.toFixed(6));stops[i].lng=Number(e.latlng.lng.toFixed(6));stops[i].pinRemoved=false;invalidate();renderStops();status('Map pin set. Confirm the address and calculate the journey.');});
$('third').onchange=()=>{if($('third').checked)stops.push(blank());else{stops=stops.slice(0,2);$('fourth').checked=false;}invalidate();renderStops();};
$('fourth').onchange=()=>{if($('fourth').checked&&stops.length===3)stops.push(blank());else stops=stops.slice(0,3);invalidate();renderStops();};
for(const key of fields)$(key).addEventListener('input',invalidate);
$('time').addEventListener('input',()=>$('preset').value='custom');
$('preset').onchange=()=>{if($('preset').value!=='custom'){$('timing').value='depart';$('time').value=$('time').value.slice(0,10)+'T'+($('preset').value==='am'?'08:00':'17:00');}invalidate();};
const browserStorage=name=>{try{return window[name];}catch{return null;}};
const keyStore=createRoutingKeyStore({session:browserStorage('sessionStorage'),device:browserStorage('localStorage')});
const savedKey=keyStore.read();$('tomtomKey').value=savedKey.key;$('rememberKey').checked=savedKey.remember;
function keyMessage(text){$('keyStatus').textContent=text;}
keyMessage(savedKey.remember?'Using the key remembered on this device.':savedKey.key?'Using the key from this browser tab session.':'Enter a key once, then choose Remember on this device if you want to keep it.');
function retainKey(){
 const stored=keyStore.save($('tomtomKey').value,$('rememberKey').checked);
 keyMessage(stored.remembered?'Key remembered in this browser on this device.':$('rememberKey').checked&&!stored.deviceSaved?'This browser blocked device storage. The key will only be available in this tab.':!stored.deviceSaved?'The browser could not remove its remembered key. Clear this site’s browser data to remove it.':stored.sessionSaved?'Key kept for this tab session only.':'Browser storage is unavailable. The key will last while this page stays open.');
}
$('tomtomKey').oninput=()=>{retainKey();invalidate();};
$('rememberKey').onchange=retainKey;
$('clearKey').onclick=()=>{$('tomtomKey').value='';$('rememberKey').checked=false;const cleared=keyStore.clear();invalidate();keyMessage(cleared.sessionCleared&&cleared.deviceCleared?'Key cleared from this browser.':'Key cleared from this page. The browser blocked removal from storage; clear this site’s browser data to remove any saved copy.');status('Road results will use baseline estimates until you enter a key.');};
function toggleRail(){if(!railMap)return;for(const [id,key] of [['showStations','stations'],['showLines','lines']]){if($(id).checked)railMap[key].addTo(map);else map.removeLayer(railMap[key]);}}
$('showStations').onchange=toggleRail;$('showLines').onchange=toggleRail;
async function refreshRail(refresh=false){try{
 let data=await loadRail({refresh});
 let stationNote='';
 if(refresh){try{data=await refreshStationLocations(data);stationNote=' Station locations checked against RTD just now; timetable coverage is unchanged.';}catch{stationNote=' Current RTD station lookup failed; using the dated reference.';}}
 rail=data;
 if(railMap){map.removeLayer(railMap.stations);map.removeLayer(railMap.lines);}railMap=railLayers(data,map,{stations:false,lines:false});toggleRail();renderStops();
 $('railStatus').textContent=data.stations.length+' RTD stations · timetable '+data.coverage.start.replace(/(....)(..)(..)/,'$1-$2-$3')+' through '+data.coverage.end.replace(/(....)(..)(..)/,'$1-$2-$3')+'. Outside these dates, rail times are planning estimates. Reference updated '+data.generatedAt.slice(0,10)+'.'+stationNote;
 if(refresh)invalidate();
 }catch(e){$('railStatus').textContent='Rail reference could not load. Road planning is still available. Use Reload rail reference to retry.';}}
$('reloadRail').onclick=()=>refreshRail(true);
$('fit').onclick=()=>{if(journey.getLayers().length)map.fitBounds(journey.getBounds(),{padding:[45,45],maxZoom:15});else if(railMap)map.fitBounds(L.featureGroup(railMap.stations.getLayers()).getBounds(),{padding:[25,25]});};
function draw(plan,data){
 journey.clearLayers();
 for(const [i,s] of plan.stops.entries())L.marker([s.lat,s.lng],{icon:icon(String(i+1)),zIndexOffset:600}).addTo(journey).bindPopup('<b>'+esc(s.name||'Location '+(i+1))+'</b><br>'+esc(s.address));
 for(const leg of data.legs)for(const s of leg.segments||[]){
  if(!s.points?.length)continue;const mode=MODES[s.mode]||MODES[leg.mode],color=s.color||mode.color;
  L.polyline(s.points,{color,weight:s.mode==='walk'?3:5,opacity:.9,dashArray:s.estimated?'5,8':s.mode==='walk'?'3,5':null}).addTo(journey).bindPopup(esc(s.label||('Rail line '+s.route)));
  const p=s.points[Math.floor(s.points.length/2)];L.marker(p,{icon:icon(mode.icon,color,'transport-icon'),zIndexOffset:400}).addTo(journey).bindPopup(esc(mode.name)+(s.route?' · '+esc(s.route)+' Line':''));
 }
 $('fit').click();
}
function stationName(id){return rail?.stations.find(s=>s.id===id)?.name||id;}
function showResults(plan,data){
 $('results').hidden=false;$('resultTitle').textContent=plan.name||'Journey schedule';
 $('summary').innerHTML=(data.conflicts.length?'<div class="warning"><b>Timing needs adjustment</b><ul>'+data.conflicts.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>':'')+
 '<div class="metrics"><div class="metric">Volunteers ready at first stop<strong>'+esc(formatDenver(data.ready))+'</strong></div><div class="metric">Final arrival<strong>'+esc(formatDenver(data.arrive))+'</strong></div><div class="metric">Journey including stops<strong>'+data.minutes+' minutes</strong></div></div>';
 $('schedule').innerHTML=data.legs.map((leg,i)=>{
  const a=plan.stops[i],b=plan.stops[i+1],mode=MODES[a.mode];
  return '<article class="leg-result"><h3>'+esc(mode.icon+' '+(i+1)+'. '+(a.name||'Location '+(i+1))+' → '+(b.name||'Location '+(i+2)))+'</h3><p>'+esc(leg.label)+'</p><table class="schedule-table"><tbody>'+
  [['Volunteer reminder',leg.reminder],['Ready to leave / load',leg.ready],['Leave location',leg.depart],...(leg.platformReady?[['At boarding station',leg.platformReady],['Train departure',leg.trainDeparture]]:[]),['Arrive at destination',leg.arrive],...(b.startTime?[['Activity / field service starts',b.startTime]]:[])].map(([label,t])=>'<tr><th>'+label+'</th><td>'+esc(formatDenver(t))+'</td></tr>').join('')+'</tbody></table>'+
  '<p class="hint">Extra travel allowance: '+(leg.allowanceMinutes||0)+' min. '+(b.dwell?'Time at destination: '+b.dwell+' min.':'')+'</p><ol class="journey-steps">'+(leg.segments||[]).map(s=>s.mode==='rail'?'<li><b>🚆 '+esc(s.route)+' Line</b>: '+esc(stationName(s.from))+' → '+esc(stationName(s.to))+'<br>'+esc(formatDenver(s.depart))+' → '+esc(formatDenver(s.arrive))+(s.headsign?'<br>Train toward '+esc(s.headsign):'')+'</li>':'<li>'+esc(MODES[s.mode]?.icon||'')+' '+esc(s.label)+' · '+s.minutes+' min'+(s.directions?' · <a href="'+esc(s.directions)+'" target="_blank" rel="noopener">'+(s.mode==='walk'?'Walking directions':'Open directions')+' ↗</a>':'')+(s.instructions?.length?'<details><summary>Turn-by-turn directions</summary><ol>'+s.instructions.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol></details>':'')+'</li>').join('')+'</ol></article>';
 }).join('');
 $('tripNotes').innerHTML=[['Parking / pickup',plan.parking],['Volunteer reminders',plan.extraReminders],['Notes',plan.notes]].filter(x=>x[1]).map(([label,text])=>'<p><b>'+label+':</b> '+esc(text)+'</p>').join('')+'<p>Rail ticket method: '+esc(plan.tickets)+'. <a href="https://www.rtd-denver.com/fares-passes" target="_blank" rel="noopener">Check RTD fare and validation requirements.</a></p>';
 updateSave();draw(plan,data);
}
$('planner').onsubmit=async e=>{
 e.preventDefault();invalidate();const token=generation;request=new AbortController();const signal=request.signal;
 $('calculate').disabled=true;status('Calculating travel, walking connections and start-time constraints…');
 try{
  const plan=readPlan(),key=$('tomtomKey').value.trim();
  const data=await calculateSchedule(plan,createRouter({data:rail,key,signal}));
  if(token!==generation)return;result=data;activePlan=plan;showResults(plan,data);
  status(data.conflicts.length?'Some critical times cannot be met. Review the highlighted conflicts and adjust the plan.':'Journey calculated. Ready, departure and arrival times are shown below.',!!data.conflicts.length);
 }catch(e){if(token===generation&&e.name!=='AbortError')status(e.message,true);}finally{if(token===generation)$('calculate').disabled=false;}
};
function updateSave(){const disabled=saving||!result||!!result.conflicts.length||!canEdit('routes');$('save').disabled=disabled;$('saveCopy').disabled=disabled;$('save').textContent=activeId?'Update shared trip':'Save shared trip';$('saveDraft').disabled=saving||!canEdit('routes');}
async function persist(copy=false){if(saving||!result||!activePlan||result.conflicts.length)return;const token=generation;saving=true;updateSave();
 try{const payload=serializePlan(activePlan,result);if(JSON.stringify(payload).length>850000)throw Error('This route is too large to save. Shorten the journey.');const id=await saveRoute(payload,copy?null:activeId);if(token===generation){activeId=id;status('Travel route saved, including start times and the Encouraging Gathering address.');}}
 catch(e){status('Could not save: '+e.message,true);}finally{saving=false;updateSave();}}
async function persistDraft(){
 if(saving||!canEdit('routes'))return;
 const token=generation;saving=true;updateSave();
 try{
  const plan=validatePlan(readPlan(),{allowMissingPoints:true}),payload=serializePlan(plan);
  if(JSON.stringify(payload).length>850000)throw Error('This route is too large to save.');
  const id=await saveRoute(payload,activeId);
  if(token===generation){activeId=id;loadedShared=true;status('Draft saved. Removed pins stay removed when you reopen this route. Add any missing pins and calculate when ready.');}
 }catch(e){status('Could not save draft: '+e.message,true);}finally{saving=false;updateSave();}
}
$('saveDraft').onclick=persistDraft;
$('save').onclick=()=>persist();$('saveCopy').onclick=()=>persist(true);
$('newTrip').onclick=()=>{apply(initial());};
$('print').onclick=()=>{if(result)window.print();};
function csvCell(value){let s=String(value??'');if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
$('csv').onclick=()=>{
 if(!result||!activePlan)return;const rows=[['Trip','Leg','From','To','Transport','Reminder (Denver)','Ready (Denver)','Departure (Denver)','Arrival (Denver)','Critical start (Denver)','Estimate / source','From address','To address']];
 result.legs.forEach((l,i)=>rows.push([activePlan.name,i+1,activePlan.stops[i].name,activePlan.stops[i+1].name,MODES[l.mode].name,formatDenver(l.reminder),formatDenver(l.ready),formatDenver(l.depart),formatDenver(l.arrive),activePlan.stops[i+1].startTime?formatDenver(activePlan.stops[i+1].startTime):'',l.label,activePlan.stops[i].address,activePlan.stops[i+1].address]));
 const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Denver-2027-Travel-Route.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function renderSaved(){
 $('saved').innerHTML=records.length?records.map(r=>'<div class="saved-row"><strong>'+esc(r.routeName||r.name||'Saved route')+(r.travelDraft?' <small>· Draft</small>':'')+'</strong><button class="secondary" data-load="'+esc(r.id)+'">Load</button>'+(canEdit('routes')?'<button class="secondary danger" data-delete="'+esc(r.id)+'">Delete</button>':'')+'</div>').join(''):'<p class="empty-state">No saved routes available for this account.</p>';
}
$('saved').onclick=async e=>{
 if(e.target.dataset.load){const r=records.find(r=>r.id===e.target.dataset.load);if(r){apply(legacyPlan(r),r.recordType==='bus-route'?r.id:null);loadedShared=true;$('planner').scrollIntoView({behavior:'smooth'});}}
 if(e.target.dataset.delete){const r=records.find(r=>r.id===e.target.dataset.delete);if(!r||!confirm('Delete saved route “'+(r.routeName||'Travel route')+'”?'))return;try{await removeRoute(r.id);if(activeId===r.id)activeId=null;status('Saved route deleted.');}catch(err){status(err.message,true);}}
};
let accessRevision=0;
observeSiteAccess(auth,()=>{
 const token=++accessRevision;unsubscribers.forEach(f=>f());unsubscribers=[];records=[];customStations=[];renderSaved();renderStops();updateSave();
 if(!canView('routes')){
  if(activeId||loadedShared){activeId=null;apply(initial());}
  $('accessStatus').textContent='Sign in with Travel Routes access to view or save shared trips.';return;
 }
 $('accessStatus').textContent=canEdit('routes')?'You can view and save shared routes.':'You can view saved routes. Editing is disabled.';
 const byType=new Map();
 unsubscribers.push(watchRecords('rtd-station',list=>{if(token!==accessRevision)return;customStations=list.filter(s=>validPoint(s.lat,s.lng)).map(s=>({...s,lines:[],note:'Custom station reference. Choose a published rail station for train routing.'}));renderStops();},()=>{}));
 for(const type of ['bus-route','route-plan'])unsubscribers.push(watchRecords(type,list=>{
  if(token!==accessRevision)return;byType.set(type,list);records=[...byType.values()].flat().filter(r=>!r.travelLocationOnly);renderSaved();
 },e=>{if(token===accessRevision)$('accessStatus').textContent='Some shared routes could not load: '+e.message;}));
});
watchHalls(list=>{locations=catalog(list);renderStops();},()=>status('Saved meeting-location updates could not load. The existing location list is available.',true));
const firstPlan=initial(),linked=new URLSearchParams(location.search);
for(const [parameter,index] of [['origin',0],['destination',1],['hall',1]]){
 const point=locations.find(p=>p.id===linked.get(parameter));
 if(point)firstPlan.stops[index]={...blank(),...point};
}
apply(firstPlan);refreshRail();

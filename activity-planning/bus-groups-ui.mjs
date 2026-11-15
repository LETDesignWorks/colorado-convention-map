import {cleanGroupPlan,cleanPoint,calculateBusGroups} from './bus-groups-model.mjs';
import {formatDenver,validPoint} from '../routes/travel-plan.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=p=>JSON.stringify([p.group||'',p.id]);
const uid=()=>crypto.randomUUID();
const newBus=(name='Bus 1')=>({id:uid(),name,departure:'',destination:null,arriveBy:'',secondEnabled:false,secondDestination:null,secondMode:'duration',secondDeparture:'',duration:'60',durationUnit:'minutes',secondArriveBy:''});
const newGroup=(name='Group 1',originId='ccc',busName='Bus 1')=>({id:uid(),name,originId,buses:[newBus(busName)]});
const emptyPlan=()=>({version:1,name:'Bus groups and departures',boarding:'15',allowance:'15',groups:[newGroup()]});
const storageKey='denver2027.busGroups.v1';
export function mountBusGroups(root,{origins,route,findAddress=async()=>[],getKey=()=>'',storage,saveShared,removeShared,exportResult=()=>{}}){
 let plan=emptyPlan(),locations=[],active=null,records=[],access=false,edit=false,fresh=false,saving=false,result=null,running=false,generation=0,request=null,saveGeneration=0,lookupGeneration=0,lookup=null,lookupTarget=null,matches=[],deleteId=null;
 root.classList.add('bus-groups');
 root.innerHTML=`<span class="eyebrow">CONVENTION CENTER + TECH CENTER</span><h2>Bus groups &amp; departures</h2><p>Create groups leaving from either center. Give every bus its own departure and activity or field service destination, then add an optional second destination.</p>
 <p class="hint">All dates and times are Denver time. DTC uses the map’s Center Point reference; confirm the final pickup address.</p>
 <fieldset data-bg-editor><legend class="bg-sr">Bus group plan</legend><div class="bg-grid"><label>Plan name<input data-plan="name" maxlength="140"></label><label>Extra travel minutes per leg<input data-plan="allowance" type="number" min="0" max="240" step="1"></label><label>Boarding minutes before departure<input data-plan="boarding" type="number" min="0" max="240" step="1"></label></div>
 <div data-bg-groups></div><div class="button-row"><button type="button" class="button secondary" data-action="add-group">+ Add group</button><button type="button" class="button secondary" data-action="new">New plan</button></div></fieldset>
 <div class="bg-toolbar"><button type="button" class="button primary" data-action="calculate">Calculate bus arrivals</button><button type="button" class="button secondary" data-action="cancel" hidden>Cancel calculation</button><button type="button" class="button secondary" data-action="export" disabled>Export Excel</button></div>
 <p class="hint" data-bg-source></p><p class="bg-status" role="status" aria-live="polite" data-bg-message></p><div data-bg-results></div>
 <details class="bg-saved" open><summary>Save and reopen bus-group plans</summary><p class="hint">Save before leaving this page. Saved plans retain your groups, buses and stop settings. Recalculate arrivals after reopening.</p><p data-bg-active></p><div class="button-row"><button type="button" class="button secondary" data-action="save-device">Save on this device</button><button type="button" class="button secondary" data-action="load-device">Load device plan</button><button type="button" class="button primary" data-action="save-shared">Save shared plan</button><button type="button" class="button secondary" data-action="save-copy" hidden>Save as new shared plan</button></div><p class="hint" data-bg-access></p><div data-bg-saved></div></details>`;
 const $=selector=>root.querySelector(selector),message=text=>{$('[data-bg-message]').textContent=text;};
 function source(){const hasKey=!!getKey();$('[data-bg-source]').innerHTML=hasKey?'Uses your remembered TomTom key for time-dependent bus estimates. Extra travel time is added to each leg.':'No TomTom key is currently available: arrivals will use road estimates without time-of-day traffic. Add a key in <a href="../travel-routes/">Travel Routes</a> or the activity-to-service planner below.';}
 function cancelLookup(){lookupGeneration++;lookup?.abort();lookup=null;lookupTarget=null;matches=[];root.querySelectorAll('[data-bg-matches]').forEach(el=>el.replaceChildren());}
 function invalidate(note='Inputs changed. Calculate bus arrivals to update the schedule.'){
  generation++;request?.abort();request=null;running=false;result=null;$('[data-bg-results]').replaceChildren();message(note);controls();
 }
 function controls(){
  $('[data-bg-editor]').disabled=saving;
  $('[data-action="calculate"]').disabled=saving||running;
  $('[data-action="cancel"]').hidden=!running;
  $('[data-action="export"]').disabled=!result||saving||running;
  for(const action of ['save-device','load-device','new'])$('[data-action="'+action+'"]').disabled=saving;
  $('[data-action="save-shared"]').disabled=saving||!edit||!fresh;
  $('[data-action="save-copy"]').disabled=saving||!edit||!fresh;
  $('[data-action="save-copy"]').hidden=!active;
  $('[data-bg-active]').textContent=active?'Editing shared plan: '+plan.name:'Current plan is a draft.';
  $('[data-bg-access]').textContent=!access?'Sign in with Activity Planning access to view shared plans.':!fresh?'Waiting for current shared plans. Device saving and calculations are available.':edit?'Shared changes use your Activity Planning edit access.':'You can view shared plans. Activity Planning edit access is needed to change them.';
  $('[data-bg-saved]').querySelectorAll('button').forEach(b=>{b.disabled=saving||(b.dataset.action!=='load-shared'&&(!edit||!fresh));});source();
 }
 function options(point){
  const groups=new Map();for(const p of locations){const name=p.group||'Locations';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p);}
  if(point&&!point.customAddress&&!locations.some(p=>key(p)===key(point)))groups.set('Saved location',[point]);
  return '<option value="">Select an activity or meeting for service</option>'+[...groups].map(([group,points])=>'<optgroup label="'+esc(group)+'">'+points.map(p=>'<option value="'+esc(key(p))+'" '+(point&&!point.customAddress&&key(point)===key(p)?'selected':'')+'>'+esc(p.name)+(p.busStatus==='not-suitable'?' · Unsuitable':'')+'</option>').join('')+'</optgroup>').join('')+'<option value="custom" '+(point?.customAddress?'selected':'')+'>Another location / enter address</option>';
 }
 function destination(bus,field,label){const p=bus[field];return `<div class="bg-destination" data-destination="${field}"><label>${label}<select data-field="${field}">${options(p)}</select></label>${p?`<p class="hint">${esc(p.address||'Address needed')}${validPoint(p.lat,p.lng)?' · '+esc(p.lat)+', '+esc(p.lng):' · Pin needed'}</p>`:''}${p&&!p.customAddress?'<button type="button" class="button secondary small" data-action="edit-point">Edit address / pin</button>':''}${p?.customAddress?`<div class="bg-grid"><label>Location name<input data-point="name" maxlength="140" value="${esc(p.name)}"></label><label>Address<input data-point="address" maxlength="300" value="${esc(p.address)}"></label></div><div class="bg-grid"><label>Latitude<input data-point="lat" type="number" step="any" min="-90" max="90" value="${esc(p.lat)}"></label><label>Longitude<input data-point="lng" type="number" step="any" min="-180" max="180" value="${esc(p.lng)}"></label></div><button type="button" class="button secondary small" data-action="find-address">Find address / suggested pin</button><div data-bg-matches aria-live="polite"></div>`:''}</div>`;}
 function busHTML(bus){return `<details class="bg-bus" open data-bus="${esc(bus.id)}"><summary><span data-bus-title>${esc(bus.name)}</span> <span class="hint">· individual departure &amp; destinations</span></summary><div class="bg-grid"><label>Bus / passenger group name<input data-field="name" maxlength="100" value="${esc(bus.name)}"></label><label>Leaves the center · Denver<input data-field="departure" type="datetime-local" value="${esc(bus.departure)}"></label><label>Must arrive at destination 1 by · optional<input data-field="arriveBy" type="datetime-local" value="${esc(bus.arriveBy)}"></label></div>${destination(bus,'destination','Destination 1 · activity or meeting for service')}<label class="bg-check"><input data-field="secondEnabled" type="checkbox" ${bus.secondEnabled?'checked':''}> Add a second destination for this bus</label>${bus.secondEnabled?`<div class="bg-second">${destination(bus,'secondDestination','Destination 2 · next activity or meeting for service')}<div class="bg-grid"><label>Leave destination 1<select data-field="secondMode"><option value="duration" ${bus.secondMode==='duration'?'selected':''}>After a stop duration + boarding</option><option value="time" ${bus.secondMode==='time'?'selected':''}>At an exact date and time</option></select></label>${bus.secondMode==='time'?`<label>Leaves destination 1 · Denver<input data-field="secondDeparture" type="datetime-local" value="${esc(bus.secondDeparture)}"></label>`:`<label>Activity / stop duration<input data-field="duration" type="number" min="0" max="${bus.durationUnit==='hours'?24:1440}" step="any" value="${esc(bus.duration)}"></label><label>Duration unit<select data-field="durationUnit"><option value="minutes" ${bus.durationUnit==='minutes'?'selected':''}>Minutes</option><option value="hours" ${bus.durationUnit==='hours'?'selected':''}>Hours</option></select></label>`}<label>Must arrive at destination 2 by · optional<input data-field="secondArriveBy" type="datetime-local" value="${esc(bus.secondArriveBy)}"></label></div><p class="hint">Stop duration starts when the bus arrives. Boarding time is added after it. An exact departure must allow arrival and boarding first.</p></div>`:''}<button type="button" class="button secondary small" data-action="remove-bus">Remove this bus</button></details>`;}
 function renderEditor(){
  const collapsed=new Set([...root.querySelectorAll('details[data-group],details[data-bus]')].filter(x=>!x.open).map(x=>x.dataset.group||x.dataset.bus));
  for(const field of ['name','boarding','allowance'])$('[data-plan="'+field+'"]').value=plan[field];
  $('[data-bg-groups]').innerHTML=plan.groups.map(g=>`<details class="bg-group" open data-group="${esc(g.id)}"><summary><span data-group-title>${esc(g.name)}</span> <span class="bg-pill">${g.buses.length} ${g.buses.length===1?'bus':'buses'}</span></summary><div class="bg-grid"><label>Group name<input data-group-field="name" maxlength="100" value="${esc(g.name)}"></label><label>Starting location<select data-group-field="originId">${origins.map(o=>`<option value="${esc(o.id)}" ${g.originId===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></label></div><p class="hint">${esc(origins.find(o=>o.id===g.originId)?.address||'')}</p><div>${g.buses.map(busHTML).join('')}</div><div class="button-row"><button type="button" class="button secondary" data-action="add-bus">+ Add bus to this group</button><button type="button" class="button secondary small" data-action="remove-group">Remove group</button></div></details>`).join('');
  root.querySelectorAll('details[data-group],details[data-bus]').forEach(el=>{if(collapsed.has(el.dataset.group||el.dataset.bus))el.open=false;});controls();
 }
 function renderSaved(){
  $('[data-bg-saved]').innerHTML=access?(records.length?records.map(r=>`<div class="bg-saved-row"><div><strong>${esc(r.plan.name)}</strong><br><span class="hint">${r.plan.groups.length} groups · ${r.plan.groups.reduce((n,g)=>n+g.buses.length,0)} buses</span></div><div class="button-row"><button class="button secondary small" type="button" data-action="load-shared" data-record="${esc(r.id)}">Load</button>${edit?`<button class="button secondary small" type="button" data-action="${deleteId===r.id?'confirm-delete':'delete-shared'}" data-record="${esc(r.id)}">${deleteId===r.id?'Confirm delete':'Delete'}</button>${deleteId===r.id?'<button class="button secondary small" type="button" data-action="cancel-delete">Cancel</button>':''}`:''}</div></div>`).join(''):'<p class="hint">No saved bus-group plans yet.</p>'):'';controls();
 }
 function renderResults(){
  const when=t=>Number.isFinite(t)?esc(formatDenver(t)):'Not calculated';
  $('[data-bg-results]').innerHTML=`<div class="bg-result-heading"><h3>Bus arrival schedule</h3><p>${result.rows.length} buses · ${result.ready} schedules ready · ${result.attention} need attention</p></div><p class="hint">${result.traffic?'Time-dependent TomTom estimates':'Road baselines without time-of-day traffic'} · Includes ${esc(result.plan.allowance)} extra travel minutes per leg. Confirm bus access and pickup entrances.</p>`+result.plan.groups.map(g=>`<h4>${esc(g.name)} · ${esc(origins.find(o=>o.id===g.originId)?.name)}</h4><div class="bg-table-wrap"><table><thead><tr><th>Bus</th><th>Ready / board at center</th><th>Leaves center</th><th>Destination 1 / arrival</th><th>Ready / leaves stop 1</th><th>Destination 2 / arrival</th><th>Timing notes</th></tr></thead><tbody>${result.rows.filter(r=>r.groupId===g.id).map(r=>{const first=r.legs[0],second=r.legs[1],bus=g.buses.find(b=>b.id===r.busId);return `<tr class="${r.issues.length?'bg-attention':''}"><th>${esc(r.busName)}</th><td>${when(first?.ready)}</td><td>${when(r.departure)}</td><td><strong>${esc(bus.destination?.name||'Choose a destination')}</strong><br>${when(first?.arrive)}${first?'<br><small>'+first.minutes+' min drive + '+esc(result.plan.allowance)+' min allowance</small>':''}</td><td>${r.secondEnabled?(second?'Board: '+when(second.ready)+'<br>Leave: '+when(second.depart):'Not scheduled'): '—'}</td><td>${r.secondEnabled?'<strong>'+esc(bus.secondDestination?.name||'Choose destination 2')+'</strong><br>'+when(second?.arrive):'No second destination'}</td><td>${r.issues.length?esc(r.issues.join(' ')):'Schedule ready'}${first?.deadline?'<br><small>Stop 1 due: '+when(first.deadline)+'</small>':''}${second?.deadline?'<br><small>Stop 2 due: '+when(second.deadline)+'</small>':''}</td></tr>`;}).join('')}</tbody></table></div>`).join('');controls();
 }
 function context(el){const group=plan.groups.find(g=>g.id===el.closest('[data-group]')?.dataset.group),bus=group?.buses.find(b=>b.id===el.closest('[data-bus]')?.dataset.bus);return {group,bus,field:el.closest('[data-destination]')?.dataset.destination};}
 function update(el){
  if(saving)return;const {group,bus,field}=context(el);let structural=false;
  if(el.dataset.plan)plan[el.dataset.plan]=el.value;
  else if(el.dataset.groupField&&group){group[el.dataset.groupField]=el.value;structural=el.dataset.groupField==='originId';if(!structural)el.closest('[data-group]').querySelector('[data-group-title]').textContent=group.name;}
  else if(el.dataset.point&&bus){bus[field][el.dataset.point]=el.value;if(el.dataset.point==='address'){bus[field].lat=null;bus[field].lng=null;el.closest('[data-destination]').querySelectorAll('[data-point="lat"],[data-point="lng"]').forEach(x=>x.value='');}cancelLookup();const note=el.closest('[data-destination]').querySelector('p.hint');if(note)note.textContent=bus[field].address+(validPoint(bus[field].lat,bus[field].lng)?' · '+bus[field].lat+', '+bus[field].lng:' · Pin needed');}
  else if(el.dataset.field&&bus){const property=el.dataset.field;
   if(property==='destination'||property==='secondDestination'){bus[property]=el.value==='custom'?{id:'custom-'+uid(),name:'',address:'',lat:null,lng:null,group:'Custom locations',customAddress:true}:el.value?cleanPoint(locations.find(p=>key(p)===el.value)||bus[property]):null;structural=true;}
   else {bus[property]=el.type==='checkbox'?el.checked:el.value;structural=['secondEnabled','secondMode','durationUnit'].includes(property);if(property==='name')el.closest('[data-bus]').querySelector('[data-bus-title]').textContent=bus.name;}
  }else return;
  invalidate();if(structural){cancelLookup();renderEditor();}
 }
 root.addEventListener('input',event=>{if(event.target.matches('input:not([type="checkbox"]),textarea'))update(event.target);});
 root.addEventListener('change',event=>{if(event.target.matches('select,input[type="checkbox"]'))update(event.target);});
 async function calculate(){
  cancelLookup();invalidate('Calculating each bus and onward trip…');const token=generation;request=new AbortController();running=true;controls();
  try{const answer=await calculateBusGroups(plan,{origins,route,key:getKey(),signal:request.signal,onProgress:(done,total)=>{if(token===generation)message('Calculated '+done+' of '+total+' buses…');}});if(token!==generation)return;result=answer;running=false;request=null;renderResults();message(answer.attention?'Arrivals calculated. Review the highlighted timing notes.':'Arrivals calculated for all buses.');}
  catch(error){if(token!==generation)return;running=false;request=null;message(error.name==='AbortError'?'Calculation canceled.':error.message);controls();}
 }
 async function lookupAddress(el,bus,field){
  cancelLookup();const point=bus[field];if(!point.address?.trim()){message('Enter an address to look up its pin.');return;}const token=lookupGeneration;lookupTarget={busId:bus.id,field};const controller=new AbortController();lookup=controller;const timer=setTimeout(()=>controller.abort(),20000);const box=el.closest('[data-destination]').querySelector('[data-bg-matches]');box.textContent='Finding suggested addresses…';
  try{const found=await findAddress(point.address,{signal:controller.signal});if(token!==lookupGeneration)return;matches=found.filter(p=>validPoint(p.lat,p.lng));box.innerHTML=matches.length?matches.map((p,i)=>`<div class="bg-match"><span>${esc(p.address||p.name)}${p.approximate?' · Area only; enter the exact pin above.':''}</span>${!p.approximate?`<button type="button" class="button secondary small" data-action="use-pin" data-match="${i}">Use this pin</button>`:''}</div>`).join(''):'No precise address found. Enter the latitude and longitude above.';}
  catch{if(token===lookupGeneration)box.textContent='Address lookup is unavailable. Enter the latitude and longitude above, or try again.';}
  finally{clearTimeout(timer);if(token===lookupGeneration)lookup=null;}
 }
 async function save(copy){
  if(saving||!edit||!fresh)return;const token=++saveGeneration;
  try{const snapshot=cleanGroupPlan(plan);cancelLookup();invalidate('Saving shared bus-group plan…');saving=true;controls();const saved=await saveShared(snapshot,copy?null:active);if(token!==saveGeneration)return;active=saved;message('Shared plan saved. Recalculate arrivals when you reopen it.');}
  catch(error){if(token===saveGeneration)message(error.message||'Could not save. Your changes are still here.');}
  finally{if(token===saveGeneration){saving=false;controls();}}
 }
 function loadPlan(value,reference=null){cancelLookup();plan=cleanGroupPlan(value);active=reference;invalidate('Plan loaded. Calculate bus arrivals for updated estimates.');renderEditor();}
 root.addEventListener('click',async event=>{
  const el=event.target.closest('button[data-action]');if(!el||!root.contains(el)||el.disabled)return;const action=el.dataset.action,{group,bus,field}=context(el);
  try{
   if(action==='calculate')return await calculate();
   if(action==='cancel'){invalidate('Calculation canceled.');return;}
   if(action==='export'){if(result)await exportResult(result);return;}
   if(action==='save-shared'||action==='save-copy')return await save(action==='save-copy');
   if(action==='save-device'){if(!storage)throw Error('Device storage is unavailable. Sign in to save a shared plan.');storage.setItem(storageKey,JSON.stringify(cleanGroupPlan(plan)));message('Plan saved on this device.');return;}
   if(action==='load-device'){const json=storage?.getItem(storageKey);if(!json)throw Error('No bus-group plan has been saved on this device.');loadPlan(JSON.parse(json));return;}
   if(action==='load-shared'){const r=records.find(r=>r.id===el.dataset.record);if(r&&access)loadPlan(r.plan,{id:r.id,revision:r.revision});return;}
   if(action==='delete-shared'){deleteId=el.dataset.record;renderSaved();return;}
   if(action==='cancel-delete'){deleteId=null;renderSaved();return;}
   if(action==='confirm-delete'){
    if(!edit||!fresh)return;const r=records.find(r=>r.id===el.dataset.record);if(!r)return;const token=++saveGeneration;saving=true;controls();
    try{await removeShared({id:r.id,revision:r.revision});if(token!==saveGeneration)return;if(active?.id===r.id)active=null;deleteId=null;message('Shared plan deleted. Any open draft remains available.');}
    catch(error){if(token===saveGeneration)message(error.message||'The shared plan could not be deleted.');}
    finally{if(token===saveGeneration){saving=false;renderSaved();}}return;
   }
   if(action==='find-address')return await lookupAddress(el,bus,field);
   if(action==='use-pin'){const p=matches[Number(el.dataset.match)];if(!p||p.approximate||lookupTarget?.busId!==bus?.id||lookupTarget.field!==field)return;bus[field]={...bus[field],address:p.address||bus[field].address,lat:Number(p.lat),lng:Number(p.lng)};}
   else if(action==='edit-point'){bus[field]={...bus[field],customAddress:true};}
   else if(action==='add-group'){if(plan.groups.length>=100)throw Error('Use up to 100 groups in one plan.');if(plan.groups.reduce((n,g)=>n+g.buses.length,0)>=1000)throw Error('Use up to 1,000 buses in one plan.');plan.groups.push(newGroup('Group '+(plan.groups.length+1),plan.groups.length===1?'dtc':'ccc',nextBusName()));}
   else if(action==='add-bus'){if(plan.groups.reduce((n,g)=>n+g.buses.length,0)>=1000)throw Error('Use up to 1,000 buses in one plan.');group.buses.push(newBus(nextBusName()));}
   else if(action==='remove-bus'){group.buses=group.buses.filter(b=>b.id!==bus.id);}
   else if(action==='remove-group'){plan.groups=plan.groups.filter(g=>g.id!==group.id);}
   else if(action==='new'){plan=emptyPlan();active=null;}
   else return;
   cancelLookup();invalidate();renderEditor();
  }catch(error){message(error.message||'This action could not be completed.');}
 });
 function nextBusName(){const max=Math.max(0,...plan.groups.flatMap(g=>g.buses).map(b=>Number(/^Bus (\d+)$/.exec(b.name)?.[1]||0)));return 'Bus '+(max+1);}
 renderEditor();renderSaved();message('Add departure dates and destinations, then calculate arrivals.');
 return {
  getPlan:()=>structuredClone(plan),getResult:()=>result,
  setLocations(points){locations=points.filter(p=>p?.id&&p?.name);cancelLookup();renderEditor();},
  setShared({items=[],canRead=false,canWrite=false,current=false,reset=false,note=''}={}){
   if(reset||(!canRead&&access)){saveGeneration++;saving=false;cancelLookup();if(active){plan=emptyPlan();active=null;invalidate('Shared plan closed because your access changed.');renderEditor();}else if(running)invalidate('Access changed. Recalculate when ready.');}
   records=items;access=canRead;edit=canWrite;fresh=current;renderSaved();if(note)message(note);
  },
  invalidate:()=>invalidate(),loadPlan
 };
}

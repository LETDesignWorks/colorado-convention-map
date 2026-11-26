import {parseScenario,pointKey,compareTravelScenarios,compareCongregationScenarios,draftHostingScenario} from './scenario-model.mjs?v=scenarios-20261126-1';
import {scenarioContext,onScenarioContext} from './scenario-context.mjs';
import {SERVICE_DATES,dateLabel,isApprovedMeeting} from '../assignments/hosting-model.mjs?v=scenarios-20261126-1';
import {formatDenver} from '../routes/travel-plan.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=new URL('../',import.meta.url),handoffKey='denver2027.scenario-handoff.v1';
const storage=name=>{try{return globalThis[name];}catch{return null;}};
const numeric=(v,label)=>{if(String(v).trim()===''||!Number.isFinite(Number(v)))throw Error('Enter '+label+'.');return Number(v);};
function handoff(kind,value){const target=kind==='travel'?'travel-routes/':'assignments/';const saved={kind,value,expires:Date.now()+30*60000};try{sessionStorage.setItem(handoffKey,JSON.stringify(saved));}catch{throw Error('Browser handoff storage is unavailable. Copy the scenario text, open the destination page, and paste it there.');}location.href=new URL(target,base).href;}
function pendingHandoff(){try{const value=JSON.parse(sessionStorage.getItem(handoffKey)||'null');if(value?.expires>Date.now())return value;sessionStorage.removeItem(handoffKey);}catch{}return null;}
export function mountScenarioPanel({host,services:injected}={}){
 if(document.getElementById('scenarioPlanner'))return;
 const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./scenario.css?v=scenarios-20261126-1',import.meta.url);document.head.append(style);
 const root=document.createElement('details');root.id='scenarioPlanner';root.className='scenario-planner';
 root.innerHTML=`<summary><span><strong>Scenario planner</strong><small>Describe a trip or congregation plan</small></span><span data-sc-toggle-label>Expand</span></summary><div class="sc-body">
 <p>Describe your scenario, review the details, then compare suggestions. Saved location names, May/June 2027 dates, AM/PM times, counts and simple preferences can be recognized. <strong>Only the reviewed fields are used in calculations; other instructions remain notes.</strong></p>
 <label>What are you planning?<select data-sc-kind><option value="travel">Travel routes / buses</option><option value="assignments">Congregation meeting-point assignments</option><option value="hosting">Daily delegate hosting</option></select></label>
 <label>Your scenario<textarea data-sc-text rows="3" maxlength="6000" placeholder="For example: 3 buses from CCC to DTC on May 25, arrive by 9 AM, stagger by 10 minutes."></textarea></label>
 <div class="sc-actions"><button type="button" data-sc-action="example">Use an example</button><button type="button" data-sc-action="review" class="sc-primary">Review scenario</button><button type="button" data-sc-action="cancel" hidden>Cancel calculation</button></div>
 <p data-sc-status role="status" aria-live="polite"></p><div data-sc-fields></div><div data-sc-results></div></div>`;
 if(host)host.append(root);else{const header=document.querySelector('header');if(header)header.after(root);else document.body.prepend(root);}
 const $=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)];
 let revision=0,request=null,busy=false,services=null,servicePromise=null,locations=[],railPoints=[],parsed=null,outcome=null,signature='',comparisonKind='',publicReady=false,publicStop=null;
 const stateText=s=>{$('[data-sc-status]').textContent=s;};
 const context=()=>scenarioContext('assignments');
 const kind=()=>$('[data-sc-kind]').value;
 if(location.pathname.includes('/assignments'))$('[data-sc-kind]').value='assignments';
 function toggleLabel(){$('[data-sc-toggle-label]').textContent=root.open?'Minimize':'Expand';try{localStorage.setItem('denver2027.scenario-panel',root.open?'expanded':'collapsed');}catch{}}
 try{root.open=localStorage.getItem('denver2027.scenario-panel')==='expanded';}catch{}
 root.addEventListener('toggle',toggleLabel);toggleLabel();
 function setBusy(value){busy=value;$('[data-sc-action="cancel"]').hidden=!value;const compare=$('[data-sc-action="compare"]');if(compare)compare.disabled=value||!$('[data-sc-confirm]').checked;}
 function invalidate(message='Details changed. Compare again when ready.'){
  revision++;request?.abort();request=null;outcome=null;signature='';$('[data-sc-results]').replaceChildren();setBusy(false);if(parsed)stateText(message);
 }
 async function ensureServices(){
  if(services)return services;if(servicePromise)return servicePromise;
  servicePromise=(async()=>{
   if(injected){services=injected;locations=services.locations;publicReady=true;return services;}
   const [common,providers,railModule,keyModule,addresses,driveModule]=await Promise.all([import('./planning-common.mjs'),import('../travel-routes/providers.mjs'),import('./rail-network.mjs'),import('../travel-routes/key-store.mjs'),import('../assignments/location-model.mjs'),import('../assignments/drive-times.mjs')]);
   const keys=keyModule.createRoutingKeyStore({session:storage('sessionStorage'),device:storage('localStorage')});
   services={...providers,findAddress:addresses.findAddress,createDriveTimes:driveModule.createDriveTimes,getKey:()=>scenarioContext('travel')?.getKey?.()??keys.read().key,loadRail:()=>railModule.loadRail()};
   const travel=scenarioContext('travel');
   if(travel){locations=travel.getLocations();publicReady=true;services.getLocations=()=>travel.getLocations();}
   else{
    locations=common.catalog();const cloud=await import('./planning-cloud.mjs');
    publicStop=cloud.watchHalls(records=>{locations=common.catalog(records);publicReady=true;},()=>{publicReady=false;});
   }
   return services;
  })().catch(e=>{servicePromise=null;throw e;});return servicePromise;
 }
 function points(){return [...new Map([...(services?.getLocations?.()||locations),...railPoints].map(p=>[pointKey(p),p])).values()];}
 function snapshot(mode){if(mode==='travel')return JSON.stringify([points(),services?.getKey?.()]);return JSON.stringify([context()?.getData(),mode==='hosting'?context()?.getHostingPlan():null]);}
 function usablePoints(){return points().filter(p=>p.group!=='Field service / meeting places'||isApprovedMeeting(p));}
 function option(p,selected){return `<option value="${esc(pointKey(p))}" ${selected===pointKey(p)?'selected':''}>${esc(p.name)}</option>`;}
 const input=(label,name,value,type='number',extra='')=>`<label>${label}<input data-sc-field="${name}" type="${type}" value="${esc(value??'')}" ${extra}></label>`;
 function choiceList(title,items,attribute,chosen){return `<details class="sc-choices"><summary>${title} · ${items.length} available</summary><label>Filter this list<input data-sc-filter="${attribute}" type="search"></label><div class="sc-actions"><button type="button" data-sc-action="check-all" data-sc-list="${attribute}">Select shown</button><button type="button" data-sc-action="check-none" data-sc-list="${attribute}">Clear all</button></div><div class="sc-choice-list">${items.map(p=>`<label data-sc-choice="${attribute}" data-sc-name="${esc(p.name.toLowerCase())}"><input type="checkbox" data-sc-choice-id="${attribute}" value="${esc(p.id)}" ${chosen.includes(String(p.id))?'checked':''}>${esc(p.name)}</label>`).join('')}</div></details>`;}
 function stopCard(i,key){const p=usablePoints().find(p=>pointKey(p)===key);return `<section class="sc-stop" data-sc-stop="${i}" ${i===2&&!parsed.pointKeys[2]||i===3&&!parsed.pointKeys[3]?'hidden':''}><h4>${i?'Destination '+i:'Starting point'}</h4><label>Select location<select data-sc-point="${i}"><option value="">Choose a location</option>${usablePoints().map(item=>option(item,key)).join('')}<option value="custom">Independent address / coordinates</option></select></label><div data-sc-custom="${i}" hidden><label>Location name<input data-sc-name="${i}"></label><label>Street address<input data-sc-address="${i}" placeholder="Street, city, state and ZIP"></label><button type="button" data-sc-action="find-address" data-sc-index="${i}">Find address</button><div data-sc-matches="${i}"></div><div class="sc-grid"><label>Latitude<input type="number" step="any" data-sc-lat="${i}"></label><label>Longitude<input type="number" step="any" data-sc-lng="${i}"></label></div><p>Check the entrance and coordinates before using this pin.</p></div><div class="sc-grid"><label>Travel from here<select data-sc-mode="${i}">${[['bus','Bus / motorcoach'],['car','Car'],['rail','Rail + walking'],['walk','Walking']].map(([value,label])=>`<option value="${value}" ${parsed.mode===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Activity / stop duration · minutes<input data-sc-dwell="${i}" type="number" min="0" max="1440" value="${i>0&&i<3?parsed.dwell:0}"></label><label>Critical activity start, if any<input data-sc-start="${i}" type="datetime-local"></label></div></section>`;}
 function renderFields(){
  const mode=kind(),data=context()?.getData();let body='';
  if(mode==='travel'){
   body=`<div class="sc-grid">${input('Route name','name','Scenario route','text')}<label>Timing<select data-sc-field="timing"><option value="depart" ${parsed.timing==='depart'?'selected':''}>Leave at</option><option value="arrive" ${parsed.timing==='arrive'?'selected':''}>Arrive by</option></select></label>${input('Date & time · Denver','time',parsed.dates[0]&&parsed.time?parsed.dates[0]+'T'+parsed.time:'','datetime-local')}${input('Passengers per vehicle / group','passengers',parsed.total??0,'number','min="0" max="10000"')}${input('Vehicles / groups · same itinerary','buses',parsed.buses,'number','min="1" max="20"')}${input('Stagger spacing · minutes','stagger',parsed.stagger,'number','min="0" max="180"')}</div><p>Each vehicle follows the reviewed itinerary. For separate origins or different destinations per bus, use <a href="${new URL('activity-planning/#busGroups',base)}">Bus groups &amp; departures</a>. Passenger numbers do not check vehicle seat capacity.</p><div class="sc-stop-grid">${[0,1,2,3].map(i=>stopCard(i,parsed.pointKeys[i])).join('')}</div><div class="sc-actions"><label class="sc-check"><input type="checkbox" data-sc-third ${parsed.pointKeys.length>=3?'checked':''}> Add third location</label><label class="sc-check"><input type="checkbox" data-sc-fourth ${parsed.pointKeys.length>=4?'checked':''}> Add fourth location</label><label class="sc-check"><input type="checkbox" data-sc-reorder> Compare the order of intermediate stops</label></div><div class="sc-grid"><label>Flexible time window<select data-sc-field="window"><option value="0">Exact time</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label></div><p>Time options are checked in 15-minute steps. “Arrive by” only tests earlier arrival targets. Rush-hour comparisons need the remembered TomTom key from Travel Routes; without it, road comparisons use baselines.</p><details class="sc-choices"><summary>Boarding, arrival and travel allowances</summary><div class="sc-grid">${input('Boarding minutes','boarding',15)}${input('Extra travel minutes / leg','allowance',10)}${input('Arrival buffer minutes','arrivalBuffer',10)}${input('Rail transfer minutes','transfer',10)}${input('Estimated rail wait minutes','wait',15)}${input('Reminder lead minutes','reminder',30)}</div></details>`;
  }else{
   const chosen=parsed.congregationIds.length?parsed.congregationIds:mode==='hosting'?data.congregations.map(c=>String(c.id)):context().getSelectedIds();
   const approved=data.locations.filter(isApprovedMeeting),named=approved.filter(p=>parsed.pointKeys.some(key=>key.endsWith('|'+p.id))).map(p=>String(p.id));
   if(mode==='hosting')body=`<div class="sc-grid">${input('Expected delegates · each selected day','total',parsed.total)}${input('Of these, DTC delegates','dtc',parsed.dtc??0)}${input('Default delegates per host','capacity',parsed.capacity??context().getHostingPlan().hostCapacity)}<label>Hosting preference<select data-sc-field="policy">${[['local-first','Local hosts first'],['visiting-first','Available visiting hosts first'],['local-only','Local hosts only']].map(([v,l])=>`<option value="${v}" ${v===parsed.policy?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="sc-actions">${SERVICE_DATES.map(date=>`<label class="sc-check"><input type="checkbox" data-sc-date value="${date}" ${parsed.dates.includes(date)?'checked':''}>${dateLabel(date)}</label>`).join('')}</div><p>Counts apply to each checked date. Existing hosting slots are retained. Suggestions fill remaining demand using recorded availability and shared meeting capacities. Proximity here is straight-line distance; check the travel route before finalizing.</p>`;
   else body=`<div class="sc-grid">${input('Maximum drive · minutes','limit',80,'number','min="1" max="480"')}</div><label class="sc-check"><input type="checkbox" data-sc-together> Keep all selected congregations at one meeting point</label><p>Compare car-road baseline driving times to approved meeting points. Traffic and date-specific availability are not included here; use Daily delegate hosting for availability. A limit above 80 minutes enables the travel override when reviewing on the map.</p><button type="button" data-sc-action="unassigned">Select unassigned congregations</button>`;
   body+=choiceList('Congregations',data.congregations,'congregations',chosen)+choiceList('Approved meeting locations',approved,'meetings',named.length?named:approved.map(p=>String(p.id)));
  }
  $('[data-sc-fields]').innerHTML=`<div class="sc-review"><h3>Review the interpreted details</h3>${parsed.warnings.length?'<ul class="sc-warning">'+parsed.warnings.map(w=>'<li>'+esc(w)+'</li>').join(''):'<p>Check the locations, dates and numbers before comparing.</p>'}${body}<label class="sc-check sc-confirm"><input type="checkbox" data-sc-confirm> These fields reflect the scenario I want to compare. I have reviewed any extra requirements in my text.</label><button type="button" data-sc-action="compare" class="sc-primary" disabled>${mode==='travel'?'Compare routes':mode==='hosting'?'Suggest daily hosts':'Compare meeting-point assignments'}</button></div>`;
 }
 const field=name=>$(`[data-sc-field="${name}"]`)?.value;
 const ids=name=>all(`[data-sc-choice-id="${name}"]:checked`).map(el=>el.value);
 function readTravel(){
  const stops=all('[data-sc-stop]').filter(el=>!el.hidden).map(el=>{const i=el.dataset.scStop,key=$(`[data-sc-point="${i}"]`).value,p=key==='custom'?{id:'scenario-custom-'+i,name:$(`[data-sc-name="${i}"]`).value||'Independent location',address:$(`[data-sc-address="${i}"]`).value,lat:numeric($(`[data-sc-lat="${i}"]`).value,'latitude'),lng:numeric($(`[data-sc-lng="${i}"]`).value,'longitude')}:points().find(p=>pointKey(p)===key);if(!p)throw Error('Choose every included location.');if(p.group==='Field service / meeting places'&&!isApprovedMeeting(p))throw Error(p.name+' is no longer approved. Choose another meeting point.');return {...structuredClone(p),mode:$(`[data-sc-mode="${i}"]`).value,dwell:numeric($(`[data-sc-dwell="${i}"]`).value,'stop duration'),dwellUnit:'minutes',startTime:$(`[data-sc-start="${i}"]`).value,showRail:false,railFrom:'',railTo:'',pinRemoved:false,locationGroup:'all'};});
  const plan={name:field('name'),vehicle:'Scenario journey',planningStatus:'planned',assignedHotelIds:[],assignedCongregationIds:[],notes:parsed.text,parking:'',tickets:'mobile',extraReminders:'',time:field('time'),timing:field('timing'),stops};
  for(const name of ['passengers','boarding','allowance','arrivalBuffer','transfer','wait','reminder'])plan[name]=numeric(field(name),name);return plan;
 }
 function table(headers,rows){return `<div class="sc-table"><table><thead><tr>${headers.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`;}
 function renderResults(){
  let html='<h3>Scenario results</h3>';
  if(comparisonKind==='travel'){
   html+='<p>'+esc(outcome.scope)+'</p>';
   if(!outcome.best)html+='<p class="sc-warning">No feasible route was found. Review the conflicts or unavailable travel estimates below.</p>';
   html+=table(['Itinerary','Journey minutes','Ready / boarding','Departure','Arrival','Result'],outcome.results.map(r=>[esc(r.plan.stops.map(p=>p.name).join(' → ')),r.schedule?.minutes??'—',r.schedule?esc(formatDenver(r.schedule.ready)):'—',r.schedule?esc(formatDenver(r.schedule.depart)):'—',r.schedule?esc(formatDenver(r.schedule.arrive)):'—',esc(r.error||r.schedule?.conflicts.join(' ')||(r===outcome.best?'Fastest tested feasible option':'Feasible'))]));
   if(outcome.best){html+='<h4>Vehicle / group schedule</h4>'+table(['Vehicle','Ready','Leaves','Arrives','Status','Open draft'],outcome.fleet.map((r,i)=>[esc(r.plan.vehicle||'Journey '+(i+1)),r.schedule?esc(formatDenver(r.schedule.ready)):'—',r.schedule?esc(formatDenver(r.schedule.depart)):'—',r.schedule?esc(formatDenver(r.schedule.arrive)):'—',esc(r.error||r.schedule?.conflicts.join(' ')||'Feasible estimate'),r.schedule&&!r.schedule.conflicts.length?`<button type="button" data-sc-action="use-route" data-sc-index="${i}">Review in Travel Routes</button>`:'Resolve timing first']));
    html+='<h4>Leg details for the fastest tested itinerary</h4>'+table(['From','To','Ready / boarding','Departs','Arrives','Estimate source'],outcome.best.schedule.legs.map((leg,i)=>[esc(outcome.best.plan.stops[i].name),esc(outcome.best.plan.stops[i+1].name),esc(formatDenver(leg.ready)),esc(formatDenver(leg.depart)),esc(formatDenver(leg.arrive)),esc(leg.label)]));}
   html+='<p>Loading a route creates an editable draft. Use the normal Save controls to share it.</p>';
  }else if(comparisonKind==='assignments'){
   html+='<p>'+esc(outcome.scope)+` Compared ${outcome.meetings} approved meeting points; ${outcome.unknown} drive estimates unavailable.</p>`;
   const groups=Map.groupBy?Map.groupBy(outcome.assignments,r=>String(r.point.id)):outcome.assignments.reduce((m,r)=>(m.set(String(r.point.id),[...(m.get(String(r.point.id))||[]),r]),m),new Map());
   html+=table(['Congregation','Suggested meeting point','Baseline drive'],outcome.assignments.map(r=>[esc(r.congregation.name),esc(r.point.name),Math.ceil(r.seconds/60)+' min']));
   for(const [id,rows]of groups)html+=`<button type="button" data-sc-action="stage-assignments" data-sc-id="${esc(id)}">Review ${rows.length} at ${esc(rows[0].point.name)} on map</button> `;
   if(outcome.unmatched.length)html+='<h4>Still needs attention</h4>'+table(['Congregation','Reason'],outcome.unmatched.map(r=>[esc(r.congregation.name),esc(r.reason)]));
   html+='<p>Map review selects the proposed congregations and meeting point. Use “Assign selected” on the map to save each group.</p>';
  }else{
   const data=context().getData();html+='<p>Suggested additions to the current hosting draft. Review availability, capacities and road travel before saving.</p>'+table(['Date','Congregation','Meeting point','Pickup area','Delegates','Why'],outcome.additions.map(r=>[esc(dateLabel(r.date)),esc(data.congregations.find(c=>String(c.id)===r.congregationId)?.name||r.congregationId),esc(data.locations.find(p=>String(p.id)===r.meetingPointId)?.name||r.meetingPointId),r.hub==='dtc'?'DTC':'Convention Center / Denver',r.delegates,esc(r.reason)]));
   html+=table(['Date','Denver delegates still needing hosts','DTC delegates still needing hosts'],outcome.remaining.map(r=>[esc(dateLabel(r.date)),r.ccc,r.dtc]));
   html+='<button type="button" data-sc-action="use-hosting" class="sc-primary">Review as a new daily hosting draft</button><p>This opens a draft in Daily field service hosting. Save it there when ready.</p>';
  }
  html+='<button type="button" data-sc-action="export">Export these results · CSV</button>';$('[data-sc-results]').innerHTML=html;
 }
 async function compare(){
  if(!$('[data-sc-confirm]')?.checked)throw Error('Review the interpreted fields first.');invalidate('Calculating scenario…');const token=revision;request=new AbortController();const signal=request.signal;setBusy(true);comparisonKind=kind();signature=snapshot(comparisonKind);let next;
  const progress=(done,total)=>{if(token===revision)stateText('Comparing '+done+' of '+total+'…');};
  try{
   if(comparisonKind==='travel'){
    const plan=readTravel(),key=services.getKey?.()||'',data=plan.stops.some(p=>p.mode==='rail')?await services.loadRail():null;
    next=await compareTravelScenarios(plan,{router:services.createRouter({data,key,signal}),reorder:$('[data-sc-reorder]').checked,windowMinutes:Number(field('window')),traffic:!!key,buses:numeric(field('buses'),'vehicle count'),stagger:numeric(field('stagger'),'stagger spacing'),signal,onProgress:progress});
   }else{
    const data=context().getData(),congregationIds=ids('congregations'),meetingIds=ids('meetings');if(!congregationIds.length||!meetingIds.length)throw Error('Choose at least one congregation and one approved meeting point.');
    if(comparisonKind==='hosting')next=draftHostingScenario({plan:context().getHostingPlan(),data,dates:all('[data-sc-date]:checked').map(el=>el.value),total:numeric(field('total'),'daily delegates'),dtc:numeric(field('dtc'),'DTC delegates'),policy:field('policy'),capacity:field('capacity'),congregationIds,meetingIds});
    else{const drives=services.createDriveTimes({fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([signal,options.signal])})});next=await compareCongregationScenarios({data,congregationIds,meetingIds,limitMinutes:numeric(field('limit'),'maximum driving minutes'),together:$('[data-sc-together]').checked},{signal,onProgress:progress,driveTo:async(congs,p)=>{await drives.ensure(congs.map(c=>c.home),p);return congs.map(c=>drives.state(c.home,p));}});}
   }
   if(token!==revision)return;if(signature!==snapshot(comparisonKind))throw Error('Locations, assignments or the open plan changed. Compare again using the latest data.');outcome=next;renderResults();stateText('Suggestions ready for review. Nothing has been saved.');
  }catch(e){if(token===revision){outcome=null;stateText(e.name==='AbortError'?'Calculation cancelled.':e.message);}}
  finally{if(token===revision)setBusy(false);}
 }
 async function review(){
  invalidate();const token=revision,mode=kind(),text=$('[data-sc-text]').value.trim();if(!text)throw Error('Type a scenario first.');
  if(mode!=='travel'&&!context()){handoff('assignments',{text,mode});return;}
  stateText('Loading current planning locations…');await ensureServices();if(token!==revision)return;
  if(mode!=='travel'&&!context().getData().ready)throw Error('Shared meeting approvals and addresses are still loading. Try Review scenario again in a moment.');
  if(mode==='travel'&&!publicReady&&!scenarioContext('travel'))stateText('Shared updates are unavailable; review the reference locations carefully.');
  if(mode==='travel')try{const rail=await services.loadRail();if(token!==revision)return;railPoints=rail.stations.map(p=>({...p,group:'Rail stations',locationType:'rail-station'}));}catch{/* Road planning remains available without rail data. */}
  if(token!==revision)return;parsed=parseScenario(text,{locations:mode==='travel'?points():context().getData().locations,congregations:context()?.getData().congregations||[]});renderFields();stateText('Review the fields and any requirements that were not recognized, then compare.');
 }
 function requireCurrent(){if(!outcome||signature!==snapshot(comparisonKind)){invalidate('Planning data changed. Compare again before using these suggestions.');throw Error('Compare again using the latest data.');}}
 function exportCsv(){requireCurrent();const tables=all('[data-sc-results] table');const rows=[];for(const t of tables){for(const tr of t.rows)rows.push([...tr.cells].filter(c=>!c.querySelector('button')).map(c=>c.textContent));rows.push([]);}const quote=v=>'"'+(/^[=+@\-\t\r]/.test(String(v))?"'":'')+String(v).replaceAll('"','""')+'"';const csv='\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Denver-2027-Scenario-'+comparisonKind+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 root.addEventListener('input',event=>{
  const el=event.target;if(el.dataset.scFilter){all(`[data-sc-choice="${el.dataset.scFilter}"]`).forEach(row=>row.hidden=!row.dataset.scName.includes(el.value.toLowerCase()));return;}
  if(el.matches('[data-sc-text]')){invalidate('Scenario text changed. Review it again.');parsed=null;$('[data-sc-fields]').replaceChildren();return;}
  if(el.hasAttribute('data-sc-address')){$(`[data-sc-matches="${el.dataset.scAddress}"]`).replaceChildren();$(`[data-sc-lat="${el.dataset.scAddress}"]`).value='';$(`[data-sc-lng="${el.dataset.scAddress}"]`).value='';}
  if(el.closest('[data-sc-fields]'))invalidate();
 });
 root.addEventListener('change',event=>{const el=event.target;
  if(el.matches('[data-sc-kind]')){invalidate();parsed=null;$('[data-sc-fields]').replaceChildren();return;}
  if(el.matches('[data-sc-third],[data-sc-fourth]')){if(el.matches('[data-sc-fourth]')&&el.checked)$('[data-sc-third]').checked=true;if(!$('[data-sc-third]').checked)$('[data-sc-fourth]').checked=false;$('[data-sc-stop="2"]').hidden=!$('[data-sc-third]').checked;$('[data-sc-stop="3"]').hidden=!$('[data-sc-fourth]').checked;}
  if(el.hasAttribute('data-sc-point'))$(`[data-sc-custom="${el.dataset.scPoint}"]`).hidden=el.value!=='custom';
  if(el.closest('[data-sc-fields]'))invalidate();
 });
 root.addEventListener('click',async event=>{const button=event.target.closest('[data-sc-action]');if(!button)return;try{
  const action=button.dataset.scAction;
  if(action==='review')return await review();if(action==='compare')return await compare();if(action==='cancel'){invalidate('Calculation cancelled.');return;}
  if(action==='example'){invalidate();parsed=null;$('[data-sc-fields]').replaceChildren();$('[data-sc-text]').value=kind()==='travel'?'3 buses from CCC to DTC on May 25, arrive by 9 AM, stagger by 10 minutes.':kind()==='hosting'?'On May 25, host 300 delegates, including 100 from DTC. Use local hosts first, with 50 delegates per host.':'Find the closest approved meeting points for the congregations I select below.';return;}
  if(action==='check-all'||action==='check-none'){const attr=button.dataset.scList;all(`[data-sc-choice="${attr}"]`).forEach(row=>{if(action==='check-none'||!row.hidden)row.querySelector('input').checked=action==='check-all';});invalidate();return;}
  if(action==='unassigned'){const assigned=new Set(context().getData().assignments.map(a=>a.congregationId));all('[data-sc-choice-id="congregations"]').forEach(el=>el.checked=!assigned.has(el.value));invalidate();return;}
  if(action==='use-route'){requireCurrent();const item=outcome.fleet[Number(button.dataset.scIndex)];if(!item?.schedule||item.schedule.conflicts.length)throw Error('Resolve this journey’s timing first.');const travel=scenarioContext('travel');if(travel){travel.usePlan(structuredClone(item.plan),structuredClone(item.schedule));stateText('Route loaded in Travel Routes. Review it and save when ready.');}else handoff('travel',{plan:item.plan});return;}
  if(action==='stage-assignments'){requireCurrent();const rows=outcome.assignments.filter(r=>String(r.point.id)===button.dataset.scId);context().stageAssignments(rows.map(r=>r.congregation.id),button.dataset.scId,outcome.limitMinutes>80);stateText('Suggested group selected on the map. Review it and use Assign selected to save.');return;}
  if(action==='use-hosting'){requireCurrent();context().useHostingPlan(structuredClone(outcome.plan));stateText('New daily hosting draft opened. Review and save it below.');outcome=null;$('[data-sc-results]').replaceChildren();return;}
  if(action==='export')return exportCsv();
  if(action==='find-address'){
   invalidate();const token=revision,i=button.dataset.scIndex,address=$(`[data-sc-address="${i}"]`).value.trim();if(!address)throw Error('Enter a street address.');stateText('Finding address candidates…');const matches=await services.findAddress(address);if(token!==revision)return;
   const container=$(`[data-sc-matches="${i}"]`);container.replaceChildren();for(const match of matches){const b=document.createElement('button');b.type='button';b.textContent=match.address||match.label||'Address candidate';b.disabled=!!match.approximate;b.addEventListener('click',()=>{$(`[data-sc-lat="${i}"]`).value=match.lat;$(`[data-sc-lng="${i}"]`).value=match.lng;$(`[data-sc-address="${i}"]`).value=match.address||address;container.replaceChildren();invalidate('Address pin selected. Confirm it before comparing.');});container.append(b);}stateText(matches.length?'Choose the correct address candidate. Approximate area matches cannot be used as exact pins.':'No address match. Enter confirmed latitude and longitude, or use the Travel Routes map to find the location.');
  }
 }catch(e){stateText(e.message||'The scenario could not be completed.');}});
 function consumeHandoff(){const pending=pendingHandoff();if(!pending)return;
  if(pending.kind==='travel'&&scenarioContext('travel')){try{scenarioContext('travel').usePlan(pending.value.plan,null);sessionStorage.removeItem(handoffKey);root.open=true;stateText('Scenario route draft opened below. Calculate it to refresh the journey before saving.');}catch(e){stateText(e.message);}return;}
  if(pending.kind==='assignments'&&context()){sessionStorage.removeItem(handoffKey);$('[data-sc-kind]').value=['assignments','hosting'].includes(pending.value.mode)?pending.value.mode:'assignments';$('[data-sc-text]').value=String(pending.value.text||'').slice(0,6000);root.open=true;stateText('Scenario text brought over. Choose Review scenario when the shared data has loaded.');}
 }
 const stopContext=onScenarioContext(consumeHandoff);consumeHandoff();
 return {root,destroy(){request?.abort();publicStop?.();stopContext();root.remove();}};
}

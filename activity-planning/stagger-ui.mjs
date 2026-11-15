import {denverInput,parseDenver,formatDenver} from '../routes/travel-plan.mjs';
import {staggerStops,stopKey,staggerPlan,scheduleFleet} from './stagger-model.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountStaggeredFleet(root,{getPlan,route,getKey=()=>'',onBusesChange=()=>{},exportResult=()=>{}}){
 let fingerprint='',points=[],rules={},result=null,request=null,generation=0,lastAutoDeparture='';
 root.classList.add('stagger-planner');
 root.innerHTML=`<span class="eyebrow">MULTIPLE BUSES · ONE ITINERARY</span><h2>Staggered bus departures</h2><p>Use the locations in the <a href="#routeForm">Route &amp; stops form</a> above. Every bus follows that itinerary, leaving each intermediate stop at the same interval and in the same bus order.</p>
 <form data-fleet-form><div class="fleet-grid"><label>Buses in this schedule<input data-fleet-buses type="number" min="1" max="1000" step="1" required></label><label>Minutes between departures<input data-fleet-gap type="number" min="0" max="240" step="1" value="10" required></label><label>Preferred first-bus departure · Denver<input data-fleet-departure type="datetime-local" required></label></div>
 <label class="fleet-check"><input data-fleet-auto type="checkbox" checked> Move the first departure earlier if needed to meet arrival deadlines</label>
 <p class="hint">Set the time <strong>all buses must arrive by</strong> at an activity or meeting. If an activity has a fixed end, set when its first bus may leave; later buses leave at the selected interval. Stop minutes include loading. Travel can change arrival spacing, so buses may wait to preserve departure spacing.</p>
 <p data-fleet-source class="hint"></p><div data-fleet-stops class="fleet-table"></div>
 <div class="button-row"><button type="submit" data-fleet-calculate class="button primary">Calculate staggered bus schedule</button><button type="button" data-fleet-cancel class="button secondary" hidden>Cancel</button></div></form>
 <p data-fleet-status role="status" aria-live="polite"></p><section data-fleet-results hidden></section>`;
 const $=s=>root.querySelector(s),field=name=>$('[data-fleet-'+name+']');
 function captureRules(){for(const row of root.querySelectorAll('[data-fleet-rule]'))rules[row.dataset.fleetRule]={deadline:row.querySelector('[data-fleet-deadline]').value,notBefore:row.querySelector('[data-fleet-not-before]')?.value||''};}
 function invalidate(message='Schedule changed. Calculate again to update all bus times.'){
  generation++;request?.abort();request=null;result=null;field('results').hidden=true;field('results').replaceChildren();field('calculate').disabled=false;field('cancel').hidden=true;field('status').textContent=message;
 }
 function refresh(){
  captureRules();const plan=getPlan(),next=JSON.stringify({name:plan.name,stops:plan.stops,roundTrip:plan.roundTrip,buffer:plan.buffer,buses:plan.buses,start:plan.startLocal,overrides:plan.overrides});
  if(next===fingerprint)return;fingerprint=next;invalidate('Route details updated. Check the deadlines and calculate the staggered schedule.');points=staggerStops(plan);
  rules=Object.fromEntries(points.map((p,i)=>[stopKey(p,i),rules[stopKey(p,i)]||{deadline:'',notBefore:''}]));field('buses').value=plan.buses||'1';
  if(!field('departure').value||field('departure').value===lastAutoDeparture){try{lastAutoDeparture=denverInput(new Date(+parseDenver(plan.startLocal)+Number(points[0]?.dwell||0)*60000));field('departure').value=lastAutoDeparture;}catch{lastAutoDeparture='';field('departure').value='';}}
  field('source').textContent='Uses '+points.length+' route stops, '+(plan.buffer||0)+' extra travel minutes per leg, and each stop’s loading time. This schedules one fleet run'+(plan.roundTrip?', including the return stop.':'.')+(Number(plan.runs)>1?' Your route’s repeated runs are not included in this comparison.':'');
  field('stops').innerHTML='<table><thead><tr><th>Stop</th><th>Minimum stop / loading</th><th>All buses arrive by · Denver</th><th>First bus cannot leave before · Denver</th></tr></thead><tbody>'+points.map((p,i)=>{const key=stopKey(p,i),rule=rules[key],last=i===points.length-1;return '<tr data-fleet-rule="'+esc(key)+'"><th scope="row">'+(i+1)+'. '+esc(p.name)+'<small>'+esc(p.address||'')+(p.automaticReturn?' · Return to start':'')+'</small></th><td>'+esc(p.dwell)+' / '+esc(p.boarding||0)+' min</td><td><input data-fleet-deadline type="datetime-local" aria-label="All buses arrive by at '+esc(p.name)+'" value="'+esc(rule.deadline)+'" '+(!i?'hidden':'')+'>'+(!i?'Starting point':'')+'</td><td>'+(!i?'Uses the preferred first departure above':last?'Final stop — no onward departure':'<input data-fleet-not-before type="datetime-local" aria-label="First bus leaves no earlier than at '+esc(p.name)+'" value="'+esc(rule.notBefore)+'">')+'</td></tr>';}).join('')+'</tbody></table>';
 }
 function renderResult(){
  const r=result,p=r.plan;field('results').hidden=false;field('results').innerHTML=`<div class="fleet-summary ${r.allMet?'':'fleet-conflict'}"><strong>${!r.hasDeadlines?'No arrival deadlines were set':r.allMet?'All entered arrival deadlines are met in this estimate':r.violations.length+' bus arrivals miss their deadlines — revise before using'}</strong><p>${p.buses} buses · ${p.gap} minutes between departures at every intermediate stop.</p><p>First bus leaves origin: <strong>${esc(formatDenver(r.firstDeparture))}</strong><br>Last bus leaves origin: <strong>${esc(formatDenver(r.lastDeparture))}</strong>${r.shiftMinutes?'<br>Initial departure moved '+r.shiftMinutes+' minutes earlier than your preferred time.':''}</p></div>
  ${!r.allMet?'<p class="fleet-warning">The entered deadlines, stop durations or earliest departures still conflict after recalculation. Change those times and calculate again; the late arrivals are marked below.</p>':''}
  <p class="hint">${r.traffic?'TomTom time-dependent bus estimates; manual driving overrides stay fixed.':'Road baselines without time-of-day traffic; manual driving overrides stay fixed.'} Use the TomTom key in the activity comparison or Travel Routes for traffic forecasts. Confirm access and loading space with the operator. These times schedule one fleet run.</p>
  <button type="button" data-fleet-export class="button secondary">Export staggered schedule to Excel</button>
  ${p.points.map((point,i)=>'<h3>'+(i+1)+'. '+esc(point.name)+'</h3><div class="fleet-table"><table><thead><tr><th>Bus</th><th>'+(i?'Arrives':'At starting point')+' · Denver</th><th>Ready / loading starts</th><th>'+(i===p.points.length-1?'Finishes':'Departs')+' · Denver</th><th>Extra waiting</th><th>Arrival deadline</th></tr></thead><tbody>'+r.rows.filter(row=>row.stop===i+1).map(row=>'<tr'+(row.lateMinutes?' class="fleet-late"':'')+'><th scope="row">Bus '+row.bus+'</th><td>'+esc(formatDenver(row.arrive))+'</td><td>'+(row.ready===null?'No boarding planned':esc(formatDenver(row.ready)))+'</td><td><strong>'+esc(formatDenver(row.depart))+'</strong></td><td>'+row.wait+' min</td><td>'+(row.deadline===null?'Not set':esc(formatDenver(row.deadline))+'<small>'+(row.lateMinutes?row.lateMinutes+' min late':'Meets deadline')+'</small>')+'</td></tr>').join('')+'</tbody></table></div>').join('')}`;
 }
 field('form').addEventListener('input',e=>{if(e.target===field('buses')){const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=1000)onBusesChange(n);}invalidate();});
 field('form').addEventListener('change',()=>invalidate());
 field('form').addEventListener('submit',async e=>{
  e.preventDefault();captureRules();invalidate('');let plan;
  try{plan=staggerPlan({route:getPlan(),buses:field('buses').value,gap:field('gap').value,departure:field('departure').value,autoAdjust:field('auto').checked,constraints:rules});}catch(error){field('status').textContent=error.message;return;}
  const token=generation;request=new AbortController();field('calculate').disabled=true;field('cancel').hidden=false;field('status').textContent='Calculating the bus schedule…';
  try{const next=await scheduleFleet(plan,{route,key:getKey().trim(),signal:request.signal,onProgress:({attempt,done,total})=>{if(token===generation)field('status').textContent='Timing check '+attempt+' · '+done+' of '+total+' bus legs checked…';}});if(token!==generation)return;result=next;renderResult();field('status').textContent=!next.hasDeadlines?'Schedule calculated. Add arrival deadlines to check timing.':next.allMet?'Schedule calculated. Every bus meets the entered arrival deadlines in this estimate.':'Schedule needs changes. Review the marked late arrivals below.';}
  catch(error){if(token===generation)field('status').textContent=error.message;}
  finally{if(token===generation){request=null;field('calculate').disabled=false;field('cancel').hidden=true;}}
 });
 field('cancel').addEventListener('click',()=>invalidate('Staggered schedule canceled.'));
 root.addEventListener('click',e=>{if(!e.target.closest('[data-fleet-export]')||!result)return;try{exportResult(result);field('status').textContent='Staggered bus schedule exported to Excel'+(result.allMet?'.':' with deadline conflicts clearly marked.');}catch(error){field('status').textContent='Could not export: '+error.message;}});
 refresh();return {refresh,invalidate};
}

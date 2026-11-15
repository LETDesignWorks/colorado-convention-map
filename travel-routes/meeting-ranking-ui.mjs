import {denverInput,formatDenver} from '../routes/travel-plan.mjs';
import {CONVENTION_CENTER,rankingSettings,meetingCandidates,rankMeetings} from './meeting-ranking.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const driveDuration=minutes=>minutes<60?minutes+' min':Math.floor(minutes/60)+' hr'+(minutes%60?' '+minutes%60+' min':'');
const labels={approved:'Suitable','not-suitable':'Unsuitable',conditional:'Conditional','inspection-scheduled':'Inspection scheduled','not-reviewed':'Not reviewed'};
export function mountMeetingRanking(root,{route,getKey=()=>'',onUse=()=>{},now=()=>new Date()}){
 let locations=[],fingerprint='',controller=null,generation=0,rows=[],selection=null;
 root.innerHTML=`<h2>Meeting locations from Colorado Convention Center</h2><p>See how long it takes to travel <strong>from Colorado Convention Center to each meeting for field service</strong>, quickest first. Choose your departure time, then calculate the travel times below.</p>
 <form data-rank-form><div class="ranking-controls"><label>Travel date · Denver<input data-rank-date type="date" required></label><label>Departure time<select data-rank-preset><option value="am">Morning rush hour · 8 AM</option><option value="pm">Afternoon rush hour · 5 PM</option><option value="custom">Any time</option></select></label><label>Leave Convention Center at<input data-rank-time type="time" value="08:00" required></label><label>Travel by<select data-rank-mode><option value="bus">Bus / motorcoach</option><option value="car">Car</option></select></label></div>
 <div class="check-row"><label><input data-rank-unsuitable type="checkbox"> Include unsuitable locations</label><label><input data-rank-rail type="checkbox"> Include rail stations as meeting points</label></div>
 <p class="hint">Rail stations here are driving destinations. Use the journey planner for rail travel. Times exclude boarding, parking and other buffers; confirm motorcoach access separately.</p>
 <div class="button-row"><button type="submit" data-rank-start>Calculate travel times &amp; rank</button><button type="button" class="secondary" data-rank-cancel hidden>Cancel</button></div></form>
 <p data-rank-source class="hint"></p><p data-rank-status role="status" aria-live="polite"></p><div data-rank-results class="ranking-table"></div>`;
 const $=s=>root.querySelector(s),date=$('[data-rank-date]'),time=$('[data-rank-time]'),preset=$('[data-rank-preset]');
 date.value=denverInput(new Date(+now()+86400000)).slice(0,10);
 function source(){const traffic=!!getKey().trim();$('[data-rank-source]').textContent=traffic?'Uses your TomTom key from Traffic estimates & TomTom key. Results include time-dependent traffic estimates for the selected departure.':'No TomTom key: results are road baselines without time-of-day traffic. Changing the time will not add rush-hour traffic. Add your key under Traffic estimates & TomTom key for traffic forecasts.';}
 function invalidate(message='Settings changed. Rank again to update the list.'){
  generation++;controller?.abort();controller=null;rows=[];selection=null;$('[data-rank-results]').replaceChildren();$('[data-rank-start]').disabled=false;$('[data-rank-cancel]').hidden=true;$('[data-rank-status]').textContent=message;source();
 }
 function settings(){return rankingSettings({date:date.value,time:time.value,preset:preset.value,mode:$('[data-rank-mode]').value,includeUnsuitable:$('[data-rank-unsuitable]').checked,includeRail:$('[data-rank-rail]').checked});}
 function render(){let rank=0;$('[data-rank-results]').innerHTML='<table><caption>'+esc(selection.traffic?'TomTom time-dependent traffic estimates':'Road baselines · no rush-hour traffic')+' · leaving '+esc(formatDenver(selection.local))+' · '+esc(selection.mode==='bus'?'Bus / motorcoach':'Car')+'</caption><thead><tr><th scope="col">Rank</th><th scope="col">Travel time from Convention Center</th><th scope="col">Meeting location</th><th scope="col">Miles</th><th scope="col">Suitability</th><th scope="col">Plan</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr'+(r.point.busStatus==='not-suitable'?' class="ranking-unsuitable"':'')+'><td>'+(r.error?'—':++rank)+'</td><td class="ranking-duration">'+(r.error?esc(r.error):'<strong>'+driveDuration(r.minutes)+'</strong><small>Convention Center → meeting</small>')+'</td><th scope="row">'+esc(r.point.name)+'<small>'+esc(r.point.address)+'</small></th><td>'+(r.error?'—':r.miles.toFixed(1))+'</td><td>'+esc(labels[r.point.busStatus]||'Not reviewed')+'</td><td>'+(r.error?'':'<button type="button" class="secondary" data-rank-use="'+i+'" aria-label="Use trip to '+esc(r.point.name)+'">Use this trip</button>')+'</td></tr>').join('')+'</tbody></table>';}
 $('[data-rank-form]').addEventListener('input',e=>{if(e.target===time)preset.value='custom';invalidate();});
 $('[data-rank-form]').addEventListener('change',e=>{if(e.target===preset&&preset.value!=='custom')time.value=preset.value==='am'?'08:00':'17:00';invalidate();});
 $('[data-rank-form]').addEventListener('submit',async e=>{
  e.preventDefault();invalidate('');let config;try{config=settings();}catch(error){$('[data-rank-status]').textContent=error.message;return;}
  const points=meetingCandidates(locations,config);if(!points.length){$('[data-rank-status]').textContent='No meeting locations match these choices.';return;}
  const token=generation,key=getKey().trim();controller=new AbortController();$('[data-rank-start]').disabled=true;$('[data-rank-cancel]').hidden=false;$('[data-rank-status]').textContent='Calculating 0 of '+points.length+' meeting locations…';
  try {
   const results=await rankMeetings(points,{settings:config,key,route,signal:controller.signal,onProgress:(done,total)=>{if(token===generation)$('[data-rank-status]').textContent='Calculated '+done+' of '+total+' meeting locations…';}});
   if(token!==generation)return;rows=results;selection={...config,traffic:!!key};render();const failed=rows.filter(r=>r.error).length;
   $('[data-rank-status]').textContent=(rows.length-failed)+' locations ranked quickest first.'+(failed?' '+failed+' could not be estimated and appear at the end.':'');
  }catch{if(token===generation)$('[data-rank-status]').textContent='Ranking could not finish. Please try again.';}
  finally{if(token===generation){controller=null;$('[data-rank-start]').disabled=false;$('[data-rank-cancel]').hidden=true;}}
 });
 $('[data-rank-cancel]').addEventListener('click',()=>invalidate('Ranking canceled.'));
 $('[data-rank-results]').addEventListener('click',e=>{const button=e.target.closest('[data-rank-use]');if(!button||!selection)return;const row=rows[Number(button.dataset.rankUse)];if(row&&!row.error)onUse({origin:{...CONVENTION_CENTER},destination:{...row.point},time:selection.local,mode:selection.mode});});
 source();return {invalidate,updateLocations(points){const next=JSON.stringify(points.map(p=>[p.id,p.group,p.locationType,p.name,p.address,p.lat,p.lng,p.busStatus]));locations=points;if(fingerprint&&fingerprint!==next)invalidate('Meeting locations updated. Rank again to use the latest list.');fingerprint=next;}};
}

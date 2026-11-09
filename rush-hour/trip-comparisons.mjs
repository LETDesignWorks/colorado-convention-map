import {escapeHtml as esc,endpointKey,departureCandidates,checkedTraffic,tripKey,tripSummary,formatDenver,parseDenver,trafficSource} from './trip-model.mjs?v=hotel-trips-20261109-1';
export function initComparisons({host,getContext,onUse,onStatus,requestTraffic}){
  host.innerHTML=`<h3>Compare departure times</h3><p>Try an exact time, such as 7:56 or 8:29, or add earlier and later departures. Run automatic tests with a connected traffic key, or enter a separate Google Maps check for each row.</p><div class="trip-comparison-controls"><div class="field"><label for="trip-compare-step">Earlier / later interval</label><select id="trip-compare-step"><option value="5">5 minutes</option><option value="15" selected>15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></div><button class="btn" type="button" id="trip-compare-nearby">Add 5 nearby departures</button><div class="field"><label for="trip-compare-exact">Another exact departure · Denver</label><input type="datetime-local" step="60" id="trip-compare-exact"></div><button class="btn" type="button" id="trip-compare-add">Add exact departure</button><button class="btn" type="button" id="trip-compare-clear">Clear comparisons</button></div><p id="trip-compare-summary" role="status">Show a route above to start comparing departure times.</p><div class="trip-comparison-scroll"><table class="trip-comparison-table"><thead><tr><th>Departure · Denver</th><th>Traffic time · minutes</th><th>Bus plan</th><th>Planned arrival · Denver</th><th>Traffic check</th></tr></thead><tbody id="trip-compare-rows"></tbody></table></div>`;
  const el=id=>document.getElementById('trip-compare-'+id);let context=null,rows=new Map(),running=false,runId=0,abort;
  const run=document.createElement('button');run.className='btn export-primary';run.type='button';run.textContent='Run automatic comparison';el('nearby').after(run);
  const stop=document.createElement('button');stop.className='btn';stop.type='button';stop.textContent='Stop tests';stop.hidden=true;run.after(stop);
  function controls(){run.disabled=running;stop.hidden=!running;el('nearby').disabled=running;el('add').disabled=running;}
  function cancel(){runId++;abort?.abort();running=false;controls();}
  function routeId(s){return s?.from&&s?.to?endpointKey(s.from)+' → '+endpointKey(s.to):'';}
  function values(){return [...rows.values()].map(r=>tripSummary({...r,allowance:context.allowance})).sort((a,b)=>+parseDenver(a.departure)-+parseDenver(b.departure));}
  function render(){
    controls();
    const all=context?values():[],checked=all.filter(r=>r.traffic),best=checked.length?Math.min(...checked.map(r=>r.minutes)):null;
    el('summary').textContent=all.length?checked.length+' of '+all.length+' departure times checked.'+(best!==null?' Shortest checked bus travel: '+best+' min.':' Traffic times are pending.'):'Show a route above, then add departure times to compare.';
    el('rows').innerHTML=all.map((r,i)=>`<tr data-entry="${i}" class="${r.minutes===best&&best!==null?'trip-best':''}"><td><strong>${esc(formatDenver(r.departure))}</strong><button class="btn" data-action="use" type="button">Use departure</button></td><td><input data-low type="number" min="1" max="1440" placeholder="Low" value="${r.traffic?.low??''}" aria-label="Lower traffic minutes for ${esc(formatDenver(r.departure))}"> – <input data-high type="number" min="1" max="1440" placeholder="High" value="${r.traffic?.high??''}" aria-label="Upper traffic minutes for ${esc(formatDenver(r.departure))}"><button class="btn" data-action="apply" type="button">Apply time</button></td><td>${r.minutes?r.minutes+' min':'Pending'}${r.minutes===best&&best!==null?'<small>Shortest checked drive</small>':''}</td><td>${r.arrival?esc(formatDenver(r.arrival)):'Pending'}</td><td><a class="btn" href="${esc(r.googleUrl)}" target="_blank" rel="noopener">Open Google ↗</a><small>Set Depart at to this row’s date and time.</small><button class="btn" data-action="remove" type="button">Remove</button></td></tr>`).join('');
    el('rows').querySelectorAll('[data-entry]').forEach(tr=>{
      const r=all[Number(tr.dataset.entry)];
      if(r.traffic){const source=document.createElement('small');source.textContent=trafficSource(r.traffic);tr.children[1].append(source);}
      for(const control of tr.querySelectorAll('input,button'))control.disabled=running;
      tr.querySelector('[data-action="apply"]').addEventListener('click',()=>{try{const traffic=checkedTraffic(tr.querySelector('[data-low]').value,tr.querySelector('[data-high]').value,'',r.key);rows.set(r.departure,{...r,traffic});render();onStatus('Departure comparison updated from the entered Google traffic time.');}catch(error){onStatus(error.message);}});
      tr.querySelector('[data-action="use"]').addEventListener('click',()=>onUse({...r,traffic:rows.get(r.departure)?.traffic||null}));
      tr.querySelector('[data-action="remove"]').addEventListener('click',()=>{rows.delete(r.departure);render();});
      for(const input of tr.querySelectorAll('input'))input.addEventListener('input',()=>{const existing=rows.get(r.departure);if(existing?.traffic){rows.set(r.departure,{...existing,traffic:null});tr.classList.remove('trip-best');tr.children[2].textContent='Pending';tr.children[3].textContent='Pending';el('summary').textContent='Apply the edited time to update the comparison.';}});
    });
  }
  function add(departures){const fresh=getContext();if(!fresh)throw Error('Show a route before adding departure comparisons.');if(routeId(fresh)!==routeId(context))rows.clear();context=fresh;
    for(const departure of departures){parseDenver(departure);if(rows.size>=20&&!rows.has(departure))throw Error('Compare up to 20 departures. Remove a row to add another.');if(!rows.has(departure))rows.set(departure,{...fresh,departure,traffic:fresh.traffic?.key===tripKey(fresh.from,fresh.to,departure)?fresh.traffic:null});}render();}
  el('nearby').addEventListener('click',()=>{try{const fresh=getContext();if(!fresh)throw Error('Show a route first.');add(departureCandidates(fresh.departure,Number(el('step').value)));}catch(error){onStatus(error.message);}});
  el('add').addEventListener('click',()=>{try{add([el('exact').value]);}catch(error){onStatus(error.message);}});
  el('clear').addEventListener('click',()=>{cancel();rows.clear();render();});
  stop.addEventListener('click',()=>{cancel();render();onStatus('Comparison stopped. Completed estimates remain available.');});
  run.addEventListener('click',async()=>{
    const id=++runId;try{if(!getContext())throw Error('Show a route first.');if(!rows.size)add(departureCandidates(getContext().departure,Number(el('step').value)));abort=new AbortController();running=true;run.disabled=true;stop.hidden=false;render();
      const pending=values();for(let i=0;i<pending.length;i++){const r=pending[i];if(id!==runId)return;rows.set(r.departure,{...r,traffic:null});render();onStatus('Testing departure '+(i+1)+' of '+pending.length+'…');
        const traffic=await requestTraffic(r.from,r.to,r.departure,{signal:abort.signal});if(id!==runId)return;rows.set(r.departure,{...r,traffic});render();}
      onStatus('Departure comparison complete. Choose Use departure to apply a result.');
    }catch(error){if(id===runId)onStatus(error.message);}finally{if(id===runId){running=false;run.disabled=false;stop.hidden=true;render();}}
  });
  return{
    stop(){cancel();render();},
    update(result){if(routeId(result)!==routeId(context)){cancel();rows.clear();}context=result;el('exact').value=result.departure;if(rows.has(result.departure))rows.set(result.departure,result);render();},
    clearIfRouteChanged(from,to){if(routeId({from,to})!==routeId(context)){cancel();rows.clear();context=null;render();}},
    results(){return context?values().map(({departure,traffic,minutes,arrival})=>({departure,traffic,minutes,arrival})):[];}
  };
}

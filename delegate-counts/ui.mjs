import {CATEGORIES,countPayload,countId,readCounts,countLocations,filterCounts,dailyCounts} from './model.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountDelegateCounts(root,{save,remove,exportCounts,makeId=()=>crypto.randomUUID()}){
 let state={records:[],points:[],access:false,edit:false,loaded:false,fresh:false,message:'Connecting to shared delegate counts…',needsRules:false};
 let records=[],invalid=0,editing=null,pendingDelete='',busy=false,generation=0,customId='',notice='';
 const filters={date:'',category:'all',search:''},$=selector=>root.querySelector(selector);
 root.classList.add('delegate-tracker');
 root.innerHTML=`<div class="dc-heading"><div><span class="eyebrow">DELEGATE PLANNING</span><h2>Delegate counts</h2><p>Track the number expected at each activity, meeting for service, and hotel by date.</p></div><button type="button" data-export>Export delegate counts to Excel</button></div>
 <p class="dc-note">Enter a total for each location and date. Hotel counts describe delegates staying there that night. Activity and service counts describe planned attendance, not live check-ins. The same people may appear in several locations or categories, so these totals are not a unique delegate headcount.</p>
 <p data-access role="status"></p><p data-rules class="dc-warning" hidden>Your main login can use this tracker now. To enable other logins, publish the updated database rules from <a href="../access/#delegateCountsSetup">Sign-in &amp; Access</a>, then grant Activity Planning access.</p>
 <div data-private hidden><div class="dc-filters"><label>View date<input type="date" data-filter-date></label><label>Location type<select data-filter-category><option value="all">All location types</option>${Object.entries(CATEGORIES).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label><label>Find a location<input type="search" data-search placeholder="Location, address or note"></label></div><button type="button" data-all-dates>Show all dates</button>
 <p class="dc-note" data-summary-label></p><div class="dc-summary" data-summary></div>
 <details class="dc-editor" data-editor open><summary><strong data-editor-title>Add a delegate count</strong></summary><form data-form><fieldset data-fields><div class="dc-fields">
 <label>Planning date<input type="date" data-date required></label><label>Location type<select data-category>${Object.entries(CATEGORIES).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label><label>Location<select data-location required></select></label>
 <label data-custom-name-wrap hidden>Location name<input data-custom-name maxlength="140"></label><label data-custom-address-wrap hidden>Location address<input data-custom-address maxlength="300" placeholder="Street, city, Colorado"></label>
 <p data-address class="dc-note dc-wide"></p><label>Number of delegates<input data-count type="number" min="0" max="100000" step="1" required placeholder="Enter expected delegates"></label><label class="dc-wide">Notes<textarea data-notes rows="2" maxlength="1000" placeholder="Reservation, group, contact reference or count source"></textarea></label></div>
 <div class="dc-actions"><button type="submit" class="dc-primary" data-save>Save delegate count</button><button type="button" data-new>Clear / add another</button></div></fieldset></form></details>
 <p data-message role="status" aria-live="polite"></p><div class="dc-table" data-table></div></div>`;
 const locations=()=>countLocations(state.points,[...records,...(editing?[editing]:[])]);
 function selectedLocation(){return locations().find(p=>p.category===$('[data-category]').value&&p.id===$('[data-location]').value);}
 function renderAddress(){
  const custom=$('[data-location]').value==='custom',point=selectedLocation();
  $('[data-custom-name-wrap]').hidden=!custom;$('[data-custom-address-wrap]').hidden=!custom;
  $('[data-custom-name]').required=custom;$('[data-address]').textContent=custom?'Enter this location once; it will be available for later dates after saving.':point?.address||'';
 }
 function renderOptions(value=$('[data-location]').value){
  const category=$('[data-category]').value;
  $('[data-location]').innerHTML='<option value="">Select a location</option>'+locations().filter(p=>p.category===category).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'<option value="custom">Add another location / address</option>';
  $('[data-location]').value=value;renderAddress();
 }
 function controls(){
  const locked=!state.access||!state.edit||!state.fresh||busy;
  $('[data-fields]').disabled=locked;for(const key of ['date','category','location'])$('[data-'+key+']').disabled=locked||Boolean(editing);
  $('[data-export]').disabled=!state.access||!state.loaded||busy;
  $('[data-save]').textContent=busy?'Saving…':editing?'Update delegate count':'Save delegate count';
  $('[data-editor-title]').textContent=editing?'Edit count — '+editing.locationName:'Add a delegate count';
 }
 function clear(){editing=null;customId='';$('[data-form]').reset();$('[data-date]').value=filters.date;$('[data-category]').value=filters.category==='all'?'activity':filters.category;renderOptions('');controls();}
 function render(){
  $('[data-private]').hidden=!state.access;$('[data-rules]').hidden=!state.needsRules;
  $('[data-access]').textContent=state.message||(!state.access?'Sign in with Activity Planning access to view delegate counts.':!state.loaded?'Loading saved delegate counts…':!state.fresh?'Showing cached information. Reconnect before changing counts.':state.edit?'Shared counts are up to date. You can add, edit and remove entries.':'Shared counts are up to date. Your login has view access.');
  if(!state.access){$('[data-table]').innerHTML='';$('[data-summary]').innerHTML='';$('[data-message]').textContent='';controls();return;}
  $('[data-summary-label]').textContent=filters.date?'All saved locations on '+filters.date+' — categories are counted separately.':'Choose a date above to see totals for that day.';
  const day=dailyCounts(records).find(day=>day.date===filters.date);
  $('[data-summary]').innerHTML=Object.entries(CATEGORIES).map(([key,name])=>`<div class="dc-total"><span>${name}</span><strong>${!state.loaded?'Loading…':!filters.date?'—':day?.[key]===null||day?.[key]===undefined?'Not entered':day[key].toLocaleString()}</strong><small>${key==='hotel'?'Delegates staying that night':'Planned attendance'}</small></div>`).join('');
  const shown=filterCounts(records,filters);
  $('[data-message]').textContent=notice+(invalid?` ${invalid} invalid saved count record(s) were excluded; ask the administrator to review them.`:'');
  $('[data-table]').innerHTML=!state.loaded?'<p>Loading saved counts…</p>':!shown.length?'<p>No delegate counts entered for this view.</p>':`<table><thead><tr><th>Date</th><th>Location</th><th>Delegates</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${shown.map(r=>`<tr><td>${esc(r.date)}</td><td><strong>${esc(r.locationName)}</strong><small>${CATEGORIES[r.category]}</small><small>${esc(r.locationAddress)}</small></td><td>${r.count.toLocaleString()}</td><td>${esc(r.notes)}</td><td><div class="dc-actions">${pendingDelete===r.id?`<span>Remove this count?</span><button type="button" class="dc-danger" data-confirm-remove="${esc(r.id)}" ${!state.edit||!state.fresh||busy?'disabled':''}>Confirm remove</button><button type="button" data-cancel-remove>Cancel</button>`:`<button type="button" data-edit="${esc(r.id)}" ${!state.edit||!state.fresh||busy?'disabled':''}>Edit</button><button type="button" class="dc-danger" data-remove="${esc(r.id)}" ${!state.edit||!state.fresh||busy?'disabled':''}>Remove</button>`}</div></td></tr>`).join('')}</tbody></table>`;
  controls();
 }
 function edit(record){
  editing={...record};notice='Editing '+record.locationName+' on '+record.date+'. Change the number or notes below.';
  $('[data-category]').value=record.category;renderOptions(record.locationId);$('[data-date]').value=record.date;$('[data-count]').value=record.count;$('[data-notes]').value=record.notes;$('[data-editor]').open=true;render();$('[data-count]').focus();
 }
 $('[data-category]').addEventListener('change',()=>renderOptions(''));
 $('[data-location]').addEventListener('change',renderAddress);
 $('[data-filter-date]').addEventListener('change',e=>{filters.date=e.target.value;render();});
 $('[data-filter-category]').addEventListener('change',e=>{filters.category=e.target.value;render();});
 $('[data-search]').addEventListener('input',e=>{filters.search=e.target.value;render();});
 $('[data-all-dates]').addEventListener('click',()=>{filters.date='';$('[data-filter-date]').value='';render();});
 $('[data-new]').addEventListener('click',()=>{notice='';clear();render();});
 $('[data-form]').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!state.edit||!state.fresh)return;
  let payload;
  try{
   let point=selectedLocation();const category=$('[data-category]').value;
   if($('[data-location]').value==='custom'){
    const name=$('[data-custom-name]').value.trim(),address=$('[data-custom-address]').value.trim();
    point=locations().find(p=>p.category===category&&p.name.toLowerCase()===name.toLowerCase()&&p.address.toLowerCase()===address.toLowerCase())||{id:customId||(customId='custom-'+makeId()),name,address};
   }
   payload=countPayload({date:$('[data-date]').value,category,locationId:point?.id,locationName:point?.name,locationAddress:point?.address,count:$('[data-count]').value,notes:$('[data-notes]').value});
   const existing=records.find(r=>r.id===countId(payload));if(existing&&editing?.id!==existing.id)throw Error('This location already has a count for that date. Use Edit on its saved row.');
   if(editing&&editing.id!==countId(payload))throw Error('Add a separate entry to change its date or location.');
  }catch(error){notice=error.message;render();return;}
  const token=generation,revision=editing?.revision??null;busy=true;render();
  try{await save(payload,revision);if(token!==generation)return;filters.date=payload.date;filters.category=payload.category;filters.search='';$('[data-filter-date]').value=filters.date;$('[data-filter-category]').value=filters.category;$('[data-search]').value='';clear();notice='Delegate count saved.';}
  catch(error){if(token===generation)notice='Could not save: '+error.message;}
  finally{if(token===generation){busy=false;render();}}
 });
 root.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-cancel-remove')){pendingDelete='';render();return;}
  const id=target.dataset.edit||target.dataset.remove||target.dataset.confirmRemove;if(!id||busy||!state.edit||!state.fresh)return;
  const record=records.find(r=>r.id===id);if(!record)return;
  if(target.dataset.edit){edit(record);return;}
  if(target.dataset.remove){pendingDelete=id;render();return;}
  const token=generation;busy=true;render();
  try{await remove(record);if(token!==generation)return;if(editing?.id===id)clear();pendingDelete='';notice='Delegate count removed.';}
  catch(error){if(token===generation)notice='Could not remove: '+error.message;}
  finally{if(token===generation){busy=false;render();}}
 });
 $('[data-export]').addEventListener('click',()=>{if(!state.access||!state.loaded||busy)return;try{exportCounts(filterCounts(records,filters),{...filters,fresh:state.fresh});notice='Delegate-count spreadsheet downloaded.';}catch(error){notice='Could not export: '+error.message;}render();});
 return {setData(next){
  const revoked=next.reset||next.access===false&&state.access;
  if(revoked){generation++;busy=false;records=[];editing=null;pendingDelete='';customId='';notice='';state={...state,records:[],loaded:false,fresh:false};filters.date='';filters.category='all';filters.search='';$('[data-filter-date]').value='';$('[data-filter-category]').value='all';$('[data-search]').value='';clear();}
  state={...state,...next};const parsed=readCounts(state.access?state.records:[]);records=parsed.counts;invalid=parsed.invalid;renderOptions();render();
 },render};
}

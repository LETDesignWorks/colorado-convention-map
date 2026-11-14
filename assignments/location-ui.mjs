import {validPoint,suggestionsFor,groupHomes} from './location-model.mjs?v=homes-20261113-1';
import {resolveAddressPin} from './address-pin.mjs?v=auto-pin-20261114-1';

export function initCongregationLocations(ctx){
  const {map,congregations,source,resolveHome,isAdmin,escapeHtml:esc}=ctx,$=id=>document.getElementById(id);
  const labels={mapped:'Address mapped',missing:'Missing address','pin-needed':'Address needs map pin',review:'Address needs review'};
  const homesLayer=map?L.layerGroup().addTo(map):null,linesLayer=map?L.layerGroup().addTo(map):null;
  let selectedId='',draftPoint='',savedPoint='',savingAssignment=false,editor=null,editorMap,editorMarker,lookupAbort,lookupSequence=0,editorSaving=false,lookupTimer,lookupTask=null,pinSource='';
  $('directorySource').textContent=`${source.spreadsheetCount} congregations from ${source.file} · ${source.retainedCount} existing entries retained · ${congregations.length} total.`;
  const congregationById=id=>congregations.find(c=>c.id===id);
  const pointLabel=p=>`${p.markerLabel||p.number||'M'} — ${p.name}`;
  function render(){
    const counts={mapped:0,missing:0,'pin-needed':0,review:0};let placed=0;
    for(const c of congregations){const home=resolveHome(c);counts[home.status]++;if(home.point)placed++;}
    $('addressSummary').innerHTML=`<span class="coverage-count">${placed} on map</span>`+['missing','pin-needed','review'].map(key=>`<button type="button" class="coverage-count ${key}" data-address-status="${key}">${counts[key]} ${labels[key].toLowerCase()}</button>`).join('');
    $('addressSummary').querySelectorAll('[data-address-status]').forEach(b=>b.addEventListener('click',()=>{$('searchInput').value='';$('statusFilter').value='all';$('meetingFilter').value='all';$('addressFilter').value=b.dataset.addressStatus;ctx.refresh();$('congregationList').scrollIntoView({behavior:'smooth',block:'start'});}));
    renderHomes();renderDetail();
  }
  function renderHomes(){
    if(!homesLayer)return;
    homesLayer.clearLayers();
    const selectedIds=ctx.getSelected(),meeting=ctx.getMeetingPoint();
    const visible=new Map(ctx.getVisible().map(c=>[c.id,c]));
    for(const c of congregations)if(c.id===selectedId||selectedIds.has(c.id)||(meeting&&ctx.getAssignment(c.id)?.meetingPointId===meeting))visible.set(c.id,c);
    for(const group of groupHomes([...visible.values()],resolveHome)){
      const active=group.congregations.some(c=>c.id===selectedId),checked=group.congregations.filter(c=>selectedIds.has(c.id)).length,assigned=group.congregations.filter(c=>meeting&&ctx.getAssignment(c.id)?.meetingPointId===meeting).length,over=group.congregations.every(c=>ctx.driveState(c,meeting).status==='over');
      const icon=L.divIcon({className:'',html:`<div class="congregation-pin${active?' active':''}${checked?' checked':''}${assigned?' saved-here':''}${over?' over-limit':''}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7"/></svg><b>${group.congregations.length}</b>${checked?`<span class="selection-badge">✓${checked}</span>`:assigned?`<span class="assigned-badge">✓${assigned}</span>`:''}</div>`,iconSize:[46,28],iconAnchor:[-8,14]});
      const marker=L.marker([group.lat,group.lng],{icon,zIndexOffset:600,title:group.congregations.map(c=>c.name).join('; ')}).addTo(homesLayer);
      const popup=document.createElement('div');popup.className='home-popup';popup.innerHTML=`<strong>${group.congregations.length} congregation${group.congregations.length===1?'':'s'}</strong><p>${esc(group.address)}</p>`;
      for(const c of group.congregations){const button=document.createElement('button');button.type='button';button.className='home-popup-choice';button.textContent=(selectedIds.has(c.id)?'✓ Selected — ':meeting&&ctx.getAssignment(c.id)?.meetingPointId===meeting?'✓ Assigned here — ':'')+c.name;button.addEventListener('click',()=>{select(c.id,false);map.closePopup();});popup.append(button);}
      marker.bindPopup(popup,{maxHeight:300,maxWidth:310});
      marker.bindTooltip(esc(group.congregations.map(c=>c.name).join(' · ')),{direction:'right'});
      if(group.congregations.length===1)marker.on('click',()=>select(group.congregations[0].id,false));
    }
  }
  function selected(){return congregationById(selectedId);}
  function select(id,pan=false){
    if(!congregationById(id))return;
    selectedId=id;savedPoint=ctx.getAssignment(id)?.meetingPointId||'';draftPoint=savedPoint;
    render();if(draftPoint)void ctx.loadDrives(draftPoint);
    const home=resolveHome(selected());if(map&&home.point&&pan)map.setView([home.point.lat,home.point.lng],13);
    $('congregationDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function renderDetail(){
    const c=selected();if(!c)return;
    const home=resolveHome(c),locations=ctx.getLocations(),assignment=ctx.getAssignment(c.id),point=locations.find(p=>p.id===assignment?.meetingPointId);
    // Shared updates may change the saved assignment; keep an intentionally unsaved choice.
    const nextSaved=assignment?.meetingPointId||'';if(draftPoint===savedPoint)draftPoint=nextSaved;savedPoint=nextSaved;
    if(draftPoint&&!locations.some(p=>p.id===draftPoint))draftPoint='';
    const suggested=ctx.isReady()?suggestionsFor(home,locations,ctx.getStatuses()):[];
    const savedName=point?pointLabel(point):assignment?.meetingPointName||'Unassigned';
    $('congregationDetail').innerHTML=`<span class="eyebrow">SELECTED CONGREGATION</span><h2>${esc(c.name)}</h2><p class="home-address">${esc(home.address||'No address on file')}</p><div class="home-actions"><span class="address-chip ${home.status}">${labels[home.status]}</span><button type="button" class="btn outline" id="editSelectedAddress">${home.address?'Edit address / pin':'Add address'}</button></div>${home.status==='review'?'<p class="address-warning">This older directory address needs confirmation. Confirm or update it before using a suggested meeting point.</p>':''}<p class="saved-assignment"><strong>Saved meeting point:</strong> ${esc(savedName)}</p>
      <h3>Suggested meeting points</h3><p class="intro-copy">Nearest approved or conditional meeting points by straight-line distance. Check driving time, capacity and bus access before assigning.</p>
      <div class="suggestion-list">${suggested.length?suggested.map((p,i)=>`<button type="button" class="suggestion" data-suggestion="${esc(p.id)}"><span><strong>${i===0?'Suggested: ':''}${esc(pointLabel(p))}</strong><small>${p.miles<.05?'Same address area':p.miles.toFixed(1)+' mi straight-line'} · ${p.busStatus==='approved'?'Approved':'Conditional — review bus access'}</small></span><span>Choose</span></button>`).join(''):`<p class="intro-copy">${!ctx.isReady()?'Waiting for shared meeting-point reviews.':home.status==='missing'?'Add an address and map pin to see suggestions.':home.status==='review'?'Confirm this address to see suggestions.':!home.point?'Add a map pin for this address to see suggestions.':'No approved or conditional meeting points are available. Choose a meeting point manually below.'}</p>`}</div>
      <div class="field"><label for="congregationDestination">Choose or move this congregation to a meeting point</label><select id="congregationDestination"><option value="">Choose a meeting point…</option>${locations.map(p=>`<option value="${esc(p.id)}">${esc(pointLabel(p))}</option>`).join('')}</select><small>Choose a suggestion, use this list, or click a meeting-point marker. Save to apply the assignment. The congregation's address stays in place.</small></div>
      <div class="button-row"><button type="button" class="btn primary" id="saveCongregationAssignment">${savingAssignment?'Saving…':isAdmin()?'Save assignment':'Sign in to save assignment'}</button></div><p id="assignmentDraftStatus" class="intro-copy" role="status"></p>`;
    $('congregationDestination').value=draftPoint;
    $('congregationDestination').disabled=savingAssignment;
    $('congregationDestination').addEventListener('change',()=>{draftPoint=$('congregationDestination').value;void ctx.loadDrives(draftPoint);drawLines();updateDraft();});
    $('editSelectedAddress').addEventListener('click',()=>edit(c.id));
    $('congregationDetail').querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{draftPoint=b.dataset.suggestion;void ctx.loadDrives(draftPoint);$('congregationDestination').value=draftPoint;drawLines();updateDraft();}));
    $('saveCongregationAssignment').addEventListener('click',async()=>{
      if(!isAdmin()){ctx.openLogin();return;}
      const target=selected(),targetPoint=draftPoint;if(!targetPoint)return;
      savingAssignment=true;renderDetail();
      try{await ctx.saveAssignment(target,targetPoint);ctx.toast(`${target.name} assigned. You can change this meeting point at any time.`);}catch(error){ctx.toast(error.message,true);}finally{savingAssignment=false;renderDetail();}
    });
    updateDraft();drawLines();
  }
  function updateDraft(){
    if(!$('assignmentDraftStatus'))return;
    const travel=ctx.driveState(selected(),draftPoint);
    $('assignmentDraftStatus').textContent=draftPoint&&draftPoint!==savedPoint?'Unsaved choice — click Save assignment to apply.':draftPoint?'This is the saved assignment. Choose another point to move this congregation.':'No meeting point selected.';
    if(draftPoint)$('assignmentDraftStatus').textContent=(!travel.allowed?'Assignment unavailable. ':$('assignmentDraftStatus').textContent+' ')+travel.label+'.';
    $('saveCongregationAssignment').disabled=savingAssignment||(isAdmin()&&(!ctx.isReady()||!draftPoint||draftPoint===savedPoint||!travel.allowed));
  }
  function drawLines(){
    if(!linesLayer)return;linesLayer.clearLayers();const c=selected();if(!c)return;const home=resolveHome(c);if(!home.point)return;
    const locations=ctx.getLocations(),saved=locations.find(p=>p.id===savedPoint),draft=locations.find(p=>p.id===draftPoint),suggested=ctx.isReady()?suggestionsFor(home,locations,ctx.getStatuses())[0]:null;
    const line=(p,color,dash,label)=>{if(p&&validPoint(p.lat,p.lng))L.polyline([[home.point.lat,home.point.lng],[p.lat,p.lng]],{color,weight:3,dashArray:dash}).addTo(linesLayer).bindTooltip(esc(label+' — '+p.name));};
    line(saved,'#148151',null,'Saved assignment');if(draft&&draft.id!==saved?.id)line(draft,'#176eb5','5 5','Unsaved choice');else if(suggested&&suggested.id!==saved?.id)line(suggested,'#7950aa','7 7','Suggested meeting point');
  }
  function meetingPointChosen(point){if(!selected())return;draftPoint=point.id;renderDetail();}
  function fitSelected(){
    const chosen=congregations.filter(c=>ctx.getSelected().has(c.id)),points=chosen.map(c=>resolveHome(c).point).filter(Boolean);renderHomes();
    if(map&&points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[65,65],maxZoom:14});
    ctx.toast(chosen.length?`${chosen.length} selected · ${points.length} on map${chosen.length>points.length?' · add missing addresses to map the rest':''}.`:'Check congregations in the directory to highlight them on the map.');
  }
  function fitAll(){
    $('searchInput').value='';$('statusFilter').value='all';$('meetingFilter').value='all';$('addressFilter').value='all';ctx.refresh();
    const points=congregations.map(c=>resolveHome(c).point).filter(Boolean);if(map&&points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[50,50],maxZoom:12});
  }
  $('showAllHomes').addEventListener('click',fitAll);
  const modal=$('addressModal');
  function cancelLookup(){lookupSequence++;clearTimeout(lookupTimer);lookupAbort?.abort();lookupTask=null;$('findHomeAddress').disabled=editorSaving;}
  function edit(id){
    if(!isAdmin()){ctx.openLogin();return;}
    if(!ctx.isReady()){ctx.toast('Wait for shared address information before editing.',true);return;}
    const c=congregationById(id);if(!c)return;
    const home=resolveHome(c);editor={congregation:c,version:ctx.getProfile(id)?.addressVersion||0};cancelLookup();pinSource=ctx.getProfile(id)?.pinSource||'';$('saveWithoutPin').hidden=true;
    $('addressCongregation').textContent=c.name;$('homeAddress').value=home.address;$('homeLat').value=home.point?.lat??'';$('homeLng').value=home.point?.lng??'';$('addressMatches').replaceChildren();$('addressEditorStatus').textContent='';
    const addresses=new Map();for(const location of ctx.getLocations())if(location.address)addresses.set(location.address,location);
    $('addressKnown').innerHTML='<option value="">Choose a hall, or enter an address below</option>'+[...addresses.values()].map(p=>`<option value="${esc(p.id)}">${esc(pointLabel(p))} · ${esc(p.address)}</option>`).join('');
    modal.classList.add('open');$('homeAddress').focus();
    if(!editorMap&&globalThis.L){editorMap=L.map('addressPreview').setView([39.74,-104.99],10);editorMap.on('click',event=>{if(editorSaving||!$('homeAddress').value.trim())return;cancelLookup();pinSource='Administrator-confirmed address pin';$('homeLat').value=event.latlng.lat.toFixed(7);$('homeLng').value=event.latlng.lng.toFixed(7);previewPin();$('addressEditorStatus').textContent='Pin placed. Check the location, then save.';});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(editorMap);}
    if(editorMap){editorMap.invalidateSize();previewPin();}
  }
  function closeEditor(){if(editorSaving)return;cancelLookup();modal.classList.remove('open');editor=null;}
  function previewPin(){
    if(!editorMap)return;if(editorMarker){editorMap.removeLayer(editorMarker);editorMarker=null;}
    if(!validPoint($('homeLat').value,$('homeLng').value))return;
    editorMarker=L.marker([Number($('homeLat').value),Number($('homeLng').value)],{draggable:true}).addTo(editorMap);editorMap.setView(editorMarker.getLatLng(),16);
    editorMarker.on('dragend',()=>{if(editorSaving)return;cancelLookup();pinSource='Administrator-confirmed address pin';const p=editorMarker.getLatLng();$('homeLat').value=p.lat.toFixed(7);$('homeLng').value=p.lng.toFixed(7);$('addressEditorStatus').textContent='Pin adjusted. Save address to keep this change.';});
  }
  $('addressKnown').addEventListener('change',()=>{const p=ctx.getLocations().find(p=>p.id===$('addressKnown').value);if(!p)return;cancelLookup();pinSource='Existing hall address pin';$('saveWithoutPin').hidden=true;$('homeAddress').value=p.address;$('homeLat').value=p.lat;$('homeLng').value=p.lng;$('addressMatches').replaceChildren();$('addressEditorStatus').textContent='Existing hall address and pin selected.';previewPin();});
  function placeResult(p,source){
    $('homeLat').value=p.lat;$('homeLng').value=p.lng;pinSource=source;
    $('addressMatches').replaceChildren();$('saveWithoutPin').hidden=true;previewPin();
    $('addressEditorStatus').textContent='Map pin found automatically. Save address to add it to the congregation map. You can drag the pin to adjust it.';
  }
  function lookupAddress(){
    if(!editor)return Promise.resolve(false);
    const query=$('homeAddress').value.trim();
    if(query.length<5)return Promise.resolve(false);
    if(lookupTask?.query===query)return lookupTask.promise;
    cancelLookup();
    const sequence=lookupSequence,controller=new AbortController();lookupAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),18000);
    $('findHomeAddress').disabled=true;$('addressMatches').replaceChildren();
    $('addressEditorStatus').textContent='Finding and placing the address pin…';
    const promise=(async()=>{
      try{
        const result=await resolveAddressPin(query,ctx.getAddressPoints(),{signal:controller.signal});
        if(sequence!==lookupSequence||!editor||$('homeAddress').value.trim()!==query)return false;
        if(result.pin){placeResult(result.pin,result.source);return true;}
        for(const p of result.candidates){
          const b=document.createElement('button');b.type='button';b.className='btn outline';b.textContent=p.address;
          b.addEventListener('click',()=>{
            cancelLookup();$('homeAddress').value=p.address;placeResult(p,'Administrator-selected address lookup result');
            $('addressEditorStatus').textContent='Address selected. Save to add this pin to the congregation map.';
          });$('addressMatches').append(b);
        }
        $('saveWithoutPin').hidden=false;
        $('addressEditorStatus').textContent='No single exact match. Choose the correct address below, place a pin on the map, or save without a pin for later.';
        return false;
      }catch(error){
        if(sequence===lookupSequence&&editor){
          $('saveWithoutPin').hidden=false;
          $('addressEditorStatus').textContent=(error.name==='AbortError'?'Address lookup timed out.':error.message)+' You can retry, place a pin manually, or save without a pin.';
        }
        return false;
      }finally{clearTimeout(timeout);if(sequence===lookupSequence){lookupTask=null;$('findHomeAddress').disabled=editorSaving;}}
    })();
    lookupTask={query,promise};return promise;
  }
  $('homeAddress').addEventListener('input',()=>{
    cancelLookup();pinSource='';$('homeLat').value='';$('homeLng').value='';$('addressKnown').value='';
    $('addressMatches').replaceChildren();$('saveWithoutPin').hidden=true;
    $('addressEditorStatus').textContent='Enter the full street address, city and state. Its map pin will be found automatically.';
    previewPin();
    if($('homeAddress').value.trim().length>=12)lookupTimer=setTimeout(()=>void lookupAddress(),900);
  });
  for(const id of ['homeLat','homeLng'])$(id).addEventListener('input',()=>{
    cancelLookup();pinSource='Administrator-confirmed address pin';$('addressMatches').replaceChildren();previewPin();
  });
  $('findHomeAddress').addEventListener('click',()=>{cancelLookup();void lookupAddress();});
  async function saveEditor(withoutPin=false){
    if(!editor||editorSaving)return;
    const current=editor;clearTimeout(lookupTimer);editorSaving=true;
    const controls=[...$('addressForm').querySelectorAll('button,input,select')];controls.forEach(e=>e.disabled=true);
    editorMarker?.dragging?.disable();
    try{
      if(!withoutPin&&$('homeAddress').value.trim()&&!$('homeLat').value.trim()&&!$('homeLng').value.trim()){
        const matched=await lookupAddress();
        if(!matched)return;
      }else cancelLookup();
      const values={address:$('homeAddress').value,lat:withoutPin?'':$('homeLat').value,lng:withoutPin?'':$('homeLng').value,pinSource};
      $('addressEditorStatus').textContent='Saving shared address and map pin…';
      await ctx.saveAddress(current.congregation,values,current.version);
      editorSaving=false;closeEditor();select(current.congregation.id,true);
      if(map&&validPoint(values.lat,values.lng)&&values.address.trim()){
        map.setView([Number(values.lat),Number(values.lng)],15);
        $('map').scrollIntoView({behavior:'smooth',block:'center'});
        ctx.toast('Address saved and pinned on the map. The meeting-point assignment was kept.');
      }else ctx.toast('Address saved. It is flagged until a map pin is added.');
    }catch(error){$('addressEditorStatus').textContent=error.message;}
    finally{editorSaving=false;controls.forEach(e=>e.disabled=false);editorMarker?.dragging?.enable();}
  }
  $('addressForm').addEventListener('submit',event=>{event.preventDefault();void saveEditor();});
  $('saveWithoutPin').addEventListener('click',()=>void saveEditor(true));
  $('cancelAddress').addEventListener('click',closeEditor);modal.addEventListener('click',e=>{if(e.target===modal)closeEditor();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEditor();if(e.key==='Tab'&&modal.classList.contains('open')){const controls=[...modal.querySelectorAll('button,input,select')].filter(el=>!el.disabled&&el.offsetParent!==null),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  // Initial fit includes homes outside the original DTC planning boundary.
  if(map){const points=congregations.map(c=>resolveHome(c).point).filter(Boolean);if(points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[50,50],maxZoom:12});}
  return{render,select,edit,meetingPointChosen,fitSelected};
}

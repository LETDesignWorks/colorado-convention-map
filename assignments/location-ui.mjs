import {validPoint,suggestionsFor,groupHomes,nearbyAddresses} from './location-model.mjs?v=address-help-20261114-1';
import {resolveAddressPin} from './address-pin.mjs?v=address-help-20261114-1';

import {formatCoordinates,parseCoordinatePair,googleSearchUrl,findCensusAddress} from './address-tools.mjs?v=coordinates-20261114-1';

export function focusMapPoint(map,point,minimumZoom=15){
  if(!map||!point||!validPoint(point.lat,point.lng))return false;
  map.stop?.();
  map.setView([Number(point.lat),Number(point.lng)],Math.max(minimumZoom,Number(map.getZoom?.())||0),{animate:true});
  return true;
}

export function initCongregationLocations(ctx){
  const {map,congregations,source,resolveHome,isAdmin,escapeHtml:esc}=ctx,$=id=>document.getElementById(id);
  const labels={mapped:'Address mapped',missing:'Missing address','pin-needed':'Address needs map pin',review:'Address needs review'};
  const homesLayer=map?L.layerGroup().addTo(map):null,linesLayer=map?L.layerGroup().addTo(map):null;
  let selectedId='',draftPoint='',savedPoint='',savingAssignment=false,editor=null,editorMap,editorMarker,lookupAbort,lookupSequence=0,editorSaving=false,lookupTimer,lookupTask=null,pinSource='',nearbyAbort,nearbySequence=0;
  $('directorySource').textContent=`${source.spreadsheetCount} congregations from ${source.file} · ${source.retainedCount} existing entries retained · ${congregations.length} total.`;
  const congregationById=id=>congregations.find(c=>c.id===id);
  const pointLabel=p=>`${p.markerLabel||p.number||'M'} — ${p.name}`;
  function render(){
    const counts={mapped:0,missing:0,'pin-needed':0,review:0};let placed=0;
    for(const c of congregations){const home=resolveHome(c);counts[home.status]++;if(home.point)placed++;}
    $('addressSummary').innerHTML=`<span class="coverage-count">${placed} on map</span>`+['missing','pin-needed','review'].map(key=>`<button type="button" class="coverage-count ${key}" data-address-status="${key}">${counts[key]} ${labels[key].toLowerCase()}</button>`).join('');
    $('addressSummary').querySelectorAll('[data-address-status]').forEach(b=>b.addEventListener('click',()=>{$('searchInput').value='';$('statusFilter').value='all';$('meetingFilter').value='all';$('addressFilter').value=b.dataset.addressStatus;ctx.refresh();$('congregationList').scrollIntoView({behavior:'smooth',block:'start'});}));
    highlightDirectory();renderHomes();renderDetail();if(!selected())drawLines();
  }
  function highlightDirectory(){
    const checked=ctx.getSelected();
    $('congregationList').querySelectorAll('[data-congregation]').forEach(row=>{
      const id=row.dataset.congregation,active=id===selectedId,isChecked=checked.has(id);
      row.classList.toggle('active-congregation',active);
      row.classList.toggle('selected',isChecked);
      const indicator=row.querySelector('[data-selection-indicator]');
      if(indicator){indicator.hidden=!active&&!isChecked;indicator.textContent=isChecked?'Selected for assignment':'Selected congregation';}
      const button=row.querySelector('[data-open-home]');
      if(button){if(active)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');}
    });
  }
  function selectionChanged(id,checked){
    render();
    if(!checked)return;
    const c=congregationById(id),home=c&&resolveHome(c);
    focusMapPoint(map,home?.point);
  }
  function renderHomes(){
    if(!homesLayer)return;
    homesLayer.clearLayers();
    const selectedIds=ctx.getSelected(),meeting=ctx.getMeetingPoint(),focus=ctx.getFocusedMeetingPoint?.();
    const visible=new Map((focus?congregations.filter(c=>ctx.getAssignment(c.id)?.meetingPointId===focus):ctx.getVisible()).map(c=>[c.id,c]));
    if(!focus)for(const c of congregations)if(c.id===selectedId||selectedIds.has(c.id)||(meeting&&ctx.getAssignment(c.id)?.meetingPointId===meeting))visible.set(c.id,c);
    for(const group of groupHomes([...visible.values()],resolveHome)){
      const active=group.congregations.some(c=>c.id===selectedId),checked=group.congregations.filter(c=>selectedIds.has(c.id)).length;
      const assigned=group.congregations.filter(c=>ctx.getAssignment(c.id)?.meetingPointId).length;
      const assignedHere=group.congregations.filter(c=>meeting&&ctx.getAssignment(c.id)?.meetingPointId===meeting).length;
      const over=group.congregations.every(c=>(ctx.mapTravelState?.(c)||ctx.driveState(c,meeting)).status==='over');
      const icon=L.divIcon({className:'',html:`<div class="congregation-pin${active?' active':''}${checked?' checked':''}${assigned?' assigned':''}${assignedHere?' saved-here':''}${over?' over-limit':''}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7"/></svg><b>${group.congregations.length}</b>${checked||active?`<span class="selection-badge">${checked>1?checked+' selected':'Selected'}</span>`:''}${assigned?`<span class="assigned-badge" title="${assigned} of ${group.congregations.length} assigned">✓${assigned}${assigned<group.congregations.length?'/'+group.congregations.length:''}</span>`:''}</div>`,iconSize:[46,28],iconAnchor:[-8,14]});
      const marker=L.marker([group.lat,group.lng],{icon,zIndexOffset:active||checked?1100:600,title:group.congregations.map(c=>c.name).join('; ')}).addTo(homesLayer);
      const popup=document.createElement('div');popup.className='home-popup';popup.innerHTML=`<strong>${group.congregations.length} congregation${group.congregations.length===1?'':'s'}</strong><p>${esc(group.address)}</p>`;
      for(const c of group.congregations){
        const assignment=ctx.getAssignment(c.id),destination=ctx.getLocations().find(p=>p.id===assignment?.meetingPointId);
        const assignedLabel=assignment?.meetingPointId?(meeting===assignment.meetingPointId?'✓ Assigned here — ':'✓ Assigned to '+(destination?.name||assignment.meetingPointName||'saved meeting point')+' — '):'';
        const button=document.createElement('button');button.type='button';button.className='home-popup-choice';button.textContent=(selectedIds.has(c.id)||c.id===selectedId?'Selected — ':'')+assignedLabel+c.name;button.addEventListener('click',()=>{select(c.id,true,true);map.closePopup();});popup.append(button);
      }
      marker.bindPopup(popup,{maxHeight:300,maxWidth:310});
      const tooltipCongregations=!focus&&(active||checked)?group.congregations.filter(c=>c.id===selectedId||selectedIds.has(c.id)):group.congregations;
      marker.bindTooltip(esc(tooltipCongregations.map(c=>c.name).join(' · ')),{direction:'right',permanent:Boolean(focus||active||checked),className:active||checked?'selected-congregation-label':focus?'focused-congregation-label':''});
      marker.on('click',()=>{
        if(group.congregations.length===1)select(group.congregations[0].id,true,true);
        else focusMapPoint(map,group);
      });
    }
  }
  function selected(){return congregationById(selectedId);}
  function select(id,pan=false,fromMap=false){
    if(!congregationById(id))return;
    selectedId=id;ctx.onCongregationSelected?.(id);savedPoint=ctx.getAssignment(id)?.meetingPointId||'';draftPoint=savedPoint;
    if(fromMap)ctx.mapSelect?.(id);
    render();if(draftPoint)void ctx.loadDrives(draftPoint);
    const home=resolveHome(selected());if(pan)focusMapPoint(map,home.point);
    if(!fromMap)$('congregationDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function clearSelection(){
    selectedId='';draftPoint='';savedPoint='';
    ctx.onCongregationSelected?.('');
    map?.closePopup?.();map?.closeTooltip?.();
    render();
  }
  function chooseDestination(id){
    if(!selected()||savingAssignment)return;
    draftPoint=id;
    void ctx.loadDrives(draftPoint);
    $('congregationDestination').value=draftPoint;
    drawLines();updateDraft();
    focusMapPoint(map,ctx.getLocations().find(p=>p.id===draftPoint));
  }
  function renderDetail(){
    const c=selected();if(!c){
      $('congregationDetail').innerHTML='<span class="eyebrow">CONGREGATION & SUGGESTED MEETING POINT</span><h2>Select a congregation</h2><p class="intro-copy">Choose a home icon or a congregation name to review its address, suggestions and assignment. Press Esc to leave a selection.</p>';
      return;
    }
    const home=resolveHome(c),locations=ctx.getLocations(),assignment=ctx.getAssignment(c.id),point=locations.find(p=>p.id===assignment?.meetingPointId);
    // Shared updates may change the saved assignment; keep an intentionally unsaved choice.
    const nextSaved=assignment?.meetingPointId||'';if(draftPoint===savedPoint)draftPoint=nextSaved;savedPoint=nextSaved;
    if(draftPoint&&!locations.some(p=>p.id===draftPoint))draftPoint='';
    const suggested=ctx.isReady()?suggestionsFor(home,locations,ctx.getStatuses()):[];
    const savedName=point?pointLabel(point):assignment?.meetingPointName||'Unassigned';
    $('congregationDetail').innerHTML=`<span class="eyebrow">SELECTED CONGREGATION</span><h2>${esc(c.name)}</h2><p class="home-address">${esc(home.address||'No address on file')}</p><div class="home-actions"><span class="address-chip ${home.status}">${labels[home.status]}</span><button type="button" class="btn outline" id="editSelectedAddress">${home.address?'Edit address / pin':'Add address'}</button></div>${home.status==='review'?'<p class="address-warning">This older directory address needs confirmation. Confirm or update it before using a suggested meeting point.</p>':''}<p class="saved-assignment"><strong>Saved meeting point:</strong> ${esc(savedName)}</p>${assignment?`<button type="button" class="btn danger" id="unassignCongregation">${savingAssignment?'Please wait…':'Unassign from meeting point'}</button><p class="intro-copy">Removes this assignment and keeps the congregation, address and map pin.</p>`:''}
      <h3>Suggested meeting points</h3><p class="intro-copy">Nearest approved or conditional meeting points by straight-line distance. Check driving time, capacity and bus access before assigning.</p>
      <div class="suggestion-list">${suggested.length?suggested.map((p,i)=>`<button type="button" class="suggestion" data-suggestion="${esc(p.id)}"><span><strong>${i===0?'Suggested: ':''}${esc(pointLabel(p))}</strong><small>${p.miles<.05?'Same address area':p.miles.toFixed(1)+' mi straight-line'} · ${p.busStatus==='approved'?'Approved':'Conditional — review bus access'}</small></span><span>Choose</span></button>`).join(''):`<p class="intro-copy">${!ctx.isReady()?'Waiting for shared meeting-point reviews.':home.status==='missing'?'Add an address and map pin to see suggestions.':home.status==='review'?'Confirm this address to see suggestions.':!home.point?'Add a map pin for this address to see suggestions.':'No approved or conditional meeting points are available. Choose a meeting point manually below.'}</p>`}</div>
      <div class="field"><label for="congregationDestination">Choose or move this congregation to a meeting point</label><select id="congregationDestination"><option value="">Choose a meeting point…</option>${locations.map(p=>`<option value="${esc(p.id)}">${esc(pointLabel(p))}</option>`).join('')}</select><small>Choose a suggestion, use this list, or click a meeting-point marker. Save to apply the assignment. The congregation's address stays in place.</small></div>
      <label class="travel-override" id="congregationTravelOverrideLabel" hidden><input type="checkbox" id="congregationTravelOverride"> Allow assignments over 1 hr 20 min to this meeting point</label><div class="button-row"><button type="button" class="btn primary" id="saveCongregationAssignment">${savingAssignment?'Saving…':isAdmin()?'Save assignment':'Sign in to save assignment'}</button></div><p id="assignmentDraftStatus" class="intro-copy" role="status"></p>`;
    $('congregationDestination').value=draftPoint;
    $('congregationTravelOverride').addEventListener('change',()=>{ctx.setTravelOverride?.(draftPoint,$('congregationTravelOverride').checked);updateDraft();});
    $('congregationDestination').disabled=savingAssignment;
    $('congregationDestination').addEventListener('change',()=>chooseDestination($('congregationDestination').value));
    $('editSelectedAddress').addEventListener('click',()=>edit(c.id));
    $('congregationDetail').querySelectorAll('[data-suggestion]').forEach(b=>{b.disabled=savingAssignment;b.addEventListener('click',()=>chooseDestination(b.dataset.suggestion));});
    $('saveCongregationAssignment').addEventListener('click',async()=>{
      if(savingAssignment)return;
      if(!isAdmin()){ctx.openLogin();return;}
      const target=selected(),targetPoint=draftPoint;if(!target||!targetPoint)return;
      savingAssignment=true;renderDetail();
      try{await ctx.saveAssignment(target,targetPoint);ctx.toast(`${target.name} assigned. You can change this meeting point at any time.`);}catch(error){ctx.toast(error.message,true);}finally{savingAssignment=false;renderDetail();}
    });
    if(assignment){
      $('unassignCongregation').disabled=savingAssignment||(isAdmin()&&!ctx.isReady());
      $('unassignCongregation').addEventListener('click',()=>void unassign(c.id));
    }
    updateDraft();drawLines();
  }
  async function unassign(id=selectedId){
    if(savingAssignment)return;
    if(!isAdmin()){ctx.openLogin();return;}
    if(!ctx.isReady()){ctx.toast('Wait for shared assignment data before unassigning.',true);return;}
    const target=congregationById(id),assignment=ctx.getAssignment(id);
    if(!target||!assignment)return;
    selectedId=id;draftPoint=savedPoint=assignment.meetingPointId||'';
    savingAssignment=true;renderDetail();
    try{
      await ctx.unassignCongregation(target);
      if(selectedId===id)draftPoint=savedPoint=ctx.getAssignment(id)?.meetingPointId||'';
      ctx.refresh();
      ctx.toast(target.name+' is unassigned. Its address and map pin are kept.');
    }catch(error){ctx.toast(error.message,true);}
    finally{savingAssignment=false;render();}
  }
  function updateDraft(){
    if(!$('assignmentDraftStatus'))return;
    const travel=ctx.driveState(selected(),draftPoint),allowed=ctx.canAssignTravel?.(travel,draftPoint)??travel.allowed;
    $('congregationTravelOverrideLabel').hidden=!isAdmin()||travel.status!=='over';
    $('congregationTravelOverride').checked=Boolean(ctx.travelOverrideEnabled?.(draftPoint));
    $('congregationTravelOverride').disabled=savingAssignment||!ctx.isReady()||!draftPoint;
    $('assignmentDraftStatus').textContent=draftPoint&&draftPoint!==savedPoint?'Unsaved choice — click Save assignment to apply.':draftPoint?'This is the saved assignment. Choose another point to move this congregation.':'No meeting point selected.';
    if(draftPoint)$('assignmentDraftStatus').textContent=(!allowed?'Assignment unavailable. ':$('assignmentDraftStatus').textContent+' ')+travel.label+'.'+(travel.status==='over'?(allowed?' Travel-limit override enabled for this meeting point.':' Check the override above to allow this longer trip.'):'');
    $('saveCongregationAssignment').disabled=savingAssignment||(isAdmin()&&(!ctx.isReady()||!draftPoint||draftPoint===savedPoint||!allowed));
  }
  function drawLines(){
    if(!linesLayer)return;linesLayer.clearLayers();
    const focus=ctx.getFocusedMeetingPoint?.();
    if(focus){
      const meeting=ctx.getLocations().find(p=>p.id===focus);
      if(meeting&&validPoint(meeting.lat,meeting.lng)){
        const assigned=congregations.filter(c=>ctx.getAssignment(c.id)?.meetingPointId===focus);
        for(const home of groupHomes(assigned,resolveHome))L.polyline([[home.lat,home.lng],[meeting.lat,meeting.lng]],{color:'#148151',weight:2,opacity:.65,interactive:false}).addTo(linesLayer);
      }
      return;
    }
    const c=selected();if(!c)return;const home=resolveHome(c);if(!home.point)return;
    const locations=ctx.getLocations(),saved=locations.find(p=>p.id===savedPoint),draft=locations.find(p=>p.id===draftPoint),suggested=ctx.isReady()?suggestionsFor(home,locations,ctx.getStatuses())[0]:null;
    const line=(p,color,dash,label)=>{if(p&&validPoint(p.lat,p.lng))L.polyline([[home.point.lat,home.point.lng],[p.lat,p.lng]],{color,weight:3,dashArray:dash}).addTo(linesLayer).bindTooltip(esc(label+' — '+p.name));};
    line(saved,'#148151',null,'Saved assignment');if(draft&&draft.id!==saved?.id)line(draft,'#176eb5','5 5','Unsaved choice');else if(suggested&&suggested.id!==saved?.id)line(suggested,'#7950aa','7 7','Suggested meeting point');
  }
  function meetingPointChosen(point){if(!selected()||savingAssignment)return;draftPoint=point.id;renderDetail();}
  function fitSelected(){
    if(ctx.getFocusedMeetingPoint?.())ctx.clearMeetingFocus?.();
    const chosen=congregations.filter(c=>ctx.getSelected().has(c.id)),points=chosen.map(c=>resolveHome(c).point).filter(Boolean);renderHomes();
    if(map&&points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[65,65],maxZoom:14});
    ctx.toast(chosen.length?`${chosen.length} selected · ${points.length} on map${chosen.length>points.length?' · add missing addresses to map the rest':''}.`:'Check congregations in the directory to highlight them on the map.');
  }
  function fitAll(){
    if(ctx.getFocusedMeetingPoint?.())ctx.clearMeetingFocus?.();
    $('searchInput').value='';$('statusFilter').value='all';$('meetingFilter').value='all';$('addressFilter').value='all';ctx.refresh();
    const points=congregations.map(c=>resolveHome(c).point).filter(Boolean);if(map&&points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[50,50],maxZoom:12});
  }
  $('showAllHomes').addEventListener('click',fitAll);
  const modal=$('addressModal');
  const manualSource='Administrator-confirmed address pin';
  function cancelNearby(){nearbySequence++;nearbyAbort?.abort();$('suggestPinAddress').disabled=editorSaving;}
  function cancelLookup(){lookupSequence++;clearTimeout(lookupTimer);lookupAbort?.abort();lookupTask=null;cancelNearby();$('findHomeAddress').disabled=editorSaving;$('tryCensusAddress').disabled=editorSaving;}
  function syncCoordinatePanel(message){
    const pair=formatCoordinates($('homeLat').value,$('homeLng').value),query=$('homeAddress').value.trim();
    $('copyHomeCoordinates').disabled=editorSaving||!pair;
    $('googleAddressLookup').href=googleSearchUrl(query)||'#';$('googleAddressLookup').hidden=!query;
    $('googlePinLookup').href=googleSearchUrl(pair)||'#';$('googlePinLookup').hidden=!pair;
    $('homeCoordinateStatus').textContent=message||(pair?'Coordinates ready. Check the map pin before saving.':'Latitude and longitude will appear here when the address is found.');
  }
  function applyCoordinatePair(text=$('pastedCoordinates').value){
    if(!editor||editorSaving)return;
    const point=parseCoordinatePair(text);
    if(!point){$('homeCoordinateStatus').textContent='Paste decimal latitude, longitude — for example 39.739200, -104.990300.';return;}
    $('pastedCoordinates').value=formatCoordinates(point.lat,point.lng);
    placeManualPin(point);
    syncCoordinatePanel('Coordinates applied to the preview. Check the building, then Save address.');
  }
  $('usePastedCoordinates').addEventListener('click',()=>applyCoordinatePair());
  $('pastedCoordinates').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();applyCoordinatePair();}
  });
  $('pastedCoordinates').addEventListener('paste',event=>{
    const text=event.clipboardData?.getData('text');
    if(!editorSaving&&parseCoordinatePair(text)){event.preventDefault();applyCoordinatePair(text);}
  });
  $('copyHomeCoordinates').addEventListener('click',async()=>{
    const pair=formatCoordinates($('homeLat').value,$('homeLng').value);if(!pair||editorSaving)return;
    try{
      if(!globalThis.navigator?.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(pair);$('homeCoordinateStatus').textContent='Coordinates copied: '+pair;
    }catch{
      $('pastedCoordinates').value=pair;$('pastedCoordinates').focus();$('pastedCoordinates').select();
      $('homeCoordinateStatus').textContent='Coordinates selected in the paste box. Press Ctrl+C (or Command+C) to copy.';
    }
  });
  function edit(id){
    if(!isAdmin()){ctx.openLogin();return;}
    if(!ctx.isReady()){ctx.toast('Wait for shared address information before editing.',true);return;}
    const c=congregationById(id);if(!c)return;
    const home=resolveHome(c);editor={congregation:c,version:ctx.getProfile(id)?.addressVersion||0};cancelLookup();pinSource=ctx.getProfile(id)?.pinSource||'';$('saveWithoutPin').hidden=true;
    $('pastedCoordinates').value='';$('addressCongregation').textContent=c.name;$('homeAddress').value=home.address;$('homeLat').value=home.point?.lat??'';$('homeLng').value=home.point?.lng??'';$('addressMatches').replaceChildren();$('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='';$('addressEditorStatus').textContent='';
    const addresses=new Map();for(const location of ctx.getLocations())if(location.address)addresses.set(location.address,location);
    $('addressKnown').innerHTML='<option value="">Choose a hall, or enter an address below</option>'+[...addresses.values()].map(p=>'<option value="'+esc(p.id)+'">'+esc(pointLabel(p))+' · '+esc(p.address)+'</option>').join('');
    modal.classList.add('open');$('homeAddress').focus();
    if(!editorMap&&globalThis.L){
      editorMap=L.map('addressPreview').setView([39.74,-104.99],10);
      editorMap.on('click',event=>{if(!editorSaving)placeManualPin(event.latlng);});
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(editorMap);
    }
    if(editorMap){editorMap.invalidateSize();if(!home.point)editorMap.setView([39.74,-104.99],10);}
    previewPin();
  }
  function closeEditor(){if(editorSaving)return;cancelLookup();modal.classList.remove('open');editor=null;}
  function dismissEditor(){
    if(!modal.classList.contains('open'))return false;
    closeEditor();
    return true;
  }
  function previewPin(){
    syncCoordinatePanel();
    if(!editorMap)return;if(editorMarker){editorMap.removeLayer(editorMarker);editorMarker=null;}
    if(!validPoint($('homeLat').value,$('homeLng').value))return;
    editorMarker=L.marker([Number($('homeLat').value),Number($('homeLng').value)],{draggable:true}).addTo(editorMap);
    editorMap.setView(editorMarker.getLatLng(),Math.max(16,editorMap.getZoom()));
    editorMarker.on('dragend',()=>{if(!editorSaving)placeManualPin(editorMarker.getLatLng());});
  }
  function placeManualPin(p){
    if(!editor||!validPoint(p.lat,p.lng))return;
    cancelLookup();pinSource=manualSource;
    $('homeLat').value=Number(p.lat).toFixed(7);$('homeLng').value=Number(p.lng).toFixed(7);
    $('addressKnown').value='';$('addressMatches').replaceChildren();$('saveWithoutPin').hidden=true;
    previewPin();
    $('addressEditorStatus').textContent='Pin placed. Check the building location, then Save address. You can keep your address or use a nearby suggestion.';
    void suggestAddressForPin();
  }
  function action(parent,label,callback){
    const button=document.createElement('button');button.type='button';button.className='btn outline';button.textContent=label;
    button.addEventListener('click',()=>{if(!editorSaving)callback();});parent.append(button);
  }
  function resultCard(parent,p,note){
    const card=document.createElement('div');card.className='address-result';
    const title=document.createElement('strong');title.textContent=p.address;card.append(title);
    const description=document.createElement('p');description.textContent=note+' Latitude: '+Number(p.lat).toFixed(6)+' · Longitude: '+Number(p.lng).toFixed(6)+'.';card.append(description);
    const actions=document.createElement('div');actions.className='address-result-actions';card.append(actions);parent.append(card);
    return actions;
  }
  async function suggestAddressForPin(){
    if(!editor||!validPoint($('homeLat').value,$('homeLng').value)){
      $('nearbyAddressStatus').textContent='Click the map or use Pin map center first.';return;
    }
    cancelNearby();const sequence=nearbySequence,controller=new AbortController();nearbyAbort=controller;
    const point={lat:Number($('homeLat').value),lng:Number($('homeLng').value)},timeout=setTimeout(()=>controller.abort(),10000);
    $('suggestPinAddress').disabled=true;$('nearbyAddressMatches').replaceChildren();
    $('nearbyAddressStatus').textContent='Looking for nearby address suggestions… Your pin will stay where you placed it.';
    try{
      const results=await nearbyAddresses(point,{signal:controller.signal});
      if(sequence!==nearbySequence||!editor)return;
      for(const p of results.slice(0,3)){
        const feet=Math.round(p.miles*5280),note=p.kind==='address'?'Nearby address · about '+feet+' ft from your pin. Check that it belongs to this building.':'Street or area only. Add the building number to your address above.';
        const actions=resultCard($('nearbyAddressMatches'),p,note);
        if(p.kind==='address')action(actions,'Use this address',()=>{
          cancelLookup();$('homeAddress').value=p.address;$('addressKnown').value='';
          $('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='Suggested address used. Your chosen pin has not moved.';syncCoordinatePanel();
          $('addressEditorStatus').textContent='Check the address and pin, then Save address.';
        });
      }
      $('nearbyAddressStatus').textContent=results.length?'Suggestions are nearby map records and may belong to a neighboring building. Use one only if it is correct.':'No nearby address found. Your pin is kept; enter the meeting address above and save.';
    }catch(error){
      if(sequence===nearbySequence&&editor)$('nearbyAddressStatus').textContent='Nearby address suggestions are unavailable. Your pin is kept; enter the meeting address above and save.';
    }finally{clearTimeout(timeout);if(sequence===nearbySequence)$('suggestPinAddress').disabled=editorSaving;}
  }
  $('pinMapCenter').addEventListener('click',()=>{
    if(editorSaving||!editorMap)return;
    if(editorMap.getZoom()<16){$('addressEditorStatus').textContent='Zoom in until you can identify the building, then choose Pin map center or click the building.';return;}
    placeManualPin(editorMap.getCenter());
  });
  $('suggestPinAddress').addEventListener('click',()=>{if(!editorSaving)void suggestAddressForPin();});
  $('addressKnown').addEventListener('change',()=>{
    const p=ctx.getLocations().find(p=>p.id===$('addressKnown').value);if(!p)return;
    cancelLookup();pinSource='Existing hall address pin';$('saveWithoutPin').hidden=true;$('homeAddress').value=p.address;$('homeLat').value=p.lat;$('homeLng').value=p.lng;
    $('addressMatches').replaceChildren();$('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='';
    $('addressEditorStatus').textContent='Existing hall address and pin selected.';previewPin();
  });
  function placeResult(p,source){
    $('homeLat').value=String(p.lat);$('homeLng').value=String(p.lng);pinSource=source;
    $('addressMatches').replaceChildren();$('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='';$('saveWithoutPin').hidden=true;previewPin();
    $('addressEditorStatus').textContent='Map pin found automatically. Save address to add it to the congregation map. You can drag the pin to adjust it.';
  }
  function lookupAddress(provider='photon'){
    if(!editor)return Promise.resolve(false);
    const query=$('homeAddress').value.trim();
    if(query.length<5){$('addressEditorStatus').textContent='Enter an address, street and city, or nearby place.';return Promise.resolve(false);}
    if(lookupTask?.query===query&&lookupTask.provider===provider)return lookupTask.promise;
    cancelLookup();
    const sequence=lookupSequence,controller=new AbortController();lookupAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),18000);
    $('homeLat').value='';$('homeLng').value='';pinSource='';previewPin();
    $('findHomeAddress').disabled=true;$('tryCensusAddress').disabled=true;$('addressMatches').replaceChildren();$('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='';
    $('addressEditorStatus').textContent=provider==='census'?'Checking U.S. Census address records…':'Finding the address or nearby street…';
    $('homeCoordinateStatus').textContent='Looking up latitude and longitude…';
    const promise=(async()=>{
      try{
        const result=provider==='census'?{pin:null,candidates:await findCensusAddress(query,{signal:controller.signal})}:await resolveAddressPin(query,ctx.getAddressPoints(),{signal:controller.signal});
        if(sequence!==lookupSequence||!editor||$('homeAddress').value.trim()!==query)return false;
        if(result.pin){placeResult(result.pin,result.source);return true;}
        if(!result.candidates.length)throw Error('No matching address coordinates found.');
        for(const p of result.candidates){
          const approximate=p.approximate===true;
          const actions=resultCard($('addressMatches'),p,p.precision==='street-estimate'?'U.S. Census street estimate. Check or move the pin to the building before saving.':approximate?'Approximate street or area. Locate the building on the map before placing a pin.':'Suggested street address. Check the address and pin before saving.');
          if(approximate){
            action(actions,'Show area on map',()=>{
              cancelLookup();$('homeLat').value='';$('homeLng').value='';pinSource='';previewPin();
              editorMap?.setView([p.lat,p.lng],p.kind==='street'?15:12);
              $('addressPreview').scrollIntoView({behavior:'smooth',block:'center'});
              $('addressEditorStatus').textContent='Area shown; no pin has been saved. Zoom to the building and click it, or use Pin map center.';
            });
          }else{
            action(actions,'Use suggested address & pin',()=>{
              cancelLookup();$('homeAddress').value=p.address;placeResult(p,p.source||'Administrator-selected address lookup result');
              $('addressEditorStatus').textContent='Suggested address and pin selected. Check the building, then Save address.';
            });
            action(actions,'Pin & keep my address',()=>{
              cancelLookup();placeResult(p,manualSource);
              $('addressEditorStatus').textContent='Pin selected; your typed address was kept. Drag the pin to the building if needed, then Save address.';
            });
          }
        }
        $('saveWithoutPin').hidden=false;
        $('addressEditorStatus').textContent='Review the suggested coordinates below, or use Google Maps and paste the coordinates above.';
        $('homeCoordinateStatus').textContent='Suggested coordinates are listed below. Choose the correct result to fill latitude and longitude.';
        return false;
      }catch(error){
        if(sequence===lookupSequence&&editor){
          $('saveWithoutPin').hidden=false;
          $('homeCoordinateStatus').textContent='Coordinates could not be found. Try the U.S. address lookup, Google Maps, or place a pin manually.';
          $('addressEditorStatus').textContent=(error.name==='AbortError'?'Address lookup timed out.':error.message)+' You can place a pin manually or save without a pin.';
        }
        return false;
      }finally{clearTimeout(timeout);if(sequence===lookupSequence){lookupTask=null;$('findHomeAddress').disabled=editorSaving;$('tryCensusAddress').disabled=editorSaving;}}
    })();
    lookupTask={query,provider,promise};return promise;
  }
  $('homeAddress').addEventListener('input',()=>{
    const keepPin=pinSource===manualSource&&validPoint($('homeLat').value,$('homeLng').value);
    cancelLookup();$('addressKnown').value='';$('addressMatches').replaceChildren();$('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='';$('saveWithoutPin').hidden=true;
    if(keepPin){syncCoordinatePanel();$('addressEditorStatus').textContent='Your chosen map pin is kept while you edit the address. Choose Find address & suggestions to search again.';return;}
    pinSource='';$('homeLat').value='';$('homeLng').value='';previewPin();
    $('addressEditorStatus').textContent='Enter the full address, or search a street and city or nearby landmark.';
    if($('homeAddress').value.trim().length>=5)lookupTimer=setTimeout(()=>void lookupAddress(),900);
  });
  for(const id of ['homeLat','homeLng'])$(id).addEventListener('input',()=>{
    cancelLookup();pinSource=manualSource;$('addressMatches').replaceChildren();$('nearbyAddressMatches').replaceChildren();$('nearbyAddressStatus').textContent='';previewPin();
  });
  $('findHomeAddress').addEventListener('click',()=>{cancelLookup();void lookupAddress();});
  $('tryCensusAddress').addEventListener('click',()=>{if(!editorSaving){cancelLookup();void lookupAddress('census');}});
  async function saveEditor(withoutPin=false){
    if(!editor||editorSaving)return;
    const current=editor;clearTimeout(lookupTimer);editorSaving=true;
    const controls=[...$('addressForm').querySelectorAll('button,input,select')];controls.forEach(e=>e.disabled=true);
    editorMarker?.dragging?.disable();
    try{
      if(!withoutPin&&!$('homeAddress').value.trim()&&validPoint($('homeLat').value,$('homeLng').value))throw Error('Add the congregation meeting address above, or choose a nearby address suggestion, before saving this pin.');
      if(!withoutPin&&$('homeAddress').value.trim()&&!String($('homeLat').value).trim()&&!String($('homeLng').value).trim()){
        const matched=await lookupAddress();
        if(!matched)return;
      }else cancelLookup();
      const values={address:$('homeAddress').value,lat:withoutPin?'':$('homeLat').value,lng:withoutPin?'':$('homeLng').value,pinSource};
      $('addressEditorStatus').textContent='Saving shared address and map pin…';
      await ctx.saveAddress(current.congregation,values,current.version);
      editorSaving=false;closeEditor();select(current.congregation.id,true);
      if(map&&validPoint(values.lat,values.lng)&&values.address.trim()){
        focusMapPoint(map,values);
        $('map').scrollIntoView({behavior:'smooth',block:'center'});
        ctx.toast('Address saved and pinned on the map. The meeting-point assignment was kept.');
      }else ctx.toast('Address saved. It is flagged until a map pin is added.');
    }catch(error){$('addressEditorStatus').textContent=error.message;}
    finally{editorSaving=false;controls.forEach(e=>e.disabled=false);editorMarker?.dragging?.enable();syncCoordinatePanel($('homeCoordinateStatus').textContent);}
  }
  $('addressForm').addEventListener('submit',event=>{event.preventDefault();void saveEditor();});
  $('saveWithoutPin').addEventListener('click',()=>void saveEditor(true));
  $('cancelAddress').addEventListener('click',closeEditor);modal.addEventListener('click',e=>{if(e.target===modal)closeEditor();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&dismissEditor())e.preventDefault();if(e.key==='Tab'&&modal.classList.contains('open')){const controls=[...modal.querySelectorAll('button,input,select,a[href]')].filter(el=>!el.disabled&&el.offsetParent!==null),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  // Initial fit includes homes outside the original DTC planning boundary.
  if(map){const points=congregations.map(c=>resolveHome(c).point).filter(Boolean);if(points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[50,50],maxZoom:12});}
  return{render,select,edit,meetingPointChosen,fitSelected,unassign,selectionChanged,clearSelection,dismissEditor};
}


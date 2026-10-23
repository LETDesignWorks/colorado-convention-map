import { scanDuplicateAddresses, duplicateSummary } from './address-duplicates.js?v=territories-20261023-49';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountDuplicateAddressReview(api) {
  const root = document.getElementById('savedTerritoriesCard');
  if (!root || document.getElementById('duplicateAddressCard')) return null;
  const card = document.createElement('section'); card.id='duplicateAddressCard';
  card.style.cssText='margin:12px 0;padding:12px;border:1px solid #c6d9e8;border-radius:10px;background:#f5fafe';
  card.innerHTML='<h3>Address duplicate check</h3><p id="duplicateAutoStatus" role="status">Select a territory to check its addresses automatically, or scan the complete meeting-place set.</p><div class="button-grid"><button type="button" class="btn outline" id="scanSelectedDuplicates" disabled>Check this territory</button><button type="button" class="btn outline" id="scanAllDuplicates">Scan all territories for this meeting place</button></div><p id="duplicateScanStatus" role="status" aria-live="polite"></p><p id="duplicateChoiceStatus" role="status"></p><div id="duplicateScanResults"></div><button type="button" class="btn save" id="applyDuplicateCleanup" hidden>Remove confirmed duplicates</button><button type="button" class="btn outline" id="reviewRemainingDuplicates" hidden>Review remaining matches</button><p style="margin-top:8px;font-size:12px">Missing street directions, such as Clyde Cir versus S Clyde Cir, are checked using map locations and city/ZIP. Different directions and apartment units stay separate. Avoid and excluded status are retained. Cleanup changes the current session only; SAVE YOUR WORK retains it as a new complete set. Earlier backups are not deleted.</p>';
  root.appendChild(card);
  const el = id=>card.querySelector('#'+id);
  let selected=null, review=null, working=false, epoch=0, limit=100, lastAll=false;
  function controls() { const ready=api.isAdmin()&&api.getSavedRecordsStatus()==='ready'&&api.getSelectedHall(); el('scanSelectedDuplicates').disabled=working||!ready||!selected||!!selected.error; el('scanAllDuplicates').disabled=working||!ready; el('applyDuplicateCleanup').disabled=working||!review; el('reviewRemainingDuplicates').disabled=working||!ready; }
  function clear() { el('reviewRemainingDuplicates').hidden=true; el('duplicateChoiceStatus').textContent=''; epoch++; selected=null; review=null; el('duplicateScanResults').replaceChildren(); el('applyDuplicateCleanup').hidden=true; el('duplicateAutoStatus').textContent='Select a territory to check its addresses, or scan this meeting place.'; el('duplicateScanStatus').textContent=''; controls(); }
  function selectVersion(version) {
    if (!version || String(version.hallId)!==String(api.getSelectedHall()?.id)) return;
    if (selected?.id===version.id) return;
    selected=version; review=null; epoch++; limit=100;
    el('reviewRemainingDuplicates').hidden=true; el('duplicateChoiceStatus').textContent='';
    el('duplicateScanResults').replaceChildren(); el('applyDuplicateCleanup').hidden=true;
    el('duplicateAutoStatus').textContent=version.error ? `${version.territory.name}: cannot check incomplete saved addresses.`
      : `${version.territory.name}: ${duplicateSummary(scanDuplicateAddresses(version.houses,[version.territory]))}`;
    el('duplicateScanStatus').textContent='Automatic check only; nothing has been changed.'; controls();
  }
  function selectId(id) {
    const territory=api.getTerritories().find(t=>String(t.id)===String(id)); if(!territory) return;
    const wanted=new Set((territory.houseIds||[]).map(String));
    const houses=api.getHouses().filter(h=>String(h.territoryId||h.avoidTerritoryId)===String(id)||wanted.has(String(h.id)));
    selectVersion({id:`map:${api.getWorkspaceGeneration()}:${id}:${JSON.stringify(houses)}`,source:'session',hallId:String(api.getSelectedHall()?.id),congregation:api.getSelectedCongregation(),territory,houses});
  }
  function renderResults() {
    const report=review.report, names=new Map(review.territories.map(t=>[String(t.id),t.name]));
    el('duplicateScanStatus').textContent=duplicateSummary(report)+' Matching records are selected for cleanup. Review-needed groups stay separate until you choose Combine these copies and the address/map location to keep.';
    el('duplicateScanResults').innerHTML=report.groups.slice(0,limit).map((g,index)=>`<details${!g.safe && index<10?' open':''} data-duplicate-group="${index}" style="margin:8px 0;padding:8px;background:white;border:1px solid #ccd7e0;border-radius:8px"><summary><strong>${esc(g.label)}</strong> — ${g.entries.length} copies${g.safe?' — matching house': ' — review needed'}${g.avoid?' — AVOID retained':''}</summary><p>${esc(g.reasons.join('; ')||'Matching address, unit and nearby map locations.')}</p><ul>${g.entries.map(e=>`<li>${esc(e.house.address)}${e.house.unit?` • unit ${esc(e.house.unit)}`:''} • ${esc(e.house.source||'Source not recorded')} • ${esc(e.assignments.map(id=>names.get(id)||id).join(', ')||'Unassigned / avoid')} • ${esc(e.house.lat)}, ${esc(e.house.lng)}${e.house.avoid?' — AVOID':''}</li>`).join('')}</ul><label>Action <select data-dup-action="${index}"><option value="skip"${g.safe?'':' selected'}>Leave these copies separate for now</option><option value="merge"${g.safe?' selected':''}${(g.directionConflict || g.entries.some(e=>e.identity.ambiguous))?' disabled':''}>Combine these copies</option></select></label><label style="display:block;margin-top:7px">Keep this address and map location <select data-dup-keep="${index}">${g.entries.map(e=>`<option value="${e.index}"${e.index===g.preferredIndex?' selected':''}>${esc(e.house.address)} — ${esc(e.house.source||e.house.id)} (${esc(e.house.lat)}, ${esc(e.house.lng)})</option>`).join('')}</select></label>${g.territoryIds.length>1?`<label style="display:block;margin-top:7px">Territory to keep the address <select data-dup-territory="${index}"><option value="__choose__">Choose a territory before combining</option><option value="">Unassigned</option>${g.territoryIds.map(id=>`<option value="${esc(id)}">${esc(names.get(id)||id)}</option>`).join('')}</select></label>`:''}</details>`).join('');
    if(report.groups.length>limit) {
      const more=document.createElement('button');more.className='btn outline';more.type='button';more.textContent=`Show all ${report.groups.length} groups`;
      more.onclick=()=>{ const choices=readDecisions();limit=report.groups.length;renderResults();restoreDecisions(choices);updateChoiceStatus(); };el('duplicateScanResults').appendChild(more);
    }
    el('applyDuplicateCleanup').hidden=!report.groups.length;
    updateChoiceStatus();
  }
  function readDecisions() {
    const choices={}; if(!review)return choices;
    review.report.groups.forEach((g,i)=>{
      const action=card.querySelector(`[data-dup-action="${i}"]`);
      if(!action || action.value==='skip'){choices[g.key]={separate:true};return;}
      choices[g.key]={keepIndex:Number(card.querySelector(`[data-dup-keep="${i}"]`).value)};
      const place=card.querySelector(`[data-dup-territory="${i}"]`);if(place&&place.value!=='__choose__')choices[g.key].territoryId=place.value;
    });return choices;
  }
  function updateChoiceStatus() {
    if (!review) { el('duplicateChoiceStatus').textContent=''; return; }
    const decisions=readDecisions(); let removal=0, skipped=0;
    for (const group of review.report.groups) {
      if (decisions[group.key]?.separate) skipped++; else removal+=group.count;
    }
    el('duplicateChoiceStatus').textContent=`${removal} repeated record(s) selected for removal; ${skipped} group(s) will remain separate. Nothing is deleted until you apply and confirm cleanup.`;
  }
  function restoreDecisions(choices) { review.report.groups.forEach((g,i)=>{ const d=choices[g.key];if(!d)return;const a=card.querySelector(`[data-dup-action="${i}"]`);if(a)a.value=d.separate?'skip':'merge';const k=card.querySelector(`[data-dup-keep="${i}"]`);if(k&&d.keepIndex!=null)k.value=String(d.keepIndex);const t=card.querySelector(`[data-dup-territory="${i}"]`);if(t&&d.territoryId!=null)t.value=d.territoryId; }); }
  async function scan(all=false) {
    if(working)return;working=true;lastAll=all;controls();const request=++epoch;review=null;
    el('reviewRemainingDuplicates').hidden=true; el('duplicateChoiceStatus').textContent='';
    el('duplicateScanStatus').textContent='Checking the chosen territories, current uploads and avoid addresses…';
    el('duplicateScanResults').replaceChildren();el('applyDuplicateCleanup').hidden=true;
    try {
      const result=await api.meetingSessionManager.reviewDuplicates(all?null:selected);
      if(request!==epoch||!api.isAdmin())return;
      review=result;limit=100;renderResults();
      if(!result.report.groups.length)el('duplicateScanStatus').textContent=duplicateSummary(result.report)+' Earlier historical versions are not counted again.';
    }catch(error){if(request===epoch)el('duplicateScanStatus').textContent=`The check could not finish: ${error.message}`;}
    finally{working=false;controls();}
  }
  async function apply() {
    if(working||!review)return;working=true;controls();const request=epoch;
    const hallAtStart=String(api.getSelectedHall()?.id||''), territoryAtStart=selected?.territory?.id;
    try{
      const result=await api.meetingSessionManager.repairDuplicates(review.token,readDecisions());
      if(!result){el('duplicateScanStatus').textContent='No changes were applied. For matches you have checked, choose Combine these copies and the address/map location to keep, then apply cleanup. Uncertain matches are never removed automatically.';return;}
      if(api.isAdmin() && hallAtStart===String(api.getSelectedHall()?.id||'') && territoryAtStart!=null) selectId(territoryAtStart);
      window.dispatchEvent(new window.CustomEvent('territory-planner:duplicates-cleaned'));
      // Applying cleanup selects the fresh version, which advances epoch. Keep
      // its result visible unless the user actually changed hall/territory.
      if(api.isAdmin() && hallAtStart===String(api.getSelectedHall()?.id||'') && (lastAll || !selected || String(selected.territory?.id)===String(territoryAtStart))){
        review=null;el('duplicateScanResults').replaceChildren();el('applyDuplicateCleanup').hidden=true;
        el('duplicateChoiceStatus').textContent='';
        el('reviewRemainingDuplicates').hidden=!result.remaining.groups.length;
        el('duplicateScanStatus').textContent=`Removed ${result.removed} repeated address record(s). ${duplicateSummary(result.remaining)}${result.remaining.groups.length?' Use Review remaining matches to choose what to keep; those records have not been deleted.':''} Select SAVE YOUR WORK to retain the cleaned session.`;
      }
    }catch(error){if(request===epoch)el('duplicateScanStatus').textContent=`Nothing was cleaned: ${error.message}`;}
    finally{working=false;controls();}
  }
  el('duplicateScanResults').addEventListener('change',updateChoiceStatus);
  el('reviewRemainingDuplicates').onclick=()=>scan(lastAll);
  el('scanSelectedDuplicates').onclick=()=>scan(false);el('scanAllDuplicates').onclick=()=>scan(true);el('applyDuplicateCleanup').onclick=apply;
  let hall=String(api.getSelectedHall()?.id||'');
  window.addEventListener('territory-planner:data',()=>{const next=String(api.getSelectedHall()?.id||'');if(next!==hall||!api.isAdmin()){hall=next;clear();}controls();});
  controls();return{selectVersion,selectId,clear,scanAll:()=>scan(true)};
}
async function initialize() {
  for(let i=0;i<200;i++) {
    const api=globalThis.__denverTerritoryPlannerAPI;
    if(api?.meetingSessionManager?.reviewDuplicates&&document.getElementById('savedTerritoriesCard')){globalThis.__denverDuplicateReview=mountDuplicateAddressReview(api);return;}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}
if(typeof window!=='undefined') initialize();

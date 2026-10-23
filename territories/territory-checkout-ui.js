import {buildCheckoutPdf, loadCheckoutLibrary, CHECKOUT_LOGO} from './territory-checkout-pdf.js?v=checkout-20261023-51';
import {checkoutOptions} from './territory-checkout-model.js?v=checkout-20261023-51';
export async function exportCheckoutPdf(roster, options) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),15000);
  try {
    const [PDFLib,response] = await Promise.all([loadCheckoutLibrary(),fetch(CHECKOUT_LOGO,{signal:controller.signal})]);
    if (!response.ok) throw Error('The convention logo could not load. Please retry.');
    return await buildCheckoutPdf(roster,options,{PDFLib,logoBytes:new Uint8Array(await response.arrayBuffer())});
  } finally {clearTimeout(timer);}
}
const mountedCheckoutSheets = new WeakMap();
export function mountCheckoutSheet(api,{document:d=globalThis.document,window:w=globalThis.window,exportPdf=exportCheckoutPdf,getApi=()=>api}={}) {
  if (mountedCheckoutSheets.has(d)) return mountedCheckoutSheets.get(d);
  const library=d.getElementById('savedTerritoriesCard');
  const parent=d.querySelector('.setup-card') || d.querySelector('.side-panel') || d.getElementById('hallAddressSetCard') || d.querySelector('.saved-card');
  if ((!library && !parent) || d.getElementById('territoryCheckoutSheet')) return null;
  const card = d.createElement('section'); card.id='territoryCheckoutSheet';
  card.className='card territory-checkout-card';card.tabIndex=-1;
  card.setAttribute('aria-labelledby','territoryCheckoutTitle');
  card.style.cssText='margin:12px 0;padding:14px;border:2px solid #8ab4a0;border-radius:12px;background:#f5fbf8;scroll-margin-top:120px';
  card.innerHTML=`<div class="card-heading"><div><span class="eyebrow">MEETING-PLACE PRINTING</span><h2 id="territoryCheckoutTitle" style="margin:0 0 7px">Territory check-out / check-in sheet</h2></div></div>
    <p data-place style="font-weight:700"></p><p>Print a convention-branded register for this meeting place. Includes the chosen saved territories and current-session territories, once per name. This is a paper register, not live check-in tracking.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px">
      <label>Territories to include<select data-scope><option value="all">All at this meeting place</option><option value="current">Selected congregation only</option></select></label>
      <label>Activity date (optional)<input type="date" data-date></label>
      <label>Session / wave (optional)<input data-session maxlength="70" placeholder="Morning / Afternoon"></label>
      <label>Coordinator (optional)<input data-coordinator maxlength="80" placeholder="Leave blank to write in"></label>
      <label>Extra blank lines<input data-blanks type="number" min="0" max="30" step="1" value="2"></label>
    </div><button type="button" class="btn save" data-export style="width:100%;margin-top:10px">Create check-out / check-in PDF</button>
    <button type="button" class="btn outline" data-retry hidden>Retry loading sheet</button><p data-status role="status" aria-live="polite"></p><div data-links class="button-grid"></div>
    <small>Times and names are blank for writing in. Exporting does not change saved plans, addresses, or territory assignments. Use SAVE YOUR WORK to retain new territories separately.</small>`;
  // Do not wait for the asynchronously inserted SAVE YOUR WORK panel.
  // Keep the sheet near the meeting-place selector, outside collapsed sections.
  if(library) library.before(card); else parent.append(card);
  const q = selector => card.querySelector(selector);
  card.querySelectorAll('input,select').forEach(input=>input.style.cssText='display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid #aebfd1;border-radius:8px');
  let busy=false, epoch=0, url='', exported=false, hallId='', disposed=false, retryTimer=null;
  const shortcuts=new Set();
  const connected=()=>typeof api?.meetingSessionManager?.registerSnapshot==='function';
  function connect() { const candidate=getApi(); if(candidate)api=candidate; return connected(); }
  function addShortcuts() {
    if(disposed)return;
    for(const target of [d.getElementById('savedTerritoriesCard'),d.getElementById('hallAddressSetCard'),d.querySelector('.saved-card')]) {
      if(!target || target.contains(card) || target.querySelector('[data-checkout-shortcut]'))continue;
      const link=d.createElement('a');link.href='#territoryCheckoutSheet';link.className='btn outline full';
      link.dataset.checkoutShortcut='';link.textContent='Territory check-out / check-in sheet';
      link.style.cssText='display:block;margin:8px 0;white-space:normal;text-align:center';
      link.addEventListener('click',event=>{event.preventDefault();card.focus({preventScroll:true});card.scrollIntoView?.({behavior:'smooth',block:'start'});});
      const heading=target.querySelector('.card-heading');if(heading)heading.after(link);else target.prepend(link);shortcuts.add(link);
    }
  }
  const observer=typeof w.MutationObserver==='function'?new w.MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1 && (node.matches?.('#hallAddressSetCard,#savedTerritoriesCard,.saved-card') || node.querySelector?.('#hallAddressSetCard,#savedTerritoriesCard,.saved-card')))))addShortcuts();
  }):null;
  observer?.observe(d.querySelector('.side-panel') || d.body,{childList:true,subtree:true});
  function retryConnection() {
    if(disposed)return;
    w.clearTimeout(retryTimer);retryTimer=null;connect();changed();addShortcuts();
    if(!connected())retryTimer=w.setTimeout(retryConnection,1000);
  }
  function clearLinks() {if (url) w.URL.revokeObjectURL(url); url=''; exported=false; q('[data-links]').replaceChildren();}
  function ready() {return connected() && api.isAdmin() && api.getSelectedHall() && api.getSavedRecordsStatus()==='ready';}
  function controls() {
    q('[data-export]').disabled=busy||!ready(); q('[data-export]').textContent=busy?'Preparing territory sheet…':'Create check-out / check-in PDF';
    q('[data-scope] option[value="current"]').disabled=!connected() || !api.getSelectedCongregation();
    q('[data-retry]').hidden=connected();
    q('[data-status]').setAttribute('aria-busy',String(busy));
  }
  function changed() {
    if(disposed)return;connect();if(connected()){w.clearTimeout(retryTimer);retryTimer=null;}epoch++; const previous=exported; clearLinks();
    const hall=api?.getSelectedHall?.(), next=String(hall?.id||'');
    if (next!==hallId || !api?.isAdmin?.()) {hallId=next; q('[data-date]').value='';q('[data-session]').value='';q('[data-coordinator]').value='';q('[data-scope]').value='all';q('[data-status]').textContent='';}
    else if (previous) q('[data-status]').textContent='The session or export settings changed. Create a new PDF to include the latest information.';
    q('[data-place]').textContent=!connected()?'Loading the territory check-out tools… This section will become ready when the planner finishes starting.':!api.isAdmin()?'Sign in to print a meeting-place register.':!hall?'Select a Kingdom Hall or meeting point first.':api.getSavedRecordsStatus()!=='ready'?`${hall.name} — waiting for saved territories to finish loading.`:`${hall.name}${hall.address?' — '+hall.address:''}`;
    controls();addShortcuts();
  }
  async function create() {
    if (disposed||busy||!ready()) return;
    clearLinks(); const token=++epoch, hall=String(api.getSelectedHall().id); busy=true; controls();
    q('[data-status]').textContent='Loading the chosen territories and current-session work…';
    const active=()=>!disposed&&token===epoch&&api.isAdmin()&&String(api.getSelectedHall()?.id)===hall;
    try {
      const options=checkoutOptions({date:q('[data-date]').value,session:q('[data-session]').value,coordinator:q('[data-coordinator]').value,blankRows:q('[data-blanks]').value});
      const congregation=q('[data-scope]').value==='current'?api.getSelectedCongregation():'';
      if(q('[data-scope]').value==='current'&&!congregation)throw Error('Select a congregation or choose all territories at this meeting place.');
      const roster=await api.meetingSessionManager.registerSnapshot({congregation});
      if(!active())return;
      if(!roster.rows.length)throw Error('No territories found for this selection. Load or create territories, then try again.');
      if(roster.reviewRows && !w.confirm(`${roster.reviewRows} territory selection(s) need saved-data or same-name version review. Print the register with those rows marked “Review before issue”? Cancel to review the territory library first.`)) {q('[data-status]').textContent='Export cancelled. No saved work changed.';return;}
      q('[data-status]').textContent=`Preparing the PDF for ${roster.rows.length} territories…`;
      const built=await exportPdf(roster,options);
      if(!active())return;
      if(!built?.blob?.size)throw Error('The PDF was empty. Please retry.');
      url=w.URL.createObjectURL(built.blob);exported=true;
      const open=d.createElement('a');open.href=url;open.target='_blank';open.rel='noopener';open.className='btn outline';open.textContent='Open PDF / Print';
      const download=d.createElement('a');download.href=url;download.download=built.filename;download.className='btn outline';download.textContent='Download PDF';q('[data-links]').append(open,download);
      q('[data-status]').textContent=`Ready: ${roster.rows.length} territories on ${built.pages} page(s), with extra blank writing lines.${roster.sessionRows?' Current-session territories are included; export does not save them.':''} Your saved records are unchanged.`;
    } catch(error) {if(active())q('[data-status]').textContent=`Sheet was not created: ${error.message}`;}
    finally {busy=false;controls();}
  }
  card.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',changed));
  q('[data-export]').addEventListener('click',create);
  w.addEventListener('territory-planner:data',changed); w.addEventListener('territory-planner:saved-records',changed);
  q('[data-retry]').addEventListener('click',retryConnection);
  const controller={create,dispose(){disposed=true;epoch++;clearLinks();w.clearTimeout(retryTimer);observer?.disconnect();w.removeEventListener('territory-planner:data',changed);w.removeEventListener('territory-planner:saved-records',changed);shortcuts.forEach(link=>link.remove());card.remove();mountedCheckoutSheets.delete(d);}};
  mountedCheckoutSheets.set(d,controller);retryConnection();
  return controller;
}
export async function initializeCheckoutSheet({document:d=globalThis.document,window:w=globalThis.window}={}) {
  const getApi=()=>w.__denverTerritoryPlannerAPI;
  return mountCheckoutSheet(getApi(),{document:d,window:w,getApi});
}

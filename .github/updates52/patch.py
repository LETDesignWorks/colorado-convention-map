from pathlib import Path

def replace(path, old, new, count=1):
    p=Path(path); s=p.read_text(); actual=s.count(old)
    if actual != count: raise RuntimeError(f'{path}: expected {count} matches, found {actual}: {old[:85]}')
    p.write_text(s.replace(old,new))

ui='territories/territory-checkout-ui.js'
replace(ui, 'export function mountCheckoutSheet(api,{document:d=globalThis.document,window:w=globalThis.window,exportPdf=exportCheckoutPdf}={}) {\n  const parent = d.getElementById(\'hallAddressSetCard\');\n  if (!parent || d.getElementById(\'territoryCheckoutSheet\')) return null;', '''const mountedCheckoutSheets = new WeakMap();
export function mountCheckoutSheet(api,{document:d=globalThis.document,window:w=globalThis.window,exportPdf=exportCheckoutPdf,getApi=()=>api}={}) {
  if (mountedCheckoutSheets.has(d)) return mountedCheckoutSheets.get(d);
  const library=d.getElementById('savedTerritoriesCard');
  const parent=d.querySelector('.setup-card') || d.querySelector('.side-panel') || d.getElementById('hallAddressSetCard') || d.querySelector('.saved-card');
  if ((!library && !parent) || d.getElementById('territoryCheckoutSheet')) return null;''')
replace(ui, "  card.style.cssText='margin-top:16px;padding-top:14px;border-top:1px solid #c6d6e5';\n  card.innerHTML=`<h3 style=\"margin:0 0 7px\">Territory check-out / check-in sheet</h3>", '''  card.className='card territory-checkout-card';card.tabIndex=-1;
  card.setAttribute('aria-labelledby','territoryCheckoutTitle');
  card.style.cssText='margin:12px 0;padding:14px;border:2px solid #8ab4a0;border-radius:12px;background:#f5fbf8;scroll-margin-top:120px';
  card.innerHTML=`<div class="card-heading"><div><span class="eyebrow">MEETING-PLACE PRINTING</span><h2 id="territoryCheckoutTitle" style="margin:0 0 7px">Territory check-out / check-in sheet</h2></div></div>''')
replace(ui, '    <p data-status role="status" aria-live="polite"></p><div data-links class="button-grid"></div>', '    <button type="button" class="btn outline" data-retry hidden>Retry loading sheet</button><p data-status role="status" aria-live="polite"></p><div data-links class="button-grid"></div>')
replace(ui, '  parent.append(card);', '''  // Do not wait for the asynchronously inserted SAVE YOUR WORK panel.
  // Keep the sheet near the meeting-place selector, outside collapsed sections.
  if(library) library.before(card); else parent.append(card);''')
replace(ui, "  let busy=false, epoch=0, url='', exported=false, hallId='';", '''  let busy=false, epoch=0, url='', exported=false, hallId='', disposed=false, retryTimer=null;
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
  }''')
replace(ui, "  function ready() {return api.isAdmin() && api.getSelectedHall() && api.getSavedRecordsStatus()==='ready';}", "  function ready() {return connected() && api.isAdmin() && api.getSelectedHall() && api.getSavedRecordsStatus()==='ready';}")
replace(ui, "    q('[data-scope] option[value=\"current\"]').disabled=!api.getSelectedCongregation();", "    q('[data-scope] option[value=\"current\"]').disabled=!connected() || !api.getSelectedCongregation();\n    q('[data-retry]').hidden=connected();")
replace(ui, "    epoch++; const previous=exported; clearLinks();\n    const hall=api.getSelectedHall(), next=String(hall?.id||'');\n    if (next!==hallId || !api.isAdmin())", "    if(disposed)return;connect();if(connected()){w.clearTimeout(retryTimer);retryTimer=null;}epoch++; const previous=exported; clearLinks();\n    const hall=api?.getSelectedHall?.(), next=String(hall?.id||'');\n    if (next!==hallId || !api?.isAdmin?.())")
replace(ui, "    q('[data-place]').textContent=!api.isAdmin()?'Sign in to print a meeting-place register.':hall?`${hall.name}${hall.address?' — '+hall.address:''}`:'Select a Kingdom Hall or meeting point first.';\n    controls();", "    q('[data-place]').textContent=!connected()?'Loading the territory check-out tools… This section will become ready when the planner finishes starting.':!api.isAdmin()?'Sign in to print a meeting-place register.':!hall?'Select a Kingdom Hall or meeting point first.':api.getSavedRecordsStatus()!=='ready'?`${hall.name} — waiting for saved territories to finish loading.`:`${hall.name}${hall.address?' — '+hall.address:''}`;\n    controls();addShortcuts();")
replace(ui, "    if (busy||!ready()) return;", "    if (disposed||busy||!ready()) return;")
replace(ui, "    const active=()=>token===epoch&&api.isAdmin()&&String(api.getSelectedHall()?.id)===hall;", "    const active=()=>!disposed&&token===epoch&&api.isAdmin()&&String(api.getSelectedHall()?.id)===hall;")
replace(ui, "  changed();\n  return {create,dispose(){epoch++;clearLinks();w.removeEventListener('territory-planner:data',changed);w.removeEventListener('territory-planner:saved-records',changed);card.remove();}};", '''  q('[data-retry]').addEventListener('click',retryConnection);
  const controller={create,dispose(){disposed=true;epoch++;clearLinks();w.clearTimeout(retryTimer);observer?.disconnect();w.removeEventListener('territory-planner:data',changed);w.removeEventListener('territory-planner:saved-records',changed);shortcuts.forEach(link=>link.remove());card.remove();mountedCheckoutSheets.delete(d);}};
  mountedCheckoutSheets.set(d,controller);retryConnection();
  return controller;''')
replace(ui, '''export async function initializeCheckoutSheet() {
  for(let i=0;i<200;i++) {
    const api=globalThis.__denverTerritoryPlannerAPI;
    if(api?.meetingSessionManager?.registerSnapshot && document.getElementById('hallAddressSetCard')) return mountCheckoutSheet(api);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}''', '''export async function initializeCheckoutSheet({document:d=globalThis.document,window:w=globalThis.window}={}) {
  const getApi=()=>w.__denverTerritoryPlannerAPI;
  return mountCheckoutSheet(getApi(),{document:d,window:w,getApi});
}''')
boot='territories/bootstrap.js'
replace(boot,"const version = 'checkout-20261023-51';","const version = 'checkout-20261023-52';")
replace(boot, "  const checkoutSheet = await import('./territory-checkout-ui.js?v=checkout-20261023-51');\n  checkoutSheet.initializeCheckoutSheet().catch(error => console.warn('Check-in sheet unavailable', error));\n", '')
replace(boot, "  document.body.innerHTML = template;", """  document.body.innerHTML = template;
  // Start independently: other optional tools must not delay this visible card.
  import('./territory-checkout-ui.js?v=checkout-20261023-52')
    .then(module => module.initializeCheckoutSheet())
    .catch(error => {
      console.warn('Check-in sheet unavailable',error);
      if(document.getElementById('territoryCheckoutSheet'))return;
      const notice=document.createElement('section');notice.id='territoryCheckoutSheet';notice.className='card';notice.setAttribute('role','status');
      notice.textContent='Territory check-out / check-in sheet could not load. Save any unsaved work, then refresh the planner to retry.';
      document.getElementById('savedTerritoriesCard')?.before(notice);
    });""")
replace('territories/index.html','bootstrap.js?v=checkout-20261023-51','bootstrap.js?v=checkout-20261023-52')
print('Checkout card mounts before the main planner, stays visible while loading, and has shortcuts in saved-work sections.')

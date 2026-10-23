import { latestWork, workTime } from './saved-work-model.js?v=territories-20261022-45';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = id => document.getElementById(id);
let api, busy = false, lastList = '';
function organizeAddressPanels() {
  const bulk = el('bulkAddressCard'), avoid = el('avoidWorkflowCard'), mapCard = document.querySelector('.map-card');
  if (!bulk || !avoid || !mapCard) return;
  let pair = el('addressWorkflowPair');
  if (!pair) {
    pair = document.createElement('section'); pair.id = 'addressWorkflowPair';
    pair.className = 'address-workflow-pair'; pair.setAttribute('aria-label', 'Ministry and avoid address lists');
    mapCard.after(pair);
  }
  if (bulk.parentElement !== pair) pair.appendChild(bulk);
  if (avoid.parentElement !== pair) pair.appendChild(avoid);
  const assessor = el('addressSourceMergeCard');
  if (assessor && assessor.parentElement !== pair.parentElement) pair.after(assessor);
}
function renderSavedWork() {
  const target = el('savedWorkList');
  if (!target) return;
  if (!api.isAdmin()) { target.innerHTML = '<div class="empty">Sign in to load your saved work.</div>'; lastList = ''; return; }
  const plans = latestWork(api.getSavedPlans());
  const groups = new Map();
  for (const plan of plans) {
    const key = String(plan.hallId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plan);
  }
  const html = plans.length ? [...groups.values()].map(group => `<article class="saved-work-location"><h3>${esc(group[0].hallName || 'Meeting location')}</h3>${group.map(plan => {
    const stamp = workTime(plan);
    return `<div class="saved-work-plan"><div><strong>${esc(plan.planName || plan.congregation)}</strong><small>${esc(plan.congregation)}</small><small>${Number(plan.houseCount || 0).toLocaleString()} addresses • ${Number(plan.territoryCount || 0).toLocaleString()} territories${plan.avoidHouseCount ? ` • ${Number(plan.avoidHouseCount).toLocaleString()} avoid` : ''}</small><small>${stamp ? esc(new Date(stamp).toLocaleString()) : 'Saved time unavailable'}</small></div><button type="button" class="btn outline" data-work-load="${esc(plan.id)}">Load saved work</button></div>`;
  }).join('')}</article>`).join('') : '<div class="empty">No main saved work yet. Your earlier plans are safe in Backup below. Load the plan you want to continue, then choose SAVE YOUR WORK.</div>';
  if (html === lastList) return;
  lastList = html; target.innerHTML = html;
  target.querySelectorAll('[data-work-load]').forEach(button => button.addEventListener('click', () => api.loadPlanRecord(button.dataset.workLoad)));
}
function refresh() {
  organizeAddressPanels(); renderSavedWork();
  const ready = api.isAdmin() && api.getSelectedHall() && api.getSelectedCongregation();
  if (el('workAddAddressButton')) el('workAddAddressButton').disabled = busy || !ready;
}
async function addAddress() {
  if (busy || !api.requireAdmin()) return;
  const input = el('workAddressInput'), message = el('workAddressMessage');
  const address = input.value.trim();
  if (!address) { input.focus(); message.textContent = 'Enter the complete street address, city, and state.'; return; }
  const hallId = String(api.getSelectedHall()?.id || ''), congregation = api.getSelectedCongregation(), houses = api.getHouses();
  if (!hallId || !congregation) { message.textContent = 'Select the meeting location and congregation first.'; return; }
  busy = true; refresh(); message.textContent = 'Locating the additional address…';
  try {
    const result = await api.geocodeAddress(address);
    if (houses !== api.getHouses() || hallId !== String(api.getSelectedHall()?.id || '') || congregation !== api.getSelectedCongregation() || !api.isAdmin()) {
      throw new Error('The workspace changed. No address was added; try again in the intended saved work.');
    }
    const record = { id: api.uniqueId('address'), address: result.matchedAddress || address, baseAddress: result.matchedAddress || address,
      lat: Number(result.lat), lng: Number(result.lng), source: `Manual addition to saved work — ${result.source || 'address lookup'}`,
      included: true, residential: true, territoryId: null, manualGap: true, unit: '' };
    if (!api.validMapCoordinates(record)) throw new Error('The address service did not return a usable location.');
    const added = api.addHouseRecord(record);
    api.recalculateTerritoryHouseIds(); api.render(); api.refresh();
    input.value = '';
    message.textContent = added ? 'Address added as Unassigned. Review its map location, assign it when ready, and select SAVE YOUR WORK.' : 'This address is already in the set. No duplicate was added.';
  } catch (error) { message.textContent = error.message || 'The address could not be added.'; }
  finally { busy = false; refresh(); }
}
async function initialize() {
  for (let attempt = 0; attempt < 200; attempt++) {
    api = globalThis.__denverTerritoryPlannerAPI;
    if (api?.getSavedPlans && el('hallAddressSetCard') && el('avoidWorkflowCard')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!api?.getSavedPlans) return;
  el('workAddAddressButton')?.addEventListener('click', addAddress);
  el('workAddressInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addAddress(); } });
  window.addEventListener('territory-planner:data', refresh);
  window.addEventListener('territory-planner:saved-records', refresh);
  refresh();
  // Earlier extensions finish their initial UI setup asynchronously.
  for (const delay of [100, 500, 1500]) setTimeout(refresh, delay);
}
initialize();

const el = {};
let api = null;
let map = null;
let previewOpen = false;

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function context() {
  return {
    hall: api?.getSelectedHall?.() || null,
    congregation: clean(api?.getSelectedCongregation?.()),
    houses: api?.getHouses?.() || [],
    territories: api?.getTerritories?.() || [],
    boundary: api?.getBoundaryGeometry?.() || null,
    savedPlans: api?.getSavedPlans?.() || []
  };
}
function contextReady(data = context()) {
  return Boolean(data.hall && data.congregation);
}
function validAddresses(data = context()) {
  return data.houses.filter(house => api?.validMapCoordinates?.(house) ?? (Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)) && !(Math.abs(Number(house.lat)) < 1 && Math.abs(Number(house.lng)) < 1)));
}
function hallLabel(hall) {
  return clean(hall?.markerLabel || hall?.number || 'KH');
}
function territoryNameMap(data = context()) {
  return new Map(data.territories.map(territory => [String(territory.id), territory.name]));
}
function savedSetsForContext(data = context()) {
  if (!contextReady(data)) return [];
  return data.savedPlans
    .filter(plan => String(plan.hallId || '') === String(data.hall.id || '') && clean(plan.congregation) === data.congregation)
    .sort((a, b) => clean(a.planName).localeCompare(clean(b.planName), undefined, { numeric: true }));
}
function setMessage(message, state = 'waiting') {
  if (!el.message) return;
  el.message.textContent = message;
  el.message.dataset.state = state;
}
function injectStyles() {
  if (document.getElementById('hall-address-set-styles')) return;
  const style = document.createElement('style');
  style.id = 'hall-address-set-styles';
  style.textContent = `
    .hall-address-set-card{border-color:#9fc3df;background:linear-gradient(145deg,#fff,#f1f7fb)}
    .hall-address-context{border:1px solid #c8dbe9;background:#f8fbfd;border-radius:12px;padding:11px;margin:9px 0;display:grid;gap:4px}
    .hall-address-context strong{color:#123f68;font-size:12px}.hall-address-context small{color:#617388;font-size:9px;line-height:1.4}
    .hall-address-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
    .hall-address-stats div{border:1px solid #d3e0e9;border-radius:11px;background:#fff;padding:9px}.hall-address-stats span{display:block;font-size:8px;text-transform:uppercase;color:#748497;font-weight:850}.hall-address-stats strong{display:block;margin-top:3px;font-size:16px;color:#153f66}
    .hall-boundary-row{display:grid;grid-template-columns:minmax(150px,.7fr) minmax(220px,1.3fr);gap:9px;align-items:end}.hall-boundary-row .field{margin:0}
    .hall-address-message{display:block;margin-top:9px;padding:9px 10px;border-radius:10px;border:1px solid #d4e0e8;background:#f8fafc;color:#596b7d;font-size:9px;line-height:1.45}.hall-address-message[data-state=success]{background:#edf9f2;color:#176343;border-color:#b9dfc9}.hall-address-message[data-state=warning]{background:#fff7df;color:#765600;border-color:#edd99d}.hall-address-message[data-state=error]{background:#fff1f0;color:#922f28;border-color:#e7bbb7}
    .hall-address-preview{margin-top:11px;border:1px solid #cbdbe7;border-radius:12px;background:#fff;overflow:hidden}.hall-address-preview-head{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;padding:10px;border-bottom:1px solid #dce6ed}.hall-address-preview-head input{min-width:0}.hall-address-preview-count{font-size:9px;color:#637487;font-weight:800}.hall-address-list{max-height:360px;overflow:auto;display:grid}.hall-address-row{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #edf1f4}.hall-address-row:last-child{border-bottom:0}.hall-address-row:hover{background:#f7fafc}.hall-address-row.avoid{background:#fff6f5}.hall-address-badge{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#66798d;color:#fff;font-size:8px;font-weight:900}.hall-address-row.avoid .hall-address-badge{background:#c9362b}.hall-address-row strong{font-size:10px;color:#253a50}.hall-address-row small{display:block;font-size:8px;color:#758395;margin-top:2px}.hall-address-status{font-size:8px;font-weight:850;color:#52677d;text-align:right}.hall-address-row.avoid .hall-address-status{color:#a0342d}.hall-address-limit{padding:9px;text-align:center;font-size:9px;color:#69798a;background:#f7fafc}
    .hall-saved-set{margin-top:12px;padding-top:11px;border-top:1px solid #d9e4eb}.hall-saved-set-grid{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.hall-saved-set .field{margin:0}
    @media(max-width:720px){.hall-address-stats{grid-template-columns:repeat(2,1fr)}.hall-boundary-row,.hall-saved-set-grid{grid-template-columns:1fr}.hall-address-preview-head{grid-template-columns:1fr}.hall-address-row{grid-template-columns:28px 1fr}.hall-address-status{grid-column:2;text-align:left}}
    @media print{.hall-address-set-card{display:none!important}}
  `;
  document.head.appendChild(style);
}
function injectUi() {
  if (document.getElementById('hallAddressSetCard')) return;
  injectStyles();
  const grouping = document.querySelector('.grouping-card');
  if (!grouping) return;
  const card = document.createElement('section');
  card.id = 'hallAddressSetCard';
  card.className = 'card hall-address-set-card';
  card.innerHTML = `
    <div class="card-heading">
      <div><span class="eyebrow">3D — SAVE YOUR WORK</span><h2>SAVE YOUR WORK</h2></div>
      <span id="hallAddressSetChip" class="count-chip">No addresses</span>
    </div>
    <p class="section-copy">Save all loaded addresses, avoid information, boundaries, and created territories together for this meeting location and congregation. Load your latest saved work under Return to your territories. Earlier copies stay in Backup.</p>
    <div id="hallAddressContext" class="hall-address-context"><strong>Select a meeting location and congregation</strong><small>Use Area Setup before saving.</small></div>
    <div class="hall-address-stats">
      <div><span>Ministry addresses</span><strong id="hallAddressIncludedCount">0</strong></div>
      <div><span>Avoid addresses</span><strong id="hallAddressAvoidCount">0</strong></div>
      <div><span>Total mapped</span><strong id="hallAddressTotalCount">0</strong></div>
      <div><span>Hall boundary</span><strong id="hallAddressBoundaryStatus">None</strong></div>
    </div>
    <div class="hall-work-actions">
      <button id="hallAddressReviewButton" class="btn outline" type="button">Show Address List</button>
      <button id="hallAddressZoomButton" class="btn outline" type="button">Zoom to Addresses</button>
      <button id="hallAddressSaveButton" class="btn save admin-control" type="button">SAVE YOUR WORK</button>
    </div>
    <small id="hallAddressMessage" class="hall-address-message" data-state="waiting">Load or add your addresses, create or edit territories, then save the complete workspace here.</small>
    <div class="work-add-address">
      <label for="workAddressInput">Add another address to this set</label>
      <input id="workAddressInput" type="text" autocomplete="street-address" placeholder="Street address, city, state and ZIP"/>
      <button id="workAddAddressButton" class="btn outline admin-control" type="button">Locate &amp; Add Address</button>
      <small id="workAddressMessage" role="status">New addresses start as Unassigned. Existing addresses and territory assignments stay in place. Use 3B to append another address file.</small>
    </div>
    <details class="hall-work-boundary-tools">
      <summary>Optional boundary tools</summary>
      <div class="field"><label for="hallAddressBoundaryPadding">Boundary padding in miles</label><input id="hallAddressBoundaryPadding" type="number" min="0.02" max="2" step="0.02" value="0.12"/></div>
      <button id="hallAddressBoundaryButton" class="btn primary admin-control" type="button">Create Editable Hall Boundary</button>
    </details>
    <div id="hallAddressPreview" class="hall-address-preview" hidden>
      <div class="hall-address-preview-head"><input id="hallAddressSearch" type="search" placeholder="Search addresses, territory, or avoid status"/><span id="hallAddressPreviewCount" class="hall-address-preview-count"></span></div>
      <div id="hallAddressList" class="hall-address-list"></div>
    </div>
    <div class="hall-saved-set" hidden>
      <label for="hallAddressSavedSelect">Legacy address sets</label><select id="hallAddressSavedSelect"><option value="">No saved sets available</option></select>
      <button id="hallAddressLoadButton" class="btn outline admin-control" type="button">Load Selected Set</button>
    </div>
`;
  const bulkCard = document.getElementById('bulkAddressCard');
  if (bulkCard) bulkCard.after(card); else grouping.before(card);
}
function bindElements() {
  Object.assign(el, {
    card: document.getElementById('hallAddressSetCard'),
    chip: document.getElementById('hallAddressSetChip'),
    context: document.getElementById('hallAddressContext'),
    included: document.getElementById('hallAddressIncludedCount'),
    avoid: document.getElementById('hallAddressAvoidCount'),
    total: document.getElementById('hallAddressTotalCount'),
    boundaryStatus: document.getElementById('hallAddressBoundaryStatus'),
    padding: document.getElementById('hallAddressBoundaryPadding'),
    review: document.getElementById('hallAddressReviewButton'),
    zoom: document.getElementById('hallAddressZoomButton'),
    boundary: document.getElementById('hallAddressBoundaryButton'),
    save: document.getElementById('hallAddressSaveButton'),
    message: document.getElementById('hallAddressMessage'),
    preview: document.getElementById('hallAddressPreview'),
    search: document.getElementById('hallAddressSearch'),
    previewCount: document.getElementById('hallAddressPreviewCount'),
    list: document.getElementById('hallAddressList'),
    saved: document.getElementById('hallAddressSavedSelect'),
    load: document.getElementById('hallAddressLoadButton')
  });
  return Boolean(el.card && el.save && el.boundary && el.list);
}
function renderAddressList(data = context()) {
  if (!el.list) return;
  const query = clean(el.search?.value).toLowerCase();
  const territoryById = territoryNameMap(data);
  const matches = data.houses
    .filter(house => {
      const territory = territoryById.get(String(house.territoryId || '')) || '';
      const status = house.avoid ? 'avoid do not visit' : house.included === false ? 'excluded' : territory || 'unassigned';
      return !query || `${house.address || ''} ${territory} ${status}`.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(Boolean(a.avoid)) - Number(Boolean(b.avoid)) || clean(a.address).localeCompare(clean(b.address), undefined, { numeric: true }));
  const limit = 1500;
  const shown = matches.slice(0, limit);
  el.previewCount.textContent = `${matches.length.toLocaleString()} address${matches.length === 1 ? '' : 'es'}`;
  if (!shown.length) {
    el.list.innerHTML = '<div class="empty">No addresses match this search.</div>';
    return;
  }
  el.list.innerHTML = shown.map(house => {
    const territory = territoryById.get(String(house.territoryId || ''));
    const status = house.avoid ? 'Avoid / Do Not Visit' : house.included === false ? 'Excluded' : territory || 'Unassigned';
    const detail = [house.source || '', house.classification || ''].filter(Boolean).join(' • ');
    return `<article class="hall-address-row${house.avoid ? ' avoid' : ''}"><span class="hall-address-badge">${house.avoid ? 'X' : 'H'}</span><div><strong>${esc(house.address || 'Mapped address')}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div><span class="hall-address-status">${esc(status)}</span></article>`;
  }).join('') + (matches.length > limit ? `<div class="hall-address-limit">Showing the first ${limit.toLocaleString()} of ${matches.length.toLocaleString()} matching addresses. Use search to narrow the list.</div>` : '');
}
function renderSavedSets(data = context()) {
  const plans = savedSetsForContext(data);
  const previous = el.saved.value;
  el.saved.innerHTML = plans.length
    ? plans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.planName || 'Saved address set')} — ${Number(plan.houseCount || 0).toLocaleString()} addresses${plan.avoidHouseCount ? ` • ${Number(plan.avoidHouseCount).toLocaleString()} avoid` : ''}${plan.territoryCount ? ` • ${Number(plan.territoryCount)} territories` : ''}</option>`).join('')
    : '<option value="">No saved sets for this Hall and congregation</option>';
  if (plans.some(plan => String(plan.id) === String(previous))) el.saved.value = previous;
  el.load.disabled = !api.isAdmin() || !plans.length;
}
function refresh() {
  if (!api || !el.card) return;
  const data = context();
  const included = data.houses.filter(house => house.included !== false && !house.avoid).length;
  const avoid = data.houses.filter(house => house.avoid).length;
  const mapped = validAddresses(data).length;
  const ready = contextReady(data);
  const admin = Boolean(api.isAdmin?.());
  el.included.textContent = included.toLocaleString();
  el.avoid.textContent = avoid.toLocaleString();
  el.total.textContent = mapped.toLocaleString();
  el.boundaryStatus.textContent = data.boundary ? 'Ready' : 'None';
  el.chip.textContent = mapped ? `${mapped.toLocaleString()} mapped` : 'No addresses';
  if (ready) {
    el.context.innerHTML = `<strong>${esc(hallLabel(data.hall))} — ${esc(data.hall.name || 'Kingdom Hall')}</strong><small>${esc(data.hall.address || 'Saved Hall location')} • ${esc(data.congregation)}<br>All saved addresses, avoid dots, boundaries, and territories in this set will remain associated with this Hall and congregation.</small>`;
  } else {
    el.context.innerHTML = '<strong>Select a Kingdom Hall and congregation</strong><small>Use Area Setup above before saving this address set.</small>';
  }
  el.review.disabled = !mapped;
  el.zoom.disabled = !mapped;
  el.boundary.disabled = !admin || !ready || !mapped;
  el.save.disabled = !admin || !ready || !data.houses.length;
  el.review.textContent = previewOpen ? 'Hide Address List' : 'Show Address List';
  el.preview.hidden = !previewOpen;
  renderSavedSets(data);
  if (previewOpen) renderAddressList(data);
  if (!mapped) setMessage('Load or add addresses, create territories, then select SAVE YOUR WORK.');
  else if (!ready) setMessage(`${mapped.toLocaleString()} addresses are mapped. Select their Kingdom Hall and congregation in Area Setup before saving.`, 'warning');
  else if (!data.boundary) setMessage(`${mapped.toLocaleString()} addresses are ready. SAVE YOUR WORK includes all loaded addresses and all created territories; no outer boundary is required.`, 'success');
  else setMessage(`${mapped.toLocaleString()} mapped addresses and ${data.territories.length} territories are ready. Select SAVE YOUR WORK to keep the complete workspace.`, 'success');
}
function togglePreview() {
  previewOpen = !previewOpen;
  refresh();
  if (previewOpen) el.preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function zoomToAddresses() {
  const points = validAddresses().map(house => [Number(house.lat), Number(house.lng)]);
  if (!points.length) return;
  map.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 17 });
}
function createHallBoundary() {
  if (!api.requireAdmin?.()) return;
  const data = context();
  if (!contextReady(data)) return api.toast?.('Select the Kingdom Hall and congregation in Area Setup first.', true);
  if (!validAddresses(data).length) return api.toast?.('Upload or add mapped addresses before creating the Hall boundary.', true);
  const padding = Math.max(.02, Math.min(2, Number(el.padding.value) || .12));
  const geometry = api.createBoundaryAroundAddresses?.(padding);
  if (geometry) {
    setMessage(`Editable Hall territory boundary created around ${validAddresses(data).length.toLocaleString()} mapped addresses with ${padding.toFixed(2)} mile padding. Use Edit Boundary in Area Setup to adjust it.`, 'success');
    refresh();
  }
}
async function saveAddressSet() {
  if (!api.requireAdmin?.()) return;
  const data = context();
  if (!contextReady(data)) return api.toast?.('Select the Kingdom Hall and congregation in Area Setup first.', true);
  if (!data.houses.length) return api.toast?.('Upload the ministry or avoid addresses before saving.', true);
  el.save.disabled = true;
  el.save.textContent = 'Saving Address Set…';
  try {
    const savedId = api.saveYourWork ? await api.saveYourWork() : await api.savePlan?.({
      addressSetMode: true,
      saveYourWork: true,
      successMessage: `${hallLabel(data.hall)} — ${data.congregation} address set saved with ${data.houses.length.toLocaleString()} mapped addresses, including ${data.houses.filter(house => house.avoid).length.toLocaleString()} avoid address${data.houses.filter(house => house.avoid).length === 1 ? '' : 'es'}.`
    });
    if (!savedId) {
      setMessage('The address set was not saved. Keep this page open, check the save message below, and try again.', 'error');
      return;
    }
    setMessage('All addresses and territories saved. Load your current work under Return to your territories. Earlier saves are kept separately in Backup.', 'success');
  } catch (error) {
    setMessage(`The address set was not saved: ${error?.message || 'Please try again.'}`, 'error');
  } finally {
    const message = el.message.textContent, state = el.message.dataset.state;
    el.save.textContent = 'SAVE YOUR WORK';
    refresh();
    setMessage(message, state);
  }
}
function loadSavedSet() {
  if (!api.requireAdmin?.()) return;
  const id = clean(el.saved.value);
  if (!id) return api.toast?.('Choose a saved address set first.', true);
  api.loadPlanRecord?.(id);
}
function wireEvents() {
  el.review.addEventListener('click', togglePreview);
  el.zoom.addEventListener('click', zoomToAddresses);
  el.boundary.addEventListener('click', createHallBoundary);
  el.save.addEventListener('click', saveAddressSet);
  el.load.addEventListener('click', loadSavedSet);
  el.search.addEventListener('input', () => renderAddressList());
  window.addEventListener('territory-planner:data', refresh);
}
async function waitForApi() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.createBoundaryAroundAddresses && candidate?.getSavedPlans) return candidate;
    await wait(50);
  }
  return null;
}
async function initialize() {
  api = await waitForApi();
  if (!api) return;
  map = api.getMap();
  injectUi();
  if (!bindElements()) return;
  wireEvents();
  refresh();
}

initialize();

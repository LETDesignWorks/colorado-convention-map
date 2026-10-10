const EXTRA_VERSION = 'territories-20261010-9';

let planner = null;
let plannerMap = null;
let renderTimer = null;
let searchText = '';
let selectedTerritoryId = '';

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function toast(message, error = false) {
  planner?.toast?.(message, error);
}
function validCoordinates(item) {
  if (planner?.validMapCoordinates) return planner.validMapCoordinates(item);
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}
function isUploadedAddress(house) {
  if (!house) return false;
  if (house.bulkImported || house.bulkBatchId) return true;
  if (Array.isArray(house.bulkBatchIds) && house.bulkBatchIds.some(Boolean)) return true;
  const source = clean(house.source).toLowerCase();
  const classification = clean(house.classification).toLowerCase();
  return source.includes('bulk address workset') ||
    source.includes('imported address workset') ||
    source.includes('prepared address list') ||
    source.includes('imported csv') ||
    source.includes('imported geojson') ||
    source.includes('uploaded address') ||
    classification === 'imported address workset' ||
    classification === 'imported';
}
function sourceLabel(house) {
  const text = `${house?.source || ''} ${house?.classification || ''}`.toLowerCase();
  if (/manual|map click|known missing|supplemental/.test(text)) return 'Manually added';
  if (/parcel|assessor|gis|address point|public address|county|statewide|composite/.test(text)) return 'Assessor / GIS';
  return clean(house?.source) || 'Additional mapped address';
}
function territoryMap() {
  return new Map((planner?.getTerritories?.() || []).map(territory => [String(territory.id), territory]));
}
function extraHomes() {
  const byTerritory = territoryMap();
  return (planner?.getHouses?.() || [])
    .filter(house => house.included !== false && !house.avoid && house.territoryId && !isUploadedAddress(house))
    .map(house => ({
      house,
      territory: byTerritory.get(String(house.territoryId)) || null,
      sourceType: sourceLabel(house)
    }))
    .sort((a, b) => {
      const territoryCompare = clean(a.territory?.name).localeCompare(clean(b.territory?.name), undefined, { numeric: true });
      if (territoryCompare) return territoryCompare;
      return clean(a.house.address).localeCompare(clean(b.house.address), undefined, { numeric: true });
    });
}

function injectStyles() {
  if (document.getElementById('territory-extra-address-styles')) return;
  const style = document.createElement('style');
  style.id = 'territory-extra-address-styles';
  style.textContent = `
    .territory-extra-card{border-color:#9fc7df;background:linear-gradient(145deg,#fff,#eef7fc)}
    .territory-extra-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
    .territory-extra-summary article{border:1px solid #d2e1eb;border-radius:11px;background:#fff;padding:9px}
    .territory-extra-summary span{display:block;font-size:8px;color:#718092;text-transform:uppercase;letter-spacing:.04em}
    .territory-extra-summary strong{display:block;margin-top:2px;font-size:16px;color:#0b5b9f}
    .territory-extra-controls{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:8px;margin:10px 0}
    .territory-extra-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
    .territory-extra-list{max-height:430px;overflow:auto;border:1px solid #d2e1eb;border-radius:11px;background:#fff}
    .territory-extra-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 10px;border-bottom:1px solid #e8eef3;cursor:pointer}
    .territory-extra-row:last-child{border-bottom:0}.territory-extra-row:hover{background:#f4f9fc}
    .territory-extra-number{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#6b7c8f;color:#fff;font-size:8px;font-weight:900}
    .territory-extra-row strong{display:block;color:#2d4358;font-size:9.5px;line-height:1.35}
    .territory-extra-row small{display:block;margin-top:2px;color:#738293;font-size:8px;line-height:1.35}
    .territory-extra-territory{display:inline-block;margin-top:4px;padding:3px 6px;border-radius:999px;background:#e7f2f9;color:#0b5b9f;font-size:7.5px;font-weight:900}
    .territory-extra-source{padding:4px 7px;border-radius:999px;background:#f1f3f5;color:#576879;font-size:7.5px;font-weight:800;white-space:nowrap}
    .territory-extra-empty{padding:16px;text-align:center;color:#718092;font-size:9px;line-height:1.5}
    .territory-extra-note{display:block;margin-top:8px;color:#6d7d8d;font-size:8.3px;line-height:1.45}
    @media(max-width:720px){.territory-extra-summary,.territory-extra-controls{grid-template-columns:1fr}.territory-extra-row{grid-template-columns:28px 1fr}.territory-extra-source{grid-column:2;justify-self:start}}
    @media print{.territory-extra-card{display:none!important}}
  `;
  document.head.appendChild(style);
}
function injectCard() {
  if (document.getElementById('territoryExtraAddressCard')) return true;
  const grouping = document.querySelector('.grouping-card');
  if (!grouping) return false;
  const card = document.createElement('section');
  card.id = 'territoryExtraAddressCard';
  card.className = 'card territory-extra-card';
  card.innerHTML = `
    <div class="card-heading">
      <div><span class="eyebrow">UPLOADED-LIST COMPARISON</span><h2>Homes added to territories beyond the uploaded list</h2></div>
      <span id="territoryExtraChip" class="count-chip">0 homes</span>
    </div>
    <p class="section-copy">This list automatically tracks assessor/GIS and manually added homes that have been assigned to a territory but were not part of any uploaded address file or prepared workset.</p>
    <div class="territory-extra-summary">
      <article><span>Additional homes</span><strong id="territoryExtraTotal">0</strong></article>
      <article><span>Territories affected</span><strong id="territoryExtraTerritories">0</strong></article>
      <article><span>Assessor / manual</span><strong id="territoryExtraSources">0 / 0</strong></article>
    </div>
    <div class="territory-extra-controls">
      <div class="field"><label for="territoryExtraSearch">Search address</label><input id="territoryExtraSearch" type="search" placeholder="Search the added-home list"></div>
      <div class="field"><label for="territoryExtraFilter">Territory</label><select id="territoryExtraFilter"><option value="">All territories</option></select></div>
    </div>
    <div class="territory-extra-actions">
      <button id="territoryExtraZoom" type="button" class="btn outline">Zoom to Listed Homes</button>
      <button id="territoryExtraCsv" type="button" class="btn outline">Download CSV</button>
    </div>
    <div id="territoryExtraList" class="territory-extra-list"><div class="territory-extra-empty">No additional homes have been assigned beyond the uploaded list.</div></div>
    <small class="territory-extra-note">The list is derived from the saved address source and current territory assignments. Removing a home from a territory removes it from this list; assigning another assessor or manually added home adds it automatically.</small>`;
  const leftover = document.getElementById('territoryLeftoverCard');
  (leftover || grouping).insertAdjacentElement('afterend', card);
  card.querySelector('#territoryExtraSearch')?.addEventListener('input', event => {
    searchText = clean(event.target.value).toLowerCase();
    renderList();
  });
  card.querySelector('#territoryExtraFilter')?.addEventListener('change', event => {
    selectedTerritoryId = clean(event.target.value);
    renderList();
  });
  card.querySelector('#territoryExtraZoom')?.addEventListener('click', zoomListedHomes);
  card.querySelector('#territoryExtraCsv')?.addEventListener('click', downloadCsv);
  return true;
}
function filteredEntries() {
  return extraHomes().filter(entry => {
    if (selectedTerritoryId && String(entry.house.territoryId) !== selectedTerritoryId) return false;
    if (!searchText) return true;
    return `${entry.house.address || ''} ${entry.territory?.name || ''} ${entry.sourceType} ${entry.house.source || ''}`.toLowerCase().includes(searchText);
  });
}
function updateTerritoryOptions(entries) {
  const select = document.getElementById('territoryExtraFilter');
  if (!select) return;
  const previous = selectedTerritoryId || select.value;
  const counts = new Map();
  entries.forEach(entry => {
    const id = String(entry.house.territoryId || '');
    if (!id) return;
    if (!counts.has(id)) counts.set(id, { name: entry.territory?.name || 'Unnamed territory', count: 0 });
    counts.get(id).count += 1;
  });
  const options = [...counts.entries()].sort((a, b) => clean(a[1].name).localeCompare(clean(b[1].name), undefined, { numeric: true }));
  select.innerHTML = '<option value="">All territories</option>' + options.map(([id, item]) => `<option value="${esc(id)}">${esc(item.name)} — ${item.count}</option>`).join('');
  if (previous && counts.has(previous)) select.value = previous;
  else { select.value = ''; selectedTerritoryId = ''; }
}
function renderList() {
  if (!injectCard()) return;
  const all = extraHomes();
  updateTerritoryOptions(all);
  const filtered = filteredEntries();
  const territoryCount = new Set(all.map(entry => String(entry.house.territoryId))).size;
  const assessorCount = all.filter(entry => entry.sourceType === 'Assessor / GIS').length;
  const manualCount = all.length - assessorCount;
  const chip = document.getElementById('territoryExtraChip');
  const total = document.getElementById('territoryExtraTotal');
  const territories = document.getElementById('territoryExtraTerritories');
  const sources = document.getElementById('territoryExtraSources');
  const list = document.getElementById('territoryExtraList');
  const zoom = document.getElementById('territoryExtraZoom');
  const csv = document.getElementById('territoryExtraCsv');
  if (chip) chip.textContent = `${all.length.toLocaleString()} home${all.length === 1 ? '' : 's'}`;
  if (total) total.textContent = all.length.toLocaleString();
  if (territories) territories.textContent = territoryCount.toLocaleString();
  if (sources) sources.textContent = `${assessorCount.toLocaleString()} / ${manualCount.toLocaleString()}`;
  if (zoom) zoom.disabled = !filtered.some(entry => validCoordinates(entry.house));
  if (csv) csv.disabled = !all.length;
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = `<div class="territory-extra-empty">${all.length ? 'No added homes match the current search or territory filter.' : 'No assessor/GIS or manually added homes are currently assigned beyond the uploaded address list.'}</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 2000).map((entry, index) => `
    <article class="territory-extra-row" data-extra-house-id="${esc(entry.house.id)}">
      <span class="territory-extra-number">${index + 1}</span>
      <div><strong>${esc(entry.house.address || 'Mapped address')}</strong><small>${esc(entry.house.source || entry.sourceType)}</small><span class="territory-extra-territory">${esc(entry.territory?.name || 'Unnamed territory')}</span></div>
      <span class="territory-extra-source">${esc(entry.sourceType)}</span>
    </article>`).join('') + (filtered.length > 2000 ? `<div class="territory-extra-empty">Showing the first 2,000 of ${filtered.length.toLocaleString()} homes. Download the CSV for the complete list.</div>` : '');
  list.querySelectorAll('[data-extra-house-id]').forEach(row => row.addEventListener('click', () => focusHouse(row.dataset.extraHouseId)));
}
function focusHouse(houseId) {
  const house = planner.getHouses().find(item => String(item.id) === String(houseId));
  if (!house || !validCoordinates(house)) return toast('This address does not currently have a usable map location.', true);
  plannerMap.setView([Number(house.lat), Number(house.lng)], Math.max(17, plannerMap.getZoom?.() || 17), { animate: true });
  const marker = planner.getHouseMarkers?.().get(house.id) || planner.getHouseMarkers?.().get(String(house.id));
  setTimeout(() => marker?.openPopup?.(), 250);
}
function zoomListedHomes() {
  const homes = filteredEntries().map(entry => entry.house).filter(validCoordinates);
  if (!homes.length) return toast('There are no mapped homes in the current list.');
  plannerMap.fitBounds(L.latLngBounds(homes.map(house => [Number(house.lat), Number(house.lng)])), { padding: [42, 42], maxZoom: 17 });
}
function downloadCsv() {
  const entries = extraHomes();
  if (!entries.length) return toast('There are no additional assigned homes to download.');
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['territory', 'address', 'source_type', 'source', 'latitude', 'longitude'],
    ...entries.map(entry => [entry.territory?.name || '', entry.house.address || '', entry.sourceType, entry.house.source || '', entry.house.lat ?? '', entry.house.lng ?? ''])
  ].map(row => row.map(quote).join(','));
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  const congregation = clean(planner.getSelectedCongregation?.() || 'congregation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'congregation';
  anchor.href = url;
  anchor.download = `${congregation}-homes-added-beyond-upload.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 900);
}
function scheduleRender(delay = 100) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderList, delay);
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getMap?.() && candidate?.getHouses?.() && candidate?.getTerritories?.()) { planner = candidate; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!planner) return;
  plannerMap = planner.getMap();
  injectStyles();
  injectCard();
  window.addEventListener('territory-planner:data', () => scheduleRender(90));
  document.addEventListener('click', event => {
    if (event.target.closest?.('#territoryExtraAddressCard')) return;
    if (event.target.closest?.('#assignSelectedButton,#newTerritoryButton,#autoGroupButton,#bulkGroup,#clearAllTerritoriesButton,#saveTerritoryBoundaryEditButton,#markAvoidButton,#restoreAvoidButton,[data-territory-delete],[data-territory-update-homes],[data-territory-reset]')) scheduleRender(160);
  }, true);
  [0, 180, 600, 1500, 3200].forEach(delay => setTimeout(renderList, delay));
  console.info(`Denver 2027 additional assigned-home tracker loaded (${EXTRA_VERSION}).`);
}

initialize();

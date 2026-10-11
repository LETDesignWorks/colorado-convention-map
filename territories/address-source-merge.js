const SOURCE_VERSION = 'territories-20261010-14';
const UPLOADED_COLOR = '#7952c7';
const UPLOADED_BORDER = '#4d2e8f';
const OFFICIAL_COLOR = '#6b7c8f';

let planner = null;
let plannerMap = null;
let applyTimer = null;
let scanTimer = null;
let scanBusy = false;

const clean = value => String(value ?? '').trim();

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
  const source = `${house.source || ''} ${house.classification || ''}`.toLowerCase();
  return source.includes('bulk address workset') ||
    source.includes('imported address workset') ||
    source.includes('prepared address list') ||
    source.includes('imported csv') ||
    source.includes('imported geojson') ||
    source.includes('uploaded address') ||
    source.includes('classification imported') ||
    clean(house.classification).toLowerCase() === 'imported';
}
function normalizedColor(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '');
}
function sourceCounts() {
  const houses = planner?.getHouses?.() || [];
  const mapped = houses.filter(house => validCoordinates(house));
  return {
    uploaded: mapped.filter(house => !house.avoid && isUploadedAddress(house)).length,
    official: mapped.filter(house => !house.avoid && !isUploadedAddress(house)).length,
    avoid: mapped.filter(house => house.avoid).length
  };
}
function placeAvoidAfterAssessor() {
  const card = document.getElementById('addressSourceMergeCard');
  const avoidCard = document.getElementById('avoidWorkflowCard');
  if (card && avoidCard && card.nextElementSibling !== avoidCard) {
    card.insertAdjacentElement('afterend', avoidCard);
  }
}
function syncCardVisibility() {
  const bulkCard = document.getElementById('bulkAddressCard');
  const card = document.getElementById('addressSourceMergeCard');
  if (!bulkCard || !card) return;
  card.classList.toggle('territory-workflow-hidden', bulkCard.classList.contains('territory-workflow-hidden'));
  placeAvoidAfterAssessor();
}
function updateCounts() {
  const counts = sourceCounts();
  const uploaded = document.getElementById('sourceUploadedCount');
  const official = document.getElementById('sourceOfficialCount');
  const avoid = document.getElementById('sourceAvoidCount');
  if (uploaded) uploaded.textContent = counts.uploaded.toLocaleString();
  if (official) official.textContent = counts.official.toLocaleString();
  if (avoid) avoid.textContent = counts.avoid.toLocaleString();
  const button = document.getElementById('addAssessorAddressesButton');
  if (button && !scanBusy) { button.disabled = false; button.classList.remove('admin-control'); button.title = counts.uploaded ? 'Add official assessor/GIS addresses around the uploaded list.' : 'Select the button to see what is needed before the scan can begin.'; }
  syncCardVisibility();
}
function applySourceColors() {
  if (!planner?.getHouses || !planner?.getHouseMarkers) return;
  const housesById = new Map(planner.getHouses().map(house => [String(house.id), house]));
  planner.getHouseMarkers().forEach((marker, id) => {
    const house = housesById.get(String(id));
    if (!house || !validCoordinates(house) || house.avoid || house.included === false || house.territoryId) return;
    const currentFill = normalizedColor(marker?.options?.fillColor);
    if (currentFill === '#ffbd00' || currentFill === 'rgb(255,189,0)') return;
    const uploaded = isUploadedAddress(house);
    marker.setStyle?.({
      color: uploaded ? UPLOADED_BORDER : '#ffffff',
      weight: uploaded ? 2.2 : 1.4,
      fillColor: uploaded ? UPLOADED_COLOR : OFFICIAL_COLOR,
      fillOpacity: uploaded ? 0.96 : 0.90,
      dashArray: null
    });
    marker.setRadius?.(uploaded ? 5.4 : 4.1);
    if (uploaded) marker.bringToFront?.();
  });
  updateCounts();
}
function scheduleApplyColors(delay = 70) {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applySourceColors, delay);
}

function injectLegend() {
  const legend = document.querySelector('.map-legend');
  if (!legend || document.getElementById('uploadedSourceLegend')) return;
  const original = [...legend.children].find(row => /included house or address/i.test(row.textContent || ''));
  if (original) original.hidden = true;
  const uploaded = document.createElement('div');
  uploaded.id = 'uploadedSourceLegend';
  uploaded.innerHTML = '<span class="legend-symbol uploaded-source-symbol">•</span>Uploaded-file address — unassigned';
  const official = document.createElement('div');
  official.id = 'officialSourceLegend';
  official.innerHTML = '<span class="legend-symbol official-source-symbol">•</span>Assessor/GIS or manually added address';
  const anchor = original || legend.children[1] || null;
  legend.insertBefore(uploaded, anchor);
  legend.insertBefore(official, anchor);
}
function injectStyles() {
  if (document.getElementById('territory-address-source-styles')) return;
  const style = document.createElement('style');
  style.id = 'territory-address-source-styles';
  style.textContent = `
    .uploaded-source-symbol{background:${UPLOADED_COLOR}!important;border-color:${UPLOADED_BORDER}!important;color:#fff!important}
    .official-source-symbol{background:${OFFICIAL_COLOR}!important;border-color:#fff!important;color:#fff!important}
    .address-source-merge-card{border-color:#c7b8e8;background:linear-gradient(145deg,#fff,#f7f4fd)}
    .address-source-key{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
    .address-source-key article{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;border:1px solid #d8d0e9;border-radius:11px;background:#fff;padding:9px}
    .address-source-dot{width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #b8c2cc}
    .address-source-dot.uploaded{background:${UPLOADED_COLOR};box-shadow:0 0 0 2px ${UPLOADED_BORDER}}
    .address-source-dot.official{background:${OFFICIAL_COLOR}}
    .address-source-key strong{display:block;font-size:9.5px;color:#2f4358}.address-source-key small{display:block;font-size:8px;color:#718092;margin-top:2px}
    .address-source-key b{font-size:14px;color:#0b5b9f}
    .address-source-actions{display:grid;grid-template-columns:minmax(0,.55fr) minmax(0,1.45fr);gap:9px;align-items:end;margin-top:10px}
    .address-source-message{display:block;margin-top:8px;padding:8px 9px;border:1px solid #d8dfe7;border-radius:9px;background:#fff;font-size:8.5px;line-height:1.45;color:#5b6d80}
    .address-source-message[data-state="working"]{background:#eef6ff;color:#174f7b}.address-source-message[data-state="success"]{background:#eef9f3;color:#236146}.address-source-message[data-state="error"]{background:#fff2f1;color:#8c312a}
    @media(max-width:720px){.address-source-key,.address-source-actions{grid-template-columns:1fr}}
    @media print{.address-source-merge-card{display:none!important}}
  `;
  document.head.appendChild(style);
}
function injectCard() {
  if (document.getElementById('addressSourceMergeCard')) { placeAvoidAfterAssessor(); ensureAssessorFallbackUi(); return true; }
  const bulkCard = document.getElementById('bulkAddressCard');
  const avoidCard = document.getElementById('avoidWorkflowCard');
  if (!bulkCard || !avoidCard) return false;
  const card = document.createElement('section');
  card.id = 'addressSourceMergeCard';
  card.className = 'card address-source-merge-card';
  card.innerHTML = `
    <div class="card-heading">
      <div><span class="eyebrow">OPTIONAL — COMPLETE THE ADDRESS MAP</span><h2>Add the remaining assessor / GIS addresses</h2></div>
      <span class="private-chip">Administrator only</span>
    </div>
    <p class="section-copy">Uploaded-file homes stay purple while they are unassigned. Official assessor/GIS or manually added homes stay gray. Once a home is placed in a territory, its territory color takes over.</p>
    <div class="address-source-key">
      <article><span class="address-source-dot uploaded"></span><div><strong>Uploaded-file addresses</strong><small>Purple until assigned</small></div><b id="sourceUploadedCount">0</b></article>
      <article><span class="address-source-dot official"></span><div><strong>Assessor/GIS addresses</strong><small>Gray until assigned</small></div><b id="sourceOfficialCount">0</b></article>
    </div>
    <div class="address-source-actions">
      <div class="field"><label for="assessorBoundaryPadding">Automatic boundary padding</label><input id="assessorBoundaryPadding" type="number" min="0.02" max="3" step="0.05" value="0.35"><small>Miles around the uploaded address set when no outer boundary exists.</small></div>
      <button id="addAssessorAddressesButton" type="button" class="btn primary admin-control">Add Assessor / GIS Addresses</button>
    </div>
    <small id="addressSourceMergeMessage" class="address-source-message" data-state="waiting">The scan preserves the uploaded workset, avoid addresses, and existing territories. If no outer boundary exists, an editable Hall boundary will be created first. Edit that boundary and run the scan again whenever you need a larger or smaller search area.</small>
    <small style="display:block;margin-top:6px;color:#7a8794;font-size:8px">Current avoid addresses: <strong id="sourceAvoidCount">0</strong>. After the scan, save the Kingdom Hall address set to retain the merged addresses.</small>`;
  bulkCard.insertAdjacentElement('afterend', card);
  placeAvoidAfterAssessor();
  const assessorButton = document.getElementById('addAssessorAddressesButton');
  if (assessorButton) assessorButton.dataset.responsiveScannerOnly = 'true';
  ensureAssessorFallbackUi();
  return true;
}
function setMessage(message, state = 'waiting') {
  const element = document.getElementById('addressSourceMergeMessage');
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}
function uncheckWorksetFocus() {
  const focus = document.getElementById('bulkFocus');
  if (!focus?.checked) return;
  focus.checked = false;
  focus.dispatchEvent(new Event('change', { bubbles: true }));
}
function finishScan(startOfficialCount, errorMessage = '') {
  clearInterval(scanTimer);
  scanTimer = null;
  scanBusy = false;
  const button = document.getElementById('addAssessorAddressesButton');
  if (button) button.textContent = 'Add Assessor / GIS Addresses';
  scheduleApplyColors(80);
  setTimeout(() => {
    const counts = sourceCounts();
    const added = Math.max(0, counts.official - startOfficialCount);
    if (errorMessage) setMessage(errorMessage, 'error');
    else setMessage(`${added.toLocaleString()} new assessor/GIS address${added === 1 ? '' : 'es'} added. The map now shows ${counts.uploaded.toLocaleString()} uploaded-file addresses in purple and ${counts.official.toLocaleString()} assessor/GIS or manually added addresses in gray. Review the map, then save the Kingdom Hall address set.`, 'success');
    updateCounts();
  }, 180);
}
function watchExistingScan(gapButton, startOfficialCount) {
  let sawBusy = gapButton.disabled;
  const startedAt = Date.now();
  scanTimer = setInterval(() => {
    sawBusy = sawBusy || gapButton.disabled;
    if (sawBusy && !gapButton.disabled) {
      finishScan(startOfficialCount);
      return;
    }
    if (!sawBusy && Date.now() - startedAt > 2500) {
      finishScan(startOfficialCount, 'The assessor/GIS scan did not start. Confirm administrator sign-in and try again.');
      return;
    }
    if (Date.now() - startedAt > 15 * 60 * 1000) {
      finishScan(startOfficialCount, 'The assessor/GIS scan took longer than expected. The addresses already added remain on the map; review the results and run the scan again if needed.');
    }
  }, 350);
}
async function addAssessorAddresses() {
  if (scanBusy || !planner?.requireAdmin?.()) return;
  const hall = planner.getSelectedHall?.();
  const congregation = clean(planner.getSelectedCongregation?.());
  if (!hall || !congregation) return toast('Select the Kingdom Hall and congregation before adding assessor/GIS addresses.', true);
  const uploaded = planner.getHouses().filter(house => isUploadedAddress(house) && validCoordinates(house));
  if (!uploaded.length) return toast('Upload and map the prepared address file first.', true);
  const gapButton = document.getElementById('gapFillButton');
  if (!gapButton) return toast('The official address-scan control is not available. Refresh the page and try again.', true);

  scanBusy = true;
  const button = document.getElementById('addAssessorAddressesButton');
  if (button) { button.disabled = true; button.textContent = 'Preparing Address Scan…'; }
  const startOfficialCount = sourceCounts().official;
  try {
    if (!planner.getBoundaryGeometry?.()) {
      const padding = Math.max(0.02, Math.min(3, Number(document.getElementById('assessorBoundaryPadding')?.value) || 0.35));
      setMessage(`Creating an editable Hall boundary around ${uploaded.length.toLocaleString()} uploaded addresses with ${padding.toFixed(2)} mile padding…`, 'working');
      const geometry = planner.createBoundaryAroundAddresses?.(padding);
      if (!geometry) throw new Error('An editable outer boundary could not be created from the uploaded addresses.');
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    uncheckWorksetFocus();
    setMessage('Scanning the selected Hall boundary and merging unique official assessor/GIS address points. Existing uploaded homes and territory work will not be replaced…', 'working');
    if (button) button.textContent = 'Scanning Assessor / GIS…';
    gapButton.click();
    watchExistingScan(gapButton, startOfficialCount);
  } catch (error) {
    finishScan(startOfficialCount, error?.message || 'The assessor/GIS addresses could not be added.');
    toast(error?.message || 'The assessor/GIS addresses could not be added.', true);
  }
}


function ensureAssessorFallbackUi() {
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return false;

  const padding = document.getElementById('assessorBoundaryPadding');
  if (padding) {
    padding.max = '2';
    const value = Number(padding.value);
    if (!Number.isFinite(value) || value < 0.02 || value > 2) padding.value = '0.35';
  }

  const actions = card.querySelector('.address-source-actions');
  if (actions && !document.getElementById('directAssessorLimit')) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
      <label for="directAssessorLimit">Official records per pass</label>
      <select id="directAssessorLimit">
        <option value="50">50 — safest</option>
        <option value="100" selected>100 — recommended</option>
        <option value="250">250 — faster computer</option>
      </select>
      <small>Each click checks one small page of official records and then stops. Select the button again to continue.</small>`;
    actions.insertBefore(field, actions.lastElementChild || null);
  }

  let ready = document.getElementById('assessorScannerReady');
  if (!ready) {
    ready = document.createElement('small');
    ready.id = 'assessorScannerReady';
    ready.style.cssText = 'display:block;margin:7px 0;padding:7px 9px;border-radius:9px;background:#eef9f3;color:#246147;font-size:8.5px;font-weight:800';
    ready.textContent = 'Assessor/GIS scanner v14 ready — selecting the blue button should change its text immediately.';
    const message = document.getElementById('addressSourceMergeMessage');
    if (message) message.insertAdjacentElement('beforebegin', ready);
    else card.appendChild(ready);
  }

  const button = document.getElementById('addAssessorAddressesButton');
  if (!button) return false;
  button.disabled = false;
  button.classList.remove('admin-control');
  button.dataset.assessorFallbackVersion = 'territories-20261010-14';

  if (button.dataset.assessorFallbackBound !== 'true') {
    button.dataset.assessorFallbackBound = 'true';
    button.addEventListener('click', async event => {
      if (button.dataset.directScannerVersion) return;
      event.preventDefault();
      event.stopPropagation();
      button.textContent = 'Loading Assessor / GIS Scanner…';
      button.setAttribute('aria-busy', 'true');
      setMessage('The blue button was selected. Loading the direct assessor/GIS scanner now…', 'working');
      try {
        const module = await import('./assessor-scan-direct.js?v=territories-20261010-14');
        const runner = module.startDirectScan || module.runDirectScan || globalThis.__denverDirectAssessorScan?.run;
        if (typeof runner !== 'function') throw new Error('The direct scanner did not expose a start function.');
        await runner();
      } catch (error) {
        console.error('Assessor fallback could not start.', error);
        button.textContent = 'Add Assessor / GIS Addresses';
        button.removeAttribute('aria-busy');
        setMessage(`The scanner could not start: ${error?.message || 'Unknown error'}`, 'error');
        toast(`The assessor/GIS scanner could not start: ${error?.message || 'Unknown error'}`, true);
      }
    });
  }

  if (!button._denverEnableObserver) {
    button._denverEnableObserver = new MutationObserver(() => {
      if (button.getAttribute('aria-busy') !== 'true' && button.disabled) button.disabled = false;
    });
    button._denverEnableObserver.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  }

  placeAvoidAfterAssessor();
  return true;
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getMap?.() && candidate?.getHouses?.() && candidate?.getHouseMarkers?.()) { planner = candidate; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!planner) return;
  plannerMap = planner.getMap();
  injectStyles();
  ensureAssessorFallbackUi();
  injectLegend();

  for (let index = 0; index < 160; index += 1) {
    if (injectCard()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  plannerMap?.on?.('moveend zoomend', () => scheduleApplyColors(90));
  window.addEventListener('territory-planner:data', () => scheduleApplyColors(90));
  document.addEventListener('click', event => {
    if (event.target.closest?.('#addAssessorAddressesButton')) return;
    scheduleApplyColors(120);
  }, true);
  [0, 120, 450, 1200, 2800].forEach(delay => setTimeout(() => {
    injectLegend();
    injectCard();
    ensureAssessorFallbackUi();
    scheduleApplyColors(20);
  }, delay));
  console.info(`Denver 2027 uploaded/assessor address source colors loaded (${SOURCE_VERSION}).`);
}

initialize();

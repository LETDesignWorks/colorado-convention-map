const FULL_BOUNDARY_VERSION = 'territories-20261011-18';
const MAX_AUTOMATIC_PAGES = 500;
const PAGE_DELAY_MS = 140;

let fullBoundaryRunning = false;
let cancelFullBoundary = false;
let refreshTimer = null;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const clean = value => String(value ?? '').trim();

function plannerApi() {
  return globalThis.__denverTerritoryPlannerAPI || null;
}

function scannerApi() {
  return globalThis.__denverDirectAssessorScan || null;
}

function messageElement() {
  return document.getElementById('addressSourceMergeMessage');
}

function setMessage(message, state = 'waiting') {
  const element = messageElement();
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function removeNearbyFilter() {
  document.getElementById('assessorNeighborControls')?.remove();
  document.getElementById('assessorNeighborReview')?.remove();
  document.getElementById('assessor-neighbor-styles')?.remove();
}

function updateUi() {
  removeNearbyFilter();
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return false;

  const heading = card.querySelector('h2');
  if (heading) heading.textContent = 'Add every assessor / GIS address inside the boundary';

  const copy = card.querySelector('.section-copy');
  if (copy) {
    copy.textContent = 'One scan now checks the complete editable Hall boundary and keeps every unique official address point inside it. Uploaded-file addresses remain purple, assessor/GIS addresses remain teal until assigned, and duplicates are skipped.';
  }

  const limit = document.getElementById('directAssessorLimit');
  if (limit) {
    limit.value = '250';
    const field = limit.closest('.field');
    const label = field?.querySelector('label');
    const note = field?.querySelector('small');
    if (label) label.textContent = 'Official records per request';
    if (note) note.textContent = 'The planner automatically continues through all official pages. A smaller request is gentler on the browser; 250 is recommended.';
  }

  const restart = document.getElementById('directAssessorRestart');
  if (restart) restart.textContent = 'Restart Full Boundary Scan';

  const button = document.getElementById('addAssessorAddressesButton');
  if (button && !fullBoundaryRunning) {
    button.textContent = 'Add Every Address Inside Boundary';
    button.disabled = false;
    button.dataset.fullBoundaryVersion = FULL_BOUNDARY_VERSION;
  }

  if (!document.getElementById('fullBoundaryModeNotice')) {
    const notice = document.createElement('small');
    notice.id = 'fullBoundaryModeNotice';
    notice.style.cssText = 'display:block;margin:8px 0;padding:8px 9px;border:1px solid #b9d9d7;border-left:4px solid #16a6a1;border-radius:9px;background:#f1fbfa;color:#456968;font-size:8.5px;line-height:1.45';
    notice.textContent = 'Complete-boundary mode: every valid official address record inside the boundary will be added, including records not classified as residential. Use Include / Exclude afterward when a business, vacant property, or other location should not be used.';
    const actions = card.querySelector('.address-source-actions');
    if (actions) actions.insertAdjacentElement('afterend', notice);
    else card.appendChild(notice);
  }

  return true;
}

function scanStatus() {
  const element = messageElement();
  const text = clean(element?.textContent).toLowerCase();
  const state = clean(element?.dataset?.state).toLowerCase();
  return {
    text,
    state,
    complete: text.includes('scan complete') || text.includes('already reached the end'),
    failed: state === 'error' || text.includes('scan stopped') || text.includes('official address scan stopped'),
    canceled: text.includes('canceled') || text.includes('canceling')
  };
}

function setMainButton(text, busy) {
  const button = document.getElementById('addAssessorAddressesButton');
  if (!button) return;
  button.textContent = text;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function runEveryAddressInsideBoundary() {
  if (fullBoundaryRunning) return;

  const planner = plannerApi();
  const scanner = scannerApi();
  if (!planner || !scanner?.run) {
    setMessage('The complete-boundary scanner is still loading. Wait a moment and select the button again.', 'error');
    return;
  }
  if (!planner.isAdmin?.()) {
    planner.requireAdmin?.();
    setMessage('Administrator sign-in is required. Sign in, then select Add Every Address Inside Boundary again.', 'error');
    return;
  }
  if (!planner.getSelectedHall?.() || !clean(planner.getSelectedCongregation?.())) {
    setMessage('Select the Kingdom Hall or meeting point and congregation before adding all boundary addresses.', 'error');
    planner.toast?.('Select the Kingdom Hall and congregation first.', true);
    return;
  }

  fullBoundaryRunning = true;
  cancelFullBoundary = false;

  try {
    removeNearbyFilter();
    const residentialOnly = document.getElementById('residentialOnly');
    if (residentialOnly?.checked) {
      residentialOnly.checked = false;
      residentialOnly.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const limit = document.getElementById('directAssessorLimit');
    if (limit) limit.value = '250';

    document.getElementById('directAssessorRestart')?.click();
    await sleep(80);

    setMessage('Starting at the first official record and automatically checking every page inside the editable Hall boundary. Duplicate addresses will be skipped.', 'working');
    setMainButton('Scanning Every Address Inside Boundary…', true);

    let page = 0;
    let completed = false;
    let failed = false;

    while (!cancelFullBoundary && page < MAX_AUTOMATIC_PAGES) {
      page += 1;
      setMainButton(`Scanning Complete Boundary — Request ${page.toLocaleString()}…`, true);
      await scanner.run();
      await sleep(PAGE_DELAY_MS);

      const status = scanStatus();
      if (status.canceled) break;
      if (status.failed) {
        failed = true;
        break;
      }
      if (status.complete) {
        completed = true;
        break;
      }

      setMessage(`Complete-boundary scan is continuing automatically. ${page.toLocaleString()} official request${page === 1 ? '' : 's'} completed so far…`, 'working');
      await sleep(PAGE_DELAY_MS);
    }

    if (cancelFullBoundary) {
      setMessage('The complete-boundary scan was canceled. Every address already added remains on the map.', 'warning');
      planner.toast?.('Complete-boundary assessor scan canceled.');
    } else if (failed) {
      planner.toast?.('The complete-boundary scan stopped because the official GIS service returned an error.', true);
    } else if (completed) {
      setMessage('Complete-boundary scan finished. Every unique official address point returned inside the editable boundary has been added. Review the teal addresses, then save the Kingdom Hall address set.', 'success');
      planner.toast?.('Every available assessor/GIS address inside the boundary has been added.');
    } else {
      setMessage(`The scan reached the ${MAX_AUTOMATIC_PAGES.toLocaleString()}-request safety limit. Addresses already added remain on the map. Use a smaller boundary or select the button again to continue.`, 'warning');
      planner.toast?.('The complete-boundary scan reached its safety limit.', true);
    }
  } finally {
    fullBoundaryRunning = false;
    setMainButton('Add Every Address Inside Boundary', false);
    updateUi();
  }
}

function bindDelegatedControls() {
  if (document.documentElement.dataset.fullBoundaryScannerVersion === FULL_BOUNDARY_VERSION) return;
  document.documentElement.dataset.fullBoundaryScannerVersion = FULL_BOUNDARY_VERSION;

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#addAssessorAddressesButton');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void runEveryAddressInsideBoundary();
  }, true);

  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#directAssessorCancel')) return;
    cancelFullBoundary = true;
  }, true);
}

function scheduleUiRefresh(delay = 80) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(updateUi, delay);
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    if (plannerApi()?.getHouses?.() && scannerApi()?.run) break;
    await sleep(50);
  }

  bindDelegatedControls();
  for (let index = 0; index < 240; index += 1) {
    if (updateUi()) break;
    await sleep(50);
  }

  window.addEventListener('territory-planner:data', () => scheduleUiRefresh(80));
  [200, 700, 1800, 3500].forEach(delay => setTimeout(updateUi, delay));
  setMessage('Ready. Select Add Every Address Inside Boundary to scan all official pages automatically. The nearby-address restriction has been removed.', 'waiting');
  console.info(`Denver 2027 full-boundary assessor runner loaded (${FULL_BOUNDARY_VERSION}).`);
}

globalThis.__denverFullBoundaryAssessor = Object.freeze({
  version: FULL_BOUNDARY_VERSION,
  run: runEveryAddressInsideBoundary,
  refresh: updateUi
});

export { runEveryAddressInsideBoundary, updateUi };

initialize();

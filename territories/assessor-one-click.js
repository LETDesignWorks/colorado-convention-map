const ONE_CLICK_VERSION = 'territories-20261011-19';

let planner = null;
let cardObserver = null;
let refreshTimer = null;

const clean = value => String(value ?? '').trim();

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function removeRequestSizeControl() {
  const select = document.getElementById('directAssessorLimit');
  const field = select?.closest('.field');
  if (field) field.remove();

  document.querySelectorAll('[for="directAssessorLimit"], [for="responsiveAssessorLimit"]').forEach(label => {
    label.closest('.field')?.remove();
  });
}

function updateOneClickUi() {
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return false;

  removeRequestSizeControl();
  document.getElementById('assessorNeighborControls')?.remove();
  document.getElementById('assessorNeighborReview')?.remove();

  setText(card.querySelector('h2'), 'Fill the boundary with all assessor / GIS addresses');
  setText(
    card.querySelector('.section-copy'),
    'Select one button and the planner will continue automatically until it has checked the complete editable Hall boundary. Every unique official address inside the boundary will be added. Uploaded-file addresses remain purple, assessor/GIS addresses remain teal until assigned, and duplicates are skipped.'
  );

  const button = document.getElementById('addAssessorAddressesButton');
  if (button && button.getAttribute('aria-busy') !== 'true') {
    setText(button, 'Fill Boundary with All Addresses');
    button.disabled = !planner?.isAdmin?.() || !(planner?.getHouses?.() || []).some(house => planner?.validMapCoordinates?.(house));
  }

  const restart = document.getElementById('directAssessorRestart');
  setText(restart, 'Start Full Boundary Scan Over');

  const cancel = document.getElementById('directAssessorCancel');
  if (cancel) setText(cancel, 'Cancel Full Boundary Scan');

  const progressText = document.getElementById('directAssessorProgressText');
  if (progressText && /preparing scan/i.test(clean(progressText.textContent))) {
    setText(progressText, 'Preparing the complete boundary scan…');
  }

  let notice = document.getElementById('fullBoundaryModeNotice');
  if (!notice) {
    notice = document.createElement('small');
    notice.id = 'fullBoundaryModeNotice';
    const actions = card.querySelector('.address-source-actions');
    if (actions) actions.insertAdjacentElement('afterend', notice);
    else card.appendChild(notice);
  }
  notice.style.cssText = 'display:block;margin:8px 0;padding:9px 10px;border:1px solid #b9d9d7;border-left:4px solid #16a6a1;border-radius:9px;background:#f1fbfa;color:#456968;font-size:9px;line-height:1.5';
  setText(
    notice,
    'One-click complete-boundary mode is active. The planner handles the scan in protected background batches so the browser stays responsive, but you do not need to choose a batch size or press the button repeatedly. Leave this page open until the completion message appears.'
  );

  if (!document.getElementById('assessor-one-click-styles')) {
    const style = document.createElement('style');
    style.id = 'assessor-one-click-styles';
    style.textContent = `
      #addressSourceMergeCard .address-source-actions{grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr)!important}
      #addAssessorAddressesButton{min-height:52px;font-size:12px}
      @media(max-width:720px){#addressSourceMergeCard .address-source-actions{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(style);
  }

  attachCardObserver(card);
  return true;
}

function scheduleRefresh(delay = 50) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(updateOneClickUi, delay);
}

function attachCardObserver(card) {
  if (cardObserver?._target === card) return;
  cardObserver?.disconnect();
  cardObserver = new MutationObserver(() => scheduleRefresh(25));
  cardObserver._target = card;
  cardObserver.observe(card, { childList: true, subtree: true });
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    planner = globalThis.__denverTerritoryPlannerAPI || null;
    if (planner?.getHouses?.()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  for (let index = 0; index < 240; index += 1) {
    if (updateOneClickUi()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  window.addEventListener('territory-planner:data', () => scheduleRefresh(40));
  [200, 700, 1600, 3200].forEach(delay => setTimeout(updateOneClickUi, delay));

  console.info(`Denver 2027 one-click full-boundary assessor UI loaded (${ONE_CLICK_VERSION}).`);
}

globalThis.__denverAssessorOneClick = Object.freeze({
  version: ONE_CLICK_VERSION,
  refresh: updateOneClickUi
});

export { updateOneClickUi };

initialize();

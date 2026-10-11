const NEIGHBOR_VERSION = 'territories-20261011-17';
const DEFAULT_NEARBY_FEET = 250;
const EARTH_RADIUS_FEET = 20902231;

let planner = null;
let pendingScan = null;
let scanWatcher = null;
let refreshTimer = null;
let processing = false;

const clean = value => String(value ?? '').trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

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
    clean(house.classification).toLowerCase() === 'imported';
}

function isOfficialAddress(house) {
  return Boolean(house && !house.avoid && !isUploadedAddress(house) && validCoordinates(house));
}

function nearbyOnlyEnabled() {
  return document.getElementById('assessorNearbyOnly')?.checked !== false;
}

function nearbyFeet() {
  const value = Number(document.getElementById('assessorNearbyFeet')?.value);
  if (!Number.isFinite(value)) return DEFAULT_NEARBY_FEET;
  return Math.max(0, Math.min(5280, value));
}

function haversineFeet(a, b) {
  const lat1 = Number(a?.lat) * Math.PI / 180;
  const lat2 = Number(b?.lat) * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLng = (Number(b?.lng) - Number(a?.lng)) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_FEET * Math.asin(Math.min(1, Math.sqrt(Math.max(0, value))));
}

function nearestUploadedAddress(record, uploaded) {
  let nearest = null;
  let feet = Number.POSITIVE_INFINITY;
  for (const candidate of uploaded) {
    const distance = haversineFeet(record, candidate);
    if (distance < feet) {
      feet = distance;
      nearest = candidate;
    }
  }
  return nearest ? { house: nearest, feet } : null;
}

function stripNeighborAnnotation(source = '') {
  return clean(source).replace(/\s*•\s*\d[\d,]*\s*ft\s*from\s*uploaded\s*address\s*:.*$/i, '').trim();
}

function annotateNeighbor(record, result) {
  if (!record || !result?.house || !Number.isFinite(result.feet)) return;
  const roundedFeet = Math.max(0, Math.round(result.feet));
  record.neighborUploadedAddress = result.house.address || result.house.baseAddress || '';
  record.neighborDistanceFeet = roundedFeet;
  const baseSource = stripNeighborAnnotation(record.source || 'Official assessor/GIS address');
  record.source = `${baseSource} • ${roundedFeet.toLocaleString()} ft from uploaded address: ${record.neighborUploadedAddress}`;
}

function pairForOfficial(record, uploaded) {
  if (!record || !uploaded.length) return null;
  const result = nearestUploadedAddress(record, uploaded);
  if (result) annotateNeighbor(record, result);
  return result;
}

function resetOfficialScanPosition() {
  const restart = document.getElementById('directAssessorRestart');
  if (restart) restart.click();
}

function injectStyles() {
  if (document.getElementById('assessor-neighbor-styles')) return;
  const style = document.createElement('style');
  style.id = 'assessor-neighbor-styles';
  style.textContent = `
    .assessor-neighbor-controls{margin:10px 0;padding:10px;border:1px solid #b9d9d7;border-left:4px solid #16a6a1;border-radius:11px;background:#f1fbfa}
    .assessor-neighbor-controls .field{margin:8px 0 0}
    .assessor-neighbor-controls strong{display:block;font-size:10px;color:#244b4a}
    .assessor-neighbor-controls small{display:block;margin-top:4px;font-size:8.5px;line-height:1.4;color:#5e7776}
    .assessor-neighbor-review{margin-top:10px;border:1px solid #cfe1e0;border-radius:11px;background:#fff;overflow:hidden}
    .assessor-neighbor-review[hidden]{display:none!important}
    .assessor-neighbor-review-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;background:#f4faf9;border-bottom:1px solid #dce9e8}
    .assessor-neighbor-review-header strong{font-size:9.5px;color:#264e4c}.assessor-neighbor-review-header span{font-size:8px;font-weight:850;color:#0b6f6b}
    .assessor-neighbor-list{max-height:260px;overflow:auto}
    .assessor-neighbor-row{display:grid;grid-template-columns:minmax(0,1fr) 22px minmax(0,1fr) auto;gap:7px;align-items:center;padding:8px 10px;border-bottom:1px solid #edf2f2;font-size:8.5px;color:#43596a}
    .assessor-neighbor-row:last-child{border-bottom:0}
    .assessor-neighbor-row strong{font-size:8.8px;color:#1f3e50}.assessor-neighbor-arrow{font-weight:900;color:#16a6a1;text-align:center}.assessor-neighbor-distance{white-space:nowrap;font-weight:850;color:#0b6f6b}
    .assessor-neighbor-empty{padding:12px;text-align:center;font-size:8.5px;color:#6d7d86}
    @media(max-width:720px){.assessor-neighbor-row{grid-template-columns:1fr auto}.assessor-neighbor-arrow{display:none}.assessor-neighbor-uploaded{grid-column:1/-1;color:#6a7884}}
    @media print{.assessor-neighbor-controls,.assessor-neighbor-review{display:none!important}}
  `;
  document.head.appendChild(style);
}

function injectControls() {
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return false;
  if (!document.getElementById('assessorNeighborControls')) {
    const controls = document.createElement('div');
    controls.id = 'assessorNeighborControls';
    controls.className = 'assessor-neighbor-controls';
    controls.innerHTML = `
      <label class="check-row"><input id="assessorNearbyOnly" type="checkbox" checked> <strong>Only add assessor/GIS addresses that are next to an uploaded address</strong></label>
      <div class="field">
        <label for="assessorNearbyFeet">Maximum distance from an uploaded address</label>
        <select id="assessorNearbyFeet">
          <option value="100">100 feet — immediate neighbor</option>
          <option value="250" selected>250 feet — recommended</option>
          <option value="500">500 feet — nearby homes</option>
          <option value="1000">1,000 feet — wider neighborhood</option>
          <option value="0">Entire editable Hall boundary</option>
        </select>
        <small>The scan can still search the complete editable boundary, but only official addresses within this distance of at least one purple uploaded home will remain on the map. Change the distance to broaden or tighten the search.</small>
      </div>`;
    const actions = card.querySelector('.address-source-actions');
    if (actions) actions.insertAdjacentElement('beforebegin', controls);
    else card.appendChild(controls);

    const changed = () => {
      resetOfficialScanPosition();
      scheduleReview(50);
    };
    document.getElementById('assessorNearbyOnly')?.addEventListener('change', changed);
    document.getElementById('assessorNearbyFeet')?.addEventListener('change', changed);
  }

  if (!document.getElementById('assessorNeighborReview')) {
    const review = document.createElement('div');
    review.id = 'assessorNeighborReview';
    review.className = 'assessor-neighbor-review';
    review.hidden = true;
    review.innerHTML = `
      <div class="assessor-neighbor-review-header"><strong>Assessor/GIS homes paired with the closest uploaded address</strong><span id="assessorNeighborReviewCount">0</span></div>
      <div id="assessorNeighborList" class="assessor-neighbor-list"></div>`;
    const message = document.getElementById('addressSourceMergeMessage');
    if (message) message.insertAdjacentElement('afterend', review);
    else card.appendChild(review);
  }
  return true;
}

function updateReview() {
  if (!planner?.getHouses) return;
  const review = document.getElementById('assessorNeighborReview');
  const list = document.getElementById('assessorNeighborList');
  const count = document.getElementById('assessorNeighborReviewCount');
  if (!review || !list || !count) return;

  const houses = planner.getHouses();
  const uploaded = houses.filter(house => !house.avoid && isUploadedAddress(house) && validCoordinates(house));
  const official = houses.filter(isOfficialAddress);
  review.hidden = !official.length;
  count.textContent = `${official.length.toLocaleString()} official`;
  if (!official.length) {
    list.innerHTML = '<div class="assessor-neighbor-empty">No assessor/GIS addresses have been added yet.</div>';
    return;
  }
  if (!uploaded.length) {
    list.innerHTML = '<div class="assessor-neighbor-empty">Upload the prepared address list to pair official addresses with their closest uploaded home.</div>';
    return;
  }

  const paired = official.map(house => ({ house, result: pairForOfficial(house, uploaded) }))
    .filter(item => item.result)
    .sort((a, b) => a.result.feet - b.result.feet || clean(a.house.address).localeCompare(clean(b.house.address), undefined, { numeric: true }));
  const shown = paired.slice(0, 250);
  list.innerHTML = shown.map(item => `
    <div class="assessor-neighbor-row">
      <strong>${escapeHtml(item.house.address || 'Official address')}</strong>
      <span class="assessor-neighbor-arrow">→</span>
      <span class="assessor-neighbor-uploaded">${escapeHtml(item.result.house.address || 'Uploaded address')}</span>
      <span class="assessor-neighbor-distance">${Math.round(item.result.feet).toLocaleString()} ft</span>
    </div>`).join('') + (paired.length > shown.length ? `<div class="assessor-neighbor-empty">Showing the closest 250 of ${paired.length.toLocaleString()} paired assessor/GIS addresses.</div>` : '');
}

function scheduleReview(delay = 120) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(updateReview, delay);
}

function captureScanStart() {
  if (!planner?.getHouses || processing) return;
  const houses = planner.getHouses();
  const uploaded = houses.filter(house => !house.avoid && isUploadedAddress(house) && validCoordinates(house));
  pendingScan = {
    existingIds: new Set(houses.map(house => String(house.id))),
    uploaded: uploaded.map(house => ({ id: String(house.id), address: house.address, baseAddress: house.baseAddress, lat: Number(house.lat), lng: Number(house.lng) })),
    nearbyOnly: nearbyOnlyEnabled(),
    feet: nearbyFeet(),
    startedAt: Date.now()
  };
  watchForScanCompletion();
}

function watchForScanCompletion() {
  clearInterval(scanWatcher);
  let sawBusy = false;
  scanWatcher = setInterval(() => {
    const button = document.getElementById('addAssessorAddressesButton');
    const busy = button?.getAttribute('aria-busy') === 'true' || /scanning|checking|starting|loading/i.test(button?.textContent || '');
    sawBusy = sawBusy || busy;
    if (sawBusy && !busy) {
      clearInterval(scanWatcher);
      scanWatcher = null;
      processCompletedScan();
      return;
    }
    if (pendingScan && Date.now() - pendingScan.startedAt > 180000) {
      clearInterval(scanWatcher);
      scanWatcher = null;
      processCompletedScan();
    }
  }, 250);
}

function processCompletedScan() {
  if (!pendingScan || !planner?.getHouses || processing) return;
  processing = true;
  const snapshot = pendingScan;
  pendingScan = null;
  const houses = planner.getHouses();
  const newOfficial = houses.filter(house => !snapshot.existingIds.has(String(house.id)) && isOfficialAddress(house));
  let kept = 0;
  let removed = 0;
  let unpaired = 0;
  const removeIds = new Set();

  for (const house of newOfficial) {
    const result = nearestUploadedAddress(house, snapshot.uploaded);
    if (!result) {
      unpaired += 1;
      if (snapshot.nearbyOnly && snapshot.feet > 0) removeIds.add(String(house.id));
      continue;
    }
    if (snapshot.nearbyOnly && snapshot.feet > 0 && result.feet > snapshot.feet) {
      removeIds.add(String(house.id));
      continue;
    }
    annotateNeighbor(house, result);
    kept += 1;
  }

  if (removeIds.size) {
    for (let index = houses.length - 1; index >= 0; index -= 1) {
      if (removeIds.has(String(houses[index].id))) {
        houses.splice(index, 1);
        removed += 1;
      }
    }
  }

  const collapsed = Number(planner.dedupeHouses?.() || 0);
  planner.recalculateTerritoryHouseIds?.();
  planner.render?.();
  planner.refresh?.();
  scheduleReview(80);

  const distanceText = snapshot.nearbyOnly && snapshot.feet > 0 ? `${snapshot.feet.toLocaleString()} feet` : 'the editable Hall boundary';
  setTimeout(() => {
    const message = document.getElementById('addressSourceMergeMessage');
    if (message) {
      message.textContent = `${kept.toLocaleString()} nearby assessor/GIS address${kept === 1 ? '' : 'es'} kept next to the uploaded homes. ${removed.toLocaleString()} address${removed === 1 ? '' : 'es'} farther than ${distanceText} ${removed === 1 ? 'was' : 'were'} left off the map.${collapsed ? ` ${collapsed.toLocaleString()} duplicate record${collapsed === 1 ? '' : 's'} also collapsed.` : ''}${unpaired ? ` ${unpaired.toLocaleString()} could not be paired.` : ''}`;
      message.dataset.state = removed || unpaired ? 'warning' : 'success';
    }
    planner.toast?.(`${kept.toLocaleString()} nearby assessor/GIS address${kept === 1 ? '' : 'es'} retained${removed ? `; ${removed.toLocaleString()} farther-away address${removed === 1 ? '' : 'es'} skipped` : ''}.`);
  }, 350);
  processing = false;
}

function bindDelegatedScanCapture() {
  if (document.documentElement.dataset.assessorNeighborCapture === NEIGHBOR_VERSION) return;
  document.documentElement.dataset.assessorNeighborCapture = NEIGHBOR_VERSION;
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#addAssessorAddressesButton');
    if (!button) return;
    captureScanStart();
  }, true);
}

async function initialize() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getHouses?.() && candidate?.render) {
      planner = candidate;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!planner) return;

  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (injectControls()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  injectStyles();
  bindDelegatedScanCapture();
  scheduleReview(50);
  window.addEventListener('territory-planner:data', () => scheduleReview(160));
}

initialize();

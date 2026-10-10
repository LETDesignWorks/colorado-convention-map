const VERSION = 'territories-20261010-6';
const LOGO_URL = new URL('../assets/denver-2027-territory-logo.png', import.meta.url).href;
const MODE_KEY = 'denver2027-territory-workflow-mode';
const MODE_BOUNDARY = 'boundary';
const MODE_UPLOAD = 'upload';
const MODE_ALL = 'all';
const EARTH_MILES_PER_DEGREE = 69.0;

let api = null;
let map = null;
let activeMode = MODE_ALL;
let prefixWasManuallyEdited = false;
let lastAutoPrefix = '';
let pdfBusy = false;

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function toast(message, error = false) {
  api?.toast?.(message, error);
}
function validCoordinates(item) {
  if (api?.validMapCoordinates) return api.validMapCoordinates(item);
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}
function selectedHall() { return api?.getSelectedHall?.() || null; }
function selectedCongregation() { return clean(api?.getSelectedCongregation?.()); }

function injectStyles() {
  if (document.getElementById('territory-workflow-experience-styles')) return;
  const style = document.createElement('style');
  style.id = 'territory-workflow-experience-styles';
  style.textContent = `
    .territory-workflow-card{border-color:#8eb9d8;background:linear-gradient(145deg,#fff,#eef6fb);position:relative;overflow:hidden}
    .territory-workflow-card:before{content:"";position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(#f6aa1c,#ef6a45)}
    .territory-workflow-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0 8px}
    .territory-workflow-option{border:2px solid #cadbe7;border-radius:15px;background:#fff;padding:12px;text-align:left;cursor:pointer;display:grid;gap:5px;min-height:112px;transition:.18s ease;color:#203b55}
    .territory-workflow-option:hover{transform:translateY(-1px);border-color:#7eaed1;box-shadow:0 7px 18px #153d6417}
    .territory-workflow-option.active{border-color:#0b5b9f;background:#edf7ff;box-shadow:0 0 0 3px #0b5b9f20}
    .territory-workflow-option strong{font-size:13px;color:#0b477c}.territory-workflow-option span{font-size:9px;line-height:1.45;color:#607286}
    .territory-workflow-option em{font-style:normal;font-size:20px}
    .territory-workflow-all{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #d7e4ed;padding-top:9px}
    .territory-workflow-all small{font-size:8.5px;color:#6a7a8b;line-height:1.4}
    .territory-workflow-hidden{display:none!important}
    .avoid-workflow-card{border-color:#e2b9b5;background:linear-gradient(145deg,#fff,#fff5f4)}
    .avoid-workflow-card .avoid-address-panel{margin:0;padding:0;border:0;background:transparent}
    .avoid-workflow-card .card-heading{margin-bottom:8px}
    .prefix-auto-note{display:block;margin-top:4px;color:#617589;font-size:8.5px;line-height:1.35}
    .nearby-grouping-note{display:block;margin-top:5px;padding:8px 9px;border-radius:9px;background:#eef8f3;color:#2b6850;border:1px solid #c5e2d3;font-size:8.5px;line-height:1.45}
    .pdf-fallback-status{position:fixed;z-index:5000;left:50%;bottom:18px;transform:translateX(-50%);background:#083f73;color:#fff;border-radius:999px;padding:10px 16px;font:800 11px/1.2 system-ui,sans-serif;box-shadow:0 8px 28px #001a3270}
    @media(max-width:720px){.territory-workflow-options{grid-template-columns:1fr}.territory-workflow-option{min-height:94px}}
    @media print{.territory-workflow-card,.avoid-workflow-card{display:none!important}}
  `;
  document.head.appendChild(style);
}

function injectWorkflowChooser() {
  if (document.getElementById('territoryWorkflowCard')) return;
  const panel = document.querySelector('.side-panel');
  if (!panel) return;
  const card = document.createElement('section');
  card.id = 'territoryWorkflowCard';
  card.className = 'card territory-workflow-card';
  card.innerHTML = `
    <div class="card-heading">
      <div><span class="eyebrow">CHOOSE HOW TO START</span><h2>How will these territories be prepared?</h2></div>
      <span id="territoryWorkflowChip" class="count-chip">All tools</span>
    </div>
    <p class="section-copy">Choose the simpler workflow for this project. The map, territory-building controls, address directory, saving, and PDF tools remain available in either workflow.</p>
    <div class="territory-workflow-options">
      <button type="button" class="territory-workflow-option" data-workflow-mode="${MODE_BOUNDARY}"><em>✎</em><strong>Start with a Map Boundary</strong><span>Draw the congregation or Hall service area, then load assessor/GIS addresses or add homes manually.</span></button>
      <button type="button" class="territory-workflow-option" data-workflow-mode="${MODE_UPLOAD}"><em>⇧</em><strong>Start with an Address List</strong><span>Select the Kingdom Hall and congregation, upload the prepared CSV/Excel list, and map only those homes.</span></button>
    </div>
    <div class="territory-workflow-all"><small>Need a tool hidden by the selected workflow?</small><button id="territoryWorkflowShowAll" type="button" class="btn outline">Show All Planning Tools</button></div>`;
  const privacy = document.getElementById('privacyCard');
  if (privacy) panel.insertBefore(card, privacy);
  else panel.prepend(card);
  card.querySelectorAll('[data-workflow-mode]').forEach(button => {
    button.addEventListener('click', () => setWorkflowMode(button.dataset.workflowMode, true));
  });
  card.querySelector('#territoryWorkflowShowAll')?.addEventListener('click', () => setWorkflowMode(MODE_ALL, true));
}

function moveAvoidSection() {
  const panel = document.querySelector('.avoid-address-panel');
  const bulkCard = document.getElementById('bulkAddressCard');
  if (!panel || !bulkCard) return;
  let card = document.getElementById('avoidWorkflowCard');
  if (!card) {
    card = document.createElement('section');
    card.id = 'avoidWorkflowCard';
    card.className = 'card avoid-workflow-card';
    card.innerHTML = `<div class="card-heading"><div><span class="eyebrow">3C — ADDRESSES TO AVOID</span><h2>Add or upload addresses that should not be visited</h2></div><span class="private-chip">Administrator only</span></div><p class="section-copy">Add these after the ministry address list has been mapped. Avoid addresses stay red, are excluded from automatic territories, and remain saved with the selected Kingdom Hall and congregation.</p>`;
    bulkCard.after(card);
  }
  if (panel.parentElement !== card) card.appendChild(panel);
  const hallEyebrow = document.querySelector('#hallAddressSetCard .eyebrow');
  if (hallEyebrow && hallEyebrow.textContent !== '3D — KINGDOM HALL ADDRESS SET') {
    hallEyebrow.textContent = '3D — KINGDOM HALL ADDRESS SET';
  }
}

function workflowTargets() {
  return {
    boundary: document.querySelector('.boundary-card'),
    addresses: document.querySelector('.address-card'),
    source: document.querySelector('.source-card'),
    bulk: document.getElementById('bulkAddressCard')
  };
}
function toggleHidden(element, hidden) {
  element?.classList.toggle('territory-workflow-hidden', Boolean(hidden));
}
function applyWorkflowMode() {
  const targets = workflowTargets();
  const hasBoundary = Boolean(api?.getBoundaryGeometry?.());
  if (activeMode === MODE_BOUNDARY) {
    toggleHidden(targets.boundary, false);
    toggleHidden(targets.addresses, false);
    toggleHidden(targets.source, false);
    toggleHidden(targets.bulk, true);
  } else if (activeMode === MODE_UPLOAD) {
    toggleHidden(targets.boundary, !hasBoundary);
    toggleHidden(targets.addresses, true);
    toggleHidden(targets.source, true);
    toggleHidden(targets.bulk, false);
  } else {
    Object.values(targets).forEach(element => toggleHidden(element, false));
  }
  document.querySelectorAll('[data-workflow-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.workflowMode === activeMode);
  });
  const chip = document.getElementById('territoryWorkflowChip');
  const chipText = activeMode === MODE_BOUNDARY ? 'Boundary workflow' : activeMode === MODE_UPLOAD ? 'Address-list workflow' : 'All tools';
  if (chip && chip.textContent !== chipText) chip.textContent = chipText;
  const showAll = document.getElementById('territoryWorkflowShowAll');
  const showAllText = activeMode === MODE_ALL ? 'All Tools Are Showing' : 'Show All Planning Tools';
  if (showAll && showAll.textContent !== showAllText) showAll.textContent = showAllText;
}
function setWorkflowMode(mode, remember = false) {
  activeMode = [MODE_BOUNDARY, MODE_UPLOAD, MODE_ALL].includes(mode) ? mode : MODE_ALL;
  if (remember) {
    try { localStorage.setItem(MODE_KEY, activeMode); } catch { /* no-op */ }
  }
  applyWorkflowMode();
  if (remember) {
    const label = activeMode === MODE_BOUNDARY ? 'Map-boundary workflow selected.' : activeMode === MODE_UPLOAD ? 'Prepared address-list workflow selected.' : 'All planning tools are now visible.';
    toast(label);
  }
}

function congregationInitials(name) {
  const ignored = new Set(['THE', 'OF', 'AND', 'SPANISH', 'ENGLISH', 'CONGREGATION', 'DENVER', 'COLORADO', 'CO', 'USA']);
  const words = clean(name).replace(/\([^)]*\)/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).filter(word => !ignored.has(word.toUpperCase()));
  const code = words.slice(0, 2).map(word => word[0].toUpperCase()).join('');
  return code || 'T';
}
function hallPrefix() {
  const hall = selectedHall();
  if (!hall) return congregationInitials(selectedCongregation());
  let marker = clean(hall.markerLabel || hall.number || 'KH').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (/^\d+$/.test(marker)) marker = `K${marker}`;
  if (!marker) marker = 'KH';
  const congregation = congregationInitials(selectedCongregation());
  return `${marker}-${congregation}`.slice(0, 12).replace(/-+$/g, '');
}
function addPrefixNote() {
  const input = document.getElementById('territoryPrefix');
  if (!input || input.parentElement?.querySelector('.prefix-auto-note')) return;
  const note = document.createElement('small');
  note.className = 'prefix-auto-note';
  note.textContent = 'Automatically based on the selected Hall and congregation. You may edit it at any time.';
  input.insertAdjacentElement('afterend', note);
  input.addEventListener('input', () => {
    prefixWasManuallyEdited = clean(input.value) !== lastAutoPrefix;
  });
}
function updateAutoPrefix(force = false) {
  const input = document.getElementById('territoryPrefix');
  if (!input) return;
  const next = hallPrefix();
  const savedPlanLoaded = Boolean(api?.getCurrentPlanId?.());
  const canUpdate = force || (!savedPlanLoaded && (!prefixWasManuallyEdited || !clean(input.value) || clean(input.value) === lastAutoPrefix));
  if (!canUpdate) return;
  input.value = next;
  input.dataset.autoPrefix = 'true';
  lastAutoPrefix = next;
  prefixWasManuallyEdited = false;
  const bulk = document.getElementById('bulkPrefix');
  if (bulk && (!clean(bulk.value) || bulk.dataset.autoPrefix === 'true' || /^T$/i.test(clean(bulk.value)))) {
    bulk.value = next;
    bulk.dataset.autoPrefix = 'true';
  }
}
function wirePrefix() {
  addPrefixNote();
  document.getElementById('hallSelect')?.addEventListener('change', () => setTimeout(() => updateAutoPrefix(true), 0));
  document.getElementById('congregationSelect')?.addEventListener('change', () => setTimeout(() => updateAutoPrefix(true), 0));
  setTimeout(() => updateAutoPrefix(false), 50);
}

function mapPoint(item, meanLat) {
  return {
    item,
    x: Number(item.lng) * Math.cos(meanLat * Math.PI / 180) * EARTH_MILES_PER_DEGREE,
    y: Number(item.lat) * EARTH_MILES_PER_DEGREE
  };
}
function squaredDistance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return (dx * dx) + (dy * dy);
}
function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}
function clusterCapacities(total, count) {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
function seedCentroids(points, count) {
  const center = centroid(points);
  let first = points[0];
  for (const point of points) if (squaredDistance(point, center) > squaredDistance(first, center)) first = point;
  const seeds = [{ x: first.x, y: first.y }];
  while (seeds.length < count) {
    let selected = points[0], selectedDistance = -1;
    for (const point of points) {
      const nearest = Math.min(...seeds.map(seed => squaredDistance(point, seed)));
      if (nearest > selectedDistance) { selected = point; selectedDistance = nearest; }
    }
    seeds.push({ x: selected.x, y: selected.y });
  }
  return seeds;
}
function assignBalanced(points, centroids, capacities) {
  const clusters = centroids.map(() => []);
  const remaining = [...capacities];
  const ranked = points.map(point => {
    const distances = centroids.map((center, index) => ({ index, distance: squaredDistance(point, center) })).sort((a, b) => a.distance - b.distance);
    const regret = distances.length > 1 ? distances[1].distance - distances[0].distance : Number.POSITIVE_INFINITY;
    return { point, distances, regret };
  }).sort((a, b) => b.regret - a.regret || b.distances[0].distance - a.distances[0].distance);
  for (const entry of ranked) {
    const choice = entry.distances.find(candidate => remaining[candidate.index] > 0) || entry.distances[0];
    clusters[choice.index].push(entry.point);
    remaining[choice.index] -= 1;
  }
  return clusters;
}
function compactRadiusGroups(items, target) {
  const valid = items.filter(validCoordinates);
  if (!valid.length) return [];
  const count = Math.max(1, Math.ceil(valid.length / Math.max(1, target)));
  const meanLat = valid.reduce((sum, item) => sum + Number(item.lat), 0) / valid.length;
  const points = valid.map(item => mapPoint(item, meanLat));
  const capacities = clusterCapacities(points.length, count);
  let centroids = seedCentroids(points, count);
  let clusters = [];
  for (let iteration = 0; iteration < 10; iteration += 1) {
    clusters = assignBalanced(points, centroids, capacities);
    const next = clusters.map((cluster, index) => cluster.length ? centroid(cluster) : centroids[index]);
    const movement = next.reduce((sum, center, index) => sum + squaredDistance(center, centroids[index]), 0);
    centroids = next;
    if (movement < 0.0000001) break;
  }
  const results = clusters.filter(cluster => cluster.length).map(cluster => cluster.map(point => point.item));
  results.sort((a, b) => {
    const ca = centroid(a.map(item => mapPoint(item, meanLat)));
    const cb = centroid(b.map(item => mapPoint(item, meanLat)));
    return cb.y - ca.y || ca.x - cb.x;
  });
  return results;
}
function groupRadiusMiles(group) {
  if (!group.length) return 0;
  const meanLat = group.reduce((sum, item) => sum + Number(item.lat), 0) / group.length;
  const points = group.map(item => mapPoint(item, meanLat));
  const center = centroid(points);
  return Math.sqrt(Math.max(...points.map(point => squaredDistance(point, center))));
}
function groupingSummary(groups) {
  const radii = groups.map(groupRadiusMiles).sort((a, b) => a - b);
  const median = radii.length ? radii[Math.floor(radii.length / 2)] : 0;
  const widest = radii.length ? radii[radii.length - 1] : 0;
  return { median, widest };
}
function ensureRadiusOptions() {
  const main = document.getElementById('groupingMethod');
  if (main && !main.querySelector('option[value="radius"]')) {
    main.insertAdjacentHTML('afterbegin', '<option value="radius">Nearby homes by radius (recommended)</option>');
    main.value = 'radius';
    const note = document.createElement('small');
    note.className = 'nearby-grouping-note';
    note.textContent = 'Nearby-radius mode balances the selected number of homes while minimizing the distance from each territory’s center. This prevents one automatic territory from jumping across distant streets or neighborhoods.';
    main.insertAdjacentElement('afterend', note);
  }
  const bulk = document.getElementById('bulkMethod');
  if (bulk && !bulk.querySelector('option[value="radius"]')) {
    bulk.insertAdjacentHTML('afterbegin', '<option value="radius">Nearby homes by radius (recommended)</option>');
    bulk.value = 'radius';
  }
}
function nextName(prefix, used, sequence) {
  let number = sequence;
  let name = `${prefix}-${String(number).padStart(2, '0')}`;
  while (used.has(name.toUpperCase())) {
    number += 1;
    name = `${prefix}-${String(number).padStart(2, '0')}`;
  }
  used.add(name.toUpperCase());
  return { name, next: number + 1 };
}
function createMainRadiusTerritories(event) {
  const method = document.getElementById('groupingMethod')?.value;
  if (method !== 'radius') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!api?.requireAdmin?.()) return;
  const houses = api.getHouses();
  const invalid = houses.filter(house => house.included !== false && !house.avoid && !validCoordinates(house));
  if (invalid.length) return toast(`${invalid.length.toLocaleString()} address location${invalid.length === 1 ? ' needs' : 's need'} repair before nearby territories can be created.`, true);
  const included = houses.filter(house => house.included !== false && !house.avoid && validCoordinates(house));
  if (!included.length) return toast('Load or upload mapped addresses first.', true);
  const territories = api.getTerritories();
  if (territories.length && !confirm('Replace all existing territory groups with new nearby-radius territories?')) return;
  const select = document.getElementById('targetSize');
  const target = select?.value === 'custom' ? Math.max(1, Math.min(200, Number(document.getElementById('customTarget')?.value) || 25)) : Math.max(1, Number(select?.value) || 30);
  const groups = compactRadiusGroups(included, target);
  territories.splice(0, territories.length);
  const prefix = clean(document.getElementById('territoryPrefix')?.value).toUpperCase() || hallPrefix();
  groups.forEach((group, index) => {
    const territory = { id: api.uniqueId('territory'), name: `${prefix}-${String(index + 1).padStart(2, '0')}`, colorIndex: index % api.getTerritoryColors().length, houseIds: group.map(house => house.id), geometry: null, manualBoundary: false };
    territories.push(territory);
    group.forEach(house => { house.territoryId = territory.id; });
  });
  api.recalculateTerritoryHouseIds();
  api.render();
  const summary = groupingSummary(groups);
  toast(`${groups.length} nearby-radius territories created. Median radius ${summary.median.toFixed(2)} mi; widest ${summary.widest.toFixed(2)} mi. Review roads, gates, and access before saving.`);
}
function houseBatchIds(house) {
  const ids = Array.isArray(house?.bulkBatchIds) ? house.bulkBatchIds.map(String) : [];
  return ids.length ? ids : house?.bulkBatchId ? [String(house.bulkBatchId)] : [];
}
function createBulkRadiusTerritories(event) {
  const method = document.getElementById('bulkMethod')?.value;
  if (method !== 'radius') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!api?.requireAdmin?.()) return;
  const batchId = clean(document.getElementById('bulkBatch')?.value);
  if (!batchId) return toast('Select an imported address workset first.', true);
  const houses = api.getHouses().filter(house => houseBatchIds(house).includes(batchId) && house.included !== false && !house.avoid);
  const invalid = houses.filter(house => !validCoordinates(house));
  if (invalid.length) return toast(`${invalid.length.toLocaleString()} address location${invalid.length === 1 ? ' needs' : 's need'} repair before nearby territories can be created. Select Repair Mapped Locations.`, true);
  if (!houses.length) return toast('The selected workset has no mapped included addresses.', true);
  const target = Math.max(1, Math.min(200, Number(document.getElementById('bulkTarget')?.value) || 40));
  const batchSelect = document.getElementById('bulkBatch');
  const batchName = clean(batchSelect?.selectedOptions?.[0]?.textContent).replace(/\s+—\s+\d[\d,]*\s*$/, '') || 'Imported addresses';
  if (!confirm(`Create nearby-radius territories from ${houses.length.toLocaleString()} addresses in “${batchName}” using a target of ${target}? Existing territories from this workset will be replaced.`)) return;
  const territories = api.getTerritories();
  const removed = new Set(territories.filter(territory => String(territory.bulkBatchId || '') === batchId).map(territory => territory.id));
  api.getHouses().forEach(house => { if (removed.has(house.territoryId)) house.territoryId = null; });
  for (let index = territories.length - 1; index >= 0; index -= 1) if (removed.has(territories[index].id)) territories.splice(index, 1);
  const groups = compactRadiusGroups(houses, target);
  const prefix = clean(document.getElementById('bulkPrefix')?.value || document.getElementById('territoryPrefix')?.value).toUpperCase() || hallPrefix();
  const used = new Set(territories.map(territory => clean(territory.name).toUpperCase()));
  let sequence = 1;
  groups.forEach(group => {
    const next = nextName(prefix, used, sequence);
    sequence = next.next;
    const territory = { id: api.uniqueId('territory'), name: next.name, colorIndex: territories.length % api.getTerritoryColors().length, houseIds: group.map(house => house.id), geometry: null, manualBoundary: false, bulkBatchId: batchId, bulkBatchName: batchName };
    territories.push(territory);
    group.forEach(house => { house.territoryId = territory.id; });
  });
  api.recalculateTerritoryHouseIds();
  api.render();
  document.getElementById('bulkFocus')?.dispatchEvent(new Event('change'));
  const summary = groupingSummary(groups);
  toast(`${groups.length} nearby-radius territories created from “${batchName}.” Median radius ${summary.median.toFixed(2)} mi; widest ${summary.widest.toFixed(2)} mi.`);
}
function wireGroupingOverrides() {
  ensureRadiusOptions();
  document.getElementById('autoGroupButton')?.addEventListener('click', createMainRadiusTerritories, true);
  document.getElementById('bulkGroup')?.addEventListener('click', createBulkRadiusTerritories, true);
}

function geometryForTerritory(territory, houses) {
  if (territory?.geometry) {
    try { return JSON.parse(JSON.stringify(territory.geometry)); } catch { /* continue */ }
  }
  const points = houses.map(house => turf.point([Number(house.lng), Number(house.lat)]));
  if (!points.length) return null;
  try {
    if (points.length === 1) return turf.buffer(points[0], 0.045, { units: 'kilometers', steps: 16 }).geometry;
    if (points.length === 2) return turf.buffer(turf.lineString(points.map(point => point.geometry.coordinates)), 0.045, { units: 'kilometers', steps: 12 }).geometry;
    const collection = turf.featureCollection(points);
    return (turf.buffer(turf.convex(collection) || turf.bboxPolygon(turf.bbox(collection)), 0.035, { units: 'kilometers', steps: 12 }))?.geometry || null;
  } catch {
    try { return turf.bboxPolygon(turf.bbox(turf.featureCollection(points))).geometry; } catch { return null; }
  }
}
function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Feature') return geometryRings(geometry.geometry);
  if (geometry.type === 'Polygon') return geometry.coordinates || [];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
  return [];
}
function projectedViewport(houses, geometry, width = 1200, height = 760, padding = 70) {
  const coords = [...geometryRings(geometry).flat(), ...houses.map(house => [Number(house.lng), Number(house.lat)])].filter(pair => pair.every(Number.isFinite));
  if (!coords.length) return null;
  const minLng = Math.min(...coords.map(point => point[0]));
  const maxLng = Math.max(...coords.map(point => point[0]));
  const minLat = Math.min(...coords.map(point => point[1]));
  const maxLat = Math.max(...coords.map(point => point[1]));
  const meanLat = ((minLat + maxLat) / 2) * Math.PI / 180;
  const cos = Math.max(0.2, Math.cos(meanLat));
  const minX = minLng * cos, maxX = maxLng * cos;
  const spanX = Math.max(maxX - minX, 0.000001), spanY = Math.max(maxLat - minLat, 0.000001);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const usedW = spanX * scale, usedH = spanY * scale;
  return {
    width, height,
    project(lng, lat) {
      return [padding + ((lng * cos) - minX) * scale + ((width - padding * 2 - usedW) / 2), padding + (maxLat - lat) * scale + ((height - padding * 2 - usedH) / 2)];
    }
  };
}
function colorForTerritory(territory) {
  const colors = api.getTerritoryColors?.() || ['#0b5b9f'];
  return colors[(Number(territory.colorIndex) || 0) % colors.length] || '#0b5b9f';
}
function buildVectorMap(territory, houses, avoids, geometry) {
  const viewport = projectedViewport([...houses, ...avoids], geometry);
  if (!viewport) return null;
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f5f8fa';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#d5e0e8';
  context.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 80) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
  for (let y = 0; y < canvas.height; y += 80) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
  const color = colorForTerritory(territory);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 12;
  for (const ring of geometryRings(geometry)) {
    context.beginPath();
    ring.forEach((point, index) => {
      const [x, y] = viewport.project(Number(point[0]), Number(point[1]));
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
  }
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.fillStyle = `${color}22`;
  for (const ring of geometryRings(geometry)) {
    context.beginPath();
    ring.forEach((point, index) => {
      const [x, y] = viewport.project(Number(point[0]), Number(point[1]));
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.closePath();
    context.fill();
    context.stroke();
  }
  houses.forEach((house, index) => {
    const [x, y] = viewport.project(Number(house.lng), Number(house.lat));
    context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fillStyle = color; context.fill();
    context.strokeStyle = '#fff'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#fff'; context.font = 'bold 12px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(index + 1), x, y + 0.5);
  });
  avoids.forEach(house => {
    const [x, y] = viewport.project(Number(house.lng), Number(house.lat));
    context.beginPath(); context.arc(x, y, 11, 0, Math.PI * 2); context.fillStyle = '#c9362b'; context.fill();
    context.strokeStyle = '#fff'; context.lineWidth = 3; context.stroke();
    context.beginPath(); context.moveTo(x - 4, y - 4); context.lineTo(x + 4, y + 4); context.moveTo(x - 4, y + 4); context.lineTo(x + 4, y - 4); context.stroke();
  });
  context.fillStyle = '#40566d'; context.font = '14px Arial'; context.textAlign = 'left'; context.fillText('Planning map — numbered dots match the address key', 18, canvas.height - 18);
  return canvas.toDataURL('image/jpeg', 0.92);
}
async function imageDataUrl(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Image returned ${response.status}`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function safeAddLogo(doc, logo) {
  if (!logo) return false;
  try { doc.addImage(logo, 'PNG', 0.30, 0.12, 1.55, 0.86, undefined, 'FAST'); return true; }
  catch (error) { console.warn('Territory PDF logo could not be drawn.', error); return false; }
}
function addPdfHeader(doc, logo, title, subtitle) {
  const usedLogo = safeAddLogo(doc, logo);
  const x = usedLogo ? 2.02 : 0.45;
  doc.setTextColor(11, 68, 126); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(title, x, 0.44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(76, 91, 107); doc.text(subtitle, x, 0.69);
  doc.setDrawColor(176, 194, 210); doc.line(0.35, 1.00, 10.65, 1.00);
}
function addPdfFooter(doc, page, count) {
  doc.setDrawColor(211, 220, 228); doc.line(0.35, 8.13, 10.65, 8.13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(94, 106, 119);
  doc.text('Denver 2027 Convention ministry territory — verify addresses, access, and boundaries locally before use.', 0.35, 8.33);
  doc.text(`Page ${page} of ${count}`, 10.65, 8.33, { align: 'right' });
}
function sortedHouses(houses) {
  return [...houses].sort((a, b) => clean(a.address).localeCompare(clean(b.address), undefined, { numeric: true }));
}
function addAddressPages(doc, logo, territory, houses, hall, congregation) {
  let index = 0;
  while (index < houses.length) {
    doc.addPage('letter', 'landscape');
    addPdfHeader(doc, logo, `${territory.name} — Address List`, `${congregation} • ${hall?.name || ''}`);
    const xs = [0.48, 5.55];
    for (let column = 0; column < 2 && index < houses.length; column += 1) {
      let y = 1.25;
      while (index < houses.length && y < 7.88) {
        const text = `${index + 1}. ${houses[index].address}`;
        const lines = doc.splitTextToSize(text, 4.55);
        const need = Math.max(0.22, lines.length * 0.17 + 0.07);
        if (y + need > 7.88) break;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(40, 55, 72); doc.text(lines, xs[column], y);
        y += need; index += 1;
      }
    }
  }
}
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function showPdfStatus(message) {
  let status = document.getElementById('pdfFallbackStatus');
  if (!status) { status = document.createElement('div'); status.id = 'pdfFallbackStatus'; status.className = 'pdf-fallback-status'; document.body.appendChild(status); }
  status.textContent = message;
  status.hidden = false;
  return status;
}
async function generateReliablePdf(territoryId, button) {
  if (pdfBusy) return;
  const territory = api.getTerritories().find(item => String(item.id) === String(territoryId));
  if (!territory) return toast('Choose a territory to print.', true);
  const allAssigned = api.getHouses().filter(house => house.included !== false && !house.avoid && String(house.territoryId) === String(territory.id));
  const invalid = allAssigned.filter(house => !validCoordinates(house));
  if (invalid.length) return toast(`${invalid.length.toLocaleString()} address location${invalid.length === 1 ? ' needs' : 's need'} repair before this PDF can be created. Select Repair Mapped Locations.`, true);
  const houses = sortedHouses(allAssigned.filter(validCoordinates));
  if (!houses.length) return toast('This territory does not have mapped assigned addresses.', true);
  const geometry = geometryForTerritory(territory, houses);
  if (!geometry) return toast('A usable territory outline could not be created from these addresses.', true);
  const avoids = api.getHouses().filter(house => house.avoid && validCoordinates(house) && (() => { try { return turf.booleanPointInPolygon(turf.point([Number(house.lng), Number(house.lat)]), turf.feature(geometry)); } catch { return false; } })());
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) return toast('The PDF library did not load. Refresh the page and try again.', true);
  pdfBusy = true;
  const originalText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Building PDF…'; }
  const status = showPdfStatus('Building territory PDF…');
  try {
    let logo = null;
    try { logo = await imageDataUrl(LOGO_URL); } catch (error) { console.warn('Territory PDF logo could not be loaded.', error); }
    status.textContent = 'Drawing map and address key…';
    const mapImage = buildVectorMap(territory, houses, avoids, geometry);
    const hall = selectedHall();
    const congregation = selectedCongregation();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
    addPdfHeader(doc, logo, territory.name, `${congregation} • ${hall?.name || ''} • ${houses.length} addresses${avoids.length ? ` • ${avoids.length} avoid` : ''}`);
    if (mapImage) doc.addImage(mapImage, 'JPEG', 0.43, 1.17, 7.05, 6.68, undefined, 'FAST');
    doc.setDrawColor(174, 190, 204); doc.roundedRect(0.43, 1.17, 7.05, 6.68, 0.07, 0.07, 'S');
    const panelX = 7.72;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(11, 68, 126); doc.text('Territory Information', panelX, 1.30);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.1); doc.setTextColor(45, 60, 76);
    const info = [
      `Territory: ${territory.name}`,
      `Congregation: ${congregation}`,
      `Meeting location: ${hall?.name || ''}`,
      `Hall address: ${hall?.address || ''}`,
      `Homes / stops: ${houses.length}`,
      `Avoid / do not visit: ${avoids.length}`,
      `Boundary: ${territory.geometry ? 'Manually edited' : 'Automatic nearby outline'}`
    ];
    let y = 1.55;
    for (const line of info) { const lines = doc.splitTextToSize(line, 2.82); doc.text(lines, panelX, y); y += lines.length * 0.17 + 0.06; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(11, 68, 126); doc.text('Address Key', panelX, y + 0.07); y += 0.31;
    let index = 0;
    while (index < houses.length && y < 7.86) {
      const lines = doc.splitTextToSize(`${index + 1}. ${houses[index].address}`, 2.82);
      const need = lines.length * 0.15 + 0.05;
      if (y + need > 7.86) break;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(45, 60, 76); doc.text(lines, panelX, y);
      y += need; index += 1;
    }
    if (index < houses.length) addAddressPages(doc, logo, territory, houses.slice(index), hall, congregation);
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) { doc.setPage(page); addPdfFooter(doc, page, pageCount); }
    status.textContent = 'Downloading PDF…';
    const filename = `${clean(congregation || 'congregation').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${clean(territory.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-territory.pdf`;
    triggerBlobDownload(doc.output('blob'), filename);
    toast(`${territory.name} PDF created with its mapped homes and address key.`);
  } catch (error) {
    console.error('Reliable territory PDF generation failed.', error);
    toast(`The territory PDF could not be generated: ${error?.message || 'Unknown error'}`, true);
  } finally {
    pdfBusy = false;
    if (button) { button.disabled = false; button.textContent = originalText || 'PDF'; }
    setTimeout(() => { status.hidden = true; }, 800);
  }
}
function interceptPdf(event) {
  const button = event.target.closest?.('#exportTerritoryPdfButton,[data-territory-pdf]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const territoryId = button.dataset.territoryPdf || document.getElementById('pdfTerritorySelect')?.value;
  generateReliablePdf(territoryId, button);
}

function refreshEnhancements() {
  moveAvoidSection();
  ensureRadiusOptions();
  updateAutoPrefix(false);
  applyWorkflowMode();
}
async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getMap?.() && candidate?.getHouses?.()) { api = candidate; break; }
    await wait(50);
  }
  if (!api) return;
  map = api.getMap();
  injectStyles();
  injectWorkflowChooser();
  moveAvoidSection();
  wirePrefix();
  wireGroupingOverrides();
  document.addEventListener('click', interceptPdf, true);
  try { activeMode = localStorage.getItem(MODE_KEY) || MODE_ALL; } catch { activeMode = MODE_ALL; }
  setWorkflowMode(activeMode, false);
  let refreshTimer = null;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshEnhancements, 90);
  };
  window.addEventListener('territory-planner:data', scheduleRefresh);

  // Watch only during startup while the asynchronously initialized upload and
  // avoid-address cards are being inserted. A permanent subtree observer caused
  // a feedback loop because this module also updates headings and status labels.
  const sidePanel = document.querySelector('.side-panel');
  if (sidePanel) {
    const startupObserver = new MutationObserver(() => {
      scheduleRefresh();
      if (document.getElementById('bulkAddressCard') &&
          document.getElementById('avoidWorkflowCard') &&
          document.getElementById('hallAddressSetCard')) {
        startupObserver.disconnect();
      }
    });
    startupObserver.observe(sidePanel, { childList: true, subtree: true });
    setTimeout(() => startupObserver.disconnect(), 8000);
  }

  [0, 120, 350, 800, 1600, 3200].forEach(delay => setTimeout(refreshEnhancements, delay));
  console.info(`Denver 2027 territory workflow enhancements loaded (${VERSION}).`);
}

initialize();

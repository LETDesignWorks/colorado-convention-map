const FLEX_VERSION = 'territories-20261010-14';
const FLEX_METHOD = 'nearby-flex';
const LOGO_URL = new URL('../assets/denver-2027-territory-logo.png', import.meta.url).href;
const ROUND_LOGO_URL = new URL('../assets/denver-2027-logo.png', import.meta.url).href;
const TILE_SIZE = 256;
const OSM_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const EARTH_MILES_PER_DEGREE = 69.0;

let planner = null;
let plannerMap = null;
let lastGroupingBatchId = '';
let pdfBusy = false;
let groupingBusy = false;
let leftoverSearch = '';

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const sleepFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function toast(message, error = false) {
  planner?.toast?.(message, error);
}
function validCoordinates(item) {
  if (planner?.validMapCoordinates) return planner.validMapCoordinates(item);
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}
function selectedHall() { return planner?.getSelectedHall?.() || null; }
function selectedCongregation() { return clean(planner?.getSelectedCongregation?.()); }
function hallPrefix() {
  const hall = selectedHall();
  const congregation = selectedCongregation();
  const ignored = new Set(['THE', 'OF', 'AND', 'SPANISH', 'ENGLISH', 'CONGREGATION', 'DENVER', 'COLORADO', 'CO', 'USA']);
  const words = congregation.replace(/\([^)]*\)/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).filter(word => !ignored.has(word.toUpperCase()));
  const congregationCode = words.slice(0, 2).map(word => word[0].toUpperCase()).join('') || 'T';
  let marker = clean(hall?.markerLabel || hall?.number || 'KH').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (/^\d+$/.test(marker)) marker = `K${marker}`;
  return `${marker || 'KH'}-${congregationCode}`.slice(0, 12).replace(/-+$/g, '');
}
function houseBatchIds(house) {
  const values = Array.isArray(house?.bulkBatchIds) ? house.bulkBatchIds.map(String).filter(Boolean) : [];
  return values.length ? values : house?.bulkBatchId ? [String(house.bulkBatchId)] : [];
}
function colorForTerritory(territory) {
  const colors = planner?.getTerritoryColors?.() || ['#0b5b9f'];
  return colors[(Number(territory?.colorIndex) || 0) % colors.length] || '#0b5b9f';
}
function hexToRgb(hex) {
  const value = clean(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map(character => character + character).join('') : value.padEnd(6, '0').slice(0, 6);
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
function statusPill(message) {
  let element = document.getElementById('territoryFlexStatus');
  if (!element) {
    element = document.createElement('div');
    element.id = 'territoryFlexStatus';
    element.className = 'territory-flex-status';
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.hidden = false;
  return element;
}
function hideStatus(element, delay = 650) {
  if (!element) return;
  setTimeout(() => { element.hidden = true; }, delay);
}

function injectStyles() {
  if (document.getElementById('territory-flex-styles')) return;
  const style = document.createElement('style');
  style.id = 'territory-flex-styles';
  style.textContent = `
    .territory-flex-note{display:block;margin-top:6px;padding:9px 10px;border:1px solid #bfdccc;border-radius:10px;background:#eef9f3;color:#245f48;font-size:8.5px;line-height:1.48}
    .territory-leftover-card{border-color:#e6c36e;background:linear-gradient(145deg,#fff,#fff9e9)}
    .territory-leftover-summary{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;margin:8px 0}
    .territory-leftover-list{max-height:360px;overflow:auto;border:1px solid #e3d7ae;border-radius:11px;background:#fff}
    .territory-leftover-row{display:grid;grid-template-columns:30px 1fr;gap:8px;padding:8px 10px;border-bottom:1px solid #f0ead6;align-items:start}
    .territory-leftover-row:last-child{border-bottom:0}.territory-leftover-row span{width:25px;height:25px;border-radius:50%;background:#d49a16;color:#fff;display:grid;place-items:center;font-size:8px;font-weight:900}
    .territory-leftover-row strong{font-size:9.5px;color:#31465b}.territory-leftover-row small{display:block;color:#798696;font-size:8px;margin-top:2px}
    .territory-leftover-empty{padding:14px;color:#6d7b8c;font-size:9px;text-align:center}
    .territory-flex-status{position:fixed;z-index:6000;left:50%;bottom:18px;transform:translateX(-50%);max-width:min(92vw,620px);background:#083f73;color:#fff;border-radius:999px;padding:11px 17px;font:800 11px/1.25 system-ui,sans-serif;box-shadow:0 9px 30px #001a3275;text-align:center}
    .territory-flex-status[hidden]{display:none}
    @media(max-width:720px){.territory-leftover-summary{grid-template-columns:1fr}.territory-flex-status{border-radius:14px}}
    @media print{.territory-leftover-card,.territory-flex-status{display:none!important}}
  `;
  document.head.appendChild(style);
}
function ensureFlexibleOptions() {
  const main = document.getElementById('groupingMethod');
  if (main) {
    if (!main.querySelector(`option[value="${FLEX_METHOD}"]`)) {
      main.insertAdjacentHTML('afterbegin', `<option value="${FLEX_METHOD}">Nearby neighborhoods — flexible size (recommended)</option>`);
      const note = document.createElement('small');
      note.className = 'territory-flex-note';
      note.textContent = 'The selected target is treated as a minimum. Nearby homes stay together, so a territory may exceed 40 homes when splitting the neighborhood would be awkward. A local cluster smaller than the minimum remains Unassigned and is listed below for manual review.';
      main.insertAdjacentElement('afterend', note);
      main.addEventListener('change', () => { main.dataset.flexUserChanged = 'true'; });
    }
    if (main.dataset.flexUserChanged !== 'true' && (!main.value || main.value === 'radius')) main.value = FLEX_METHOD;
  }
  const bulk = document.getElementById('bulkMethod');
  if (bulk) {
    if (!bulk.querySelector(`option[value="${FLEX_METHOD}"]`)) {
      bulk.insertAdjacentHTML('afterbegin', `<option value="${FLEX_METHOD}">Nearby neighborhoods — flexible size (recommended)</option>`);
      const note = document.createElement('small');
      note.className = 'territory-flex-note';
      note.textContent = 'Uses the selected number as a minimum and permits larger territories to keep nearby homes together. Any isolated group below the minimum stays Unassigned and appears in the review list.';
      bulk.insertAdjacentElement('afterend', note);
      bulk.addEventListener('change', () => { bulk.dataset.flexUserChanged = 'true'; });
    }
    if (bulk.dataset.flexUserChanged !== 'true' && (!bulk.value || bulk.value === 'radius')) bulk.value = FLEX_METHOD;
  }
}
function injectLeftoverCard() {
  if (document.getElementById('territoryLeftoverCard')) return;
  const grouping = document.querySelector('.grouping-card');
  if (!grouping) return;
  const card = document.createElement('section');
  card.id = 'territoryLeftoverCard';
  card.className = 'card territory-leftover-card';
  card.innerHTML = `
    <div class="card-heading">
      <div><span class="eyebrow">AUTOMATIC GROUPING REVIEW</span><h2>Homes not assigned to a full nearby territory</h2></div>
      <span id="territoryLeftoverChip" class="count-chip">0 homes</span>
    </div>
    <p class="section-copy">These homes remain Unassigned because their nearby local group did not reach the selected minimum without joining a distant neighborhood. They stay on the map and may be assigned manually.</p>
    <div class="territory-leftover-summary">
      <input id="territoryLeftoverSearch" type="search" placeholder="Search the unassigned address list">
      <div class="button-grid">
        <button id="territoryLeftoverZoom" type="button" class="btn outline">Zoom to Homes</button>
        <button id="territoryLeftoverCsv" type="button" class="btn outline">Download CSV</button>
      </div>
    </div>
    <div id="territoryLeftoverList" class="territory-leftover-list"><div class="territory-leftover-empty">Automatic grouping has not left any homes for review.</div></div>`;
  grouping.after(card);
  card.querySelector('#territoryLeftoverSearch')?.addEventListener('input', event => {
    leftoverSearch = clean(event.target.value).toLowerCase();
    renderLeftovers();
  });
  card.querySelector('#territoryLeftoverZoom')?.addEventListener('click', zoomLeftovers);
  card.querySelector('#territoryLeftoverCsv')?.addEventListener('click', downloadLeftovers);
}
function currentLeftovers() {
  if (!planner) return [];
  return planner.getHouses().filter(house => {
    if (house.included === false || house.avoid || house.territoryId || !validCoordinates(house)) return false;
    if (lastGroupingBatchId && !houseBatchIds(house).includes(lastGroupingBatchId)) return false;
    return true;
  }).sort((a, b) => clean(a.address).localeCompare(clean(b.address), undefined, { numeric: true }));
}
function renderLeftovers() {
  const card = document.getElementById('territoryLeftoverCard');
  if (!card) return;
  const all = currentLeftovers();
  const filtered = leftoverSearch ? all.filter(house => `${house.address || ''} ${house.source || ''}`.toLowerCase().includes(leftoverSearch)) : all;
  const chip = document.getElementById('territoryLeftoverChip');
  const list = document.getElementById('territoryLeftoverList');
  if (chip) chip.textContent = `${all.length.toLocaleString()} home${all.length === 1 ? '' : 's'}`;
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = `<div class="territory-leftover-empty">${all.length ? 'No unassigned homes match the search.' : 'Every mapped home in the last grouping scope belongs to a territory.'}</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 1500).map((house, index) => `<article class="territory-leftover-row"><span>${index + 1}</span><div><strong>${esc(house.address || 'Mapped home')}</strong><small>${esc(house.source || 'Unassigned mapped address')}</small></div></article>`).join('') + (filtered.length > 1500 ? `<div class="territory-leftover-empty">Showing the first 1,500 of ${filtered.length.toLocaleString()} homes. Download the CSV for the complete list.</div>` : '');
}
function zoomLeftovers() {
  const homes = currentLeftovers();
  if (!homes.length) return toast('There are no unassigned homes from the last automatic grouping.');
  plannerMap.fitBounds(L.latLngBounds(homes.map(house => [Number(house.lat), Number(house.lng)])), { padding: [42, 42], maxZoom: 17 });
}
function downloadLeftovers() {
  const homes = currentLeftovers();
  if (!homes.length) return toast('There are no unassigned homes to download.');
  const rows = ['address,latitude,longitude,source', ...homes.map(house => [house.address, house.lat, house.lng, house.source || ''].map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))];
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${clean(selectedCongregation() || 'congregation').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-unassigned-homes.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 900);
}

function projectPoint(item, meanLat) {
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
function pointDistance(a, b) { return Math.sqrt(squaredDistance(a, b)); }
function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}
function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}
function adaptiveLinkRadius(points) {
  if (points.length < 2) return 0.2;
  const sampleStep = Math.max(1, Math.ceil(points.length / 1200));
  const nearest = [];
  for (let index = 0; index < points.length; index += sampleStep) {
    let best = Number.POSITIVE_INFINITY;
    for (let other = 0; other < points.length; other += 1) {
      if (index === other) continue;
      const distance = pointDistance(points[index], points[other]);
      if (distance < best) best = distance;
    }
    if (Number.isFinite(best)) nearest.push(best);
  }
  const neighborhoodDistance = percentile(nearest, 0.78);
  return Math.max(0.12, Math.min(0.55, neighborhoodDistance * 5.25 || 0.22));
}
function connectedComponents(points, radius) {
  const parent = points.map((_, index) => index);
  const rank = points.map(() => 0);
  const find = index => {
    let value = index;
    while (parent[value] !== value) { parent[value] = parent[parent[value]]; value = parent[value]; }
    return value;
  };
  const union = (a, b) => {
    let rootA = find(a), rootB = find(b);
    if (rootA === rootB) return;
    if (rank[rootA] < rank[rootB]) [rootA, rootB] = [rootB, rootA];
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
  };
  const cells = new Map();
  const key = (x, y) => `${x}:${y}`;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const cellX = Math.floor(point.x / radius), cellY = Math.floor(point.y / radius);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const candidates = cells.get(key(cellX + dx, cellY + dy)) || [];
      for (const candidate of candidates) if (pointDistance(point, points[candidate]) <= radius) union(index, candidate);
    }
    const cellKey = key(cellX, cellY);
    if (!cells.has(cellKey)) cells.set(cellKey, []);
    cells.get(cellKey).push(index);
  }
  const groups = new Map();
  points.forEach((point, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(point);
  });
  return [...groups.values()];
}
function componentCenter(component) { return centroid(component); }
function mergeNearbySmallComponents(components, target, radius) {
  const maximum = (target * 2) - 1;
  const mergeLimit = Math.max(0.75, radius * 4.25);
  const working = components.map(component => [...component]);
  let changed = true;
  while (changed) {
    changed = false;
    let best = null;
    for (let first = 0; first < working.length; first += 1) {
      if (working[first].length >= target) continue;
      const centerA = componentCenter(working[first]);
      for (let second = first + 1; second < working.length; second += 1) {
        if (working[second].length >= target || working[first].length + working[second].length > maximum) continue;
        const distance = pointDistance(centerA, componentCenter(working[second]));
        if (distance > mergeLimit) continue;
        if (!best || distance < best.distance) best = { first, second, distance };
      }
    }
    if (best) {
      working[best.first].push(...working[best.second]);
      working.splice(best.second, 1);
      changed = true;
    }
  }
  return working;
}
function capacities(total, count) {
  const base = Math.floor(total / count), remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
function seedCenters(points, count) {
  const overall = centroid(points);
  let first = points[0];
  for (const point of points) if (squaredDistance(point, overall) > squaredDistance(first, overall)) first = point;
  const centers = [{ x: first.x, y: first.y }];
  while (centers.length < count) {
    let selected = points[0], selectedDistance = -1;
    for (const point of points) {
      const distance = Math.min(...centers.map(center => squaredDistance(point, center)));
      if (distance > selectedDistance) { selected = point; selectedDistance = distance; }
    }
    centers.push({ x: selected.x, y: selected.y });
  }
  return centers;
}
function balancedClusters(points, count) {
  if (count <= 1) return [[...points]];
  const sizes = capacities(points.length, count);
  let centers = seedCenters(points, count);
  let clusters = [];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    clusters = centers.map(() => []);
    const remaining = [...sizes];
    const ranked = points.map(point => {
      const distances = centers.map((center, index) => ({ index, distance: squaredDistance(point, center) })).sort((a, b) => a.distance - b.distance);
      return { point, distances, regret: distances.length > 1 ? distances[1].distance - distances[0].distance : Number.POSITIVE_INFINITY };
    }).sort((a, b) => b.regret - a.regret);
    for (const entry of ranked) {
      const choice = entry.distances.find(candidate => remaining[candidate.index] > 0) || entry.distances[0];
      clusters[choice.index].push(entry.point);
      remaining[choice.index] -= 1;
    }
    const nextCenters = clusters.map((cluster, index) => cluster.length ? centroid(cluster) : centers[index]);
    const movement = nextCenters.reduce((sum, center, index) => sum + squaredDistance(center, centers[index]), 0);
    centers = nextCenters;
    if (movement < 0.0000001) break;
  }
  return clusters.filter(cluster => cluster.length);
}
async function flexibleNeighborhoodGroups(items, target, status) {
  const valid = items.filter(validCoordinates);
  if (!valid.length) return { groups: [], leftovers: [], linkRadius: 0 };
  const meanLat = valid.reduce((sum, item) => sum + Number(item.lat), 0) / valid.length;
  const points = valid.map(item => projectPoint(item, meanLat));
  status.textContent = `Finding nearby neighborhood clusters for ${valid.length.toLocaleString()} homes…`;
  await sleepFrame();
  const linkRadius = adaptiveLinkRadius(points);
  let components = connectedComponents(points, linkRadius);
  components = mergeNearbySmallComponents(components, target, linkRadius);
  status.textContent = `Building territories with a minimum of ${target} nearby homes…`;
  await sleepFrame();
  const groups = [], small = [];
  for (const component of components) {
    if (component.length < target) { small.push(component); continue; }
    const count = Math.max(1, Math.floor(component.length / target));
    groups.push(...balancedClusters(component, count));
  }
  const maximum = (target * 2) - 1;
  const absorbLimit = Math.max(0.95, linkRadius * 5.25);
  const leftovers = [];
  for (const component of small.sort((a, b) => b.length - a.length)) {
    const center = componentCenter(component);
    let bestIndex = -1, bestDistance = Number.POSITIVE_INFINITY;
    groups.forEach((group, index) => {
      if (group.length + component.length > maximum) return;
      const distance = pointDistance(center, componentCenter(group));
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    if (bestIndex >= 0 && bestDistance <= absorbLimit) groups[bestIndex].push(...component);
    else leftovers.push(...component);
  }
  groups.sort((a, b) => {
    const centerA = componentCenter(a), centerB = componentCenter(b);
    return centerB.y - centerA.y || centerA.x - centerB.x;
  });
  return { groups: groups.map(group => group.map(point => point.item)), leftovers: leftovers.map(point => point.item), linkRadius };
}
function groupingTarget(main) {
  if (main) {
    const select = document.getElementById('targetSize');
    return select?.value === 'custom' ? Math.max(1, Math.min(200, Number(document.getElementById('customTarget')?.value) || 40)) : Math.max(1, Number(select?.value) || 40);
  }
  return Math.max(1, Math.min(200, Number(document.getElementById('bulkTarget')?.value) || 40));
}
function nextTerritoryName(prefix, used, start) {
  let number = start;
  let name = `${prefix}-${String(number).padStart(2, '0')}`;
  while (used.has(name.toUpperCase())) { number += 1; name = `${prefix}-${String(number).padStart(2, '0')}`; }
  used.add(name.toUpperCase());
  return { name, next: number + 1 };
}
async function buildFlexibleTerritories({ main }) {
  if (groupingBusy || !planner?.requireAdmin?.()) return;
  const target = groupingTarget(main);
  const allHouses = planner.getHouses();
  let scope = [];
  let batchId = '';
  let batchName = '';
  if (main) {
    scope = allHouses.filter(house => house.included !== false && !house.avoid);
  } else {
    batchId = clean(document.getElementById('bulkBatch')?.value);
    if (!batchId) return toast('Select an imported address workset first.', true);
    scope = allHouses.filter(house => houseBatchIds(house).includes(batchId) && house.included !== false && !house.avoid);
    batchName = clean(document.getElementById('bulkBatch')?.selectedOptions?.[0]?.textContent).replace(/\s+—\s+\d[\d,]*\s*$/, '') || 'Imported addresses';
  }
  const invalid = scope.filter(house => !validCoordinates(house));
  if (invalid.length) return toast(`${invalid.length.toLocaleString()} address location${invalid.length === 1 ? ' needs' : 's need'} repair before automatic grouping. Select Repair Mapped Locations.`, true);
  if (!scope.length) return toast('Load or upload mapped addresses first.', true);
  const territories = planner.getTerritories();
  if (main) {
    if (territories.length && !confirm(`Replace all existing territories with nearby flexible groups using ${target} homes as the minimum?`)) return;
  } else if (!confirm(`Create nearby flexible territories from ${scope.length.toLocaleString()} homes in “${batchName}” using ${target} homes as the minimum? Existing territories from this workset will be replaced.`)) return;
  groupingBusy = true;
  const status = statusPill('Preparing nearby neighborhood groups…');
  try {
    const result = await flexibleNeighborhoodGroups(scope, target, status);
    if (!result.groups.length && result.leftovers.length) {
      lastGroupingBatchId = batchId;
      scope.forEach(house => { house.territoryId = null; });
      renderLeftovers();
      return toast(`No nearby local group reached the ${target}-home minimum. ${result.leftovers.length} homes remain Unassigned for manual review.`, true);
    }
    if (main) {
      territories.splice(0, territories.length);
      scope.forEach(house => { house.territoryId = null; });
    } else {
      const removed = new Set(territories.filter(territory => String(territory.bulkBatchId || '') === batchId).map(territory => String(territory.id)));
      allHouses.forEach(house => { if (removed.has(String(house.territoryId)) || houseBatchIds(house).includes(batchId)) house.territoryId = null; });
      for (let index = territories.length - 1; index >= 0; index -= 1) if (removed.has(String(territories[index].id))) territories.splice(index, 1);
    }
    const prefix = clean((main ? document.getElementById('territoryPrefix') : document.getElementById('bulkPrefix'))?.value || document.getElementById('territoryPrefix')?.value).toUpperCase() || hallPrefix();
    const used = new Set(territories.map(territory => clean(territory.name).toUpperCase()));
    let sequence = 1;
    result.groups.forEach(group => {
      const next = nextTerritoryName(prefix, used, sequence);
      sequence = next.next;
      const territory = {
        id: planner.uniqueId('territory'), name: next.name,
        colorIndex: territories.length % planner.getTerritoryColors().length,
        houseIds: group.map(house => house.id), geometry: null, manualBoundary: false,
        ...(batchId ? { bulkBatchId: batchId, bulkBatchName: batchName } : {})
      };
      territories.push(territory);
      group.forEach(house => { house.territoryId = territory.id; });
    });
    result.leftovers.forEach(house => { house.territoryId = null; });
    lastGroupingBatchId = batchId;
    planner.recalculateTerritoryHouseIds();
    planner.render();
    renderLeftovers();
    const sizes = result.groups.map(group => group.length);
    const smallest = Math.min(...sizes), largest = Math.max(...sizes);
    status.textContent = `${result.groups.length} territories created; sizes ${smallest}–${largest}. ${result.leftovers.length} unassigned.`;
    toast(`${result.groups.length} nearby territories created. Each completed territory has at least ${target} homes and may be larger to preserve local grouping. ${result.leftovers.length ? `${result.leftovers.length} homes remain Unassigned and are listed for review.` : 'Every home was assigned.'}`);
  } catch (error) {
    console.error(error);
    toast(`Automatic territory grouping failed: ${error?.message || 'Unknown error'}`, true);
  } finally {
    groupingBusy = false;
    hideStatus(status, 1300);
  }
}

function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Feature') return geometryRings(geometry.geometry);
  if (geometry.type === 'Polygon') return geometry.coordinates || [];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
  return [];
}
function territoryGeometry(territory, houses) {
  if (territory?.geometry) {
    try { return JSON.parse(JSON.stringify(territory.geometry)); } catch { /* continue */ }
  }
  const points = houses.map(house => turf.point([Number(house.lng), Number(house.lat)]));
  if (!points.length) return null;
  try {
    if (points.length === 1) return turf.buffer(points[0], 0.05, { units: 'kilometers', steps: 16 }).geometry;
    if (points.length === 2) return turf.buffer(turf.lineString(points.map(point => point.geometry.coordinates)), 0.05, { units: 'kilometers', steps: 14 }).geometry;
    const collection = turf.featureCollection(points);
    const hull = turf.concave(collection, { maxEdge: 0.45, units: 'kilometers' }) || turf.convex(collection) || turf.bboxPolygon(turf.bbox(collection));
    return turf.buffer(hull, 0.04, { units: 'kilometers', steps: 16 })?.geometry || hull.geometry;
  } catch {
    try { return turf.bboxPolygon(turf.bbox(turf.featureCollection(points))).geometry; } catch { return null; }
  }
}
function pointInsideGeometry(item, geometry) {
  try { return turf.booleanPointInPolygon(turf.point([Number(item.lng), Number(item.lat)]), turf.feature(geometry)); }
  catch { return false; }
}
function milesBetween(a, b) {
  try { return turf.distance(turf.point([Number(a.lng), Number(a.lat)]), turf.point([Number(b.lng), Number(b.lat)]), { units: 'miles' }); }
  catch { return Number.POSITIVE_INFINITY; }
}
function relevantAvoids(allAvoids, houses, geometry) {
  return allAvoids.filter(avoid => pointInsideGeometry(avoid, geometry) || houses.some(house => milesBetween(avoid, house) <= 0.25));
}
function mercatorWorld(lng, lat, zoom) {
  const scale = TILE_SIZE * (2 ** zoom);
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const sin = Math.sin(safeLat * Math.PI / 180);
  return {
    x: ((Number(lng) + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}
function mapCoordinates(houses, avoids, geometry) {
  return [...geometryRings(geometry).flat(), ...houses.map(house => [Number(house.lng), Number(house.lat)]), ...avoids.map(house => [Number(house.lng), Number(house.lat)])].filter(pair => pair.length >= 2 && pair.every(Number.isFinite));
}
function chooseViewport(coordinates, width, height, padding = 70) {
  for (let zoom = 18; zoom >= 11; zoom -= 1) {
    const points = coordinates.map(([lng, lat]) => mercatorWorld(lng, lat, zoom));
    const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
    if ((maxX - minX) <= width - padding * 2 && (maxY - minY) <= height - padding * 2) {
      const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
      return { zoom, left: centerX - width / 2, top: centerY - height / 2, width, height };
    }
  }
  const zoom = 11;
  const points = coordinates.map(([lng, lat]) => mercatorWorld(lng, lat, zoom));
  const centerX = (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2;
  const centerY = (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2;
  return { zoom, left: centerX - width / 2, top: centerY - height / 2, width, height };
}
async function fetchTileBitmap(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Tile ${response.status}`);
    const blob = await response.blob();
    if (globalThis.createImageBitmap) return await createImageBitmap(blob);
    return await new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Tile image failed')); };
      image.src = objectUrl;
    });
  } finally { clearTimeout(timer); }
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index]); }
      catch { results[index] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return results;
}
async function buildStreetMapImage(territory, houses, avoids, geometry, status) {
  const width = 1200, height = 760;
  const coordinates = mapCoordinates(houses, avoids, geometry);
  if (!coordinates.length) return null;
  const viewport = chooseViewport(coordinates, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#eef3f6'; context.fillRect(0, 0, width, height);
  const firstX = Math.floor(viewport.left / TILE_SIZE), lastX = Math.floor((viewport.left + width) / TILE_SIZE);
  const firstY = Math.floor(viewport.top / TILE_SIZE), lastY = Math.floor((viewport.top + height) / TILE_SIZE);
  const tileCount = 2 ** viewport.zoom;
  const jobs = [];
  for (let tileX = firstX; tileX <= lastX; tileX += 1) for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
    jobs.push({ tileX, tileY, url: OSM_TILE.replace('{z}', viewport.zoom).replace('{x}', wrappedX).replace('{y}', tileY) });
  }
  status.textContent = `Loading ${jobs.length} street-map tiles…`;
  const images = await mapLimit(jobs, 6, job => fetchTileBitmap(job.url));
  let loaded = 0;
  jobs.forEach((job, index) => {
    const image = images[index];
    if (!image) return;
    loaded += 1;
    context.drawImage(image, (job.tileX * TILE_SIZE) - viewport.left, (job.tileY * TILE_SIZE) - viewport.top, TILE_SIZE, TILE_SIZE);
    image.close?.();
  });
  if (!loaded) {
    context.fillStyle = '#f6f8fa'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#d4dfe7'; context.lineWidth = 1;
    for (let x = 0; x < width; x += 80) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
    for (let y = 0; y < height; y += 80) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
  }
  const project = (lng, lat) => {
    const point = mercatorWorld(lng, lat, viewport.zoom);
    return [point.x - viewport.left, point.y - viewport.top];
  };
  const color = colorForTerritory(territory);
  context.lineJoin = 'round'; context.lineCap = 'round';
  for (const ring of geometryRings(geometry)) {
    context.beginPath();
    ring.forEach((pair, index) => { const [x, y] = project(Number(pair[0]), Number(pair[1])); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.closePath(); context.strokeStyle = '#fff'; context.lineWidth = 14; context.stroke();
  }
  for (const ring of geometryRings(geometry)) {
    context.beginPath();
    ring.forEach((pair, index) => { const [x, y] = project(Number(pair[0]), Number(pair[1])); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.closePath(); context.fillStyle = `${color}20`; context.fill(); context.strokeStyle = color; context.lineWidth = 7; context.stroke();
  }
  houses.forEach((house, index) => {
    const [x, y] = project(Number(house.lng), Number(house.lat));
    context.beginPath(); context.arc(x, y, 13, 0, Math.PI * 2); context.fillStyle = color; context.fill(); context.strokeStyle = '#fff'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#fff'; context.font = 'bold 12px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(index + 1), x, y + 0.5);
    const houseNumber = clean(house.address).match(/^\s*(\d+[A-Za-z]?)/)?.[1];
    if (houseNumber) {
      context.font = 'bold 13px Arial'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.lineWidth = 4; context.strokeStyle = '#fff'; context.strokeText(houseNumber, x + 17, y); context.fillStyle = '#65798c'; context.fillText(houseNumber, x + 17, y);
    }
  });
  avoids.forEach(avoid => {
    const [x, y] = project(Number(avoid.lng), Number(avoid.lat));
    context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fillStyle = '#c9362b'; context.fill(); context.strokeStyle = '#fff'; context.lineWidth = 3; context.stroke();
    context.beginPath(); context.moveTo(x - 5, y - 5); context.lineTo(x + 5, y + 5); context.moveTo(x - 5, y + 5); context.lineTo(x + 5, y - 5); context.stroke();
  });
  context.fillStyle = 'rgba(255,255,255,.94)'; context.fillRect(10, height - 29, 230, 22);
  context.fillStyle = '#43566a'; context.font = '12px Arial'; context.textAlign = 'left'; context.textBaseline = 'alphabetic'; context.fillText(OSM_ATTRIBUTION, 17, height - 13);
  context.fillStyle = 'rgba(255,255,255,.95)'; context.beginPath(); context.arc(width - 38, 42, 25, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#91a3b4'; context.lineWidth = 2; context.stroke();
  context.fillStyle = '#20384f'; context.font = 'bold 15px Arial'; context.textAlign = 'center'; context.fillText('N', width - 38, 36);
  context.beginPath(); context.moveTo(width - 38, 61); context.lineTo(width - 38, 42); context.lineTo(width - 45, 51); context.moveTo(width - 38, 42); context.lineTo(width - 31, 51); context.strokeStyle = '#20384f'; context.lineWidth = 2; context.stroke();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.93), streetTilesLoaded: loaded };
}
async function imageCanvasData(url, fallback = false) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Image ${response.status}`);
    const blob = await response.blob();
    const bitmap = globalThis.createImageBitmap ? await createImageBitmap(blob) : await new Promise((resolve, reject) => {
      const image = new Image(); const objectUrl = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image could not be decoded')); };
      image.src = objectUrl;
    });
    const maxWidth = 1000;
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
    return canvas.toDataURL('image/png');
  } catch (error) {
    if (!fallback) return imageCanvasData(ROUND_LOGO_URL, true);
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 260;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 150px Arial'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillStyle = '#0c4f78'; context.fillText('DENVER', 20, 135);
    context.fillStyle = '#ee6541'; context.font = '130px Arial'; context.fillText('2027', 650, 135);
    return canvas.toDataURL('image/png');
  }
}
function drawLogo(doc, logo) {
  try { doc.addImage(logo, 'PNG', 0.24, 0.08, 1.78, 0.98, undefined, 'FAST'); return true; }
  catch {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(12, 79, 120); doc.text('DENVER', 0.32, 0.47);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(238, 101, 65); doc.text('2027', 1.22, 0.47);
    return false;
  }
}
function pdfHeader(doc, logo, title, subtitle) {
  const used = drawLogo(doc, logo);
  const x = used ? 2.15 : 2.02;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(11, 68, 126); doc.text(title, x, 0.43);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(72, 87, 104); doc.text(subtitle, x, 0.70);
  doc.setDrawColor(174, 193, 209); doc.line(0.35, 1.03, 10.65, 1.03);
}
function pdfFooter(doc, page, count) {
  doc.setDrawColor(210, 219, 227); doc.line(0.35, 8.12, 10.65, 8.12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(93, 106, 120);
  doc.text('Denver 2027 Convention ministry territory — verify addresses, access, and boundaries locally before use.', 0.35, 8.32);
  doc.text(`Page ${page} of ${count}`, 10.65, 8.32, { align: 'right' });
}
function sortedByAddress(items) { return [...items].sort((a, b) => clean(a.address).localeCompare(clean(b.address), undefined, { numeric: true })); }
function addAddressListPages(doc, logo, territory, houses, startIndex, hall, congregation) {
  let index = startIndex;
  while (index < houses.length) {
    doc.addPage('letter', 'landscape');
    pdfHeader(doc, logo, `${territory.name} — Address List`, `${congregation} • ${hall?.name || ''}`);
    const columns = [0.48, 5.55];
    for (let column = 0; column < 2 && index < houses.length; column += 1) {
      let y = 1.26;
      while (index < houses.length) {
        const lines = doc.splitTextToSize(`${index + 1}. ${houses[index].address}`, 4.55);
        const needed = Math.max(0.22, lines.length * 0.17 + 0.07);
        if (y + needed > 7.91) break;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(40, 55, 72); doc.text(lines, columns[column], y);
        y += needed; index += 1;
      }
    }
  }
}
function addAvoidPages(doc, logo, territory, allAvoids, relevantIds, hall, congregation) {
  const avoids = sortedByAddress(allAvoids);
  let index = 0;
  do {
    doc.addPage('letter', 'landscape');
    pdfHeader(doc, logo, `${territory.name} — Avoid / Do Not Visit`, `${congregation} • ${hall?.name || ''} • ${avoids.length} saved avoid address${avoids.length === 1 ? '' : 'es'}`);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(82, 94, 108);
    doc.text('This appendix is included with every territory PDF. Addresses marked NEAR THIS TERRITORY are also shown as red X dots on its map.', 0.48, 1.22);
    if (!avoids.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(72, 88, 104); doc.text('No Avoid / Do Not Visit addresses are currently saved for this Hall and congregation.', 0.55, 1.70);
      break;
    }
    const columns = [0.55, 5.55];
    for (let column = 0; column < 2 && index < avoids.length; column += 1) {
      let y = 1.55;
      while (index < avoids.length) {
        const avoid = avoids[index];
        const near = relevantIds.has(String(avoid.id));
        const label = `${index + 1}. ${avoid.address}${near ? '  —  NEAR THIS TERRITORY' : ''}`;
        const lines = doc.splitTextToSize(label, 4.48);
        const needed = Math.max(0.30, lines.length * 0.17 + 0.09);
        if (y + needed > 7.91) break;
        doc.setFillColor(201, 54, 43); doc.circle(columns[column] + 0.07, y - 0.02, 0.065, 'F');
        doc.setFont('helvetica', near ? 'bold' : 'normal'); doc.setFontSize(8.1); doc.setTextColor(near ? 151 : 70, near ? 45 : 57, near ? 37 : 72); doc.text(lines, columns[column] + 0.20, y);
        y += needed; index += 1;
      }
    }
  } while (index < avoids.length);
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1800);
}
async function generateTerritoryPdf(territoryId, button) {
  if (pdfBusy || !planner?.requireAdmin?.()) return;
  const territory = planner.getTerritories().find(item => String(item.id) === String(territoryId));
  if (!territory) return toast('Choose a territory to print.', true);
  const assigned = planner.getHouses().filter(house => house.included !== false && !house.avoid && String(house.territoryId) === String(territory.id));
  const invalid = assigned.filter(house => !validCoordinates(house));
  if (invalid.length) return toast(`${invalid.length.toLocaleString()} address location${invalid.length === 1 ? ' needs' : 's need'} repair before this PDF can be created.`, true);
  const houses = sortedByAddress(assigned.filter(validCoordinates));
  if (!houses.length) return toast('This territory does not have mapped assigned addresses.', true);
  const geometry = territoryGeometry(territory, houses);
  if (!geometry) return toast('A usable territory outline could not be created from the mapped homes.', true);
  const allAvoids = planner.getHouses().filter(house => house.avoid && validCoordinates(house));
  const mapAvoids = relevantAvoids(allAvoids, houses, geometry);
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) return toast('The PDF library did not load. Refresh the page and try again.', true);
  pdfBusy = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Building PDF…'; }
  const status = statusPill('Loading Denver 2027 logo…');
  try {
    const logo = await imageCanvasData(LOGO_URL);
    const mapResult = await buildStreetMapImage(territory, houses, mapAvoids, geometry, status);
    status.textContent = 'Creating printable territory pages…';
    await sleepFrame();
    const hall = selectedHall(), congregation = selectedCongregation();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
    pdfHeader(doc, logo, territory.name, `${congregation} • ${hall?.name || ''} • ${houses.length} homes • ${allAvoids.length} Hall avoid address${allAvoids.length === 1 ? '' : 'es'}`);

    // Front: a full-width territory map suitable for the front side of a duplex print.
    if (mapResult?.dataUrl) doc.addImage(mapResult.dataUrl, 'JPEG', 0.43, 1.17, 10.14, 6.68, undefined, 'FAST');
    doc.setDrawColor(169, 188, 204);
    doc.roundedRect(0.43, 1.17, 10.14, 6.68, 0.07, 0.07, 'S');
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(188, 202, 214);
    doc.roundedRect(7.94, 7.38, 2.38, 0.30, 0.04, 0.04, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(43, 59, 75);
    doc.text(`${houses.length} homes • Red X = Avoid / Do Not Visit`, 8.06, 7.57);

    // Back: always begin the complete address list on page 2.
    addAddressListPages(doc, logo, territory, houses, 0, hall, congregation);
    addAvoidPages(doc, logo, territory, allAvoids, new Set(mapAvoids.map(house => String(house.id))), hall, congregation);
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) { doc.setPage(page); pdfFooter(doc, page, pageCount); }
    const filename = `${clean(congregation || 'congregation').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${clean(territory.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-territory.pdf`;
    status.textContent = 'Downloading territory PDF…';
    triggerDownload(doc.output('blob'), filename);
    toast(`${territory.name} PDF created with the territory map on the front, the complete address list beginning on the back, and the Avoid / Do Not Visit appendix.`);
  } catch (error) {
    console.error(error);
    toast(`The territory PDF could not be generated: ${error?.message || 'Unknown error'}`, true);
  } finally {
    pdfBusy = false;
    if (button) { button.disabled = false; button.textContent = original || 'PDF'; }
    hideStatus(status, 1100);
  }
}

function captureActions(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const pdfButton = target.closest('#exportTerritoryPdfButton,[data-territory-pdf]');
  if (pdfButton) {
    event.preventDefault(); event.stopImmediatePropagation();
    const territoryId = pdfButton.dataset.territoryPdf || document.getElementById('pdfTerritorySelect')?.value;
    void generateTerritoryPdf(territoryId, pdfButton);
    return;
  }
  const mainButton = target.closest('#autoGroupButton');
  if (mainButton && document.getElementById('groupingMethod')?.value === FLEX_METHOD) {
    event.preventDefault(); event.stopImmediatePropagation(); void buildFlexibleTerritories({ main: true }); return;
  }
  const bulkButton = target.closest('#bulkGroup');
  if (bulkButton && document.getElementById('bulkMethod')?.value === FLEX_METHOD) {
    event.preventDefault(); event.stopImmediatePropagation(); void buildFlexibleTerritories({ main: false });
  }
}
window.addEventListener('click', captureActions, true);

function refreshUi() {
  ensureFlexibleOptions();
  injectLeftoverCard();
  renderLeftovers();
}
async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getMap?.() && candidate?.getHouses?.()) { planner = candidate; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!planner) return;
  plannerMap = planner.getMap();
  injectStyles();
  [0, 150, 450, 900, 1800, 3500].forEach(delay => setTimeout(refreshUi, delay));
  let refreshTimer = null;
  window.addEventListener('territory-planner:data', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshUi, 120);
  });
  console.info(`Denver 2027 flexible grouping and PDF module loaded (${FLEX_VERSION}).`);
}

initialize();

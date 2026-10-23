// Pure, non-destructive backup preview. No storage or editable-map side effects.
export const text = value => String(value ?? '').trim();
export const clone = value => JSON.parse(JSON.stringify(value));
export const nameKey = value => text(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
export const locationKey = (hallId, congregation) => JSON.stringify([text(hallId), nameKey(congregation)]);
export function stable(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (typeof value.toDate === 'function') return JSON.stringify(value.toDate().toISOString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
export function savedTime(record) {
  const value = record?.updatedAt || record?.createdAt;
  const result = value?.toDate ? +value.toDate() : value && typeof value === 'object' && 'seconds' in value
    ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6 : +new Date(value || 0);
  return Number.isFinite(result) ? result : 0;
}
export const workspaceStamp = workspace => stable(workspace);
export function mapped(house) {
  return house?.lat != null && house?.lng != null && text(house.lat) !== '' && text(house.lng) !== '' &&
    Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)) &&
    Math.abs(Number(house.lat)) <= 85.05112878 && Math.abs(Number(house.lng)) <= 180 &&
    !(Math.abs(Number(house.lat)) < 1 && Math.abs(Number(house.lng)) < 1);
}
const suffixes = { STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', DRIVE: 'DR', COURT: 'CT', CIRCLE: 'CIR',
  LANE: 'LN', PLACE: 'PL', BOULEVARD: 'BLVD', PARKWAY: 'PKWY', COLORADO: 'CO' };
export function addressKey(house) {
  let address = nameKey(house.address || house.baseAddress);
  let unit = nameKey(house.unit);
  address = address.replace(/(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)\b\s*|#\s*)([A-Z0-9-]+)/g, (_, value) => {
    if (!unit) unit = value;
    return ' ';
  });
  address = address.replace(/\b\d{5}-\d{4}\b/g, value => value.slice(0, 5))
    .replace(/[.,]/g, ' ').replace(/\b[A-Z]+\b/g, value => suffixes[value] || value).replace(/\s+/g, ' ').trim();
  return JSON.stringify([address, unit]);
}
function geometryOf(territory) {
  let geometry = territory.geometryJson || territory.geometry || null;
  if (typeof geometry === 'string') geometry = JSON.parse(geometry);
  if (geometry?.type === 'Feature') geometry = geometry.geometry;
  if (!geometry) return null;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  if (!Array.isArray(polygons) || !polygons.length || !polygons.every(polygon => Array.isArray(polygon) && polygon.length && polygon.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(pair => Array.isArray(pair) && pair.length >= 2 &&
      Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && Math.abs(pair[0]) <= 180 && Math.abs(pair[1]) <= 90) &&
    ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]))) throw new Error('A territory has an incomplete boundary. Repair that backup before merging.');
  return clone(geometry);
}
function validateSet(set, label) {
  if (!Array.isArray(set?.houses) || !Array.isArray(set?.territories)) throw new Error(`${label} is missing its addresses or territory list.`);
  for (const type of ['houses', 'territories']) {
    const seen = new Set();
    for (const item of set[type]) {
      const id = text(item?.id);
      if (!id || seen.has(id)) throw new Error(`${label} contains missing or repeated ${type === 'houses' ? 'address' : 'territory'} IDs. No work was changed.`);
      seen.add(id);
      if (type === 'houses' && !text(item.address || item.baseAddress)) throw new Error(`${label} contains an address without a street address.`);
    }
  }
}
function mergeProtection(keep, incoming) {
  keep.avoid = Boolean(keep.avoid || incoming.avoid);
  keep.included = !keep.avoid && keep.included !== false && incoming.included !== false;
  keep.residential = keep.residential !== false && incoming.residential !== false;
  keep.avoidSource = [...new Set([keep.avoidSource, incoming.avoidSource].filter(Boolean))].join(' | ');
  const batches = new Map();
  for (const house of [keep, incoming]) {
    const ids = house.bulkBatchIds?.length ? house.bulkBatchIds : house.bulkBatchId ? [house.bulkBatchId] : [];
    ids.forEach((id, index) => batches.set(String(id), house.bulkBatchNames?.[index] || house.bulkBatchName || batches.get(String(id)) || 'Imported addresses'));
  }
  keep.bulkBatchIds = [...batches.keys()]; keep.bulkBatchNames = [...batches.values()];
  keep.bulkBatchId = keep.bulkBatchIds[0] || ''; keep.bulkBatchName = keep.bulkBatchNames[0] || '';
  keep.bulkImported = Boolean(keep.bulkImported || incoming.bulkImported);
  keep.manualGap = Boolean(keep.manualGap || incoming.manualGap);
  keep.supplemental = Boolean(keep.supplemental || incoming.supplemental);
}
export function previewBackupMerge(target, source, decisions = {}) {
  validateSet(target, 'The current workspace'); validateSet(source, 'The backup');
  if (!target.hallId || !target.congregation) throw new Error('Select a meeting location and congregation first.');
  const houses = [], byAddress = new Map(), usedIds = new Set(), refs = { current: new Map(), backup: new Map() }, notes = [];
  let locationsKept = 0, duplicates = 0, serial = 0;
  for (const [origin, set] of [['current', target], ['backup', source]]) {
    for (const original of set.houses) {
      const key = addressKey(original);
      const bucket = byAddress.get(key) || [];
      let house = bucket.find(candidate => mapped(candidate) && mapped(original)
        ? Math.hypot(Number(candidate.lat) - Number(original.lat), Number(candidate.lng) - Number(original.lng)) <= .0003
        : bucket.length === 1);
      if (house) {
        duplicates++;
        if (!mapped(house) && mapped(original)) { house.lat = original.lat; house.lng = original.lng; }
        mergeProtection(house, original);
      } else {
        house = clone(original);
        house.id = text(house.id);
        while (usedIds.has(house.id)) house.id = `merged-address-${++serial}-${text(original.id)}`;
        usedIds.add(house.id); houses.push(house);
        mergeProtection(house, original);
        if (bucket.length) {
          locationsKept++;
          // Conflicting locations remain distinct; a historical avoid flag is conservative.
          for (const candidate of bucket) { mergeProtection(house, candidate); mergeProtection(candidate, house); }
        }
        bucket.push(house); byAddress.set(key, bucket);
      }
      refs[origin].set(text(original.id), house.id);
    }
  }
  const housesById = new Map(houses.map(house => [house.id, house]));
  const candidates = [];
  for (const [origin, set] of [['current', target], ['backup', source]]) {
    for (const original of set.territories) {
      const tid = text(original.id), wanted = new Set((original.houseIds || []).map(String));
      const members = set.houses.filter(h => !h.avoid && h.included !== false &&
        (text(h.territoryId) ? text(h.territoryId) === tid : wanted.has(text(h.id)))).map(h => refs[origin].get(text(h.id)));
      const territory = { ...clone(original), id: tid, geometry: geometryOf(original), houseIds: [...new Set(members)].sort() };
      delete territory.geometryJson;
      const signature = stable([nameKey(territory.name), territory.geometry, territory.houseIds]);
      candidates.push({ key: `${origin}:${tid}`, origin, territory, signature, members: territory.houseIds });
    }
  }
  // Same ID or same displayed name needs one reviewed choice, never an implicit union of boundaries.
  const parent = candidates.map((_, i) => i), root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const byId = new Map(), byName = new Map();
  candidates.forEach((candidate, index) => {
    for (const [lookup, key] of [[byId, candidate.territory.id], [byName, nameKey(candidate.territory.name)]]) {
      if (!key) continue;
      if (lookup.has(key)) parent[root(index)] = root(lookup.get(key)); else lookup.set(key, index);
    }
  });
  const components = new Map();
  candidates.forEach((candidate, index) => { const key = root(index); if (!components.has(key)) components.set(key, []); components.get(key).push(candidate); });
  const conflicts = [], selected = [], aliases = {}, discarded = [];
  for (const options of components.values()) {
    const conflictKey = 'territories:' + options.map(option => option.key).sort().join('|');
    const identical = options.every(option => option.signature === options[0].signature);
    let chosen = options.find(option => option.key === decisions[conflictKey]);
    if (!chosen && (identical || options.length === 1)) chosen = options.find(option => option.origin === 'current') || options[0];
    if (!chosen) {
      conflicts.push({ key: conflictKey, kind: 'territory', title: `Choose the territory to keep: ${[...new Set(options.map(o => o.territory.name || o.territory.id))].join(' / ')}`,
        options: options.map(option => ({ value: option.key, label: `${option.origin === 'current' ? 'Current location set' : 'Backup'} — ${option.territory.name || option.territory.id} (${option.members.length} homes)`,
          territoryId: option.territory.id, geometry: option.territory.geometry,
          addresses: option.members.map(id => housesById.get(id)?.address || id) })) });
      chosen = options.find(option => option.origin === 'current') || options[0];
    }
    selected.push(chosen);
    for (const option of options) {
      aliases[option.key] = chosen.territory.id;
      if (option !== chosen) discarded.push({ name: option.territory.name, id: option.territory.id, origin: option.origin, identical });
    }
  }
  const memberships = new Map();
  selected.forEach(candidate => candidate.members.forEach(id => {
    if (!memberships.has(id)) memberships.set(id, []);
    memberships.get(id).push(candidate);
  }));
  houses.forEach(house => {
    house.territoryId = null; house.avoidTerritoryId = null;
    if (house.avoid || house.included === false) return;
    const options = memberships.get(house.id) || [];
    if (options.length === 1) house.territoryId = options[0].territory.id;
    else if (options.length > 1) {
      const key = 'address:' + house.id;
      if (decisions[key] === 'unassigned') return;
      const selected = options.find(candidate => candidate.territory.id === decisions[key]);
      if (selected) house.territoryId = selected.territory.id;
      else conflicts.push({ key, kind: 'address', title: `Overlapping assignment: ${house.address}`, options: [
        { value: 'unassigned', label: 'Keep this address unassigned' },
        ...options.map(candidate => ({ value: candidate.territory.id, label: `${candidate.territory.name} — ${candidate.origin === 'current' ? 'current set' : 'backup'}` }))] });
    }
  });
  // Retain avoid associations only when that exact selected territory survives.
  for (const [origin, set] of [['current', target], ['backup', source]]) for (const old of set.houses) {
    const house = housesById.get(refs[origin].get(text(old.id)));
    if (!house?.avoid || house.avoidTerritoryId) continue;
    const tid = text(old.avoidTerritoryId || (old.avoid ? old.territoryId : ''));
    if (tid && selected.some(c => c.territory.id === tid)) house.avoidTerritoryId = tid;
  }
  const territories = selected.map((candidate, index) => ({ ...candidate.territory,
    colorIndex: Number.isFinite(candidate.territory.colorIndex) ? candidate.territory.colorIndex : index,
    houseIds: houses.filter(h => !h.avoid && h.included !== false && h.territoryId === candidate.territory.id).map(h => h.id) }));
  if (locationsKept) notes.push(`${locationsKept} same-text address record(s) had conflicting locations and were kept separate. Review these map points before treating them as duplicates.`);
  const unmapped = houses.filter(h => !mapped(h)).length;
  if (unmapped) notes.push(`${unmapped} address record(s) have no usable map point. They remain in the address directory for repair.`);
  if (discarded.some(item => !item.identical)) notes.push('Addresses from a territory version you do not keep remain available; homes not assigned to a kept territory become Unassigned. The source backups remain unchanged.');
  return { draft: { ...clone(target), houses, territories }, conflicts, notes, discarded,
    relink: locationKey(target.hallId, target.congregation) !== locationKey(source.hallId, source.congregation),
    sourceId: source.id, sourceLabel: source.label || source.id,
    stats: { addresses: houses.length, added: houses.length - target.houses.length, duplicates, territories: territories.length,
      avoids: houses.filter(h => h.avoid).length, unassigned: houses.filter(h => !h.avoid && h.included !== false && !h.territoryId).length } };
}
export function groupTerritoriesByName(groups, records, hallId, overrides = new Map()) {
  const preferences = new Map();
  for (const record of records.values()) {
    if (record.deletedAt || record.recordType !== 'territory-name-choice' || text(record.hallId) !== text(hallId)) continue;
    const key = record.normalizedName;
    if (!preferences.has(key) || savedTime(record) >= savedTime(preferences.get(key))) preferences.set(key, record);
  }
  const buckets = new Map();
  for (const group of groups) {
    const key = nameKey(group.versions[0]?.territory.name) || `unnamed:${group.key}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(group);
  }
  return [...buckets.entries()].map(([key, options]) => {
    const sorted = [...options].sort((a, b) => Number(b.versions[0]?.time || 0) - Number(a.versions[0]?.time || 0) || a.key.localeCompare(b.key));
    const persisted = sorted.find(group => group.key === preferences.get(key)?.territoryKey);
    const representative = sorted.find(group => group.key === overrides.get(key)) || persisted || sorted[0];
    return { ...representative, nameBucket: key, alternatives: sorted, nameChoiceSaved: Boolean(persisted && persisted.key === representative.key),
      reviewNeeded: sorted.length > 1 && !persisted };
  }).sort((a, b) => a.nameBucket.localeCompare(b.nameBucket, undefined, { numeric: true }));
}
export function deletionProblem(record, records, currentPlanId, pendingSources = []) {
  if (!record || !['territory-plan', 'territory-pdf', 'territory-boundary'].includes(record.recordType)) return 'This is not a removable backup.';
  if (record.deletedAt) return 'This backup is already in Trash.';
  if (text(record.id) === text(currentPlanId)) return 'This backup is currently open. Save an independent merged copy or load another set before removing it.';
  if (pendingSources.includes(record.id)) return 'Save the merged backup successfully before removing a backup used in the unsaved merge.';
  const sameScope = [...records.values()].filter(r => !r.deletedAt && locationKey(r.hallId, r.congregation) === locationKey(record.hallId, record.congregation));
  const latest = items => items.sort((a, b) => savedTime(b) - savedTime(a) || text(b.id).localeCompare(text(a.id)))[0];
  if (record.recordType === 'territory-plan' && latest(sameScope.filter(r => r.recordType === 'territory-plan' && r.saveKind === 'work'))?.id === record.id)
    return 'This is the current saved work for the location. It cannot be removed as an old backup.';
  if (record.recordType === 'territory-boundary' && latest(sameScope.filter(r => r.recordType === 'territory-boundary' && r.meetingPlaceBoundary))?.id === record.id)
    return 'This is the approved meeting-place boundary, not an old backup.';
  return '';
}

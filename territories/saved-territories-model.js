// Saved data only. This module has no access to the editable workspace or writes.
const text = value => String(value ?? '').trim();
const copy = value => JSON.parse(JSON.stringify(value));

export function savedTime(value) {
  const date = value?.toDate ? value.toDate() : value && typeof value === 'object' && 'seconds' in value
    ? new Date(value.seconds * 1000) : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}
function array(value, fallback = []) {
  if (typeof value === 'string') value = JSON.parse(value);
  if (value == null) return fallback;
  if (!Array.isArray(value)) throw new Error('Saved list is invalid.');
  return value;
}
function geometry(territory) {
  let value = territory.geometryJson || territory.geometry;
  if (typeof value === 'string') value = JSON.parse(value);
  if (value?.type === 'Feature') value = value.geometry;
  return value ? copy(value) : null;
}
function identity(hallId, territory, sourceId, index) {
  // Never use a display name as identity. ID-less legacy entries stay separate.
  return JSON.stringify([text(hallId), text(territory.id) || `legacy:${sourceId}:${index}`]);
}
const chunkArrays = new WeakMap();
function decodedChunk(chunk) {
  if (!chunkArrays.has(chunk)) chunkArrays.set(chunk, array(chunk.housesJson ?? chunk.houses));
  return chunkArrays.get(chunk);
}
function planHouses(plan, records) {
  const ids = Array.isArray(plan.chunkIds) ? plan.chunkIds : [...records.values()]
    .filter(item => item.recordType === 'territory-plan-chunk' && item.planId === plan.id)
    .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex)).map(item => item.id);
  const houses = ids.flatMap(id => {
    const chunk = records.get(id);
    if (!chunk || (chunk.planId && chunk.planId !== plan.id)) throw new Error('Saved addresses are incomplete. Refresh to retry.');
    const data = chunk.housesJson ?? chunk.houses;
    if (data == null) throw new Error('Saved addresses are incomplete. Refresh to retry.');
    return decodedChunk(chunk);
  });
  if (Number.isFinite(plan.houseCount) && plan.houseCount !== houses.length) throw new Error('Saved address count does not match this plan.');
  return houses;
}
function assignedHouses(territory, houses) {
  const ids = new Set((territory.houseIds || []).map(String)), id = text(territory.id);
  return houses.filter(h => h.avoid ? id && text(h.avoidTerritoryId) === id
    : h.included !== false && (text(h.territoryId) ? id && text(h.territoryId) === id : ids.has(String(h.id))));
}
function makeVersion(record, territory, houses, index, source, error = '') {
  const isPdf = source !== 'plan';
  return {
    key: identity(record.hallId, territory, record.id, index),
    id: JSON.stringify([source, record.id, index]), source, recordId: record.id, hallId: text(record.hallId),
    territory: { ...copy(territory), geometry: error ? null : geometry(territory) },
    houses: copy(houses), error, congregation: text(record.congregation),
    planId: isPdf ? text(record.planId) : record.id,
    sourceName: isPdf ? record.filename || 'Saved PDF' : record.planName || 'Saved plan',
    time: savedTime(isPdf ? record.territorySavedAt || record.createdAt || record.updatedAt : record.updatedAt || record.createdAt),
    pdfRecord: isPdf ? record : null
  };
}

export async function collectSavedTerritories({ records, hallId, readSnapshot, isCurrent = () => true }) {
  const versions = [], issues = [];
  const relevant = [...records.values()].filter(r => !r.deletedAt && text(r.hallId) === text(hallId) && hallId != null && text(hallId));
  for (const plan of relevant.filter(r => r.recordType === 'territory-plan')) {
    let saved;
    try { saved = array(plan.territoriesJson || plan.territories); }
    catch (error) { issues.push(`${plan.planName || 'Saved plan'}: ${error.message}`); continue; }
    let houses = [], addressError = '';
    try { houses = planHouses(plan, records); }
    catch (error) { addressError = error.message; issues.push(`${plan.planName || 'Saved plan'}: ${addressError}`); }
    const byTerritory = new Map(), byId = new Map();
    for (const house of houses) {
      byId.set(String(house.id), house);
      const id = text(house.avoid ? house.avoidTerritoryId : house.territoryId);
      if (id && (house.avoid || house.included !== false)) { if (!byTerritory.has(id)) byTerritory.set(id, []); byTerritory.get(id).push(house); }
    }
    for (const [index, territory] of saved.entries()) {
      const assigned = [...(byTerritory.get(text(territory.id)) || [])];
      for (const id of territory.houseIds || []) { const house = byId.get(String(id)); if (house && !house.avoid && house.included !== false && !text(house.territoryId)) assigned.push(house); }
      try { versions.push(makeVersion(plan, territory, assigned, index, 'plan', addressError)); }
      catch (error) { issues.push(`${territory.name || 'Territory'}: ${error.message}`); }
    }
  }
  const jobs = relevant.filter(r => r.recordType === 'territory-pdf').flatMap(record => [
    { record, source: 'pdf' },
    ...(record.originalPdf ? [{ record: { ...record, ...record.originalPdf, id: record.id }, source: 'original' }] : [])
  ]);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (next < jobs.length && isCurrent()) {
      const { record, source } = jobs[next++];
      try {
        const snapshot = await readSnapshot(record);
        if (!isCurrent()) return;
        if (text(snapshot.hall?.id) !== text(hallId) || (record.territoryId && text(record.territoryId) !== text(snapshot.territory?.id))) {
          throw new Error('The PDF snapshot does not match its saved meeting place or territory.');
        }
        const version = makeVersion({ ...record, congregation: snapshot.congregation || record.congregation }, snapshot.territory, snapshot.houses, 0, source);
        if (source === 'original' && !record.originalPdf?.updatedAt) version.originalDateUnknown = true;
        versions.push(version);
      } catch (error) {
        if (!isCurrent()) return;
        issues.push(`${record.territoryName || 'Saved PDF'}: ${error.message}`);
        // Keep a failed latest snapshot visible as unavailable, never silently
        // substitute an older boundary and claim it is the latest.
        if (record.territoryId) versions.push(makeVersion(record, { id: record.territoryId, name: record.territoryName }, [], 0, source, error.message));
      }
    }
  }));
  const grouped = new Map();
  for (const version of versions) {
    if (!grouped.has(version.key)) grouped.set(version.key, { key: version.key, versions: [] });
    grouped.get(version.key).versions.push(version);
  }
  const rank = { plan: 2, pdf: 1, original: 0 };
  for (const group of grouped.values()) group.versions.sort((a, b) => b.time - a.time || rank[b.source] - rank[a.source] || a.id.localeCompare(b.id));
  const groups = [...grouped.values()].sort((a, b) => text(a.versions[0].territory.name).localeCompare(text(b.versions[0].territory.name), undefined, { numeric: true }) || a.key.localeCompare(b.key));
  return { groups, issues, planCount: relevant.filter(r => r.recordType === 'territory-plan').length, pdfCount: relevant.filter(r => r.recordType === 'territory-pdf').length };
}

export function savedGeometry(version, turf) {
  if (version.error) return null;
  if (version.territory.geometry) return copy(version.territory.geometry);
  const points = version.houses.filter(h => !h.avoid && h.included !== false && h.lat != null && h.lng != null &&
    Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lng)) && Math.abs(Number(h.lat)) <= 90 && Math.abs(Number(h.lng)) <= 180)
    .map(h => turf.point([Number(h.lng), Number(h.lat)]));
  if (!points.length) return null;
  if (points.length === 1) return turf.buffer(points[0], .045, { units: 'kilometers', steps: 16 });
  if (points.length === 2) return turf.buffer(turf.lineString(points.map(p => p.geometry.coordinates)), .045, { units: 'kilometers', steps: 12 });
  const collection = turf.featureCollection(points);
  const outline = turf.convex(collection) || turf.bboxPolygon(turf.bbox(collection));
  return turf.buffer(outline, .035, { units: 'kilometers', steps: 12 });
}

// Latest-request-wins also cancels in-flight reads on hide, Hall change or sign-out.
export function createSavedLayerLoader(collect = collectSavedTerritories) {
  let generation = 0; const snapshots = new Map(); let cacheHall = '';
  return {
    clearCache() { snapshots.clear(); cacheHall = ''; },
    cancel() { generation++; },
    async load(options) {
      const token = ++generation;
      if (cacheHall !== String(options.hallId)) { snapshots.clear(); cacheHall = String(options.hallId); }
      const readSnapshot = record => {
        const key = JSON.stringify([record.id, record.snapshotChunkIds, record.snapshot, record.originalPdf, savedTime(record.updatedAt)]);
        if (snapshots.has(key)) { const value = snapshots.get(key); snapshots.delete(key); snapshots.set(key, value); return value; }
        const value = Promise.resolve().then(() => options.readSnapshot(record)).catch(error => { snapshots.delete(key); throw error; });
        snapshots.set(key, value); while (snapshots.size > 64) snapshots.delete(snapshots.keys().next().value);
        return value;
      };
      const result = await collect({ ...options, readSnapshot, isCurrent: () => generation === token });
      return generation === token ? result : null;
    }
  };
}

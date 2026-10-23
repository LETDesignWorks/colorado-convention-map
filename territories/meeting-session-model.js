import { previewBackupMerge, nameKey, clone, stable } from './backup-merge-model.js?v=territories-20261022-45';

const id = value => String(value ?? '');
const named = territory => nameKey(territory.name) || `ID:${id(territory.id)}`;
function geometry(territory) {
  let value = territory.geometry || territory.geometryJson || null;
  if (typeof value === 'string') value = JSON.parse(value);
  return value?.type === 'Feature' ? value.geometry : value;
}
export function sessionContentStamp(workspace) {
  return stable([workspace.hallId, workspace.congregation, workspace.generation,
    workspace.editId, workspace.editing, workspace.houses, workspace.territories, workspace.boundary]);
}

export function territoryStamps(workspace) {
  const members = new Map();
  const avoids = (workspace.houses || []).filter(h => h.avoid);
  for (const home of workspace.houses || []) {
    if (!home.territoryId || home.avoid) continue;
    const key = id(home.territoryId); if (!members.has(key)) members.set(key, []); members.get(key).push(home);
  }
  const protections = stable(avoids);
  return new Map((workspace.territories || []).map(t => [id(t.id), { name: named(t), stamp: stable([t, members.get(id(t.id)) || [], protections]) }]));
}
export function sessionChanges(workspace, baseline = new Map()) {
  const current = territoryStamps(workspace);
  return { dirtyTerritoryIds: [...current].filter(([key,v]) => v.stamp !== baseline.get(key)?.stamp).map(([key]) => key),
    removedTerritoryNames: [...baseline].filter(([key]) => !current.has(key)).map(([,v]) => v.name) };
}

function sourceFromVersion(version, destination) {
  if (version.error || !version.territory?.id || !Array.isArray(version.houses)) {
    throw new Error(`“${version.territory?.name || 'Territory'}” has incomplete saved data. Review its versions before saving the session.`);
  }
  if (id(version.hallId) !== id(destination.hallId)) throw new Error('A territory belongs to another meeting place. Use the backup merge review to copy it first.');
  const territory = clone(version.territory);
  territory.id = id(territory.id); territory.geometry = geometry(territory); delete territory.geometryJson;
  territory.congregation = territory.congregation || version.congregation || destination.congregation;
  const houses = clone(version.houses);
  for (const home of houses) {
    if (home.avoid) { home.included = false; home.territoryId = null; home.avoidTerritoryId = territory.id; }
    else if (home.included !== false) home.territoryId = territory.id;
  }
  return { id: version.id, label: territory.name, hallId: destination.hallId,
    congregation: destination.congregation, houses, territories: [territory] };
}
function checkedMerge(target, source, preferCurrent = false) {
  let result = previewBackupMerge(target, source);
  if (preferCurrent) {
    const decisions = {};
    for (const conflict of result.conflicts) {
      if (conflict.kind === 'territory') {
        const options = conflict.options.filter(o => o.value.startsWith('current:'));
        if (options.length === 1) decisions[conflict.key] = options[0].value;
      }
    }
    if (Object.keys(decisions).length) result = previewBackupMerge(target, source, decisions);
  }
  if (result.conflicts.length) {
    throw new Error(`The session has conflicting territory assignments: ${result.conflicts.slice(0, 3).map(c => c.title).join('; ')}. Review these with Add to this location before saving. Nothing has been overwritten.`);
  }
  return result.draft;
}
// The editable session wins over historical copies. An explicit version selection
// replaces just that named territory; every address and restrictive flag survives.
export function assembleMeetingSession(workspace, groups, { base = null, selected = null } = {}) {
  if (!workspace.hallId || !workspace.congregation) throw new Error('Select a meeting place and congregation first.');
  if (workspace.editing) throw new Error('Finish or cancel the boundary drawing before saving the session.');
  let result = clone(workspace);
  // A deliberate removal must also suppress matching copies from an older base.
  const liveNamesAtStart = new Set(workspace.territories.map(named));
  const removed = new Set((workspace.removedTerritoryNames || []).filter(name => !liveNamesAtStart.has(name)));
  if (base) {
    if (id(base.hallId) !== id(workspace.hallId)) throw new Error('The saved base belongs to another meeting place.');
    const retainedBase = clone(base), removedIds = new Set(retainedBase.territories.filter(t => removed.has(named(t))).map(t => id(t.id)));
    retainedBase.territories = retainedBase.territories.filter(t => !removedIds.has(id(t.id)));
    retainedBase.houses.forEach(h => { if (removedIds.has(id(h.territoryId))) h.territoryId = null; if (removedIds.has(id(h.avoidTerritoryId))) h.avoidTerritoryId = null; });
    result = checkedMerge(result, { ...retainedBase, id: base.id || 'session-base', label: 'Complete saved location' }, true);
    if (workspace.editId && base.boundary) result.boundary = clone(base.boundary);
  }
  const liveNames = new Set(), liveIds = new Set();
  for (const territory of result.territories) {
    if (liveNames.has(named(territory))) throw new Error(`The current session contains two territories named “${territory.name}”. Review which one to keep before saving.`);
    liveNames.add(named(territory)); liveIds.add(id(territory.id));
    territory.congregation ||= workspace.congregation;
  }
  const wanted = [];
  const dirty = new Set(workspace.dirtyTerritoryIds || workspace.territories.map(t => id(t.id)));
  for (const group of groups) {
    const version = group.versions.find(v => v.id === group.keptVersionId) || group.versions[0];
    if (!version) continue;
    if (id(version.hallId) !== id(workspace.hallId)) throw new Error('A saved library group belongs to another meeting place.');
    if (removed.has(named(version.territory))) continue;
    const existing = result.territories.find(t => named(t) === named(version.territory) || id(t.id) === id(version.territory.id));
    if (existing && !dirty.has(id(existing.id)) && !(selected && (named(existing) === named(selected.territory) || id(existing.id) === id(selected.territory.id)))) {
      result.territories = result.territories.filter(t => t !== existing);
      result.houses.forEach(h => { if (id(h.territoryId) === id(existing.id)) h.territoryId = null; if (id(h.avoidTerritoryId) === id(existing.id)) h.avoidTerritoryId = null; });
      liveNames.delete(named(existing)); liveIds.delete(id(existing.id));
    }
    if (selected && (named(version.territory) === named(selected.territory) || id(version.territory.id) === id(selected.territory.id))) continue;
    if (!liveNames.has(named(version.territory)) && !liveIds.has(id(version.territory.id))) {
      wanted.push(version); liveNames.add(named(version.territory)); liveIds.add(id(version.territory.id));
    }
  }
  if (selected) {
    const replaceIds = new Set(result.territories.filter(t => named(t) === named(selected.territory) || id(t.id) === id(selected.territory.id)).map(t => id(t.id)));
    result.territories = result.territories.filter(t => !replaceIds.has(id(t.id)));
    result.houses.forEach(h => {
      if (replaceIds.has(id(h.territoryId))) h.territoryId = null;
      if (replaceIds.has(id(h.avoidTerritoryId))) h.avoidTerritoryId = null;
    });
    wanted.push(selected);
  }
  for (const version of wanted) result = checkedMerge(result, sourceFromVersion(version, workspace));
  result.removedTerritoryNames = [...removed].filter(name => !result.territories.some(t => named(t) === name));
  result.sessionScope = 'meeting-place'; result.editId = null; result.editing = false;
  return result;
}

function smallHash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }
export function workspaceTerritoryVersions(workspace, turf) {
  if (!workspace?.hallId || !Array.isArray(workspace.territories)) return [];
  const byTerritory = new Map(), avoids = [];
  for (const house of workspace.houses || []) {
    if (house.avoid) { avoids.push(house); continue; }
    if (house.included === false || !house.territoryId) continue;
    const key = id(house.territoryId);
    if (!byTerritory.has(key)) byTerritory.set(key, []);
    byTerritory.get(key).push(house);
  }
  return workspace.territories.map(territory => {
    const tid = id(territory.id), shape = geometry(territory);
    const members = byTerritory.get(tid) || [];
    const relevantAvoids = avoids.filter(home => {
      if (shape && turf?.booleanPointInPolygon) {
        try { return turf.booleanPointInPolygon(turf.point([Number(home.lng), Number(home.lat)]), turf.feature(shape)); } catch { return false; }
      }
      return id(home.avoidTerritoryId) === tid;
    });
    return { key: JSON.stringify([id(workspace.hallId), tid]), id: JSON.stringify(['session', workspace.generation, tid, smallHash(stable([territory, members, relevantAvoids]))]),
      source: 'session', recordId: '', planId: workspace.currentPlanId || '', hallId: id(workspace.hallId),
      congregation: territory.congregation || workspace.congregation, sourceName: 'Current meeting-place session',
      time: 0, pdfRecord: null, error: '', territory: { ...territory, geometry: shape }, houses: [...members, ...relevantAvoids] };
  });
}
export function withSessionTerritories(groups, workspace, turf) {
  const removed = new Set(workspace.removedTerritoryNames || []);
  const dirty = new Set(workspace.dirtyTerritoryIds || workspace.territories.map(t => id(t.id)));
  const output = groups.filter(g => !removed.has(g.nameBucket)).map(group => ({ ...group, versions: [...group.versions] }));
  for (const version of workspaceTerritoryVersions(workspace, turf)) {
    const bucket = named(version.territory);
    const group = output.find(g => g.nameBucket === bucket || g.versions.some(v => id(v.territory.id) === id(version.territory.id)));
    if (group) {
      if (dirty.has(id(version.territory.id))) {
        group.versions = [version, ...group.versions.filter(v => v.source !== 'session')];
        group.hasSessionVersion = true;
      }
    } else output.push({ key: version.key, nameBucket: bucket, versions: [version], alternatives: [], keptVersionId: '', hasSessionVersion: true });
  }
  return output.sort((a, b) => a.nameBucket.localeCompare(b.nameBucket, undefined, { numeric: true }));
}

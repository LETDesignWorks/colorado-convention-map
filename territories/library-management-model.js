import { nameKey, savedTime } from './backup-merge-model.js?v=territories-20261022-43';
import { mergeTerritoryWork } from './saved-work-model.js?v=territories-20261022-43';
const copy = value => JSON.parse(JSON.stringify(value));
function versionHomes(version) {
  const seen = new Set(), target = String(version.territory.id);
  return copy(version.houses).map(home => {
    const id = String(home.id || '');
    if (!id || seen.has(id)) throw new Error('This version has missing or repeated address IDs. Review its addresses first.');
    seen.add(id); home.id = id;
    if (home.avoid) { home.included = false; home.territoryId = null; home.avoidTerritoryId = target; }
    else if (home.included !== false) home.territoryId = target;
    return home;
  });
}
export function datedWorkName(hallName, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${String(hallName || 'Meeting location').trim()} — ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} MT`;
}
export function libraryChoice(records, hallId, name) {
  return [...records.values()].filter(r => !r.deletedAt && r.recordType === 'territory-name-choice' && String(r.hallId) === String(hallId) && r.normalizedName === nameKey(name))
    .sort((a, b) => savedTime(b) - savedTime(a) || String(b.id).localeCompare(String(a.id)))[0] || null;
}
export function combineChosenLocation(workspace, versions) {
  const result = copy(workspace);
  if (workspace.editId || workspace.editing) throw new Error('Finish the current territory edit and load the complete location set before saving a library set.');
  if (!versions.length) throw new Error('There are no saved territories for the selected congregation.');
  const names = new Set();
  for (const v of versions) {
    if (v.error || !v.territory?.id || !Array.isArray(v.houses)) throw new Error('A chosen version is incomplete. Review it before saving.');
    if (String(v.hallId) !== String(workspace.hallId) || v.congregation !== workspace.congregation) throw new Error('Choose versions from the selected meeting place and congregation.');
    const name = nameKey(v.territory.name);
    if (!name || names.has(name)) throw new Error('Choose only one version of each named territory.');
    names.add(name);
  }
  const replaced = new Set(result.territories.filter(t => names.has(nameKey(t.name))).map(t => String(t.id)));
  result.territories = result.territories.filter(t => !replaced.has(String(t.id)));
  result.houses.forEach(h => {
    if (replaced.has(String(h.territoryId || ''))) h.territoryId = null;
    if (replaced.has(String(h.avoidTerritoryId || ''))) h.avoidTerritoryId = null;
  });
  for (const v of versions) {
    const incoming = versionHomes(v);
    // Retain restrictive flags already in the location set. Restoring an older
    // territory must never silently turn a do-not-visit address into a ministry home.
    for (const h of incoming) {
      const prior = result.houses.find(p => String(p.id) === String(h.id) ||
        (String(p.address).trim().toLowerCase() === String(h.address).trim().toLowerCase() && String(p.unit || '') === String(h.unit || '') && Number(p.lat).toFixed(6) === Number(h.lat).toFixed(6) && Number(p.lng).toFixed(6) === Number(h.lng).toFixed(6)));
      if (prior?.avoid) { h.avoid = true; h.included = false; h.territoryId = null; h.avoidSource = prior.avoidSource || h.avoidSource || ''; }
      if (prior?.included === false) h.included = false;
    }
    const combined = mergeTerritoryWork(result.houses, result.territories, incoming, [copy(v.territory)], String(v.territory.id));
    result.houses = combined.houses; result.territories = combined.territories;
  }
  return result;
}
export function createLibraryManager(host) {
  let busy = false;
  const guard = hallId => {
    if (!host.isAdmin() || host.status() !== 'ready') throw new Error('Sign in and wait for saved records to finish loading.');
    if (String(host.hall()?.id) !== String(hallId)) throw new Error('The meeting place changed. Open the territory again.');
  };
  async function keep(version) {
    guard(version.hallId);
    if (busy) throw new Error('Finish the current library operation first.');
    if (version.error || !version.territory?.id || !version.houses?.length) throw new Error('This version is incomplete. Review its addresses first.');
    busy = true;
    try {
      const old = libraryChoice(host.records(), version.hallId, version.territory.name);
      if (old?.versionId === version.id) return old;
      const snapshot = { hallId: version.hallId, congregation: version.congregation,
        houses: versionHomes(version), territories: [copy(version.territory)], boundary: copy(version.territory.geometry || null) };
      const id = await host.saveSnapshot(snapshot, { kind: 'backup', libraryKept: true,
        name: `${datedWorkName(host.hall().name)} — KEEP ${version.territory.name}`, fromVersion: version.id });
      guard(version.hallId);
      const key = JSON.stringify([String(version.hallId), String(version.territory.id)]);
      return await host.writeChoice(version.hallId, version.territory.name, key,
        { versionId: JSON.stringify(['plan', id, 0]), hiddenVersionIds: old?.hiddenVersionIds || [] });
    } finally { busy = false; }
  }
  async function removeOthers(group, restore = false) {
    const version = group.versions[0]; guard(version.hallId);
    if (busy) throw new Error('Finish the current library operation first.');
    const choice = libraryChoice(host.records(), version.hallId, version.territory.name);
    if (!choice?.versionId || !group.versions.some(v => v.id === choice.versionId)) throw new Error('Save the exact version you want to keep before removing other versions.');
    busy = true;
    try {
      const hidden = restore ? [] : [...new Set([...(choice.hiddenVersionIds || []), ...group.versions.filter(v => v.id !== choice.versionId).map(v => v.id)])];
      return await host.writeChoice(version.hallId, version.territory.name, choice.territoryKey,
        { versionId: choice.versionId, hiddenVersionIds: hidden });
    } finally { busy = false; }
  }
  async function saveSet(versions, name) {
    const current = host.capture(); guard(current.hallId);
    if (busy) throw new Error('Finish the current library operation first.');
    const combined = combineChosenLocation(current, versions);
    busy = true;
    try {
      return await host.saveSnapshot(combined, { kind: 'work', name: String(name || '').trim() || datedWorkName(host.hall().name), sourceVersionIds: versions.map(v => v.id) });
    } finally { busy = false; }
  }
  async function removeVersion(group, versionId) {
    const version = group.versions[0]; guard(version.hallId);
    if (busy) throw new Error('Finish the current library operation first.');
    const choice = libraryChoice(host.records(), version.hallId, version.territory.name);
    if (!choice?.versionId || !group.versions.some(v => v.id === choice.versionId)) throw new Error('Save the exact version to keep first.');
    if (versionId === choice.versionId) throw new Error('The kept version is protected. Choose another version first.');
    if (!group.versions.some(v => v.id === versionId)) throw new Error('That version is no longer in this review.');
    busy = true;
    try {
      return await host.writeChoice(version.hallId, version.territory.name, choice.territoryKey,
        { versionId: choice.versionId, hiddenVersionIds: [...new Set([...(choice.hiddenVersionIds || []), versionId])] });
    } finally { busy = false; }
  }
  return { keep, removeOthers, removeVersion, saveSet, isBusy: () => busy };
}

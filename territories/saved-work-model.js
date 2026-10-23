// Independent saved-work snapshots. No network, database writes, or UI state.
const clean = value => String(value ?? '').trim();
const clone = value => JSON.parse(JSON.stringify(value));
export function workKey(hallId, congregation) {
  return JSON.stringify([clean(hallId), clean(congregation).replace(/\s+/g, ' ').toLowerCase()]);
}
export function workTime(record) {
  const value = record.updatedAt || record.createdAt;
  const date = value?.toDate ? value.toDate() : value && typeof value === 'object' && 'seconds' in value
    ? new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6) : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}
export function latestWork(plans) {
  const byKey = new Map();
  for (const plan of plans) {
    if (plan.deletedAt || plan.recordType !== 'territory-plan' || plan.saveKind !== 'work' || !plan.hallId || !plan.congregation) continue;
    const key = workKey(plan.hallId, plan.congregation), previous = byKey.get(key);
    if (!previous || workTime(plan) > workTime(previous)
      || (workTime(plan) === workTime(previous) && String(plan.id).localeCompare(String(previous.id)) > 0)) byKey.set(key, plan);
  }
  return [...byKey.values()].sort((a, b) => clean(a.hallName).localeCompare(clean(b.hallName), undefined, { numeric: true })
    || clean(a.congregation).localeCompare(clean(b.congregation)));
}
export function currentWorkFor(plans, hallId, congregation) {
  const key = workKey(hallId, congregation);
  return latestWork(plans).find(plan => workKey(plan.hallId, plan.congregation) === key) || null;
}
export function readPlanAddresses(plan, records) {
  const ids = Array.isArray(plan.chunkIds) ? plan.chunkIds : [...records.values()]
    .filter(item => item.recordType === 'territory-plan-chunk' && String(item.planId) === String(plan.id))
    .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex)).map(item => item.id);
  const houses = ids.flatMap(id => {
    const part = records.get(id);
    if (!part || (part.planId && String(part.planId) !== String(plan.id))) throw new Error('Saved address data is incomplete. Refresh saved records and retry.');
    const value = part.housesJson != null ? JSON.parse(part.housesJson) : part.houses;
    if (!Array.isArray(value)) throw new Error('Saved address data is incomplete. Refresh saved records and retry.');
    return value;
  });
  if (Number.isFinite(plan.houseCount) && houses.length !== plan.houseCount) throw new Error('The saved address count does not match. Refresh saved records and retry.');
  return clone(houses);
}
export function readPlanTerritories(plan) {
  const value = plan.territoriesJson ? JSON.parse(plan.territoriesJson) : (plan.territories || []);
  if (!Array.isArray(value)) throw new Error('Saved territory information is incomplete.');
  return clone(value);
}
function addressKey(house) {
  // Preserve units, suffixes, and distinct addresses. Never merge only by number.
  return [clean(house.address).replace(/\s+/g, ' ').toLowerCase(), clean(house.unit).toLowerCase()].join('|');
}
export function mergeTerritoryWork(baseHouses, baseTerritories, incomingHouses, incomingTerritories, territoryId) {
  const target = String(territoryId);
  const originals = new Map(baseHouses.map(house => [String(house.id), house]));
  const untouchedIds = new Set(baseTerritories.filter(territory => String(territory.id) !== target).map(territory => String(territory.id)));
  if (incomingTerritories.some(territory => untouchedIds.has(String(territory.id)))) throw new Error('An edited territory conflicts with another saved territory. Load the complete saved work before combining them.');
  const houses = clone(baseHouses);
  houses.forEach(house => {
    if (String(house.territoryId || '') === target) house.territoryId = null;
    if (String(house.avoidTerritoryId || '') === target) house.avoidTerritoryId = null;
  });
  const byId = new Map(houses.map(house => [String(house.id), house]));
  const incomingIds = new Set(), redirects = new Map();
  for (const source of incomingHouses) {
    const house = clone(source), id = String(house.id || '');
    if (!id || incomingIds.has(id)) throw new Error('The edited address list contains missing or repeated IDs.');
    incomingIds.add(id);
    let existing = byId.get(id);
    if (existing && addressKey(existing) !== addressKey(house)) throw new Error('An address ID points to two different addresses. The saved work has not been changed.');
    if (!existing) existing = houses.find(item => addressKey(item) === addressKey(house)
      && Number(item.lat).toFixed(6) === Number(house.lat).toFixed(6) && Number(item.lng).toFixed(6) === Number(house.lng).toFixed(6));
    if (existing) {
      const prior = originals.get(String(existing.id));
      if (prior && !prior.avoid && prior.territoryId && String(prior.territoryId) !== target) {
        throw new Error('An address is already assigned to another saved territory. Open the complete saved work to resolve this assignment.');
      }
      redirects.set(id, String(existing.id));
      const retainedId = String(existing.id);
      Object.assign(existing, house, { id: retainedId });
    } else {
      houses.push(house); byId.set(id, house);
    }
  }
  const territories = [...clone(baseTerritories.filter(territory => String(territory.id) !== target)), ...clone(incomingTerritories)];
  for (const territory of territories) {
    territory.houseIds = houses.filter(house => !house.avoid && house.included !== false && String(house.territoryId || '') === String(territory.id)).map(house => String(house.id));
  }
  // Homes removed from the edited territory remain available as unassigned homes.
  return { houses, territories };
}

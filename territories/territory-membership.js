// Membership review is separate from display and never silently steals homes.
const tid = value => String(value ?? '');
export function boundaryMembership(workspace, territoryId, turf) {
  const territory = workspace.territories.find(t => tid(t.id) === tid(territoryId));
  let geometry = territory?.geometry || territory?.geometryJson;
  if (typeof geometry === 'string') geometry = JSON.parse(geometry);
  if (geometry?.type === 'Feature') geometry = geometry.geometry;
  if (!territory || !['Polygon','MultiPolygon'].includes(geometry?.type)) throw new Error('This territory needs a drawn boundary before checking its addresses.');
  const result = { territory, geometry, assigned: [], unassigned: [], conflicts: [], avoids: [], excluded: [], outsideAssigned: [] };
  for (const home of workspace.houses) {
    if (home.lat == null || home.lng == null || !Number.isFinite(Number(home.lat)) || !Number.isFinite(Number(home.lng))) continue;
    let inside = false;
    try { inside = turf.booleanPointInPolygon(turf.point([Number(home.lng),Number(home.lat)]),turf.feature(geometry)); } catch { continue; }
    if (!inside) { if (!home.avoid && tid(home.territoryId) === tid(territoryId)) result.outsideAssigned.push(home); continue; }
    if (home.avoid) result.avoids.push(home);
    else if (home.included === false) result.excluded.push(home);
    else if (!home.territoryId) result.unassigned.push(home);
    else if (tid(home.territoryId) === tid(territoryId)) result.assigned.push(home);
    else result.conflicts.push(home);
  }
  return result;
}
export function fillBoundaryMembership(workspace, territoryId, turf, { moveConflicts = false, releaseOutside = false } = {}) {
  const result = JSON.parse(JSON.stringify(workspace));
  const review = boundaryMembership(result, territoryId, turf);
  for (const home of review.unassigned) home.territoryId = tid(territoryId);
  if (releaseOutside) for (const home of review.outsideAssigned) home.territoryId = null;
  if (moveConflicts) for (const home of review.conflicts) home.territoryId = tid(territoryId);
  for (const home of review.avoids) { home.territoryId = null; home.included = false; home.avoidTerritoryId = tid(territoryId); }
  for (const territory of result.territories) territory.houseIds = result.houses.filter(h => !h.avoid && h.included !== false && tid(h.territoryId) === tid(territory.id)).map(h => tid(h.id));
  return { draft: result, review };
}

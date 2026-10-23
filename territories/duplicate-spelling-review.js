// Explicit, user-confirmed spelling cleanup. This does NOT change automatic
// duplicate detection or authorize combining different units/directions/localities.
export function matchingSpellingReview(report, territoryId = null) {
  const choices = {}, groups = [];
  const mapped = h => h.lat != null && h.lng != null && String(h.lat).trim() !== '' && String(h.lng).trim() !== '' && Number.isFinite(+h.lat) && Number.isFinite(+h.lng) && Math.abs(+h.lat) <= 85 && Math.abs(+h.lng) <= 180 && !(Math.abs(+h.lat) < 1 && Math.abs(+h.lng) < 1);
  for (const group of report.groups || []) {
    choices[group.key] = { separate: true };
    const entries = group.entries || [];
    if (entries.length < 2 || group.directionConflict || entries.some(e => !e.identity || e.identity.ambiguous)) continue;
    if (group.territoryIds.length > 1 || (territoryId != null && !group.territoryIds.includes(String(territoryId)))) continue;
    const sameKnown = field => entries.every(e => e.identity[field]) && new Set(entries.map(e => e.identity[field])).size === 1;
    if (new Set(entries.map(e => e.identity.zip).filter(Boolean)).size > 1 || new Set(entries.map(e => e.identity.city).filter(Boolean)).size > 1) continue;
    if (!sameKnown('zip') && !sameKnown('city')) continue;
    const families = new Set(entries.map(e => e.identity.directionlessKey || e.identity.key));
    const directions = new Set(entries.map(e => e.identity.directionKey).filter(Boolean));
    if (families.size !== 1 || directions.size > 1) continue;
    // A complete directional spelling wins, but never choose an unmapped copy
    // over a mapped one. Avoid/excluded status is merged by the cleanup service.
    const candidates = entries.filter(e => mapped(e.house) && (!directions.size || e.identity.directionKey));
    const keep = candidates.find(e => e.index === group.preferredIndex) || candidates[0];
    if (!keep) continue;
    choices[group.key] = { keepIndex: keep.index, territoryId: group.territoryIds[0] || null };
    groups.push({ group, keep });
  }
  return { choices, groups, removals: groups.reduce((n, x) => n + x.group.count, 0) };
}

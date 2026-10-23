// Candidate matching only: an absent direction is not permission to erase it.
const directions = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const suffixes = new Set(['ST','AVE','RD','DR','CT','CIR','LN','PL','BLVD','PKWY','TER','TRL','WAY','LOOP','HWY','TRCE','SQ','PASS','PT']);
export function addDirectionIdentity(identity) {
  const match = identity.street.match(/^(\d+[A-Z]?(?:-\d+[A-Z]?)?(?:\s+1\/2)?)\s+(.+)$/);
  if (!match) return { ...identity, directionKey: '', directionlessKey: identity.key };
  const tokens = match[2].split(' ');
  let before = '', after = '';
  if (tokens.length >= 3 && directions.has(tokens.at(-1)) && suffixes.has(tokens.at(-2))) after = tokens.pop();
  // NORTH ST is a street named North, not a direction-only street.
  if (tokens.length >= 3 && directions.has(tokens[0]) && suffixes.has(tokens.at(-1))) before = tokens.shift();
  return { ...identity, directionKey: before || after ? `${before}|${after}` : '',
    directionlessKey: JSON.stringify([[match[1], ...tokens].join(' '), identity.unit, identity.building]) };
}
export function directionalDuplicateBuckets(exactBuckets) {
  const families = new Map(), output = new Map();
  for (const [key, entries] of exactBuckets) {
    const family = entries[0].identity.directionlessKey || key;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push([key, entries]);
  }
  for (const [family, buckets] of families) {
    const hasPlain = buckets.some(([, entries]) => !entries[0].identity.directionKey);
    const hasDirection = buckets.some(([, entries]) => entries[0].identity.directionKey);
    if (hasPlain && hasDirection) output.set(`direction:${family}`, buckets.flatMap(([, entries]) => entries));
    else for (const [key, entries] of buckets) output.set(key, entries);
  }
  return output;
}
export function directionMatchDetails(entries) {
  const present = new Set(entries.map(e => e.identity.directionKey).filter(Boolean));
  const missing = present.size > 0 && entries.some(e => !e.identity.directionKey);
  const sameKnown = field => entries.every(e => e.identity[field]) && new Set(entries.map(e => e.identity[field])).size === 1;
  const cities = new Set(entries.map(e => e.identity.city).filter(Boolean));
  return { missing, conflict: missing && present.size > 1, cityConflict: cities.size > 1,
    corroborated: sameKnown('zip') || sameKnown('city') };
}
export function preferredDuplicateEntry(entries) {
  // Prefer a complete directional address without discarding any avoid/excluded flag.
  return entries.find(e => e.identity.directionKey && e.house.avoid)
    || entries.find(e => e.identity.directionKey)
    || entries.find(e => e.house.avoid) || entries[0];
}

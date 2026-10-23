// Read-only detection and pure draft cleanup. Never writes to saved records.
const text = value => String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
const copy = value => JSON.parse(JSON.stringify(value));
const suffix = { STREET:'ST',ST:'ST',AVENUE:'AVE',AVE:'AVE',ROAD:'RD',RD:'RD',DRIVE:'DR',DR:'DR',COURT:'CT',CT:'CT',CIRCLE:'CIR',CIR:'CIR',LANE:'LN',LN:'LN',PLACE:'PL',PL:'PL',BOULEVARD:'BLVD',BLVD:'BLVD',PARKWAY:'PKWY',PKWY:'PKWY',TERRACE:'TER',TER:'TER',TRAIL:'TRL',TRL:'TRL',WAY:'WAY',LOOP:'LOOP',HIGHWAY:'HWY',HWY:'HWY',TRCE:'TRCE',TRACE:'TRCE',SQUARE:'SQ',SQ:'SQ',PASS:'PASS',POINT:'PT',PT:'PT' };
const directions = { NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW' };
const normalizeUnit = value => text(value).replace(/^(?:APT|APARTMENT|UNIT|SUITE|STE)\.?\s*/,'').replace(/^#\s*/,'').replace(/[.,]/g,'').trim();
function mapped(h) { return h.lat != null && h.lng != null && String(h.lat).trim() !== '' && String(h.lng).trim() !== '' && Number.isFinite(+h.lat) && Number.isFinite(+h.lng) && Math.abs(+h.lat) <= 85.051129 && Math.abs(+h.lng) <= 180 && !(Math.abs(+h.lat) < 1 && Math.abs(+h.lng) < 1); }
export function duplicateAddressIdentity(house) {
  let value = text(house.address || house.baseAddress).replace(/[.]/g,'');
  let unit = normalizeUnit(house.unit), embedded = '', building = text(house.building || house.buildingNumber), ambiguous = false;
  value = value.replace(/\b(?:BUILDING|BLDG)\s+([A-Z0-9-]+)/g, (_,v) => { if (building && building !== v) ambiguous = true; building ||= v; return ' '; });
  value = value.replace(/(?:\b(?:APARTMENT|APT|UNIT|SUITE|STE)\s*|#\s*)([A-Z0-9-]+)/g, (_,v) => { if (embedded && embedded !== v) ambiguous = true; embedded = v; return ' '; });
  if (unit && embedded && unit !== embedded) ambiguous = true;
  unit ||= embedded;
  const zip = value.match(/\b(\d{5})(?:-\d{4})?\s*(?:USA|US)?$/)?.[1] || text(house.zip || house.zipCode || house.postalCode).slice(0,5);
  const parts = value.split(',');
  let street = parts[0].trim().replace(/\s+/g,' ');
  const match = street.match(/^(\d+[A-Z]?(?:-\d+[A-Z]?)?(?:\s+1\/2)?)\s+(.+)$/);
  if (!match) return null;
  let tokens = match[2].split(' ').filter(Boolean), end = -1;
  // A recognized suffix needs a street-name token before it. Keep directional suffixes.
  tokens.forEach((token,i) => { if (i > 0 && suffix[token]) end = i; });
  let city = parts.slice(1).join(' ').replace(/\b(?:CO|COLORADO|USA|US)\b/g,'').replace(/\b\d{5}(?:-\d{4})?\b/g,'').trim();
  if (end >= 0) {
    let stop = end + 1;
    if (/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST|NORTHEAST|NORTHWEST|SOUTHEAST|SOUTHWEST)$/.test(tokens[stop] || '')) stop++;
    city ||= tokens.slice(stop).join(' ').replace(/\b(?:CO|COLORADO|USA|US)\b/g,'').replace(/\b\d{5}(?:-\d{4})?\b/g,'').trim();
    tokens = tokens.slice(0,stop);
  } else {
    // No guess at where a suffix-less street ends: use the comma/explicit city fields.
    const locality = text(house.city);
    if (locality) tokens = tokens.join(' ').split(locality)[0].trim().split(' ');
    tokens = tokens.join(' ').replace(/\s+(?:CO|COLORADO)\s+\d{5}(?:-\d{4})?$/,'').split(' ');
  }
  if (!tokens.length || tokens.every(t => /^\d+$/.test(t))) return null;
  const streetKey = [match[1], ...tokens.map(t => suffix[t] || directions[t] || t)].join(' ');
  return { key: JSON.stringify([streetKey,unit,building]), street: streetKey, unit, building, zip, city: text(city || house.city), ambiguous };
}
function memberships(houses, territories) {
  const fallback = new Map();
  for (const t of territories) for (const id of t.houseIds || []) {
    const key = String(id); if (!fallback.has(key)) fallback.set(key,new Set()); fallback.get(key).add(String(t.id));
  }
  return houses.map(h => h.avoid ? [] : h.territoryId ? [String(h.territoryId)] : [...(fallback.get(String(h.id)) || [])]);
}
export function scanDuplicateAddresses(houses, territories = [], territoryId = null) {
  if (!Array.isArray(houses) || !Array.isArray(territories)) throw new Error('The address set is incomplete.');
  const assignments = memberships(houses,territories), buckets = new Map(); let unchecked = 0;
  houses.forEach((house,index) => {
    const identity = duplicateAddressIdentity(house);
    if (!identity) { unchecked++; return; }
    if (!buckets.has(identity.key)) buckets.set(identity.key,[]);
    buckets.get(identity.key).push({ index, identity, house, assignments: assignments[index] });
  });
  const groups = [];
  for (const [key,entries] of buckets) {
    if (entries.length < 2) continue;
    if (territoryId != null && !entries.some(e => e.assignments.includes(String(territoryId)) || String(e.house.avoidTerritoryId || '') === String(territoryId))) continue;
    const places = new Set(entries.flatMap(e => e.assignments));
    const valid = entries.every(e => mapped(e.house));
    let minLat=Infinity,maxLat=-Infinity,minLng=Infinity,maxLng=-Infinity;
    for(const e of entries){minLat=Math.min(minLat,+e.house.lat);maxLat=Math.max(maxLat,+e.house.lat);minLng=Math.min(minLng,+e.house.lng);maxLng=Math.max(maxLng,+e.house.lng);}
    const spread = valid ? Math.hypot((maxLat-minLat)*111320, (maxLng-minLng)*111320*Math.cos(minLat*Math.PI/180)) : Infinity;
    const ambiguous = entries.some(e => e.identity.ambiguous);
    const zips = new Set(entries.map(e => e.identity.zip).filter(Boolean));
    const confirmed = valid && spread <= 35 && !ambiguous && zips.size <= 1;
    const safe = confirmed && places.size <= 1;
    const reasons = [];
    if (!valid) reasons.push('A map location is missing');
    else if (spread > 35) reasons.push('Map locations differ');
    if (zips.size > 1) reasons.push('ZIP codes differ');
    if (ambiguous) reasons.push('Unit or building information conflicts');
    if (places.size > 1) reasons.push('Appears in more than one territory');
    const first = entries[0].identity;
    groups.push({ key, label: first.street + (first.unit ? ` — Unit ${first.unit}` : '') + (first.building ? ` — Building ${first.building}` : ''),
      entries, territoryIds: [...places], confirmed, safe, reasons,
      avoid: entries.some(e => e.house.avoid), excluded: entries.some(e => e.house.included === false), count: entries.length-1 });
  }
  return { groups, checked: houses.length-unchecked, unchecked,
    duplicates: groups.reduce((n,g)=>n+g.count,0), safe: groups.filter(g=>g.safe).reduce((n,g)=>n+g.count,0),
    review: groups.filter(g=>!g.safe).length };
}
function mergeHome(keep, entries, territoryId) {
  const homes = entries.map(e=>e.house), result = copy(keep);
  for (const h of homes) for (const [key,value] of Object.entries(h)) if (value !== undefined && (result[key] == null || result[key] === '')) result[key] = copy(value);
  const joined = field => [...new Set(homes.map(h=>h[field]).filter(Boolean))].join(' | ');
  result.avoid = homes.some(h=>h.avoid); result.included = !result.avoid && homes.every(h=>h.included !== false);
  result.unitCount = Math.max(1,...homes.map(h=>Number(h.unitCount)||1));
  result.residential = homes.every(h=>h.residential !== false);
  result.source = joined('source'); result.avoidSource = joined('avoidSource');
  for (const key of ['manualGap','supplemental','bulkImported']) result[key] = homes.some(h=>h[key]);
  const batches = new Map();
  for (const h of homes) (h.bulkBatchIds?.length ? h.bulkBatchIds : h.bulkBatchId ? [h.bulkBatchId] : []).forEach((id,i)=>batches.set(String(id),h.bulkBatchNames?.[i] || h.bulkBatchName || batches.get(String(id)) || 'Imported addresses'));
  result.bulkBatchIds = [...batches.keys()]; result.bulkBatchNames = [...batches.values()];
  result.bulkBatchId = result.bulkBatchIds[0] || ''; result.bulkBatchName = result.bulkBatchNames[0] || '';
  result.territoryId = result.included ? territoryId || null : null;
  result.avoidTerritoryId = result.avoid ? keep.avoidTerritoryId || homes.find(h=>h.avoidTerritoryId)?.avoidTerritoryId || territoryId || null : null;
  return result;
}
export function cleanDuplicateAddresses(workspace, { territoryId = null, decisions = {} } = {}) {
  const identities=new Map();
  for(const h of workspace.houses){ const id=String(h.id||''), key=duplicateAddressIdentity(h)?.key || text(h.address); if(!id)throw new Error('An address is missing its ID. Reload or repair it before cleanup.'); if(identities.has(id)&&identities.get(id)!==key)throw new Error('Different addresses share an ID. Reload or repair the set before cleanup.'); identities.set(id,key); }
  const report = scanDuplicateAddresses(workspace.houses,workspace.territories,territoryId);
  const draft = copy(workspace), deleted = new Set(), remap = new Map(); let removed = 0;
  for (const group of report.groups) {
    const decision = decisions[group.key];
    if (decision?.separate || (!group.safe && !decision)) continue;
    const keepIndex = decision?.keepIndex ?? group.entries.find(e=>e.house.avoid)?.index ?? group.entries[0].index;
    const keep = group.entries.find(e=>e.index === Number(keepIndex));
    if (!keep) throw new Error('The chosen address changed. Scan again.');
    if (group.entries.some(e=>e.identity.ambiguous)) throw new Error('Correct conflicting unit/building information before merging these records.');
    const destination = decision?.territoryId ?? group.territoryIds[0] ?? null;
    if (group.territoryIds.length > 1 && !Object.hasOwn(decision || {},'territoryId')) throw new Error('Choose which territory should keep the repeated address.');
    if (destination && !group.territoryIds.includes(String(destination))) throw new Error('Choose an existing territory shown in this duplicate group.');
    draft.houses[keep.index] = mergeHome(keep.house,group.entries,destination);
    for (const entry of group.entries) {
      remap.set(String(entry.house.id),String(keep.house.id));
      if (entry.index !== keep.index) { deleted.add(entry.index); removed++; }
    }
  }
  draft.houses = draft.houses.filter((_,i)=>!deleted.has(i));
  const byId = new Map(draft.houses.map(h=>[String(h.id),h]));
  for (const t of draft.territories) {
    const wanted = new Set((t.houseIds || []).map(id=>remap.get(String(id)) || String(id)));
    t.houseIds = draft.houses.filter(h=>!h.avoid && h.included !== false && (h.territoryId ? String(h.territoryId) === String(t.id) : wanted.has(String(h.id)))).map(h=>h.id);
    t.houseIds = [...new Set(t.houseIds)].filter(id=>byId.has(String(id)));
  }
  return { draft, removed, report, remaining: scanDuplicateAddresses(draft.houses,draft.territories,territoryId) };
}
export function duplicateSummary(report) {
  return report.groups.length ? `${report.duplicates} repeated address record(s) in ${report.groups.length} group(s); ${report.safe} can be combined safely${report.review ? `; ${report.review} need a keep/location decision` : ''}.`
    : `No duplicate addresses detected in ${report.checked} checkable records${report.unchecked ? `; ${report.unchecked} could not be checked` : ''}.`;
}
// Assemble only the chosen/current version of each territory for a review.
// Copies appearing in different historical saves are NOT counted as duplicates.
// Address duplicates within a chosen version remain intact until explicit cleanup.
export function duplicateReviewWorkspace(workspace, groups, { selected = null, base = null } = {}) {
  const draft = copy(workspace), sourceHomes = [...(base?.houses || []), ...workspace.houses];
  draft.houses = []; draft.territories = [];
  const used = new Set(), rowsById = new Map(); let serial = 0;
  const makeId = old => { let value = String(old || `address-${++serial}`); while (used.has(value)) value = `duplicate-review-${++serial}-${old}`; used.add(value); return value; };
  const same = (a,b) => { const key=duplicateAddressIdentity(a)?.key; return Boolean(key && key===duplicateAddressIdentity(b)?.key); };
  // Base/current repetitions are representations of the same record, not repeated uploads.
  for (const [index,original] of sourceHomes.entries()) {
    const old = String(original.id || ''), isCurrent = index >= (base?.houses.length || 0);
    const prior = rowsById.get(old)?.find(row => same(row,original) && row._baseOnly && isCurrent);
    if (prior) { Object.assign(prior,mergeHome({...original,id:prior.id},[{house:prior},{house:original}],null),{_baseOnly:false}); continue; }
    const row = { ...copy(original), id:makeId(old), _baseOnly:!isCurrent };
    if (!rowsById.has(old)) rowsById.set(old,[]); rowsById.get(old).push(row); draft.houses.push(row);
  }
  for (const h of draft.houses) { h.territoryId = null; h.avoidTerritoryId = null; }
  const chosen = groups.map(g => g.versions[0]?.source === 'session' ? g.versions[0] : g.versions.find(v=>v.id===g.keptVersionId)||g.versions[0]).filter(Boolean);
  if (selected) {
    const match = v => String(v.territory.id) === String(selected.territory.id) || text(v.territory.name) === text(selected.territory.name);
    for (let i=chosen.length-1;i>=0;i--) if(match(chosen[i])) chosen.splice(i,1);
    chosen.push(selected);
  }
  const assigned = new Set();
  for (const version of chosen) {
    if (version.error || !Array.isArray(version.houses) || String(version.hallId) !== String(workspace.hallId)) throw new Error('A chosen territory is incomplete or belongs to another meeting place. Refresh and review it first.');
    const t = copy(version.territory); t.id = String(t.id); t.houseIds = []; t.congregation ||= version.congregation || workspace.congregation;
    draft.territories.push(t);
    for (const original of version.houses) {
      const old = String(original.id || '');
      let row = rowsById.get(old)?.find(h=>!assigned.has(h.id)&&same(h,original));
      if (!row) {
        row = {...copy(original), id:makeId(old)}; draft.houses.push(row);
        if (!rowsById.has(old)) rowsById.set(old,[]); rowsById.get(old).push(row);
      } else {
        const id = row.id; Object.assign(row,mergeHome({...original,id},[{house:row},{house:original}],null));
      }
      assigned.add(row.id);
      if (row.avoid) { row.included=false; row.territoryId=null; row.avoidTerritoryId=t.id; }
      else if (row.included !== false) { row.territoryId=t.id; row.avoidTerritoryId=null; t.houseIds.push(row.id); }
    }
  }
  for (const h of draft.houses) delete h._baseOnly;
  draft.editId=null; draft.editing=false; draft.sessionScope='meeting-place';
  return draft;
}

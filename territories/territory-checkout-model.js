// Read-only roster projection. Never copies household addresses or writes records.
const text = value => String(value ?? '').trim();
const key = value => text(value).normalize('NFKC').toUpperCase().replace(/\s+/g, ' ');
export function checkoutRoster(hall, groups, {congregation = ''} = {}) {
  if (!text(hall?.id)) throw Error('Select a meeting place first.');
  if (!Array.isArray(groups)) throw Error('The saved territory list is not ready.');
  const rows = [], seen = new Set();
  for (const group of groups) {
    const version = group.versions?.[0]?.source === 'session' ? group.versions[0]
      : group.versions?.find(v => v.id === group.keptVersionId) || group.versions?.[0];
    if (!version) continue;
    if (text(version.hallId) !== text(hall.id)) throw Error('A territory belongs to another meeting place. Reload the list.');
    const host = text(version.territory?.congregation || version.congregation);
    if (congregation && key(host) !== key(congregation)) continue;
    const name = text(version.territory?.name) || `Territory ${text(version.territory?.id)}`;
    if (!text(version.territory?.id) || seen.has(key(name))) throw Error('Review duplicate or unnamed territories before printing the register.');
    seen.add(key(name));
    rows.push({id:text(version.territory.id), name, congregation:host, source:version.source,
      needsReview:Boolean(version.error || group.reviewNeeded)});
  }
  rows.sort((a,b) => a.name.localeCompare(b.name, 'en', {numeric:true}) || a.id.localeCompare(b.id));
  return {hall:{id:text(hall.id), name:text(hall.name), address:text(hall.address)},
    congregation:text(congregation), rows, sessionRows:rows.filter(r => r.source === 'session').length,
    reviewRows:rows.filter(r => r.needsReview).length};
}
export function checkoutOptions(input = {}) {
  const date = text(input.date);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date)) throw Error('Choose a valid activity date, or leave it blank.');
  const blankRows = Number(input.blankRows ?? 2);
  if (!Number.isInteger(blankRows) || blankRows < 0 || blankRows > 30) throw Error('Choose 0 to 30 extra blank lines.');
  return {date, session:text(input.session).slice(0,70), coordinator:text(input.coordinator).slice(0,80), blankRows};
}

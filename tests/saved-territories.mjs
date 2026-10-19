import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectSavedTerritories, createSavedLayerLoader, savedGeometry, savedTime } from '../territories/saved-territories-model.js';
import { makePdfArchive, readArchiveSnapshot, readArchivePdf } from '../territories/pdf-archive.js';

const polygon = { type: 'Polygon', coordinates: [[[-105, 39], [-104.99, 39], [-104.99, 39.01], [-105, 39.01], [-105, 39]]] };
const territory = (id, name = 'Same Name') => ({ id, name, geometryJson: JSON.stringify(polygon), houseIds: [id + '-home'] });
const home = id => ({ id: id + '-home', territoryId: id, lat: 39.005, lng: -104.995, address: '100 Example Street', included: true });
const plan = (id, hallId, time, territories, extra = {}) => ({ id, hallId, recordType: 'territory-plan', updatedAt: time,
  planName: id, congregation: 'Example congregation', territoriesJson: JSON.stringify(territories), chunkIds: [id + '-chunk'], houseCount: territories.length, ...extra });
const chunk = (id, territories) => ({ id: id + '-chunk', recordType: 'territory-plan-chunk', planId: id, chunkIndex: 0, housesJson: JSON.stringify(territories.map(t => home(t.id))) });
const records = new Map();
const add = value => records.set(value.id, value);
add(plan('plan-old', 'hall-a', '2021-01-01', [territory('one'), territory('two')])); add(chunk('plan-old', [territory('one'), territory('two')]));
add(plan('plan-new', 'hall-a', '2026-10-19', [territory('one', 'Renamed One')])); add(chunk('plan-new', [territory('one')]));
add(plan('other-congregation', 'hall-a', '2025-04-01', [territory('three')], { congregation: 'Other congregation' })); add(chunk('other-congregation', [territory('three')]));
add(plan('other-hall', 'hall-b', '2027-01-01', [territory('one')])); add(chunk('other-hall', [territory('one')]));
const snapshots = new Map(), pdfs = new Map();
async function addPdf(id, tid, time, options = {}) {
  const snapshot = { hall: { id: 'hall-a' }, congregation: 'PDF congregation', territory: { id: tid, name: 'Same Name', geometry: polygon }, houses: [home(tid)] };
  const bytes = new Blob(['%PDF-1.4\nexact stored test PDF\n%%EOF'], { type: 'application/pdf' });
  const archive = await makePdfArchive(id, bytes, snapshot, { hallId: 'hall-a', territoryId: tid, territoryName: 'Same Name', updatedAt: time,
    recordType: 'territory-pdf', planId: 'plan-old', filename: id + '.pdf', ...options });
  add(archive.record); snapshots.set(id, archive); pdfs.set(id, bytes);
}
await addPdf('pdf-older', 'one', '2020-01-01');
await addPdf('pdf-latest', 'one', '2026-10-20');
await addPdf('pdf-only', 'four', '2019-06-01');
await addPdf('layout-refreshed', 'two', '2026-10-21', { territorySavedAt: '2020-01-01' });
const readSnapshot = async record => readArchiveSnapshot(record, snapshots.get(record.id).parts);
const before = JSON.stringify([...records]), archiveBefore = JSON.stringify([...snapshots]);
const result = await collectSavedTerritories({ records, hallId: 'hall-a', readSnapshot });
assert.equal(result.groups.length, 4, 'same-name territories remain separate; PDF-only and old saves included');
assert.equal(result.planCount, 3); assert.equal(result.pdfCount, 4); assert.equal(result.issues.length, 0);
const group = id => result.groups.find(g => g.versions[0].territory.id === id);
assert.equal(group('one').versions.length, 4);
assert.equal(group('one').versions[0].recordId, 'pdf-latest');
assert.equal(group('two').versions[0].recordId, 'plan-old', 'layout rebuild date must not supersede newer territory content');
assert.ok(group('one').versions.some(v => v.territory.name === 'Renamed One'), 'renames retain history by stable ID');
assert.equal(group('three').versions[0].congregation, 'Other congregation');
assert.equal(JSON.stringify([...records]), before, 'collection is read-only');
assert.equal(JSON.stringify([...snapshots]), archiveBefore, 'snapshots are read-only');
group('one').versions[0].houses[0].address = 'changed only in viewer';
assert.equal(JSON.stringify([...snapshots]), archiveBefore, 'view models are independent copies');
assert.deepEqual(savedGeometry(group('two').versions[0], {}), polygon);
assert.equal(savedTime({ seconds: 1609459200 }), Date.parse('2021-01-01'));
assert.equal(savedTime({ toDate: () => new Date('2021-01-01') }), Date.parse('2021-01-01'));
assert.equal(savedTime('invalid'), 0);
assert.deepEqual((await collectSavedTerritories({ records, hallId: 'empty', readSnapshot })).groups, []);
const pdfRecord = records.get('pdf-older'), pdf = readArchivePdf(pdfRecord, snapshots.get(pdfRecord.id).parts);
assert.deepEqual(new Uint8Array(await pdf.arrayBuffer()), new Uint8Array(await pdfs.get(pdfRecord.id).arrayBuffer()), 'opens exact PDF bytes');

// Legacy formats, numeric meeting place IDs, absent territory IDs and bad parts.
const legacy = new Map([
  ['legacy', { id: 'legacy', hallId: 7, recordType: 'territory-plan', updatedAt: '2022-01-01', territories: [territory('legacy-id')], houseCount: 1 }],
  ['legacy-part', { id: 'legacy-part', recordType: 'territory-plan-chunk', planId: 'legacy', chunkIndex: 0, houses: [home('legacy-id')] }],
  ['anonymous', { id: 'anonymous', hallId: '7', recordType: 'territory-plan', territories: [{ name: 'Same' }, { name: 'Same' }], chunkIds: [], houseCount: 0 }]
]);
const old = await collectSavedTerritories({ records: legacy, hallId: '7', readSnapshot });
assert.equal(old.groups.length, 3); assert.equal(old.issues.length, 0);
legacy.delete('legacy-part');
const broken = await collectSavedTerritories({ records: legacy, hallId: '7', readSnapshot });
assert.equal(broken.issues.length, 1); assert.ok(broken.groups.some(g => g.versions[0].error));
add({ id: 'broken-pdf', hallId: 'hall-a', recordType: 'territory-pdf', territoryId: 'one', territoryName: 'Same Name', updatedAt: '2029-01-01' });
const failure = await collectSavedTerritories({ records, hallId: 'hall-a', readSnapshot });
assert.equal(failure.groups.find(g => g.versions[0].territory.id === 'one').versions[0].recordId, 'broken-pdf');
assert.ok(failure.groups.find(g => g.versions[0].recordId === 'broken-pdf').versions[0].error, 'failed latest never silently substitutes older geometry');
records.delete('broken-pdf');
const invalid = await collectSavedTerritories({ records, hallId: 'hall-a', readSnapshot: async record => ({ ...await readSnapshot(record), hall: { id: 'hall-b' } }) });
assert.equal(invalid.issues.length, 4, 'reject mismatched PDF meeting place');

const originalRecord = records.get('pdf-older');
originalRecord.originalPdf = { ...originalRecord };
const originals = await collectSavedTerritories({ records, hallId: 'hall-a', readSnapshot });
assert.ok(originals.groups.some(g => g.versions.some(v => v.source === 'original')), 'retained original PDFs have separate version entries');

// Concurrent loads, hiding and changing context must discard pending results.
let resolveFirst;
const loader = createSavedLayerLoader(async ({ hallId }) => hallId === 'slow' ? new Promise(resolve => { resolveFirst = resolve; }) : { hallId });
const slow = loader.load({ hallId: 'slow' });
assert.deepEqual(await loader.load({ hallId: 'fast' }), { hallId: 'fast' });
resolveFirst({ hallId: 'slow' }); assert.equal(await slow, null);
const hidden = loader.load({ hallId: 'slow' }); loader.cancel(); resolveFirst({ hallId: 'slow' }); assert.equal(await hidden, null);

// Boundary fallback only consumes the saved addresses, never live workspace houses.
let buffered;
const fakeTurf = { point: coordinates => ({ geometry: { coordinates } }), buffer: value => { buffered = value; return { type: 'Feature' }; } };
savedGeometry({ territory: {}, houses: [home('one'), { ...home('avoid'), avoid: true }], error: '' }, fakeTurf);
assert.deepEqual(buffered.geometry.coordinates, [-104.995, 39.005]);
assert.equal(savedGeometry({ territory: {}, houses: [], error: '' }, fakeTurf), null);

// Guard the production integration: the component receives no mutable workspace
// or load/save API, and its PDF reader cannot rebuild or publish an archive.
const source = await readFile(new URL('../territories/app-main.js', import.meta.url), 'utf8');
const mount = source.slice(source.indexOf('  mountSavedTerritories({'), source.indexOf('  setupRecoveryImport({'));
assert.ok(mount.includes('readArchivePdf(record, await archiveParts(record, \'pdf\'))'));
assert.doesNotMatch(mount, /loadPlanRecord|clearPlanWorkspace|savePlan|refreshSavedPdfRecord|houses|territories,/);
console.log('Saved territories: all-date/Hall filtering, stable identity, renames, latest/history/originals, legacy data, corrupted snapshots, exact PDF bytes, no mutations, and cancellation passed.');

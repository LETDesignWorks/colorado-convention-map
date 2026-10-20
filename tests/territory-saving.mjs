// Exercise the real save/load functions against an isolated atomic store.
// No production Firebase records or personal address data are used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { makePdfArchive, readArchivePdf, readArchiveSnapshot, PDF_LAYOUT_VERSION } from '../territories/pdf-archive.js';
import { validateRecoveryPackage, sha256 } from '../territories/territory-recovery.js';

const source = (await readFile(new URL('../territories/app-main.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replaceAll('import.meta.url', "'http://localhost/territories/app-main.js'").replace(/^initialize\(\);\s*$/m, '');
const store = new Map();
let nextId = 1, failCommit = false, failManifest = false, gate = null, commits = 0, failAtCommit = null;
const committedWrites = [];
const clone = value => structuredClone(value);
const doc = (...args) => ({ id: args.length === 1 ? `test-${nextId++}` : args.at(-1) });
const writeBatch = () => {
  const operations = [];
  return {
    set(ref, data, options) { operations.push({ type: 'set', ref, data: clone(data), options }); },
    delete(ref) { operations.push({ type: 'delete', ref }); },
    async commit() {
      commits++;
      if (gate) await gate;
      if (failCommit || commits === failAtCommit) throw Object.assign(new Error('Simulated permission failure'), { code: 'permission-denied' });
      committedWrites.push(...operations);
      operations.forEach(operation => {
        if (operation.type === 'delete') store.delete(operation.ref.id);
        else store.set(operation.ref.id, operation.options?.merge
          ? { ...store.get(operation.ref.id), ...operation.data } : operation.data);
      });
    }
  };
};
function realm() {
  const elements = new Map(), messages = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', checked: true,
      disabled: false, hidden: false, dataset: {}, style: {}, querySelectorAll: () => [],
      addEventListener() {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const context = vm.createContext({ console: { error() {} }, Blob, Uint8Array, Date, Intl, Math, JSON,
    URL, setTimeout, clearTimeout, btoa, atob, makePdfArchive, readArchivePdf, readArchiveSnapshot, PDF_LAYOUT_VERSION, normalizeAddressKey: value => value,
    document: { getElementById: element }, window: { dispatchEvent() {} },
    CustomEvent: class {}, confirm: () => true, ASSESSOR_SOURCES: { manual: {} },
    collection: () => ({}), doc, writeBatch, serverTimestamp: () => new Date(),
    query: (...args) => args, where: (...args) => args, onSnapshot: (_query, _options, callback) => { context.snapshotCallback = callback; return () => {}; },
    setDoc: async (ref, data) => { if (failManifest) throw Error('Simulated manifest failure'); store.set(ref.id, clone(data)); },
    getDoc: async ref => ({ id: ref.id, exists: () => store.has(ref.id), data: () => clone(store.get(ref.id)) }),
    L: { geoJSON: () => ({ addTo: () => ({ getBounds: () => ({ isValid: () => false }) }) }) },
    testMessages: messages
  });
  vm.runInContext(source + `
    currentUser = { email: ADMIN_EMAIL }; db = {};
    hallLocations = [{ id: 'test-hall', name: 'Test Hall' }];
    dedupeHouseRecords = () => 0;
    toast = (message, error) => testMessages.push({ message, error });
    updateSummary = () => {}; emitPlannerDataChange = () => {}; updateBoundaryUi = () => {};
    renderAllPlanningData = () => {}; cancelTerritoryBoundaryEdit = () => {};
    restoreHallAndCongregation = (id, congregation) => { selectedHall = { id, name: 'Test Hall' }; selectedCongregation = congregation; };
    currentSourceKey = () => 'manual';
    boundaryGroup = { clearLayers() {} };
    globalThis.test = {
      savePlan, saveTerritoryPdf, loadPlanRecord, openSavedPdf, editSavedTerritory, subscribeReviews, clearPlanWorkspace, restoreRecoveryPackage, refreshSavedPdfRecord,
      seed(data) { houses = data.houses; territories = data.territories; boundaryGeometry = data.geometry;
        selectedHall = data.hall; selectedCongregation = data.congregation; els.planName.value = data.name || 'Test Plan'; },
      reload(records) { reviewRecords = new Map(records); renderSavedRecords(); },
      state() { return { houses, territories, boundaryGeometry, currentPlanId, selectedCongregation }; },
      record(id) { return reviewRecords.get(id); }
    };
  `, context);
  return { test: context.test, context, elements, element, messages };
}
const geometry = { type: 'Polygon', coordinates: [[[-105,39.5],[-104.9,39.5],[-104.9,39.6],[-105,39.6],[-105,39.5]]] };
const houses = Array.from({ length: 360 }, (_, index) => ({ id: `h-${index}`, address: `${1000 + index} Test St`,
  lat: 39.55, lng: -104.95 + index * .00001, included: true, territoryId: index < 180 ? 'territory-a' : 'territory-b' }));
houses.push({ id: 'avoid', address: '8888 Avoid Test St', lat: 39.55, lng: -104.95, avoid: true, included: false });
const fixture = { name: 'Persistence Test', hall: { id: 'test-hall', name: 'Test Hall', number: 1 }, congregation: 'Test Congregation',
  houses, geometry, territories: [{ id: 'territory-a', name: 'Test A', colorIndex: 0, geometry, houseIds: houses.slice(0,180).map(h=>h.id) },
    { id: 'territory-b', name: 'Test B', colorIndex: 1, houseIds: houses.slice(180,360).map(h=>h.id) }] };
const first = realm();
first.test.seed(clone(fixture));
const planId = await first.test.savePlan();
assert.ok(planId);
assert.equal(first.test.state().currentPlanId, planId);
assert.equal(first.element('planSaveMessage').dataset.state, 'success');
assert.equal(store.get(planId).chunkIds.length, 2);
assert.equal(first.test.record(planId).houseCount, 361, 'Confirmed plan is immediately available before subscription notification');
let writesBefore = committedWrites.length;
await first.test.savePlan();
assert.equal(committedWrites.length - writesBefore, 1, 'An unchanged plan must not rewrite any addresses');

// A large Hall plan must use small requests, not resend thousands of indexed
// address maps together. This reproduces the shape of the live 5,658-home plan.
const large = realm();
const largeFixture = clone(fixture);
largeFixture.houses = Array.from({length:5658},(_,i)=>({...fixture.houses[0],id:`large-${i}`,address:`${10000+i} Synthetic Street`}));
large.test.seed(largeFixture);
writesBefore = committedWrites.length;
await large.test.savePlan();
const addressWrites = committedWrites.slice(writesBefore).filter(op=>op.data?.recordType==='territory-plan-chunk');
assert.equal(addressWrites.length,17);
assert.ok(addressWrites.every(op=>typeof op.data.housesJson==='string' && !op.data.houses));
assert.ok(addressWrites.every(op=>Buffer.byteLength(JSON.stringify(op.data))<500000));
writesBefore = committedWrites.length;
await large.test.savePlan();
assert.equal(committedWrites.length-writesBefore,1,'Repeated large-plan exports write only the plan record');

const second = realm();
second.test.reload([...store].map(([id, data]) => [id, { id, ...clone(data) }]));
second.test.loadPlanRecord(planId);
assert.equal(second.test.state().houses.length, 361);
assert.equal(second.test.state().territories.length, 2);
assert.equal(second.test.state().territories[0].houseIds.length, 180);
assert.deepEqual(JSON.parse(JSON.stringify(second.test.state().territories[0].geometry)), geometry);
assert.equal(second.test.state().houses.find(h => h.id === 'avoid').avoid, true);
assert.equal(second.test.state().selectedCongregation, fixture.congregation);

// Two requests arriving together must update the same plan, not create duplicates.
const concurrent = realm(); concurrent.test.seed(clone(fixture));
const ids = await Promise.all([concurrent.test.savePlan(), concurrent.test.savePlan()]);
assert.equal(ids[0], ids[1]);

// A failed save does not replace previously confirmed work or announce success.
const previous = clone(store.get(planId));
failCommit = true;
second.test.state().houses[0].address = '2222 Changed Test St';
assert.equal(await second.test.savePlan(), null);
assert.deepEqual(store.get(planId), previous);
assert.equal(second.element('planSaveMessage').dataset.state, 'error');
failCommit = false;
assert.equal(await second.test.savePlan(), planId);
assert.equal(second.element('planSaveMessage').dataset.state, 'success');

// A failure after staging changed addresses must leave the old plan loadable.
const confirmedPlan = clone(store.get(planId));
second.test.state().houses[1].address = '3333 Staged Change St';
failAtCommit = commits + 2;
assert.equal(await second.test.savePlan(), null);
failAtCommit = null;
assert.deepEqual(store.get(planId),confirmedPlan);
assert.ok(confirmedPlan.chunkIds.every(id=>store.has(id)));
assert.equal(await second.test.savePlan(),planId);

// Missing chunks must not silently load zero homes and overwrite the workspace.
const completeRecords = [...store].map(([id, data]) => [id, { id, ...clone(data) }]);
second.test.reload(completeRecords.filter(([id]) => id !== store.get(planId).chunkIds[0]));
const beforeLoad = JSON.stringify(second.test.state());
second.test.loadPlanRecord(planId);
assert.equal(JSON.stringify(second.test.state()), beforeLoad);
assert.match(second.messages.at(-1).message, /missing address data/);

// Local pending snapshots cannot appear as confirmed saved records.
second.test.subscribeReviews();
second.context.snapshotCallback({ metadata: { hasPendingWrites: true }, forEach: () => { throw Error('Pending snapshot was read'); } });

// Saving cannot attach a stale plan ID after the user starts another workspace.
const changing = realm(); changing.test.seed(clone(fixture));
let release; gate = new Promise(resolve => { release = resolve; });
const pending = changing.test.savePlan();
await new Promise(resolve => setTimeout(resolve, 0));
changing.test.clearPlanWorkspace(); release(); gate = null;
await pending;
assert.equal(changing.test.state().currentPlanId, null);

const snapshot = { hall: fixture.hall, congregation: fixture.congregation, territory: fixture.territories[0],
  houses: [...fixture.houses.slice(0, 180), fixture.houses.at(-1)] };
const bytes = Uint8Array.from({length: 950000}, (_, index) => index % 256);
const pdf = new Blob([bytes], {type:'application/pdf'});
const archiveId = await first.test.saveTerritoryPdf(pdf, 'test-territory.pdf', clone(snapshot), planId);
const record = store.get(archiveId);
assert.equal(record.recordType, 'territory-pdf');
const pdfParts = record.pdfPartIds.map(id => store.get(id));
assert.deepEqual(new Uint8Array(await readArchivePdf(record, pdfParts).arrayBuffer()), bytes);
assert.throws(() => readArchivePdf(record, pdfParts.slice(1)), /incomplete/);
for (const part of [...record.pdfPartIds, ...record.snapshotPartIds].map(id => store.get(id))) {
  assert.ok(Buffer.byteLength(JSON.stringify(part)) < 700000, 'Every part stays below the document limit');
}

// Fresh-session restore creates an editable copy while retaining both originals.
const archivedSession = realm();
archivedSession.test.reload([...store].map(([id, data]) => [id, { id, ...clone(data) }]));
await archivedSession.test.openSavedPdf(archiveId, { textContent:'Load territory' }, true);
assert.equal(archivedSession.test.state().houses.length, 181);
assert.equal(archivedSession.test.state().territories.length, 1);
assert.equal(archivedSession.test.state().currentPlanId, null);
assert.equal(archivedSession.test.state().houses.at(-1).avoid, true);
assert.deepEqual(store.get(archiveId), record);
assert.ok(store.has(planId));

// Explicit editing is cancellable and validates before touching the workspace.
const editVersion = { ...clone(snapshot), hallId: fixture.hall.id };
const editing = realm(); editing.test.seed(clone(fixture));
const untouched = JSON.stringify(editing.test.state()), sourceBefore = JSON.stringify(editVersion);
editing.context.confirm = () => false;
assert.equal(editing.test.editSavedTerritory(editVersion), false);
assert.equal(JSON.stringify(editing.test.state()), untouched);
assert.throws(() => editing.test.editSavedTerritory({ ...editVersion, error: 'Missing part' }), /incomplete/);
assert.throws(() => editing.test.editSavedTerritory({ ...editVersion, houses: [{ id: 'broken', address: '100 Test St', lat: null, lng: -105 }] }), /incomplete/);
assert.throws(() => editing.test.editSavedTerritory({ ...editVersion, territory: { ...editVersion.territory, geometry: { type: 'Polygon', coordinates: [] } } }), /boundary is incomplete/);
assert.equal(JSON.stringify(editing.test.state()), untouched);
editing.context.confirm = () => true;
assert.equal(editing.test.editSavedTerritory(editVersion), true);
assert.equal(editing.test.state().currentPlanId, null);
assert.equal(editing.test.state().territories[0].id, snapshot.territory.id);
assert.equal(editing.test.state().houses.at(-1).avoidTerritoryId, snapshot.territory.id);
assert.equal(JSON.stringify(editVersion), sourceBefore, 'Editing never mutates the inspected version');
const fullPlanBefore = clone(store.get(planId));
editing.test.state().territories[0].name = 'Revised Test A';
editing.test.state().houses[0].address = '1234 Corrected Street';
const revisedPlanId = await editing.test.savePlan();
assert.notEqual(revisedPlanId, planId, 'A one-territory edit cannot overwrite the original full plan');
const editedSnapshot = { ...snapshot, houses: clone(editing.test.state().houses), territory: clone(editing.test.state().territories[0]) };
const revisedArchiveId = await editing.test.saveTerritoryPdf(pdf, 'revised.pdf', editedSnapshot, revisedPlanId);
assert.notEqual(revisedArchiveId, archiveId);
assert.equal(store.get(revisedArchiveId).territoryId, record.territoryId, 'Revisions retain territory identity for history');
assert.deepEqual(store.get(planId), fullPlanBefore);
assert.deepEqual(store.get(archiveId), record);
const revisedSession = realm(); revisedSession.test.reload([...store].map(([id,data]) => [id,{id,...clone(data)}]));
await revisedSession.test.openSavedPdf(revisedArchiveId, { textContent: 'Edit territory' }, true);
assert.equal(revisedSession.test.state().territories[0].name, 'Revised Test A');
assert.equal(revisedSession.test.state().houses[0].address, '1234 Corrected Street');
const pendingRestore = realm(); pendingRestore.test.reload([...store].map(([id,data]) => [id,{id,...clone(data)}]));
let releaseRead;
const readGate = new Promise(resolve => { releaseRead = resolve; });
const originalGet = pendingRestore.context.getDoc;
pendingRestore.context.getDoc = async ref => { await readGate; return originalGet(ref); };
const lateRestore = pendingRestore.test.openSavedPdf(archiveId, { textContent: 'Edit territory' }, true);
pendingRestore.test.clearPlanWorkspace(); releaseRead(); await lateRestore;
assert.equal(pendingRestore.test.state().houses.length, 0, 'A late PDF read must not replace a newer workspace');
console.log('Saved-territory edits verified: cancellation, validation, immutable source, same territory ID, distinct revision plan/PDF, old records retained, reopen, stale-read protection.');

// Failure before publication leaves no library entry and no partial payloads.
const keysBefore = [...store.keys()];
failManifest = true;
await assert.rejects(() => first.test.saveTerritoryPdf(pdf, 'failed.pdf', snapshot, planId), /manifest failure/);
failManifest = false;
assert.deepEqual([...store.keys()], keysBefore);

// Unicode snapshot chunks reassemble without changing house names or numbers.
const unicode = await makePdfArchive('unicode', pdf, {...snapshot, notes: 'Cañón 🏠 '.repeat(40000)});
const transported = unicode.parts.map(part => ({...part,data:Buffer.from(part.data,'utf8').toString('utf8')}));
assert.deepEqual(readArchiveSnapshot(unicode.record, transported), {...snapshot, notes: 'Cañón 🏠 '.repeat(40000)});
console.log('Saving verified: fresh-session plan restore, concurrent saves, failed-save retry, missing chunks, pending writes, workspace changes, PDF byte equality, archive restore, and failed-export cleanup.');

// A recovery creates a separate saved plan and byte-exact PDF archives. Retrying
// must not overwrite the original workspace or edits to the recovered plan.
const recoveredFixture = clone(fixture);
recoveredFixture.territories.forEach(t => { t.geometry ||= null; });
recoveredFixture.geometry = geometry;
const recoveryBytes = new TextEncoder().encode('%PDF-1.7\nSynthetic recovery test only\n%%EOF');
const recoveryHash = await sha256(recoveryBytes);
const recoverySource = JSON.stringify({format:'denver-territory-recovery',version:1,plan:recoveredFixture,
  originals:recoveredFixture.territories.map((territory,index)=>({filename:`synthetic-${index}.pdf`,
    pdfBase64:btoa(String.fromCharCode(...recoveryBytes)),sha256:recoveryHash,
    snapshot:{territory,houses:recoveredFixture.houses.filter(h=>h.avoid||h.territoryId===territory.id),hall:recoveredFixture.hall,congregation:recoveredFixture.congregation}}))});
// Each original must be distinct; these fixtures intentionally use two different
// PDF contents to verify per-file identities.
const recoveryObject = JSON.parse(recoverySource);
const secondBytes = new TextEncoder().encode('%PDF-1.7\nSecond synthetic recovery test\n%%EOF');
recoveryObject.originals[1].pdfBase64 = btoa(String.fromCharCode(...secondBytes));
recoveryObject.originals[1].sha256 = await sha256(secondBytes);
recoveryObject.plan.houses.forEach(h=>{h.avoid=Boolean(h.avoid);h.included=!h.avoid;});
recoveryObject.originals.forEach(o=>o.snapshot.houses.forEach(h=>{h.avoid=Boolean(h.avoid);h.included=!h.avoid;}));
const validated = await validateRecoveryPackage(JSON.stringify(recoveryObject));
const recoveryRealm = realm(); recoveryRealm.test.seed(clone(fixture));
const beforeRecoveryWorkspace = clone(recoveryRealm.test.state());
failManifest = true;
await assert.rejects(recoveryRealm.test.restoreRecoveryPackage(validated),/manifest failure/);
failManifest = false;
const recoveredId = await recoveryRealm.test.restoreRecoveryPackage(validated);
assert.equal(store.get(recoveredId).territoryCount,2);
assert.deepEqual(clone(recoveryRealm.test.state()),beforeRecoveryWorkspace);
const recoveredPdfs = [...store.values()].filter(d=>d.recordType==='territory-pdf'&&d.planId===recoveredId);
assert.equal(recoveredPdfs.length,2);
assert.deepEqual(Buffer.from(await readArchivePdf(recoveredPdfs[0], [...store.values()]).arrayBuffer()),Buffer.from(recoveryBytes));
store.set(recoveredId,{...store.get(recoveredId),planName:'Later user edit'});
writesBefore = committedWrites.length;
assert.equal(await recoveryRealm.test.restoreRecoveryPackage(validated),recoveredId);
assert.equal(committedWrites.length,writesBefore,'Retry must not repeat confirmed writes');
assert.equal(store.get(recoveredId).planName,'Later user edit');
const invalidRecovery=clone(recoveryObject);invalidRecovery.originals[0].pdfBase64=btoa('%PDF-corrupted');
await assert.rejects(validateRecoveryPackage(JSON.stringify(invalidRecovery)),/damaged or incomplete/);
const unsafeAvoid=clone(recoveryObject);unsafeAvoid.plan.houses.at(-1).included=true;
await assert.rejects(validateRecoveryPackage(JSON.stringify(unsafeAvoid)),/Do Not Visit/);
console.log('Recovery tests passed: original PDFs, independent plan, failure recovery, safe retry, and input validation.');

// Rebuilding a saved PDF publishes new parts atomically in the same row, keeps
// the original file, and never loads or saves over the active workspace.
const updating = realm(); updating.test.seed(clone(fixture));
updating.test.reload([...store].map(([id, data]) => [id, { id, ...clone(data) }]));
updating.context.rebuildCalls = 0;
vm.runInContext(`renderSavedTerritoryPdf = async snapshot => {
  rebuildCalls++;
  return {blob: new Blob(['%PDF-updated-territory']), snapshot: {...snapshot, pdfLayoutVersion: PDF_LAYOUT_VERSION,
    nearbyCoffee: {status: 'ready', shops: [{name: 'Test Cafe'}]}}};
};`, updating.context);
const beforeUpdateState = JSON.stringify(updating.test.state()), beforeUpdateKeys = [...store.keys()];
failManifest = true;
await assert.rejects(updating.test.refreshSavedPdfRecord(archiveId), /manifest failure/);
failManifest = false;
assert.deepEqual(store.get(archiveId), record, 'Failed update retains the old manifest');
assert.deepEqual([...store.keys()], beforeUpdateKeys, 'Failed revision only cleans up its own staged parts');
assert.deepEqual(new Uint8Array(await readArchivePdf(record, [...store.values()]).arrayBuffer()), bytes);
const [updated, concurrentUpdate] = await Promise.all([updating.test.refreshSavedPdfRecord(archiveId), updating.test.refreshSavedPdfRecord(archiveId)]);
assert.equal(updated.id, concurrentUpdate.id); assert.equal(updating.context.rebuildCalls, 2, 'Concurrent updates share one render after the failed attempt');
assert.equal(updated.id, archiveId); assert.equal(updated.pdfLayoutVersion, PDF_LAYOUT_VERSION);
assert.ok(updated.pdfPartIds.every(id => !record.pdfPartIds.includes(id)), 'Revisions never overwrite readable payloads');
assert.equal(await readArchivePdf(updated, [...store.values()]).text(), '%PDF-updated-territory');
assert.deepEqual(new Uint8Array(await readArchivePdf(updated.originalPdf, [...store.values()]).arrayBuffer()), bytes);
assert.deepEqual(readArchiveSnapshot(updated, [...store.values()]).houses, snapshot.houses);
assert.equal(JSON.stringify(updating.test.state()), beforeUpdateState, 'Current workspace is untouched');
const writesAfterUpdate = committedWrites.length;
await updating.test.refreshSavedPdfRecord(archiveId);
assert.equal(committedWrites.length, writesAfterUpdate, 'An updated file is reused without repeated writes');
const newerRecord = {...updated, pdfLayoutVersion: PDF_LAYOUT_VERSION + 1}; store.set(archiveId, newerRecord);
await updating.test.refreshSavedPdfRecord(archiveId);
assert.deepEqual(store.get(archiveId), newerRecord, 'An older browser must never downgrade a newer PDF');
console.log('Saved PDF upgrades passed: atomic failure/retry, preserved originals, unchanged homes/workspace, concurrency and version reuse.');

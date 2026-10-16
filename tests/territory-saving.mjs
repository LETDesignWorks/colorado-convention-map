// Exercise the real save/load functions against an isolated atomic store.
// No production Firebase records or personal address data are used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { makePdfArchive, readArchivePdf, readArchiveSnapshot } from '../territories/pdf-archive.js';

const source = (await readFile(new URL('../territories/app-main.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replaceAll('import.meta.url', "'http://localhost/territories/app-main.js'").replace(/^initialize\(\);\s*$/m, '');
const store = new Map();
let nextId = 1, failCommit = false, failManifest = false, gate = null, commits = 0;
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
      if (failCommit) throw Object.assign(new Error('Simulated permission failure'), { code: 'permission-denied' });
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
    URL, setTimeout, clearTimeout, btoa, atob, makePdfArchive, readArchivePdf, readArchiveSnapshot, normalizeAddressKey: value => value,
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
    dedupeHouseRecords = () => 0;
    toast = (message, error) => testMessages.push({ message, error });
    updateSummary = () => {}; emitPlannerDataChange = () => {}; updateBoundaryUi = () => {};
    renderAllPlanningData = () => {}; cancelTerritoryBoundaryEdit = () => {};
    restoreHallAndCongregation = (id, congregation) => { selectedHall = { id, name: 'Test Hall' }; selectedCongregation = congregation; };
    currentSourceKey = () => 'manual';
    boundaryGroup = { clearLayers() {} };
    globalThis.test = {
      savePlan, saveTerritoryPdf, loadPlanRecord, openSavedPdf, subscribeReviews, clearPlanWorkspace,
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

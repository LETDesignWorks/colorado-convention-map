import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as model from '../territories/saved-work-model.js';
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const main = read('territories/app-main.js');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const persist = section(main, 'async function persistPlan(options = {}) {', '\nfunction subscribeReviews()');
const copy = value => JSON.parse(JSON.stringify(value));
const house = (id, territory = null, props = {}) => ({ id, address: `${id} Example St`, lat: 39.5, lng: -104.9, included: true, avoid: false, territoryId: territory, ...props });
function harness(options = {}) {
  let nextId = 0, writes = 0;
  const stored = new Map(), messages = [], confirmations = [];
  const base = { id: 'previous-work', recordType: 'territory-plan', saveKind: 'work', hallId: '21', hallName: 'Test Hall', congregation: 'Test Congregation', planName: 'Complete work', updatedAt: new Date('2026-10-20'), houseCount: 3, chunkIds: ['previous-work-houses'], territoriesJson: JSON.stringify([{ id: 't1', houseIds: ['1'] }, { id: 't2', houseIds: ['2'] }]) };
  const oldHouses = [house('1', 't1'), house('2', 't2'), house('3', null, { avoid: true, included: false })];
  if (options.existing) {
    stored.set(base.id, copy(base)); stored.set('previous-work-houses', { id: 'previous-work-houses', recordType: 'territory-plan-chunk', planId: base.id, houses: copy(oldHouses) });
  }
  const context = {
    ...model, console, JSON, Number, String, Boolean, Set, Map, Date,
    setTimeout: () => 1, clearTimeout() {},
    selectedHall: { id: '21', name: 'Test Hall', address: '1 Public Rd' }, selectedCongregation: 'Test Congregation',
    houses: [house('1', 't1'), house('2', 't2'), house('3', null, { avoid: true, included: false })],
    territories: [{ id: 't1', name: 'One', houseIds: ['1'] }, { id: 't2', name: 'Two', houseIds: ['2'] }],
    boundaryGeometry: null, boundaryPreservesAddresses: true, currentPlanId: options.existing ? base.id : 'legacy-plan',
    activeSavedWorkKey: options.existing ? model.workKey('21', 'Test Congregation') : '',
    savedTerritoryEditId: null, workspaceGeneration: 1, savedRecordsStatus: 'ready', currentUser: { email: 'test@example.invalid' },
    db: {}, reviewRecords: new Map([...stored].map(([k, v]) => [k, copy(v)])), FIRESTORE_HOUSE_CHUNK_SIZE: 2,
    els: Object.fromEntries(['planName', 'territoryPrefix', 'boundaryName', 'groupingMethod', 'residentialOnly', 'separateUnits', 'savePlanButton'].map(id => [id, { value: '', checked: true, disabled: false, textContent: '' }])),
    requireAdmin: () => true, isAdmin: () => true, friendlyError: error => error.message,
    setPlanSaveMessage: text => messages.push(text), toast: text => messages.push(text), dedupeHouseRecords: () => 0,
    renderAllPlanningData() {}, renderSavedRecords() {}, updateSummary() {}, emitPlannerDataChange() {},
    clean: value => String(value ?? '').trim(), markerLabel: () => '21', currentSourceKey: () => 'manual', targetSizeValue: () => 30,
    serializeHouse: copy, encodeGeometry: shape => shape ? JSON.stringify(shape) : '',
    decodeGeometry: (json, fallback) => json ? JSON.parse(json) : (fallback || null),
    savedPlans: () => [...context.reviewRecords.values()].filter(record => record.recordType === 'territory-plan'),
    confirm: text => { confirmations.push(text); return options.confirm !== false; },
    collection: (_, name) => { assert.equal(name, 'reviews'); return { name }; },
    doc: (...args) => ({ id: args.length === 1 ? `new-${++nextId}` : args[2] }),
    serverTimestamp: () => new Date(),
    setDoc: async (ref, record) => { if (options.failManifest) throw new Error('manifest rejected'); stored.set(ref.id, copy(record)); },
    writeBatch: () => {
      const batch = [];
      return { set(ref, record) { batch.push([ref.id, copy(record)]); }, async commit() {
        writes++;
        if (options.failChunk === writes) throw new Error('chunk rejected');
        batch.forEach(([key, value]) => stored.set(key, value));
        options.onChunk?.(context, writes);
      } };
    }
  };
  vm.createContext(context); vm.runInContext(persist, context);
  return { context, stored, messages, confirmations, save: opts => context.persistPlan(opts), oldHouses };
}
test('complete save publishes all addresses and all territories', async () => {
  const h = harness(); const id = await h.save({ saveYourWork: true });
  const record = h.stored.get(id);
  assert.equal(record.saveKind, 'work'); assert.equal(record.houseCount, 3); assert.equal(record.territoryCount, 2); assert.equal(record.avoidHouseCount, 1);
  assert.equal(model.readPlanAddresses({ ...record, id }, h.stored).length, 3);
});
test('subsequent saves never share address chunks or overwrite earlier work', async () => {
  const h = harness({ existing: true }); const before = JSON.stringify([...h.stored]);
  const id = await h.save({ saveYourWork: true });
  assert.notEqual(id, 'previous-work');
  assert.equal(JSON.stringify([...h.stored].filter(([key]) => key.startsWith('previous-work'))), before);
  for (const key of h.stored.get(id).chunkIds) assert.equal(h.stored.get(key).planId, id);
  h.stored.delete('previous-work'); h.stored.delete('previous-work-houses');
  assert.equal(model.readPlanAddresses({ ...h.stored.get(id), id }, h.stored).length, 3);
});
test('ordinary backup save cannot become main saved work', async () => {
  const h = harness({ existing: true }); h.context.activeSavedWorkKey = ''; h.context.currentPlanId = 'legacy-backup';
  const id = await h.save({}); assert.equal(h.stored.get(id).saveKind, 'backup');
  assert.equal(model.currentWorkFor(h.context.savedPlans(), '21', 'Test Congregation').id, 'previous-work');
});
test('declining backup promotion produces no new records', async () => {
  const h = harness({ existing: true, confirm: false }); h.context.activeSavedWorkKey = ''; h.context.currentPlanId = 'legacy-backup';
  assert.equal(await h.save({ saveYourWork: true }), null); assert.equal(h.stored.size, 2); assert.equal(h.confirmations.length, 1);
});
test('editing one territory retains the complete meeting-location plan', async () => {
  const h = harness({ existing: true });
  h.context.savedTerritoryEditId = 't1'; h.context.activeSavedWorkKey = ''; h.context.currentPlanId = null;
  h.context.houses = [house('1', 't1'), house('4', 't1')]; h.context.territories = [{ id: 't1', name: 'Updated one', houseIds: ['1', '4'] }];
  const id = await h.save({ saveYourWork: true }); const record = h.stored.get(id);
  assert.equal(record.houseCount, 4); assert.equal(record.territoryCount, 2);
  assert.equal(model.readPlanAddresses({ ...record, id }, h.stored).find(home => home.id === '2').territoryId, 't2');
  assert.equal(h.context.currentPlanId, null); // Partial workspace never masquerades as a full one.
});
test('missing base chunks cannot partially overwrite current work', async () => {
  const h = harness({ existing: true }); h.context.savedTerritoryEditId = 't1'; h.context.reviewRecords.delete('previous-work-houses');
  assert.equal(await h.save({ saveYourWork: true }), null); assert.equal(h.stored.size, 2);
});
test('failed address upload never publishes a manifest', async () => {
  const h = harness({ existing: true, failChunk: 2 });
  assert.equal(await h.save({ saveYourWork: true }), null);
  assert.equal([...h.stored.values()].filter(row => row.recordType === 'territory-plan').length, 1);
  assert.equal(h.context.currentPlanId, 'previous-work');
});
test('failed manifest keeps the earlier work loadable', async () => {
  const h = harness({ existing: true, failManifest: true });
  assert.equal(await h.save({ saveYourWork: true }), null);
  assert.equal(model.readPlanAddresses({ ...h.stored.get('previous-work'), id: 'previous-work' }, h.stored).length, 3);
});
test('workspace changed during save cannot change the captured data or attach its result', async () => {
  const h = harness({ onChunk(context, count) { if (count === 1) { context.houses = [house('999')]; context.workspaceGeneration++; context.currentPlanId = 'different-work'; } } });
  const id = await h.save({ saveYourWork: true });
  assert.equal(h.stored.get(id).houseCount, 3); assert.equal(h.context.currentPlanId, 'different-work');
});
test('saving requires administrative access and ready saved records', async () => {
  const h = harness(); h.context.requireAdmin = () => false; assert.equal(await h.save({ saveYourWork: true }), null); assert.equal(h.stored.size, 0);
  h.context.requireAdmin = () => true; h.context.savedRecordsStatus = 'loading'; assert.equal(await h.save({ saveYourWork: true }), null); assert.equal(h.stored.size, 0);
});
function fakeClassList() { const set = new Set(); return { toggle(name, on) { on ? set.add(name) : set.delete(name); }, contains(name) { return set.has(name); } }; }
test('address-list mode always hides the big-picture boundary, even with a saved boundary', () => {
  const workflow = read('territories/territory-workflow-ui.js');
  const apply = section(workflow, 'function applyWorkflowMode() {', '\nfunction setWorkflowMode(');
  for (const hasBoundary of [true, false]) {
    const targets = Object.fromEntries(['boundary', 'addresses', 'source', 'bulk'].map(key => [key, { classList: fakeClassList() }]));
    const context = { activeMode: 'upload', MODE_BOUNDARY: 'boundary', MODE_UPLOAD: 'upload', MODE_ALL: 'all', api: { getBoundaryGeometry: () => hasBoundary },
      document: { body: { dataset: {} }, querySelectorAll: () => [], getElementById: () => null }, workflowTargets: () => targets,
      toggleHidden: (target, hidden) => target.classList.toggle('territory-workflow-hidden', hidden) };
    vm.createContext(context); vm.runInContext(apply+'\napplyWorkflowMode();', context);
    assert.equal(targets.boundary.classList.contains('territory-workflow-hidden'), true);
    assert.equal(targets.addresses.classList.contains('territory-workflow-hidden'), true);
    assert.equal(targets.bulk.classList.contains('territory-workflow-hidden'), false);
    context.activeMode = 'boundary'; vm.runInContext('applyWorkflowMode();', context);
    assert.equal(targets.boundary.classList.contains('territory-workflow-hidden'), false);
  }
});
test('assessor-fill panel is available for a selected meeting place even before uploads', () => {
  const source = read('territories/address-source-merge.js');
  const sync = section(source, 'function syncCardVisibility() {', '\nfunction updateCounts()');
  const card = { classList: fakeClassList() };
  let hall = null, congregation = '';
  const context = { document: { getElementById: () => card }, planner: { getSelectedHall: () => hall, getSelectedCongregation: () => congregation }, placeAvoidAfterAssessor() {} };
  vm.createContext(context); vm.runInContext(sync+'\nsyncCardVisibility();', context);
  assert.equal(card.classList.contains('territory-workflow-hidden'), true);
  hall = { id: '21' }; congregation = 'Highlands Ranch'; vm.runInContext('syncCardVisibility();', context);
  assert.equal(card.classList.contains('territory-workflow-hidden'), false);
});
test('return section has a current-work list and a collapsed load-only backup section', () => {
  const template = read('territories/template.html');
  assert.match(template, /id="savedWorkList"/); assert.match(template, /<details id="savedWorkBackup" class="saved-work-backup">/);
  assert.doesNotMatch(template, /<details id="savedWorkBackup"[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(section(main, 'function renderSavedRecords()', '\nfunction restoreHallAndCongregation'), /data-delete-plan=/);
  assert.match(main, /plan\?\.saveKind === 'work'/);
  assert.match(read('territories/saved-work.css'), /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(read('territories/saved-work-ui.js'), /mapCard\.after\(pair\)/);
});
test('save controls call complete-work saves and modified modules bypass old caches', () => {
  assert.match(main, /savePlanButton[\s\S]*saveNamedWork/);
  assert.match(read('territories/hall-address-sets.js'), /saveYourWork: true/);
  const bootstrap = read('territories/bootstrap.js');
  for (const name of ['hall-address-sets', 'territory-workflow-ui', 'saved-work-ui']) assert.ok(bootstrap.includes(`${name}.js?v=territories-20261022-41`));
  for (const name of ['app-main', 'address-source-merge', 'bulk-addresses', 'assessor-full-boundary', 'assessor-one-click', 'meeting-place-ui']) assert.ok(bootstrap.includes(`${name}.js?v=territories-20261022-41`));
});


test('SAVE YOUR WORK keeps every loaded record without silently deduplicating units', async () => {
  const h = harness();
  let dedupeCalls = 0;
  h.context.dedupeHouseRecords = () => { dedupeCalls++; return 0; };
  h.context.houses = [house('unit-a', null, { address: '100 Example St Apt 1', unit: '1' }), house('unit-b', null, { address: '100 Example St Apt 2', unit: '2' }), house('excluded', null, { included: false })];
  const id = await h.save({ saveYourWork: true });
  const saved = model.readPlanAddresses({ ...h.stored.get(id), id }, h.stored);
  assert.equal(saved.length, 3); assert.equal(dedupeCalls, 0);
  assert.equal(saved.find(home => home.id === 'excluded').included, false);
  assert.equal(saved.find(home => home.id === 'unit-b').unit, '2');
});

test('loading protected complete saved work preserves its exact address records', () => {
  assert.match(main, /const duplicatesRemovedOnLoad = 0;/);
});

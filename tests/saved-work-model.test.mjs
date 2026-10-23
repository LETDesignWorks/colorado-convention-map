import test from 'node:test';
import assert from 'node:assert/strict';
import { workKey, latestWork, currentWorkFor, readPlanAddresses, mergeTerritoryWork } from '../territories/saved-work-model.js';
const plan = (id, time, props = {}) => ({ id, recordType: 'territory-plan', saveKind: 'work', hallId: '21', hallName: 'Test Hall', congregation: 'Test Congregation', updatedAt: time, ...props });
const home = (id, territoryId, address = `${id} Test St`) => ({ id, territoryId, address, lat: 39.5, lng: -104.9, included: true, avoid: false });
test('location keys separate congregations and normalize whitespace', () => {
  assert.equal(workKey('21', ' Test  Congregation '), workKey(21, 'test congregation'));
  assert.notEqual(workKey('21', 'English'), workKey('21', 'Spanish'));
});
test('one current saved work per meeting place and congregation', () => {
  const records = [plan('a', '2026-10-21'), plan('b', '2026-10-22'), plan('c', '2026-10-23', { saveKind: 'backup' }), plan('d', '2026-10-21', { congregation: 'Spanish' })];
  assert.deepEqual(latestWork(records).map(p => p.id).sort(), ['b', 'd']);
  assert.equal(currentWorkFor(records, '21', 'Test Congregation').id, 'b');
});
test('supports Firestore timestamps and deterministic ties', () => {
  assert.equal(latestWork([plan('a', { seconds: 5 }), plan('b', { seconds: 5, nanoseconds: 1000000 })])[0].id, 'b');
});
test('read copies do not mutate archive data', () => {
  const original = home('1', 't1');
  const records = new Map([['p-h', { planId: 'p', housesJson: JSON.stringify([original]) }]]);
  const read = readPlanAddresses({ id: 'p', chunkIds: ['p-h'], houseCount: 1 }, records);
  read[0].address = 'changed';
  assert.equal(JSON.parse(records.get('p-h').housesJson)[0].address, '1 Test St');
});
test('missing or foreign address chunks fail closed', () => {
  assert.throws(() => readPlanAddresses({ id: 'p', chunkIds: ['missing'], houseCount: 1 }, new Map()));
  assert.throws(() => readPlanAddresses({ id: 'p', chunkIds: ['x'], houseCount: 1 }, new Map([['x', { planId: 'other', houses: [home('1', 't1')] }]])));
});
test('single territory save preserves other territories and all unassigned homes', () => {
  const base = [home('1', 't1'), home('2', 't2'), home('3', null)];
  const territories = [{ id: 't1', houseIds: ['1'] }, { id: 't2', houseIds: ['2'] }];
  const merged = mergeTerritoryWork(base, territories, [home('1', 't1'), home('4', 't1')], [{ id: 't1' }], 't1');
  assert.equal(merged.houses.length, 4);
  assert.equal(merged.houses.find(h => h.id === '2').territoryId, 't2');
  assert.equal(merged.houses.find(h => h.id === '3').territoryId, null);
  assert.deepEqual(merged.territories.find(t => t.id === 't1').houseIds, ['1', '4']);
  assert.equal(base.length, 3);
});
test('removing a territory does not erase its addresses', () => {
  const result = mergeTerritoryWork([home('1', 't1'), home('2', 't2')], [{ id: 't1' }, { id: 't2' }], [], [], 't1');
  assert.equal(result.houses[0].territoryId, null);
  assert.equal(result.territories.length, 1);
});
test('conflicting assignments cannot overwrite another territory', () => {
  assert.throws(() => mergeTerritoryWork([home('2', 't2')], [{ id: 't2' }], [home('2', 't1')], [{ id: 't1' }], 't1'));
});
test('separate apartment units remain separate', () => {
  const a = { ...home('a', null, '100 Test St Apt 1'), unit: '1' };
  const b = { ...home('b', 't1', '100 Test St Apt 2'), unit: '2' };
  assert.equal(mergeTerritoryWork([a], [], [b], [{ id: 't1' }], 't1').houses.length, 2);
});
test('avoid metadata survives single-territory update', () => {
  const avoid = { ...home('x', null), avoid: true, included: false, avoidTerritoryId: 't2' };
  const result = mergeTerritoryWork([avoid, home('1', 't1')], [{ id: 't1' }, { id: 't2' }], [home('1', 't1')], [{ id: 't1' }], 't1');
  assert.equal(result.houses.find(h => h.id === 'x').avoid, true);
  assert.equal(result.houses.find(h => h.id === 'x').avoidTerritoryId, 't2');
});

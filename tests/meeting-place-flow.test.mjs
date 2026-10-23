import test from 'node:test';
import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import { chooseMeetingPlan, latestMeetingBoundary, proposedBoundary, outsideHomes, boundaryFingerprint,
  createMeetingBoundaryFlow, captureScanScope, scanScopeIsCurrent } from '../territories/meeting-place-model.js';
const box = () => turf.bboxPolygon([-105.02, 39.57, -105.01, 39.58]).geometry;
const home = (id, lng = -105.015, lat = 39.575, extra = {}) => ({ id, lng, lat, address: `${id} Example St`, ...extra });
const record = (id, extra = {}) => ({ id, recordType: 'territory-plan', hallId: '21', congregation: 'Highlands Ranch', houseCount: 3, updatedAt: 1000, ...extra });
const records = (...items) => new Map(items.map(item => [item.id, item]));
function harness(overrides = {}) {
  const state = { boundary: box(), accepted: box(), homes: [home('1')], generation: 1, hallId: '21', congregation: 'Highlands Ranch', admin: true,
    confirmations: [], decisions: [], applied: [], writes: [], scans: 0, messages: [], scanResult: { status: 'complete' }, ...overrides };
  const host = { turf, context: () => ({ hallId: state.hallId, congregation: state.congregation, generation: state.generation }),
    isCurrent: scope => state.admin && scope.hallId === state.hallId && scope.congregation === state.congregation && scope.generation === state.generation,
    isAdmin: () => state.admin, getHall: () => ({ id: state.hallId, name: 'Test Hall', lat: 39.575, lng: -105.015 }),
    getHomes: () => state.homes, getBoundary: () => state.boundary, padding: () => .12,
    applyBoundary: geometry => { state.boundary = geometry; state.applied.push(geometry); },
    getAcceptedBoundary: () => state.accepted,
    saveBoundary: async geometry => { if (state.failWrite) throw new Error('write rejected'); state.writes.push(geometry); state.accepted = geometry; },
    scan: async () => { state.scans++; await state.onScan?.(); return state.scanResult; },
    confirm: async message => { state.confirmations.push(message); await state.onConfirm?.(); return state.decisions.shift() ?? true; },
    status: message => state.messages.push(message), preview: () => { state.preview = true; }, clearPreview: () => { state.preview = false; }
  };
  return { state, host, flow: createMeetingBoundaryFlow(host) };
}
test('current saved work is preferred over a newer legacy set or isolated backup', () => {
  const data = records(record('legacy', { addressSetMode: true, updatedAt: 9999 }), record('main', { saveKind: 'work' }), record('backup', { saveKind: 'backup', updatedAt: 99999 }));
  assert.equal(chooseMeetingPlan(data, '21', 'highlands   ranch').plan.id, 'main');
});
test('legacy address set loads when no new-format save exists', () => {
  const data = records(record('legacy', { addressSetMode: true }), record('partial', { planName: 'T01 - revised territory', updatedAt: 9999 }));
  const selected = chooseMeetingPlan(data, '21', 'Highlands Ranch');
  assert.equal(selected.plan.id, 'legacy'); assert.equal(selected.legacy, true);
});
test('different halls and congregations never mix; explicit backup is not automatically promoted', () => {
  const data = records(record('a', { saveKind: 'work' }), record('b', { hallId: '22', saveKind: 'work' }), record('c', { saveKind: 'backup', congregation: 'Other' }));
  assert.equal(chooseMeetingPlan(data, '22', 'Highlands Ranch').plan.id, 'b');
  assert.equal(chooseMeetingPlan(data, '21', 'Other'), null);
});
test('a corrupt current manifest remains selected so validation can fail without silently loading stale work', () => {
  const selected = chooseMeetingPlan(records(record('current', { saveKind: 'work', chunkIds: ['missing'] }), record('old', { addressSetMode: true })), '21', 'Highlands Ranch');
  assert.equal(selected.plan.id, 'current');
});
test('latest explicitly approved boundary is separate from search and backup boundaries', () => {
  const boundary = id => record(id, { recordType: 'territory-boundary', boundaryJson: JSON.stringify(box()), meetingPlaceBoundary: true });
  const selected = latestMeetingBoundary(records(boundary('approved'), { ...boundary('newer-draft'), meetingPlaceBoundary: false, updatedAt: 9000 }), '21', 'Highlands Ranch');
  assert.equal(selected.record.id, 'approved');
});
test('boundary proposal supports one home, coincident homes and a collinear street', () => {
  for (const homes of [[home('1')], [home('1'), home('2')], [home('1', -105.01), home('2', -105.02), home('3', -105.03)]]) {
    assert.equal(outsideHomes(turf, homes, proposedBoundary(turf, homes, null)).length, 0);
  }
});
test('expanded boundary retains every part of the old boundary and all new homes', () => {
  const old = box(), homes = [home('1'), home('2', -104.99), home('3', -105.04, 39.6)];
  const expanded = proposedBoundary(turf, homes, old);
  assert.equal(outsideHomes(turf, homes, expanded).length, 0);
  const difference = turf.difference(turf.featureCollection([turf.feature(old), turf.feature(expanded)]));
  assert.ok(!difference || turf.area(difference) < .001); assert.deepEqual(old, box());
});
test('large uploaded sets use a bounded proposal and keep all points', () => {
  const homes = Array.from({length: 1000}, (_, i) => home(String(i), -105.02 + (i%50)*.0001, 39.57+Math.floor(i/50)*.0001));
  assert.equal(outsideHomes(turf, homes, proposedBoundary(turf, homes, null)).length, 0);
});
test('first upload generates a search boundary, scans, then asks to adopt', async () => {
  const h = harness({ boundary: null, accepted: null }); h.state.onScan = () => assert.equal(h.state.confirmations.length, 0);
  assert.equal((await h.flow.fill({automatic: true})).status, 'complete');
  assert.equal(h.state.scans, 1); assert.equal(h.state.applied.length, 1); assert.equal(h.state.writes.length, 1); assert.match(h.state.confirmations[0], /boundary only/);
});
test('declining first adoption keeps loaded homes and only a temporary search boundary', async () => {
  const h = harness({ boundary: null, accepted: null, decisions: [false] }); const before = structuredClone(h.state.homes); await h.flow.fill({automatic: true});
  assert.equal(h.state.writes.length, 0); assert.deepEqual(h.state.homes, before); assert.ok(h.state.boundary);
});
test('outside upload prompts before changing the boundary; decline preserves both old area and new homes', async () => {
  const h = harness({ homes: [home('1'), home('2', -104.99)], decisions: [false] });
  const old = boundaryFingerprint(h.state.boundary), homes = structuredClone(h.state.homes);
  assert.equal((await h.flow.fill({automatic: true})).status, 'declined');
  assert.equal(h.state.scans, 0); assert.equal(h.state.applied.length, 0); assert.equal(h.state.writes.length, 0);
  assert.equal(boundaryFingerprint(h.state.boundary), old); assert.deepEqual(h.state.homes, homes); assert.equal(h.state.preview, false);
});
test('approving outside upload expands once, fills and saves only the approved boundary', async () => {
  const h = harness({ homes: [home('1'), home('2', -104.99)] }); const originalHomes = structuredClone(h.state.homes); await h.flow.fill({automatic: true});
  assert.equal(h.state.confirmations.length, 1); assert.equal(h.state.scans, 1); assert.equal(h.state.writes.length, 1);
  assert.equal(outsideHomes(turf, h.state.homes, h.state.boundary).length, 0); assert.deepEqual(h.state.homes, originalHomes);
});
test('new addresses already inside the boundary cause no scan or extra prompt', async () => {
  const h = harness(); assert.equal((await h.flow.fill({automatic:true})).status, 'inside'); assert.equal(h.state.scans, 0); assert.equal(h.state.confirmations.length, 0);
});
test('explicit refill works inside the accepted area without repeatedly asking to adopt', async () => {
  const h = harness(); await h.flow.fill(); assert.equal(h.state.scans, 1); assert.equal(h.state.confirmations.length, 0);
});
test('failed and cancelled scans never adopt the proposed boundary', async () => {
  for (const status of ['failed', 'cancelled']) { const h = harness({ boundary: null, accepted: null, scanResult: {status} }); await h.flow.fill({automatic:true}); assert.equal(h.state.writes.length, 0); assert.equal(h.state.confirmations.length, 0); }
});
test('partial GIS results are reported accurately before adoption', async () => {
  const h = harness({ boundary: null, accepted: null, scanResult: {status:'partial'} }); await h.flow.fill({automatic:true}); assert.match(h.state.confirmations[0], /partial results/); assert.match(h.state.messages.at(-1), /failed/);
});
test('a context change while confirming expansion cannot touch the new hall', async () => {
  const h = harness({ homes: [home('1'), home('2', -104.99)] }); h.state.onConfirm = () => { h.state.generation++; h.state.hallId='22'; };
  assert.equal((await h.flow.fill()).status, 'stale'); assert.equal(h.state.applied.length, 0); assert.equal(h.state.scans, 0);
});
test('context or boundary changes during scan prevent adoption', async () => {
  for (const change of ['generation','boundary']) { const h = harness({boundary: null, accepted:null}); h.state.onScan = () => { if (change==='generation') h.state.generation++; else h.state.boundary=box(); }; assert.equal((await h.flow.fill({automatic:true})).status, 'stale'); assert.equal(h.state.writes.length, 0); }
});
test('failed boundary write does not claim it saved', async () => {
  const h = harness({ boundary:null, accepted:null, failWrite:true }); assert.equal((await h.flow.fill({automatic:true})).status,'failed'); assert.equal(h.state.writes.length,0); assert.match(h.state.messages.at(-1), /write rejected/);
});
test('an empty new hall requires consent before using a radius around the hall', async () => {
  const h = harness({ homes: [], boundary: null, accepted: null, decisions: [false] }); assert.equal((await h.flow.fill()).status, 'declined'); assert.equal(h.state.scans,0); assert.equal(h.state.applied.length,0);
});
test('empty new hall can retrieve GIS addresses without a prepared upload', async () => {
  const h = harness({ homes: [], boundary: null, accepted: null }); assert.equal((await h.flow.fill()).status,'complete'); assert.equal(h.state.scans,1); assert.equal(h.state.writes.length,1); assert.equal(h.state.confirmations.length,2);
});
test('double clicking cannot launch two scans', async () => {
  let release; const h=harness(); h.state.onScan=()=>new Promise(resolve=>{release=resolve;}); const first=h.flow.fill(); assert.equal((await h.flow.fill()).status,'busy'); release(); await first; assert.equal(h.state.scans,1);
});
test('scan scope includes hall, congregation, generation, boundary and administrative access', () => {
  const state={generation:1,hallId:'21',congregation:'A',boundary:box(),admin:true};
  const api={getWorkspaceGeneration:()=>state.generation,getSelectedHall:()=>({id:state.hallId}),getSelectedCongregation:()=>state.congregation,getBoundaryGeometry:()=>state.boundary,isAdmin:()=>state.admin};
  const scope=captureScanScope(api); assert.equal(scanScopeIsCurrent(api,scope),true);
  for (const [field,value] of [['generation',2],['hallId','22'],['congregation','B'],['boundary',null],['admin',false]]) { const old=state[field]; state[field]=value; assert.equal(scanScopeIsCurrent(api,scope),false); state[field]=old; }
});

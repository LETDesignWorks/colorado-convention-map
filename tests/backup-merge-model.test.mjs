import test from 'node:test';
import assert from 'node:assert/strict';
import { previewBackupMerge, addressKey, groupTerritoriesByName, deletionProblem, stable } from '../territories/backup-merge-model.js';
const home = (id, address = `${id} Example Street, Testville CO 80000`, extra = {}) => ({ id, address, lat: 39.5, lng: -105, included: true, territoryId: null, ...extra });
const territory = (id, name, ids = [], extra = {}) => ({ id, name, houseIds: ids, geometry: null, ...extra });
const set = (houses = [], territories = [], extra = {}) => ({ hallId: '21', congregation: 'Highlands Ranch', houses, territories, boundary: null, ...extra });
const source = (houses = [], territories = [], extra = {}) => set(houses, territories, { id: 'backup-1', label: 'Old set', ...extra });
const polygon = { type: 'Polygon', coordinates: [[[-105, 39], [-104, 39], [-104, 40], [-105, 39]]] };
test('additive preview preserves target and source, boundary and unassigned addresses', () => {
  const a = set([home('1')], [], { boundary: polygon }), b = source([home('2')], [territory('t2', 'T-2', ['2'])]);
  const before = stable([a,b]); const r = previewBackupMerge(a,b);
  assert.equal(stable([a,b]), before); assert.equal(r.draft.houses.length,2); assert.equal(r.draft.territories.length,1);
  assert.deepEqual(r.draft.boundary,polygon); assert.equal(r.draft.houses.find(h=>h.id==='1').territoryId,null);
});
test('address spelling and punctuation dedupe while preserving conservative avoid and exclusion flags', () => {
  const r = previewBackupMerge(set([home('a','100 EXAMPLE ST, TESTVILLE CO 80000')]), source([home('b','100 Example Street, Testville CO 80000',{avoid:true,avoidSource:'old list'})]));
  assert.equal(r.draft.houses.length,1); assert.equal(r.draft.houses[0].avoid,true); assert.equal(r.draft.houses[0].included,false);
  const excluded = previewBackupMerge(set([home('a')]),source([home('b',home('a').address,{included:false})]));
  assert.equal(excluded.draft.houses[0].included,false);
});
test('apartment units remain separate and equivalent embedded unit notation matches', () => {
  assert.equal(addressKey(home('a','100 Example St Apt 1, Testville CO')), addressKey(home('b','100 Example St #1, Testville CO')));
  const r = previewBackupMerge(set([home('a','100 Example St Apt 1')]),source([home('b','100 Example St Apt 2'),home('c','100 Example St')]));
  assert.equal(r.draft.houses.length,3);
});
test('same ID pointing at a different address gets a new ID, not a replacement', () => {
  const r=previewBackupMerge(set([home('1')]),source([home('1','200 Different Street')]));
  assert.equal(r.draft.houses.length,2); assert.equal(new Set(r.draft.houses.map(h=>h.id)).size,2);
});
test('different places with the same short street address are not silently collapsed', () => {
  const r=previewBackupMerge(set([home('a','100 Main St')]),source([home('b','100 Main St',{lat:40,avoid:true})]));
  assert.equal(r.draft.houses.length,2); assert.equal(r.draft.houses.every(h=>h.avoid),true); assert.equal(r.notes.length,1);
});
test('same name with different territory contents requires an explicit keep choice', () => {
  const a=set([home('1')],[territory('t1','HR-01',['1'])]),b=source([home('2')],[territory('t2','HR-01',['2'])]);
  const pending=previewBackupMerge(a,b); assert.equal(pending.conflicts[0].kind,'territory');
  const r=previewBackupMerge(a,b,{[pending.conflicts[0].key]:'backup:t2'});
  assert.equal(r.conflicts.length,0); assert.equal(r.draft.territories[0].id,'t2'); assert.equal(r.draft.houses.length,2);
  assert.equal(r.draft.houses.find(h=>h.id==='1').territoryId,null);
});
test('updated same-ID territory is reviewed instead of combining two boundaries', () => {
  const a=set([home('1')],[territory('t','HR-1',['1'])]),b=source([home('2')],[territory('t','HR-1',['2'])]);
  const p=previewBackupMerge(a,b); assert.equal(p.conflicts.length,1);
  const r=previewBackupMerge(a,b,{[p.conflicts[0].key]:'current:t'});
  assert.deepEqual(r.draft.territories[0].houseIds,['1']); assert.equal(r.draft.houses.length,2);
});
test('identical same-name territories do not create duplicate assignments', () => {
  const a=set([home('a')],[territory('t1','HR-1',['a'])]),b=source([home('b',home('a').address)],[territory('t2','HR-1',['b'])]);
  const r=previewBackupMerge(a,b); assert.equal(r.conflicts.length,0); assert.equal(r.draft.territories.length,1);assert.equal(r.draft.houses.length,1);
});
test('overlap between different kept territories requires an assignment choice', () => {
  const a=set([home('a')],[territory('t1','HR-1',['a'])]),b=source([home('b',home('a').address)],[territory('t2','HR-2',['b'])]);
  const p=previewBackupMerge(a,b); assert.equal(p.conflicts[0].kind,'address');
  const r=previewBackupMerge(a,b,{[p.conflicts[0].key]:'unassigned'});
  assert.equal(r.conflicts.length,0);assert.equal(r.draft.houses[0].territoryId,null);assert.equal(r.draft.territories.length,2);
});
test('cross-location and cross-congregation imports are explicitly identified', () => {
  assert.equal(previewBackupMerge(set(),source([home('a')],[],{hallId:'22'})).relink,true);
  assert.equal(previewBackupMerge(set(),source([home('a')],[],{congregation:'Southpark'})).relink,true);
});
test('only a number in common never deduplicates two addresses', () => {
  assert.equal(previewBackupMerge(set([home('a','100 Apple St')]),source([home('b','100 Birch St')])).draft.houses.length,2);
});
test('incomplete boundary fails before applying any merge', () => {
  assert.throws(()=>previewBackupMerge(set(),source([home('a')],[territory('t','T',['a'],{geometry:{type:'Polygon',coordinates:[]}})])),/incomplete boundary/);
});
test('repeated source IDs fail closed',()=>{
  assert.throws(()=>previewBackupMerge(set(),source([home('a'),home('a','Different St')])),/repeated/);
});
test('unmapped records remain available for repair',()=>{
  const r=previewBackupMerge(set(),source([home('a','100 Main St',{lat:null,lng:null})]));
  assert.equal(r.draft.houses.length,1);assert.match(r.notes.join(' '),/no usable map point/);
});
test('source upload membership is retained on an address dedupe',()=>{
  const r=previewBackupMerge(set([home('a','100 Main St',{bulkBatchIds:['old'],bulkBatchNames:['old list']})]),source([home('b','100 Main St',{bulkBatchIds:['new'],bulkBatchNames:['new list']})]));
  assert.deepEqual(r.draft.houses[0].bulkBatchIds,['old','new']);
});
test('large merge is bounded and does not lose addresses',()=>{
  const a=set(Array.from({length:3000},(_,i)=>home(String(i)))),b=source(Array.from({length:3000},(_,i)=>home(String(i+2000))));
  const r=previewBackupMerge(a,b);assert.equal(r.draft.houses.length,5000);assert.equal(r.stats.duplicates,1000);
});
const group=(id,name,time=1,congregation='Highlands Ranch')=>({key:id,versions:[{id:'v'+id,time,congregation,territory:{id,name},houses:[]}]});
test('saved map presents one entry per normalized name without deleting alternatives',()=>{
  const original=[group('a','HR-01'),group('b',' hr-01 ',2),group('c','HR-02')]; const copy=stable(original);
  const r=groupTerritoriesByName(original,new Map(),'21');assert.equal(r.length,2);assert.equal(r[0].alternatives.length,2);assert.equal(r[0].key,'b');assert.equal(r[0].reviewNeeded,true);assert.equal(stable(original),copy);
});
test('saved keep preference selects the chosen ID, including an older copy',()=>{
  const records=new Map([['p',{recordType:'territory-name-choice',hallId:'21',normalizedName:'HR-01',territoryKey:'a',updatedAt:2}]]);
  const r=groupTerritoriesByName([group('a','HR-01'),group('b','HR-01',2)],records,'21');assert.equal(r[0].key,'a');assert.equal(r[0].nameChoiceSaved,true);
  const preview=groupTerritoriesByName([group('a','HR-01'),group('b','HR-01',2)],records,'21',new Map([['HR-01','b']]));assert.equal(preview[0].nameChoiceSaved,false);
});
test('preferences are scoped to meeting place and missing kept entries require review',()=>{
  const records=new Map([['p',{recordType:'territory-name-choice',hallId:'22',normalizedName:'HR-01',territoryKey:'a'}]]);
  const r=groupTerritoriesByName([group('a','HR-01'),group('b','HR-01',2)],records,'21');assert.equal(r[0].key,'b');assert.equal(r[0].reviewNeeded,true);
});
test('unnamed territories are not collapsed by an empty name',()=>{
  assert.equal(groupTerritoriesByName([group('a',''),group('b','')],new Map(),'21').length,2);
});
test('deletion protects current saved work, open copies, pending merges and approved boundaries',()=>{
  const old={id:'old',recordType:'territory-plan',hallId:'21',congregation:'Highlands Ranch',saveKind:'work',updatedAt:1};
  const latest={...old,id:'latest',updatedAt:2}, recs=new Map([['old',old],['latest',latest]]);
  assert.match(deletionProblem(latest,recs,null),/current saved work/);
  assert.match(deletionProblem(old,recs,'old'),/currently open/);
  assert.match(deletionProblem(old,recs,null,['old']),/Save the merged backup/);
  assert.equal(deletionProblem(old,recs,null), '');
  const boundary={...old,id:'boundary',recordType:'territory-boundary',meetingPlaceBoundary:true};recs.set('boundary',boundary);
  assert.match(deletionProblem(boundary,recs,null),/approved/);
});
test('trashed saved work does not become the latest protected copy',()=>{
  const a={id:'a',recordType:'territory-plan',hallId:'21',congregation:'Highlands Ranch',saveKind:'work',updatedAt:1};const b={...a,id:'b',updatedAt:2,deletedAt:3};
  assert.match(deletionProblem(a,new Map([['a',a],['b',b]]),null),/current saved work/);
});

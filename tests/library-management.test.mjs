import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { datedWorkName, combineChosenLocation, createLibraryManager } from '../territories/library-management-model.js';
import { groupTerritoriesByName, deletionProblem, nameKey } from '../territories/backup-merge-model.js';
import { createBackupTools } from '../territories/backup-merge-service.js';
import { createSavedLayerLoader } from '../territories/saved-territories-model.js';
const home = (id, territoryId=null, extra={}) => ({id,address:`${id} Example St`,lat:39.57,lng:-104.99,territoryId,included:true,...extra});
const version = (id='old', extra={}) => ({id:JSON.stringify(['plan',id,0]),recordId:id,hallId:'hall',congregation:'A',territory:{id:'t1',name:'HR-01',houseIds:['1']},houses:[home('1','t1')],...extra});
const group = v => ({key:JSON.stringify([v.hallId,v.territory.id]),versions:[v]});
function harness() {
 const records = new Map();let counter=0, now=100, hall={id:'hall',name:'Example Hall'}, fail=false;
 const workspace={hallId:'hall',congregation:'A',houses:[home('99')],territories:[],boundary:null};
 const saves=[];
 const host={isAdmin:()=>true,status:()=> 'ready',hall:()=>hall,records:()=>records,capture:()=>structuredClone(workspace),
   saveSnapshot:async(snapshot,options)=>{if(fail)throw Error('storage failed');const id='copy'+(++counter);records.set(id,{id,recordType:'territory-plan',hallId:'hall',congregation:'A',saveKind:options.kind,libraryKept:options.libraryKept,updatedAt:now++});saves.push({id,snapshot:structuredClone(snapshot),options});return id;},
   writeChoice:async(hallId,name,territoryKey,details)=>{const id='choice'+(++counter);const r={id,recordType:'territory-name-choice',hallId,normalizedName:nameKey(name),territoryKey,...details,updatedAt:now++};records.set(id,r);return r;}};
 return {records,host,workspace,saves,manager:createLibraryManager(host),setHall:value=>hall=value,fail:()=>fail=true};
}
test('dated names use Denver time with seconds, regardless of server timezone',()=>{
 assert.equal(datedWorkName('Example Hall',new Date('2026-10-23T02:03:04Z')),'Example Hall — 2026-10-22 20:03:04 MT');
 assert.notEqual(datedWorkName('Example Hall',new Date('2026-10-23T02:03:04Z')),datedWorkName('Example Hall',new Date('2026-10-23T02:03:05Z')));
});
test('keep saves independent addresses and exact version before a cleanup is allowed',async()=>{
 const h=harness(),v=version();const before=JSON.stringify(v);const choice=await h.manager.keep(v);
 assert.equal(h.saves.length,1);assert.equal(h.saves[0].options.kind,'backup');assert.equal(h.saves[0].options.libraryKept,true);
 assert.deepEqual(h.saves[0].snapshot.houses,v.houses);assert.equal(JSON.stringify(v),before);
 assert.notEqual(choice.versionId,v.id);assert.equal(JSON.parse(choice.versionId)[1],h.saves[0].id);
 assert.match(deletionProblem(h.records.get(h.saves[0].id),h.records,'none'),/kept territory/);
});
test('cleanup hides only other versions; full plans and unrelated territories remain recoverable',async()=>{
 const h=harness(),v=version(),choice=await h.manager.keep(v);const kept=version(h.saves[0].id);
 const g={versions:[kept,v,version('older')]};await h.manager.removeOthers(g);
 const result=groupTerritoriesByName([group({...kept,time:3}),{...group(v),versions:[v,version('older')]},group(version('other',{territory:{id:'t2',name:'HR-02'},time:2}))],h.records,'hall');
 assert.equal(result.length,2);const chosen=result.find(g=>g.versions[0].territory.name==='HR-01');
 assert.equal(chosen.versions.length,1);assert.equal(chosen.versions[0].id,choice.versionId);assert.equal(chosen.hiddenVersionCount,2);
 assert.equal(h.records.get(h.saves[0].id).deletedAt,undefined);
 await h.manager.removeOthers(g,true);assert.equal([...h.records.values()].at(-1).hiddenVersionIds.length,0);
});
test('a failed independent save never saves a keep choice or deletes another version',async()=>{
 const h=harness();h.fail();await assert.rejects(h.manager.keep(version()),/storage failed/);assert.equal(h.records.size,0);
 await assert.rejects(h.manager.removeOthers({versions:[version()]}),/Save the exact version/);
});
test('all same-name revisions are offered, including older revisions of the same territory ID',()=>{
 const a=version('a',{time:1}),b=version('b',{time:2}),c=version('c',{time:3,territory:{id:'different',name:'HR-01'}});
 const records=new Map([['k',{id:'k',recordType:'territory-name-choice',hallId:'hall',normalizedName:'hr-01',territoryKey:group(a).key,versionId:a.id,updatedAt:4}]]);
 // Use the exported normalization rather than making assumptions about casing.
 records.get('k').normalizedName=nameKey('HR-01');
 const result=groupTerritoriesByName([{...group(a),versions:[b,a]},group(c)],records,'hall');
 assert.equal(result.length,1);assert.equal(result[0].versions.length,3);assert.equal(result[0].versions[0].id,a.id);assert.equal(result[0].keptVersionId,a.id);
});
test('named library set preserves unassigned homes, separate units and restrictive avoid flags',()=>{
 const w={hallId:'hall',congregation:'A',territories:[{id:'old-id',name:'HR-01'}],houses:[home('99'),home('1','old-id',{avoid:true,included:false,avoidSource:'private'}),home('2',null,{address:'10 Example St Apt 1',unit:'1'}),home('3',null,{address:'10 Example St Apt 2',unit:'2'})],boundary:null};
 const before=JSON.stringify(w);const out=combineChosenLocation(w,[version()]);
 assert.equal(JSON.stringify(w),before);assert.equal(out.houses.length,4);assert.equal(out.houses.find(h=>h.id==='1').avoid,true);assert.equal(out.houses.find(h=>h.id==='1').included,false);
 assert.equal(out.territories.length,1);assert.equal(out.territories[0].id,'t1');
});
test('named set cannot silently relabel another congregation or overlap a different current territory',()=>{
 const w={hallId:'hall',congregation:'A',territories:[],houses:[],boundary:null};
 assert.throws(()=>combineChosenLocation(w,[version('b',{congregation:'B'})]),/selected meeting/);
 const occupied={...w,territories:[{id:'occupied',name:'HR-02'}],houses:[home('1','occupied')]};
 assert.throws(()=>combineChosenLocation(occupied,[version()]),/another saved territory/);
});
test('checking backup button state does not clone a large editable address set',()=>{
 let captures=0;
 const tools=createBackupTools({context:()=>({hallId:'hall',congregation:'A',generation:1,currentPlanId:'p'}),capture:()=>{captures++;throw Error('large clone should not happen');}});
 for(let i=0;i<500;i++)tools.state();assert.equal(captures,0);
});
test('unchanged PDF snapshots are read once per session and changed snapshots are invalidated',async()=>{
 let reads=0;
 const loader=createSavedLayerLoader(async options=>({snapshot:await options.readSnapshot(options.record)}));
 const options={hallId:'hall',record:{id:'pdf',updatedAt:1,snapshotChunkIds:['one']},readSnapshot:async()=>({n:++reads})};
 assert.equal((await loader.load(options)).snapshot.n,1);assert.equal((await loader.load(options)).snapshot.n,1);
 assert.equal((await loader.load({...options,record:{...options.record,updatedAt:2}})).snapshot.n,2);
 loader.clearCache();assert.equal((await loader.load(options)).snapshot.n,3);
});
test('snapshot read failures are retryable rather than cached as successful data',async()=>{
 let n=0;const loader=createSavedLayerLoader(async o=>o.readSnapshot(o.record));
 const o={hallId:'hall',record:{id:'pdf'},readSnapshot:async()=>{if(++n===1)throw Error('offline');return 'okay';}};
 await assert.rejects(loader.load(o),/offline/);assert.equal(await loader.load(o),'okay');
});
test('PDF button exists for plan-only versions and snapshot generation never loads the editable map',()=>{
 const s=fs.readFileSync('territories/saved-territories-layer.js','utf8');
 assert.match(s,/>View PDF<\/button>/);assert.match(s,/versionPdf\(version, message\)/);
 const main=fs.readFileSync('territories/app-main.js','utf8');
 const section=main.slice(main.indexOf('async function libraryVersionPdf('),main.indexOf('let hallSelectionSequence'));
 assert.match(section,/buildTerritoryPdf\(snapshot, progress\)/);assert.doesNotMatch(section,/loadPlanRecord\(|savePlan\(/);
});
test('retired leftover panel does no work and does not remove address records',()=>{
 const s=fs.readFileSync('territories/territory-flex-grouping-pdf.js','utf8');assert.match(s,/function injectLeftoverCard\(\) \{ return;/);assert.match(s,/function renderLeftovers\(\) \{ return;/);
});

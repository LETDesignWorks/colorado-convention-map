import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createConfirmedRecordBuffer } from '../territories/planner-records-cache.js';
import { createLibraryManager, combineChosenLocation, datedWorkName } from '../territories/library-management-model.js';
import { deletionProblem, groupTerritoriesByName, nameKey } from '../territories/backup-merge-model.js';
const read = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setTimeout(resolve,25));
function change(id,recordType,type='added',more={}) { return {type,doc:{id,data:()=>({recordType,...more})}}; }
function snapshot(changes,pending=false) { return {metadata:{hasPendingWrites:pending},docChanges:options=>{assert.equal(options.includeMetadataChanges,true);return changes;}}; }
test('confirmed record buffer retains other updates received during a pending write',()=>{
 const records=new Map(),apply=createConfirmedRecordBuffer(records);
 assert.equal(apply(snapshot([change('p','territory-plan')],true)).pending,true);assert.equal(records.size,0);
 apply(snapshot([change('external','territory-boundary')],true));assert.equal(records.size,0);
 const result=apply(snapshot([change('p','territory-plan','modified')],false));
 assert.equal(result.pending,false);assert.equal(result.changed,true);assert.equal(records.size,2);assert.ok(records.has('external'));
});
test('confirmed chunk acknowledgments do not rebuild saved history and preserve untouched identities',()=>{
 const stable={id:'s',recordType:'territory-plan'},records=new Map([['s',stable]]),apply=createConfirmedRecordBuffer(records);
 apply(snapshot([change('c','territory-plan-chunk')],true));
 assert.equal(apply(snapshot([change('c','territory-plan-chunk','modified')])).changed,false);
 assert.equal(records.get('s'),stable);assert.ok(records.has('c'));
 apply(snapshot([change('s','territory-plan','removed')],true));apply(snapshot([]));assert.equal(records.has('s'),false);
});
test('legacy houseIds-only membership survives saving a chosen location set',()=>{
 const h={id:'h',address:'1 Example St',lat:39.57,lng:-104.99,included:true,territoryId:null};
 const w={hallId:'a',congregation:'A',houses:[],territories:[],boundary:null};
 const v={hallId:'a',congregation:'A',territory:{id:'t',name:'T1',houseIds:['h']},houses:[h]};
 const set=combineChosenLocation(w,[v]);assert.equal(set.houses[0].territoryId,'t');assert.deepEqual(set.territories[0].houseIds,['h']);assert.equal(h.territoryId,null);
});
test('individual deletion protects the exact keeper and only removes the chosen alternative',async()=>{
 const records=new Map([['choice',{id:'choice',recordType:'territory-name-choice',hallId:'a',normalizedName:nameKey('T1'),territoryKey:'key',versionId:'kept',updatedAt:1}]]);
 let saved;
 const manager=createLibraryManager({isAdmin:()=>true,status:()=> 'ready',hall:()=>({id:'a'}),records:()=>records,
  writeChoice:async(h,n,k,details)=>saved=details});
 const group={versions:[{id:'kept',hallId:'a',territory:{id:'t',name:'T1'}},{id:'older'},{id:'other'}]};
 await assert.rejects(manager.removeVersion(group,'kept'),/protected/);assert.equal(saved,undefined);
 await manager.removeVersion(group,'older');assert.deepEqual(saved.hiddenVersionIds,['older']);assert.equal(saved.versionId,'kept');
});
test('loading feedback is visible before work and clears on completion',async()=>{
 const dom=new JSDOM('<div id="map"></div>');globalThis.document=dom.window.document;
 const {startLoading,stopLoading,clearLoading,paintBeforeWork}=await import('../territories/planner-loading.js');
 startLoading('test','Loading Example Hall');assert.equal(document.getElementById('plannerLoading').hidden,false);
 assert.match(document.getElementById('plannerLoadingText').textContent,/Example Hall/);await paintBeforeWork();
 stopLoading('test');assert.equal(document.getElementById('plannerLoading').hidden,true);assert.equal(document.getElementById('map').getAttribute('aria-busy'),'false');clearLoading();dom.window.close();
});
test('bulk cleanup returns usable controls after a successful delete',async()=>{
 const dom=new JSDOM('<details id="savedWorkBackup" open><summary>Backup</summary></details>');
 const records=new Map([['old',{id:'old',recordType:'territory-plan',hallId:'a',congregation:'A',planName:'Old',updatedAt:1}]]);
 const api={isAdmin:()=>true,getSavedRecordsStatus:()=> 'ready',getSavedRecords:()=>records,getSelectedHall:()=>({id:'a',name:'Hall'}),getSelectedCongregation:()=> 'A',getCurrentPlanId:()=> 'current',
   backupTools:{state:()=>({pendingSourceIds:[]}),trash:async id=>{records.get(id).deletedAt=Date.now();}}};
 const context={document:dom.window.document,window:dom.window,globalThis:{__denverTerritoryPlannerAPI:api},setTimeout,clearTimeout,confirm:()=>true,deletionProblem,console};
 vm.runInNewContext(read('territories/library-bulk-cleanup.js').replace(/^import .*;$/gm,''),context);await tick();
 const d=dom.window.document;d.getElementById('bulkBackupCleanup').open=true;await tick();
 d.getElementById('selectRemovableBackups').click();d.getElementById('deleteSelectedBackups').click();await tick();
 assert.ok(records.get('old').deletedAt);assert.equal(d.getElementById('selectRemovableBackups').disabled,false);assert.equal(d.getElementById('clearBackupSelection').disabled,false);assert.match(d.getElementById('bulkBackupCleanupStatus').textContent,/1 backup/);dom.window.close();
});
function layerHarness() {
 const ids=['savedTerritoriesCard','savedTerritoriesStatus','savedTerritoriesList','savedTerritoryDetail','savedTerritoriesPanel','savedTerritoriesProblems','savedTerritoriesHall'];
 const buttons=['showAllSavedTerritories','hideSavedTerritories','refreshSavedTerritories','zoomSavedTerritories','latestSavedTerritories'];
 const dom=new JSDOM(ids.map(id=>`<div id="${id}"></div>`).join('')+buttons.map(id=>`<button id="${id}"></button>`).join('')+'<input id="autoShowSavedTerritories" type="checkbox">',{url:'https://example.invalid'});
 const v={id:'exact-plan',source:'plan',recordId:'p',sourceName:'Saved plan',hallId:'a',congregation:'A',time:1,territory:{id:'t',name:'T1'},houses:[{id:'h',address:'1 Example St'}]};
 const groups=[{key:'k',versions:[v]}],calls=[],map={getPane:()=>({}),removeLayer(){},fitBounds(){}};
 const L={featureGroup:()=>({clearLayers(){},removeLayer(){},addTo(){return this;},getBounds:()=>({isValid:()=>true})}),geoJSON:()=>({eachLayer(fn){fn({bindTooltip(){},on(){}})},addTo(){return this;},getBounds:()=>({isValid:()=>true})})};
 const host={map,L,turf:{},getHall:()=>({id:'a',name:'Hall'}),getCongregation:()=> 'A',isAdmin:()=>true,getRecords:()=>new Map(),getStatus:()=> 'ready',
   libraryManager:{keep:async()=>{throw Error('Storage unavailable');}},versionPdf:async version=>{calls.push(version.id);return{blob:new Blob(['mock']),filename:'test.pdf'};}};
 const ctx={document:dom.window.document,window:dom.window,URL,console,queueMicrotask,setTimeout,clearTimeout,confirm:()=>true,prompt:()=>null,host,datedWorkName,
   paintBeforeWork:()=>Promise.resolve(),groupTerritoriesByName,createSavedLayerLoader:()=>({cancel(){},load:async()=>({groups,issues:[],planCount:1,pdfCount:0})}),savedGeometry:()=>({type:'Polygon'})};
 vm.runInNewContext(read('territories/saved-pdf-view.js').replace(/^export /gm,'')+'\n'+read('territories/saved-territories-layer.js').replace(/^import .*;$/gm,'').replace('export function mountSavedTerritories','function mountSavedTerritories')+'\nmountSavedTerritories(host);',ctx);
 return{dom,calls};
}
test('a plan-only saved version has a functioning PDF action for the exact selection',async()=>{
 const h=layerHarness(),d=h.dom.window.document;d.getElementById('showAllSavedTerritories').click();await tick();d.querySelector('[data-saved-index]').click();
 d.getElementById('openSavedTerritoryPdf').click();await tick();assert.deepEqual(h.calls,['exact-plan']);assert.equal(d.querySelector('#savedTerritoryPdfLinks a[download]').download,'test.pdf');
 d.getElementById('hideSavedTerritories').click();h.dom.window.close();
});
test('failed keep restores usable PDF and selection controls without enabling protected deletion',async()=>{
 const h=layerHarness(),d=h.dom.window.document;d.getElementById('showAllSavedTerritories').click();await tick();d.querySelector('[data-saved-index]').click();
 d.getElementById('keepExactVersion').click();await tick();assert.match(d.getElementById('libraryVersionStatus').textContent,/Storage unavailable/);
 assert.equal(d.getElementById('openSavedTerritoryPdf').disabled,false);assert.equal(d.getElementById('savedTerritoryVersion').disabled,false);assert.equal(d.getElementById('deleteOtherVersions').disabled,true);h.dom.window.close();
});
function writeHarness(failPart=0) {
 const source=read('territories/app-main.js'),code=source.slice(source.indexOf('async function saveLibrarySnapshot('),source.indexOf('\nasync function libraryVersionPdf('));
 const stored=new Map(),reviews=new Map(),writes=[],hall={id:'a',name:'Hall'};let counter=0,commits=0;
 const context={isAdmin:()=>true,savedRecordsStatus:'ready',selectedHall:hall,selectedCongregation:'A',libraryChoice:()=>null,libraryNameKey:n=>String(n).toUpperCase(),currentUser:{email:'test@example.invalid'},serializeHouse:h=>({...h}),FIRESTORE_HOUSE_CHUNK_SIZE:1,
  db:{},collection:()=>({collection:true}),doc:(parent,...path)=>({id:parent.collection?'copy'+(++counter):path.at(-1)}),workKey:(h,c)=>JSON.stringify([h,c]),datedWorkName:()=> 'Named',
  markerLabel:()=> 'A',encodeGeometry:g=>g?JSON.stringify(g):null,decodeGeometry:(j,g)=>j?JSON.parse(j):g||null,els:{territoryPrefix:{value:'A'}},clean:s=>String(s||'').trim(),targetSizeValue:()=>30,
  serverTimestamp:()=>1,writeBatch:()=>{const entries=[];return{set:(ref,record)=>{entries.push([ref.id,record])},commit:async()=>{commits++;if(failPart===commits)throw Error('chunk failed');for(const entry of entries){writes.push(entry[1].recordType==='territory-plan'?'manifest':entry[0]);stored.set(...entry)}}}},
  setDoc:async(ref,record)=>{writes.push('manifest');stored.set(ref.id,record)},reviewRecords:reviews,renderSavedRecords(){},emitPlannerDataChange(){},console,Map,Date,JSON};
 vm.createContext(context);vm.runInContext(code+'\nthis.save=saveLibrarySnapshot;',context);return{context,stored,reviews,writes};
}
test('independent kept copy publishes only after all owned address parts succeed',async()=>{
 const h=writeHarness(),snapshot={hallId:'a',congregation:'A',boundary:null,houses:[{id:'1'},{id:'2'}],territories:[{id:'t',name:'T1'}]};
 const id=await h.context.save(snapshot,{kind:'backup',libraryKept:true});assert.equal(h.writes.at(-1),'manifest');
 const record=h.stored.get(id);assert.equal(record.libraryKept,true);assert.equal(record.chunkIds.length,2);assert.ok(record.chunkIds.every(key=>h.stored.get(key).planId===id));assert.ok(h.reviews.has(id));
});
test('a failed kept-copy part never exposes a loadable partial plan',async()=>{
 const h=writeHarness(2);await assert.rejects(h.context.save({hallId:'a',congregation:'A',boundary:null,houses:[{id:'1'},{id:'2'}],territories:[]}),/chunk failed/);
 assert.equal(h.writes.includes('manifest'),false);assert.equal(h.reviews.size,0);assert.equal([...h.stored.values()].some(r=>r.recordType==='territory-plan'),false);
});


test('complete session atomically publishes manifest and all exact kept-version choices',async()=>{
 const h=writeHarness(),snapshot={hallId:'a',congregation:'A',boundary:null,houses:[{id:'1'},{id:'2'}],territories:[{id:'t',name:'T1'},{id:'u',name:'T2',congregation:'B'}]};
 const id=await h.context.save(snapshot,{kind:'work',sessionScope:'meeting-place'});
 const record=h.stored.get(id),choices=[...h.stored.values()].filter(r=>r.recordType==='territory-name-choice');
 assert.equal(record.sessionScope,'meeting-place');assert.equal(choices.length,2);
 assert.ok(choices.every((c,i)=>JSON.parse(c.versionId)[1]===id));
 assert.equal(JSON.parse(record.territoriesJson)[1].congregation,'B');
 const failed=writeHarness(3);await assert.rejects(failed.context.save(snapshot,{kind:'work',sessionScope:'meeting-place'}),/chunk failed/);
 assert.equal([...failed.stored.values()].filter(r=>['territory-plan','territory-name-choice'].includes(r.recordType)).length,0);
});

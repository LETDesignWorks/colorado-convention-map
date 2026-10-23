import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as model from '../territories/backup-merge-model.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const read = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
function uiHarness() {
  const dom = new JSDOM('<details id="savedWorkBackup" open><summary>Backup</summary><div id="savedPlans"><div><button data-load-plan="old">Load backup copy</button></div></div></details>',{url:'https://example.invalid/territories/'});
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  const records = new Map([['old',{id:'old',recordType:'territory-plan',hallId:'21',hallName:'Example Hall',congregation:'Highlands Ranch',planName:'Old backup',houseCount:1,updatedAt:1}]]);
  const calls=[], homes=[{id:'1',address:'1 Example St'}];
  const preview={sourceLabel:'Old backup',stats:{addresses:2,territories:0,avoids:0,duplicates:0,unassigned:2},notes:[],conflicts:[],relink:false};
  const tools={state:()=>({busy:false,pendingSourceIds:[]}),prepare:async id=>{calls.push(['prepare',id]);return{token:'t',source:{id},preview};},review:()=>preview,
    apply:()=>{calls.push(['apply']);homes.push({id:'2',address:'2 Example St'});return preview;},
    save:async(name,makeCurrent)=>{calls.push(['save',name,makeCurrent]);return{id:'saved',currentId:makeCurrent?'current':null};},trash:async(id,restore)=>calls.push(['trash',id,restore])};
  const api={backupTools:tools,isAdmin:()=>true,getSavedRecordsStatus:()=> 'ready',getSavedRecords:()=>records,getHouses:()=>homes,
    getSelectedHall:()=>({id:'21',name:'Example Hall'}),getSelectedCongregation:()=> 'Highlands Ranch',getCurrentPlanId:()=> 'main',getMap:()=>({removeLayer(){}}),render(){}};
  const context={document:dom.window.document,window:dom.window,console,setTimeout,clearTimeout,queueMicrotask,confirm:()=>true,
    globalThis:{__denverTerritoryPlannerAPI:api},...model};
  vm.runInNewContext(read('territories/backup-merge-ui.js').replace(/^import .*;$/gm,''),context);
  return{dom,calls,homes,api};
}
test('backup UI offers an additive action separately from the old replacement loader',async()=>{
  const h=uiHarness();await settle();const d=h.dom.window.document;
  assert.ok(d.querySelector('[data-load-plan]'));assert.equal(d.querySelector('[data-add-backup]').textContent,'Add to this location');
  assert.ok(d.getElementById('saveMergedBackup'));assert.ok(d.querySelector('[data-trash-backup]'));assert.match(d.getElementById('backupMergeDestination').textContent,/Example Hall/);
  h.dom.window.close();
});
test('preview and apply are separate clicks, and saving can also create current work',async()=>{
  const h=uiHarness();await settle();const d=h.dom.window.document;
  d.querySelector('[data-add-backup]').click();await settle();assert.equal(h.homes.length,1);assert.equal(d.getElementById('applyBackupMerge').disabled,false);
  d.getElementById('applyBackupMerge').click();assert.equal(h.homes.length,2);assert.equal(h.calls.filter(c=>c[0]==='save').length,0);
  d.getElementById('saveMergedBackup').click();await settle();assert.deepEqual(h.calls.find(c=>c[0]==='save').slice(1),['',true]);assert.match(d.getElementById('backupMergeStatus').textContent,/saved and verified/);
  h.dom.window.close();
});
function layerHarness() {
  const ids=['savedTerritoriesCard','savedTerritoriesStatus','savedTerritoriesList','savedTerritoryDetail','savedTerritoriesPanel','savedTerritoriesProblems','savedTerritoriesHall'];
  const buttons=['showAllSavedTerritories','hideSavedTerritories','refreshSavedTerritories','zoomSavedTerritories','latestSavedTerritories'];
  const dom=new JSDOM(ids.map(id=>`<div id="${id}" tabindex="-1"></div>`).join('')+buttons.map(id=>`<button id="${id}"></button>`).join('')+'<input id="autoShowSavedTerritories" type="checkbox">',{url:'https://example.invalid'});
  const records=new Map(),calls=[],map={panes:new Map(),getPane(name){return this.panes.get(name);},createPane(name){const p={style:{}};this.panes.set(name,p);return p;},removeLayer(){},fitBounds(){}};
  const groups=['a','b'].map((id,i)=>({key:id,versions:[{id:'v'+id,source:'plan',sourceName:'Source '+id,recordId:id,hallId:'21',congregation:i?'Southpark':'Highlands Ranch',time:i+1,territory:{id,name:'HR-01',geometry:{type:'Polygon',coordinates:[]}},houses:[{id:'h'+id,address:`${i+1} Example St`}]}]}));
  let savedLayer;
  const L={featureGroup:()=>savedLayer={items:[],clearLayers(){this.items=[];},removeLayer(item){this.items=this.items.filter(x=>x!==item);},addTo(){return this;},getBounds:()=>({isValid:()=>true})},geoJSON:()=>({eachLayer(fn){fn({bindTooltip(){},on(){}});},addTo(layer){layer.items.push(this);return this;},getBounds:()=>({isValid:()=>true})}),DomEvent:{stopPropagation(){}}};
  const host={map,L,turf:{},getHall:()=>({id:'21',name:'Example Hall'}),isAdmin:()=>true,getRecords:()=>records,getStatus:()=> 'ready',readSnapshot:async()=>{},readPdf:async()=>{},
    saveNameChoice:async(name,key)=>{calls.push([name,key]);records.set('choice',{id:'choice',recordType:'territory-name-choice',hallId:'21',normalizedName:model.nameKey(name),territoryKey:key,updatedAt:Date.now()});}};
  const context={document:dom.window.document,window:dom.window,URL,console,queueMicrotask,setTimeout,clearTimeout,host,
    paintBeforeWork:()=>Promise.resolve(), groupTerritoriesByName:model.groupTerritoriesByName,createSavedLayerLoader:()=>({cancel(){},load:async()=>({groups,issues:[],planCount:2,pdfCount:0})}),savedGeometry:v=>v.territory.geometry};
  const code=read('territories/saved-territories-layer.js').replace(/^import .*;$/gm,'').replace('export function mountSavedTerritories','function mountSavedTerritories');
  vm.runInNewContext(code+'\nmountSavedTerritories(host);',context);
  return{dom,calls,records,get layer(){return savedLayer;}};
}
test('same-name saved territories show once, with both alternatives available to review',async()=>{
  const h=layerHarness(),d=h.dom.window.document;d.getElementById('showAllSavedTerritories').click();await settle();
  assert.equal(d.querySelectorAll('[data-saved-index]').length,1);assert.equal(h.layer.items.length,1);
  d.querySelector('[data-saved-index]').click();assert.equal(d.querySelectorAll('[data-keep-name]').length,2);
  assert.match(d.getElementById('savedTerritoryDetail').textContent,/Southpark/);assert.match(d.getElementById('savedTerritoryDetail').textContent,/Highlands Ranch/);
  h.dom.window.close();
});
test('keeping an older same-name alternative survives hide and reopen without deleting originals',async()=>{
  const h=layerHarness(),d=h.dom.window.document;d.getElementById('showAllSavedTerritories').click();await settle();d.querySelector('[data-saved-index]').click();
  d.querySelector('[data-keep-name="1"]').click();await settle();assert.equal(h.calls[0][1],'a');assert.equal(h.records.get('choice').territoryKey,'a');
  d.getElementById('hideSavedTerritories').click();d.getElementById('showAllSavedTerritories').click();await settle();d.querySelector('[data-saved-index]').click();
  assert.equal(d.querySelectorAll('[data-keep-name]').length,2);assert.match(d.getElementById('savedTerritoryDetail').textContent,/keep choice is saved/);assert.match(d.querySelector('[data-saved-index]').textContent,/Source a/);
  h.dom.window.close();
});
test('trash filters are present in all auto-restore and historical map sources',()=>{
  for(const path of ['territories/saved-work-model.js','territories/saved-territories-model.js','territories/meeting-place-model.js'])assert.match(read(path),/deletedAt/);
  const main=read('territories/app-main.js');assert.match(main,/forceBackup/);assert.match(main,/getDocFromServer/);assert.match(main,/backupTools,/);
  assert.match(main,/recordType: 'territory-name-choice'/);assert.match(main,/runTransaction\(db/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as turf from '@turf/turf';
import { createRequire } from 'node:module';
import { assembleMeetingSession, withSessionTerritories, territoryStamps, sessionChanges, sessionContentStamp } from '../territories/meeting-session-model.js';
import { createMeetingSessionManager } from '../territories/meeting-session-service.js';
import { boundaryMembership, fillBoundaryMembership } from '../territories/territory-membership.js';
import { editablePolygonFeatures, removeBoundaryVertex, mountVertexRemoval } from '../territories/territory-vertex-tools.js';
import { latestWork, currentWorkFor } from '../territories/saved-work-model.js';
const clone = value => JSON.parse(JSON.stringify(value));
const shape = turf.bboxPolygon([-105.02,39.57,-105,39.59]).geometry;
const home=(id, t=null, extra={})=>({ id, address:`${id} Example St`, lat:39.58, lng:-105.01, included:true, territoryId:t, ...extra });
const territory=(id, name=id, extra={})=>({id,name,houseIds:[],geometry:clone(shape),...extra});
const workspace=(houses=[],territories=[])=>({hallId:'21',hallName:'Highlands Ranch',congregation:'A',houses,territories,boundary:clone(shape),generation:1,editId:null,editing:false});
const version=(t, houses, extra={})=>({id:`v-${t.id}`, key:`k-${t.id}`, hallId:'21',congregation:'A', territory:t,houses,...extra});
const group=v=>({key:v.key,nameBucket:v.territory.name.toUpperCase(),versions:[v]});
test('complete session includes all library territories plus current uploads, new territories and avoids',()=>{
 const w=workspace([home('1','new'),home('2'),home('avoid',null,{avoid:true,included:false})],[territory('new')]);
 const groups=[group(version(territory('5'),[home('5','5')])),group(version(territory('13'),[home('13','13')],{congregation:'B'}))];
 const result=assembleMeetingSession(w,groups); assert.equal(result.territories.length,3);assert.equal(result.houses.length,5);assert.equal(result.houses.find(h=>h.id==='avoid').avoid,true);assert.equal(result.territories.find(t=>t.id==='13').congregation,'B');assert.equal(w.houses.length,3);
});
test('current edits win historical same-name copies and new uploads are not dropped',()=>{
 const w=workspace([home('1','5'),home('2','5')],[territory('5','5',{houseIds:['1','2']})]);
 const result=assembleMeetingSession(w,[group(version(territory('old','5'),[home('3','old')]))]);assert.equal(result.territories[0].id,'5');assert.equal(result.houses.length,2);
});
test('an explicit kept library choice replaces an unchanged loaded copy, not a dirty one',()=>{
 const w=workspace([home('1','5')],[territory('5','5')]);const baseline=territoryStamps(w);Object.assign(w,sessionChanges(w,baseline));
 const v=version(territory('old','5'),[home('2','old')]);const g={...group(v),keptVersionId:v.id};
 const result=assembleMeetingSession(w,[g]);assert.equal(result.territories[0].id,'old');assert.equal(result.houses.find(h=>h.id==='1').territoryId,null);
 w.houses.push(home('3','5'));Object.assign(w,sessionChanges(w,baseline));assert.equal(assembleMeetingSession(w,[g]).territories[0].id,'5');
});
test('editing a saved territory retains every unrelated territory and all session addresses',()=>{
 const w=workspace([home('1','5'),home('13','13'),home('outside')],[territory('5'),territory('13')]);
 const v=version(territory('replacement','5'),[home('new','replacement')]);
 const result=assembleMeetingSession(w,[],{selected:v});assert.equal(result.territories.length,2);assert.equal(result.houses.length,4);assert.ok(result.territories.some(t=>t.id==='13'));
});
test('legacy isolated edit can restore its full base including unassigned homes',()=>{
 const w=workspace([home('1','5')],[territory('5')]);w.editId='5';
 const base=workspace([home('1','5'),home('2','13'),home('3')],[territory('5'),territory('13')]);
 const result=assembleMeetingSession(w,[],{base});assert.equal(result.houses.length,3);assert.equal(result.territories.length,2);assert.equal(result.editId,null);
});
test('new avoid information remains restrictive when reviewing an older version',()=>{
 const w=workspace([home('1',null,{avoid:true,included:false,avoidSource:'Latest upload'})],[]);
 const v=version(territory('5'),[home('1','5')]);const result=assembleMeetingSession(w,[],{selected:v});assert.equal(result.houses[0].avoid,true);assert.equal(result.houses[0].included,false);assert.equal(result.houses[0].territoryId,null);
});
test('new session territories and changed versions appear in the library immediately',()=>{
 const w=workspace([home('1','5')],[territory('5')]);const out=withSessionTerritories([],w,turf);assert.equal(out.length,1);assert.equal(out[0].versions[0].source,'session');
 w.houses.push(home('2','5'));assert.notEqual(out[0].versions[0].id,withSessionTerritories([],w,turf)[0].versions[0].id);
});
test('intentional session territory removal does not resurrect a historical copy',()=>{
 const w=workspace([home('1','5')],[territory('5')]);const baseline=territoryStamps(w);w.territories=[];w.houses[0].territoryId=null;Object.assign(w,sessionChanges(w,baseline));
 assert.equal(assembleMeetingSession(w,[group(version(territory('5'),[home('1','5')]))]).territories.length,0);
});
test('conflicting chosen assignments fail without changing either source',()=>{
 const w=workspace();const groups=[group(version(territory('5'),[home('1','5')])),group(version(territory('13'),[home('1','13')]))];
 assert.throws(()=>assembleMeetingSession(w,groups),/conflicting territory assignments/);assert.equal(w.houses.length,0);
});
test('incomplete library versions cannot silently disappear from a complete session save',()=>{
 assert.throws(()=>assembleMeetingSession(workspace(),[group(version(territory('5'),[],{error:'missing chunk'}))]),/incomplete saved data/);
});
test('territories 5 and 13 boundary review finds inside unassigned, avoid, excluded and conflicting homes',()=>{
 for (const name of ['5','13']) {
 const w=workspace([home('a',name),home('b'),home('c','other'),home('d',null,{avoid:true,included:false}),home('e',null,{included:false}),home('f',null,{lat:39.9})],[territory(name),territory('other')]);
 const review=boundaryMembership(w,name,turf);assert.equal(review.assigned.length,1);assert.equal(review.unassigned.length,1);assert.equal(review.conflicts.length,1);assert.equal(review.avoids.length,1);assert.equal(review.excluded.length,1);
 const result=fillBoundaryMembership(w,name,turf).draft;assert.equal(result.houses[1].territoryId,name);assert.equal(result.houses[2].territoryId,'other');assert.equal(result.houses[3].avoid,true);assert.equal(w.houses[1].territoryId,null);
 assert.equal(fillBoundaryMembership(w,name,turf,{moveConflicts:true}).draft.houses[2].territoryId,name);
 }
});
test('membership check respects polygon holes and multi-polygon components',()=>{
 const polygon=turf.polygon([[[-105.03,39.56],[-104.99,39.56],[-104.99,39.6],[-105.03,39.6],[-105.03,39.56]],shape.coordinates[0]]).geometry;
 const w=workspace([home('1')],[territory('5','5',{geometry:polygon})]);assert.equal(boundaryMembership(w,'5',turf).unassigned.length,0);
});
test('whole meeting-place session appears once and restores across congregation selectors',()=>{
 const plans=[{id:'s',recordType:'territory-plan',saveKind:'work',sessionScope:'meeting-place',hallId:'21',congregation:'A',updatedAt:3},{id:'b',recordType:'territory-plan',saveKind:'work',hallId:'21',congregation:'B',updatedAt:4}];
 assert.deepEqual(latestWork(plans).map(p=>p.id),['s']);assert.equal(currentWorkFor(plans,'21','B').id,'s');
});
function serviceHarness() {
 let w=workspace([home('current','new'),home('upload'),home('avoid',null,{avoid:true,included:false})],[territory('new')]);
 const records=new Map([['p',{id:'p',recordType:'territory-plan',hallId:'21',congregation:'A',territories:[territory('5')],chunkIds:['c'],houseCount:1}],['c',{id:'c',recordType:'territory-plan-chunk',planId:'p',houses:[home('5','5')]}]]);
 const calls=[];const host={turf,isAdmin:()=>true,status:()=> 'ready',capture:()=>clone(w),records:()=>records,hall:()=>({id:'21',name:'Highlands Ranch'}),readSnapshot:async()=>{},readBase:()=>null,askName:()=> 'My complete session',confirm:()=>true,confirmVersion:()=>true,
 saveSnapshot:async(draft,options)=>{calls.push({draft:clone(draft),options});return 'saved';},apply:(draft,stamp)=>{assert.equal(stamp,sessionContentStamp(w));w=clone(draft);},editBoundary:()=>{},message:()=>{}};
 return {host,calls,get workspace(){return w;},manager:createMeetingSessionManager(host)};
}
test('SAVE YOUR WORK publishes one named full session with source provenance',async()=>{
 const h=serviceHarness();await h.manager.save();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.sessionScope,'meeting-place');assert.equal(h.calls[0].draft.territories.length,2);assert.equal(h.calls[0].draft.houses.length,4);
});
test('cancelled session naming performs no save and no replacement',async()=>{const h=serviceHarness();h.host.askName=()=>null;assert.equal(await h.manager.save(),null);assert.equal(h.calls.length,0);assert.equal(h.workspace.territories.length,1);});
test('failed snapshot save retains the editable session and source records',async()=>{const h=serviceHarness();h.host.saveSnapshot=async()=>{throw new Error('offline');};await assert.rejects(h.manager.save(),/offline/);assert.equal(h.workspace.territories.length,1);});
test('edits arriving while saving are not overwritten by the captured session',async()=>{const h=serviceHarness();h.host.saveSnapshot=async()=>{h.workspace.houses.push(home('later'));return 'saved';};await h.manager.save();assert.ok(h.workspace.houses.some(x=>x.id==='later'));});
test('vertex removal maintains closed rings and a minimum three corners without mutating the original',()=>{
 const before=JSON.stringify(shape);const next=removeBoundaryVertex(shape,0,0,turf);assert.equal(next.coordinates[0].length,4);assert.deepEqual(next.coordinates[0][0],next.coordinates[0].at(-1));assert.equal(JSON.stringify(shape),before);assert.throws(()=>removeBoundaryVertex(next,0,1,turf),/at least three/);
});
test('each MultiPolygon component gets its own editable polygon',()=>{const features=editablePolygonFeatures({type:'MultiPolygon',coordinates:[shape.coordinates,shape.coordinates]});assert.equal(features.features.length,2);assert.ok(features.features.every(f=>f.geometry.type==='Polygon'));});
test('explicit delete and undo work with the real pinned Leaflet.draw editor',()=>{
 const require=createRequire(import.meta.url);const dom=new JSDOM('<div id="map"></div><div id="controls"></div>',{pretendToBeVisual:true,runScripts:'dangerously'});
 const {window}=dom;window.SVGSVGElement.prototype.createSVGRect=()=>({});
 window.eval(fs.readFileSync(require.resolve('leaflet/dist/leaflet.js'),'utf8'));window.eval(fs.readFileSync(require.resolve('leaflet-draw/dist/leaflet.draw.js'),'utf8'));
 const L=window.L;const element=window.document.getElementById('map');Object.defineProperty(element,'clientWidth',{value:800});Object.defineProperty(element,'clientHeight',{value:600});
 const map=L.map(element,{zoomControl:false}).setView([39.58,-105.01],16);const group=L.featureGroup().addTo(map);L.geoJSON(shape).eachLayer(layer=>group.addLayer(layer));const layer=group.getLayers()[0];const editor=new L.EditToolbar.Edit(map,{featureGroup:group});editor.enable();
 const oldDocument=globalThis.document;globalThis.document=window.document;
 try {
 let changed=0;const dispose=mountVertexRemoval({L,turf,map,group,container:window.document.getElementById('controls'),onChange:()=>changed++});
 assert.equal(dispose.deleteAt(map.latLngToContainerPoint(L.latLng(39.57,-105.02))),true);assert.equal(layer.toGeoJSON().geometry.coordinates[0].length,4);assert.equal(changed,1);
 window.document.getElementById('undoBoundaryPointButton').click();assert.equal(layer.toGeoJSON().geometry.coordinates[0].length,5);assert.equal(layer.editing.enabled(),true);dispose();assert.equal(window.document.getElementById('removeBoundaryPointButton'),null);
 } finally {globalThis.document=oldDocument;editor.disable();map.remove();dom.window.close();}
});
test('integrated controls use complete session saves and territory-only GIS search',()=>{
 const main=fs.readFileSync('territories/app-main.js','utf8'), layer=fs.readFileSync('territories/saved-territories-layer.js','utf8'), scanner=fs.readFileSync('territories/assessor-full-boundary.js','utf8');
 assert.match(main,/return meetingSessionManager.edit\(version\)/);assert.match(main,/return await meetingSessionManager.save\(\)/);assert.match(main,/publish.set\(ref, record\)/);assert.match(main,/versionId: JSON.stringify\(\['plan', id, index\]\)/);
 assert.match(layer,/Check boundary addresses/);assert.match(layer,/Find missing assessor/);assert.match(layer,/withSessionTerritories/);assert.match(scanner,/scope.searchGeometry/);
 assert.match(fs.readFileSync('territories/template.html','utf8'),/territory-list-card" hidden/);
});


test('an unchanged session uses the same default version shown in the saved library',()=>{
 const w=workspace([home('1','5')],[territory('5')]);w.dirtyTerritoryIds=[];
 const v=version(territory('newer','5'),[home('2','newer')]);const result=assembleMeetingSession(w,[group(v)]);
 assert.equal(result.territories[0].id,'newer');assert.ok(result.houses.some(h=>h.id==='1'));
});
test('removing a territory prevents older base resurrection but preserves its homes',()=>{
 const w=workspace([home('1')]);w.removedTerritoryNames=['5'];
 const base=workspace([home('1','5'),home('2','5')],[territory('5')]);
 const result=assembleMeetingSession(w,[],{base});assert.equal(result.territories.length,0);assert.equal(result.houses.length,2);assert.ok(result.houses.every(h=>!h.territoryId));
});
test('recreating a removed territory name clears the persisted removal',()=>{
 const w=workspace([home('1','replacement')],[territory('replacement','5')]);w.removedTerritoryNames=['5'];
 const result=assembleMeetingSession(w,[]);assert.equal(result.territories.length,1);assert.deepEqual(result.removedTerritoryNames,[]);
});
test('saved session collection preserves per-territory congregation metadata',async()=>{
 const {collectSavedTerritories}=await import('../territories/saved-territories-model.js');
 const records=new Map([['p',{id:'p',recordType:'territory-plan',hallId:'21',congregation:'A',houseCount:1,chunkIds:['c'],territories:[territory('5','5',{congregation:'B'})]}],['c',{id:'c',recordType:'territory-plan-chunk',planId:'p',houses:[home('1','5')]}]]);
 const result=await collectSavedTerritories({records,hallId:'21',readSnapshot:async()=>{throw Error('unexpected');}});
 assert.equal(result.groups[0].versions[0].congregation,'B');
});
test('outside-assigned homes move to unassigned only with explicit consent',()=>{
 const w=workspace([home('1','5',{lat:39.9})],[territory('5')]);
 assert.equal(fillBoundaryMembership(w,'5',turf).draft.houses[0].territoryId,'5');
 const result=fillBoundaryMembership(w,'5',turf,{releaseOutside:true}).draft;
 assert.equal(result.houses[0].territoryId,null);assert.equal(result.houses.length,1);assert.equal(w.houses[0].territoryId,'5');
});

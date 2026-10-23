import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import * as turf from '@turf/turf';
import { trimBoundaryArea, validateTrimmedBoundary, mountBoundaryTrim } from '../territories/territory-trim-tools.js';
import { mountVertexRemoval } from '../territories/territory-vertex-tools.js';
const coord = (x,y) => [-105 + x*.001,39.5 + y*.001];
const polygon = pairs => ({type:'Polygon',coordinates:[pairs.map(p=>coord(...p))]});
const rect = (x1,y1,x2,y2) => polygon([[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]);
const body=rect(0,0,4,4), cut=rect(-5,-1,0,2);
const tail=polygon([[0,0],[4,0],[4,4],[0,4],[0,1.2],[-4,.25],[-4,.20],[0,1.1],[0,0]]);
const point=(x,y)=>turf.point(coord(x,y));
const inside=(shape,x,y)=>turf.booleanPointInPolygon(point(x,y),shape);
const sameArea=(a,b)=>assert.ok(Math.abs(turf.area(a)-turf.area(b))<.01);
test('a narrow territory tail is clipped in one operation without changing the main body',()=>{
 const before=JSON.stringify(tail), result=trimBoundaryArea(tail,cut,turf);
 sameArea(result.geometry,body);assert.ok(inside(result.geometry,2,2));assert.equal(inside(result.geometry,-3,.4),false);assert.equal(JSON.stringify(tail),before);
});
test('a zero-width backtracking spike is removable, not a chain of invalid point deletions',()=>{
 const spike=polygon([[0,0],[4,0],[4,4],[0,4],[0,1],[-2,.5],[-4,.2],[-2,.5],[0,1],[0,0]]);
 const result=trimBoundaryArea(spike,cut,turf);sameArea(result.geometry,body);assert.equal(turf.kinks(result.geometry).features.length,0);
});
test('all unrelated multipart components survive trimming',()=>{
 const other=rect(8,0,10,2), shape={type:'MultiPolygon',coordinates:[tail.coordinates,other.coordinates]};
 const result=trimBoundaryArea(shape,cut,turf);assert.equal(result.parts,2);assert.ok(inside(result.geometry,9,1));sameArea(result.geometry,{type:'MultiPolygon',coordinates:[body.coordinates,other.coordinates]});
});
test('a cut that splits one territory retains both remaining pieces',()=>{
 const result=trimBoundaryArea(body,rect(1,-1,2,5),turf);assert.equal(result.parts,2);assert.ok(inside(result.geometry,.5,2));assert.ok(inside(result.geometry,3,2));assert.equal(inside(result.geometry,1.5,2),false);
});
test('existing holes and unrelated parts stay intact',()=>{
 const shape={...tail,coordinates:[tail.coordinates[0],rect(1,2,2,3).coordinates[0]]};
 const result=trimBoundaryArea(shape,cut,turf);assert.equal(inside(result.geometry,1.5,2.5),false);assert.ok(inside(result.geometry,3,3));
});
test('an internal trim creates a hole rather than deleting the entire polygon',()=>{const r=trimBoundaryArea(body,rect(1,1,2,2),turf);assert.ok(inside(r.geometry,3,3));assert.equal(inside(r.geometry,1.5,1.5),false);});
test('a box outside the territory does not make a change',()=>assert.throws(()=>trimBoundaryArea(tail,rect(10,10,11,11),turf),/does not touch/));
test('removing the whole territory is blocked',()=>assert.throws(()=>trimBoundaryArea(tail,rect(-10,-10,10,10),turf),/entire territory/));
test('invalid box and invalid coordinates fail without modifying input',()=>{
 const original=JSON.stringify(tail);assert.throws(()=>trimBoundaryArea(tail,polygon([[0,0],[3,3],[0,3],[3,0],[0,0]]),turf),/cross|collapse/);assert.equal(JSON.stringify(tail),original);
 assert.throws(()=>validateTrimmedBoundary({type:'Polygon',coordinates:[[[null,0],[1,0],[1,1],[null,0]]]},turf),/incomplete/);
});
const require=createRequire(import.meta.url);
function harness(shape=tail, combined=false){
 const dom=new JSDOM('<div class="map-card territory-edit-active"><div id="map"></div></div><div id="controls"><button id="saveTerritoryBoundaryEditButton">Save</button></div>',{pretendToBeVisual:true,runScripts:'dangerously'}),{window}=dom;
 window.SVGSVGElement.prototype.createSVGRect=()=>({});
 window.eval(fs.readFileSync(require.resolve('leaflet/dist/leaflet.js'),'utf8'));window.eval(fs.readFileSync(require.resolve('leaflet-draw/dist/leaflet.draw.js'),'utf8'));
 const L=window.L,element=window.document.getElementById('map');Object.defineProperty(element,'clientWidth',{value:800});Object.defineProperty(element,'clientHeight',{value:600});
 const map=L.map(element,{zoomControl:false}).setView([39.502,-105],16), group=L.featureGroup().addTo(map);
 const polygons=shape.type==='MultiPolygon'?shape.coordinates:[shape.coordinates];
 for(const coordinates of polygons)L.geoJSON({type:'Polygon',coordinates}).eachLayer(layer=>{layer._denverTerritoryId='24';layer.options.denverTerritoryId='24';group.addLayer(layer)});
 const editor=new L.EditToolbar.Edit(map,{featureGroup:group});editor.enable();
 const oldDocument=globalThis.document;globalThis.document=window.document;let changes=0;
 const tool=(combined?mountVertexRemoval:mountBoundaryTrim)({L,turf,map,group,container:window.document.getElementById('controls'),onChange:()=>changes++});
 return{dom,L,map,group,editor,tool,get changes(){return changes},close(){tool();editor.disable();map.remove();dom.window.close();globalThis.document=oldDocument}};
}
test('real pinned Leaflet editor trims a tail and undo restores the exact original layer',()=>{
 const h=harness();try{const old=h.group.getLayers()[0],original=JSON.stringify(old.toGeoJSON().geometry);
 assert.equal(h.tool.applyTrim(cut),true);sameArea(h.group.toGeoJSON().features[0],body);assert.equal(h.changes,1);assert.ok(h.group.getLayers().every(l=>l.editing.enabled()&&l._denverTerritoryId==='24'));
 h.dom.window.document.getElementById('undoTerritoryTrimButton').click();assert.equal(h.group.getLayers()[0],old);assert.equal(JSON.stringify(old.toGeoJSON().geometry),original);assert.equal(h.changes,2);
 }finally{h.close()}
});
test('two successive trims can be undone in reverse order',()=>{
 const h=harness();try{h.tool.applyTrim(cut);h.tool.applyTrim(rect(3,-1,5,5));h.dom.window.document.getElementById('undoTerritoryTrimButton').click();sameArea(h.group.toGeoJSON().features[0],body);h.dom.window.document.getElementById('undoTerritoryTrimButton').click();sameArea(h.group.toGeoJSON().features[0],tail);}finally{h.close()}
});
test('split output is editable as separate polygons with the same territory identity',()=>{
 const h=harness(body);try{assert.equal(h.tool.applyTrim(rect(1,-1,2,5)),true);assert.equal(h.group.getLayers().length,2);assert.ok(h.group.getLayers().every(l=>l.toGeoJSON().geometry.type==='Polygon'&&l.editing.enabled()&&l._denverTerritoryId==='24'));}finally{h.close()}
});
test('rectangle selection disables corner tools and save until completion, then restores them',()=>{
 const h=harness(tail,true);try{const d=h.dom.window.document;d.getElementById('trimTerritoryTailButton').click();assert.equal(h.tool.isTrimming(),true);assert.equal(d.getElementById('removeBoundaryPointButton').disabled,true);assert.equal(d.getElementById('saveTerritoryBoundaryEditButton').disabled,true);
 h.map.fire('draw:created',{layerType:'rectangle',layer:h.L.geoJSON(cut).getLayers()[0]});assert.equal(h.tool.isTrimming(),false);sameArea(h.group.toGeoJSON().features[0],body);assert.equal(d.getElementById('saveTerritoryBoundaryEditButton').disabled,false);
 }finally{h.close()}
});
test('cancelling a trim selection leaves the editable geometry unchanged',()=>{
 const h=harness();try{const before=JSON.stringify(h.group.toGeoJSON());h.dom.window.document.getElementById('trimTerritoryTailButton').click();h.dom.window.document.getElementById('trimTerritoryTailButton').click();assert.equal(JSON.stringify(h.group.toGeoJSON()),before);assert.equal(h.changes,0);assert.ok(h.group.getLayers()[0].editing.enabled());}finally{h.close()}
});
test('dispose removes temporary drawing listeners so later rectangles cannot edit this territory',()=>{
 const h=harness();try{const before=JSON.stringify(h.group.toGeoJSON());h.dom.window.document.getElementById('trimTerritoryTailButton').click();h.tool();h.map.fire('draw:created',{layerType:'rectangle',layer:h.L.geoJSON(cut).getLayers()[0]});assert.equal(JSON.stringify(h.group.toGeoJSON()),before);assert.equal(h.dom.window.document.getElementById('trimTerritoryTailButton'),null);}finally{h.close()}
});
test('native edits invalidate stale trim undo',()=>{
 const h=harness();try{h.tool.applyTrim(cut);h.map.fire('draw:editvertex');assert.equal(h.dom.window.document.getElementById('undoTerritoryTrimButton').disabled,true);}finally{h.close()}
});
test('the real saved-layer pane is hidden only during boundary editing',()=>{
 const h=harness();try{const pane=h.map.createPane('savedTerritories');const style=h.dom.window.document.createElement('style');style.textContent=fs.readFileSync('territories/saved-work.css','utf8');h.dom.window.document.head.appendChild(style);
 assert.equal(h.dom.window.getComputedStyle(pane).visibility,'hidden');h.dom.window.document.querySelector('.map-card').classList.remove('territory-edit-active');assert.notEqual(h.dom.window.getComputedStyle(pane).visibility,'hidden');}finally{h.close()}
});
test('boundary save preserves every address and keeps outside homes as unassigned',()=>{
 const main=fs.readFileSync('territories/app-main.js','utf8');const code=main.slice(main.indexOf('function applyTerritoryBoundaryAssignments('),main.indexOf('function boundaryChangeSummary('));
 const home=(id,x,y,extra={})=>({id,lng:coord(x,y)[0],lat:coord(x,y)[1],included:true,avoid:false,territoryId:'24',...extra});
 const context={houses:[home('inside',2,2),home('tail',-3,.4),home('avoid',-3,.4,{avoid:true,included:false,territoryId:null,avoidTerritoryId:'24'}),home('other',9,1,{territoryId:'25'})],territories:[{id:'24',geometry:tail},{id:'25',geometry:rect(8,0,10,2)}],geometryObject:g=>g,JSON};
 context.includedAddressesInsideGeometry=g=>context.houses.filter(h=>h.included&&!h.avoid&&turf.booleanPointInPolygon(turf.point([h.lng,h.lat]),g));context.recalculateTerritoryHouseIds=()=>{};vm.createContext(context);vm.runInContext(code,context);
 context.applyTerritoryBoundaryAssignments('24',trimBoundaryArea(tail,cut,turf).geometry);assert.equal(context.houses.length,4);assert.equal(context.houses[0].territoryId,'24');assert.equal(context.houses[1].territoryId,null);assert.equal(context.houses[2].avoid,true);assert.equal(context.houses[3].territoryId,'25');
});
test('potential reassignment requires consent before applying a boundary',()=>{
 const main=fs.readFileSync('territories/app-main.js','utf8'),code=main.slice(main.indexOf('function confirmBoundaryEditUpdate('),main.indexOf('function announceBoundaryUpdate('));let asked='';
 const context={turf,validateTrimmedBoundary,toast(){},confirm:msg=>(asked=msg,false),houses:[{id:'1',included:true,avoid:false,territoryId:'24'}],includedAddressesInsideGeometry:()=>[],Set};vm.createContext(context);vm.runInContext(code,context);assert.equal(context.confirmBoundaryEditUpdate('24',body),false);assert.match(asked,/kept, not deleted/);
});
test('integration publishes edited geometry and native saves retain every multipart component',()=>{
 const main=fs.readFileSync('territories/app-main.js','utf8'),layer=fs.readFileSync('territories/saved-territories-layer.js','utf8');
 assert.match(main,/disposeVertexRemoval\?\.isTrimming/);assert.match(main,/combinedGeometryFromFeatureGroup\(territoryEditGroup\) \|\| combinedGeometryFromFeatureGroup\(editedGroup\)/);assert.equal((main.match(/announceBoundaryUpdate\(result.territory\)/g)||[]).length,2);
 assert.match(layer,/territory-planner:boundary-updated/);assert.match(layer,/selectedVersions.delete\(group.key\)/);assert.match(layer,/v.source === 'session'/);
});

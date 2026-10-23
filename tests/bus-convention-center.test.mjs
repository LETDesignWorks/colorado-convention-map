import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DRIVE_TIME_AREA} from '../bus-access/drive-time-area.mjs';
import {CONVENTION_CENTER, recenterPlanningBoundary} from '../bus-access/planning-center.mjs';
const read = p => fs.readFileSync(p, 'utf8');
const data = read('bus-access/data.js');
const DTC = JSON.parse(data.match(/export const DTC=(\[[^;]+\]);/)[1]);
const oldBoundary = JSON.parse(data.match(/export const DTC_BOUNDARY=(\[[^;]+\]);/)[1]);
const source = read('bus-access/app-v2.js'), html = read('bus-access/index.html');
function angularDistance(a,b) {
  const [x,y] = a.map(n=>n*Math.PI/180), [p,q] = b.map(n=>n*Math.PI/180);
  return 2*Math.asin(Math.sqrt(Math.sin((x-p)/2)**2+Math.cos(x)*Math.cos(p)*Math.sin((y-q)/2)**2));
}
test('Bus Review center matches the Convention Center already used by Route Planner', () => {
  assert.deepEqual(CONVENTION_CENTER.point,[39.74248,-104.99567]);
  assert.equal(CONVENTION_CENTER.name,'Colorado Convention Center');
  assert.equal(CONVENTION_CENTER.address,'700 14th St, Denver, CO 80202');
  assert.match(read('routes/app.js'), /name:'Colorado Convention Center'.*lat:39\.74248,lng:-104\.99567/);
});
test('recentered planning sketch keeps its shape size, vertex count and closed ring', () => {
  const before=JSON.stringify(oldBoundary), boundary=recenterPlanningBoundary(oldBoundary,DTC);
  assert.equal(boundary.length,oldBoundary.length);assert.deepEqual(boundary[0],boundary.at(-1));
  assert.notDeepEqual(boundary,oldBoundary);assert.equal(JSON.stringify(oldBoundary),before);
  for(let i=0;i<boundary.length;i++) {
    assert.ok(boundary[i].every(Number.isFinite));
    assert.ok(Math.abs(angularDistance(oldBoundary[i],DTC)-angularDistance(boundary[i],CONVENTION_CENTER.point)) < 2e-8);
  }
});
test('center relocation is reversible without corrupting the original coordinates', () => {
  const moved=recenterPlanningBoundary(oldBoundary,DTC), back=recenterPlanningBoundary(moved,CONVENTION_CENTER.point,DTC);
  for(let i=0;i<back.length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(back[i][j]-oldBoundary[i][j])<.000002);
});
test('invalid guide coordinates are refused rather than drawn at the wrong location',()=>{
  for(const boundary of [null,[],[[NaN,0],[0,0],[0,1],[NaN,0]]])assert.throws(()=>recenterPlanningBoundary(boundary,DTC),/invalid/);
  assert.throws(()=>recenterPlanningBoundary(oldBoundary,[null,0]),/invalid/);
});
test('live map initializes with the Convention Center, star popup and road-network outline',()=>{
  const events=[], map={setView:(point,zoom)=>{events.push(['view',point,zoom]);return map},fitBounds:(...v)=>events.push(['bounds',...v])};
  const layer={addTo:()=>layer,getBounds:()=> 'new-guide-bounds'};
  const marker={addTo:()=>marker,bindPopup:text=>events.push(['popup',text])};
  const L={map:()=>map,tileLayer:()=>layer,geoJSON:(p)=>{events.push(['geoJSON',p]);return layer;},divIcon:x=>x,marker:(p,o)=>{events.push(['marker',p,o]);return marker;}};
  const boundary=recenterPlanningBoundary(oldBoundary,DTC);
  const context=vm.createContext({L,window:{L},CONVENTION_CENTER,DRIVE_TIME_AREA,syncMarkers:()=>events.push(['sync']),map:null,boundaryLayer:null});
  vm.runInContext(source.slice(source.indexOf('function initMap()'),source.indexOf('function filteredLocations()'))+'\ninitMap();',context);
  assert.deepEqual(events.find(e=>e[0]==='view')[1],CONVENTION_CENTER.point);
  assert.deepEqual(events.find(e=>e[0]==='marker')[1],CONVENTION_CENTER.point);
  assert.equal(events.find(e=>e[0]==='geoJSON')[1],DRIVE_TIME_AREA);
  assert.match(events.find(e=>e[0]==='popup')[1],/Colorado Convention Center/);
  assert.doesNotMatch(events.find(e=>e[0]==='popup')[1],/DTC|Belleview/);
  assert.equal(events.find(e=>e[0]==='bounds')[1],'new-guide-bounds');
  assert.ok(events.some(e=>e[0]==='sync'));
});
test('new locations start at the Convention Center without changing existing records',()=>{
  const elements=Object.fromEntries(['locationId','locationType','markerLabel','lat','lng','planningArea'].map(k=>[k,{}]));
  const locationForm={reset(){},elements,querySelector:()=>({})};
  const context=vm.createContext({CONVENTION_CENTER,locationForm,nextLabel:()=> 'K1',document:{getElementById:()=>({})}});
  vm.runInContext(source.slice(source.indexOf('function resetLocationForm()'),source.indexOf('function openLocationEditor('))+'\nresetLocationForm();',context);
  assert.equal(elements.lat.value,CONVENTION_CENTER.point[0]);assert.equal(elements.lng.value,CONVENTION_CENTER.point[1]);assert.equal(elements.planningArea.value,'ccc-45');
});
test('legacy DTC classifications remain available and are not silently renamed',()=>{
  assert.deepEqual(DTC,[39.624,-104.905]);
  assert.match(html,/<option value="dtc-45">Legacy DTC area — review against the new center<\/option>/);
  assert.match(source,/planningArea\.value=location\.planningArea\|\|'other'/);
  assert.match(source,/planningArea:data\.planningArea\|\|'other'/);
  assert.match(html,/<option value="ccc-45">Colorado Convention Center/);
});
test('labels distinguish a road-network estimate from live traffic or bus verification',()=>{
  assert.match(html,/45-minute planning center: Colorado Convention Center/);
  assert.match(html,/calculated 45-minute driving estimate FROM the Colorado Convention Center/);
  assert.match(html,/No live traffic, loading time, or bus-clearance verification/);
  assert.doesNotMatch(html,/<title>DTC|<h1>DTC|estimated 45-minute DTC planning boundary/);
});
test('entry points fetch the updated map without changing parking-lot modules',()=>{
  assert.match(html,/app\.js\?v=bus-drive-time-20261023-54/);
  assert.match(read('bus-access/app.js'),/app-v2\.js\?v=bus-drive-time-20261023-54/);
  assert.match(source,/planning-center\.mjs\?v=bus-center-20261023-53/);
  assert.match(source,/traffic-planner\.mjs\?v=traffic-20261023-48/);
  assert.match(source,/traffic-model\.mjs\?v=traffic-20261023-48/);
});

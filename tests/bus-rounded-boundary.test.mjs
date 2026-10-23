import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as turf from '@turf/turf';
import {JSDOM} from 'jsdom';
import {roundedPlanningArea, mountPlanningBoundary} from '../bus-access/rounded-boundary.mjs';
import {DRIVE_TIME_AREA as source, DRIVE_TIME_CHECKS as sites} from '../bus-access/drive-time-area.mjs';
import {CONVENTION_CENTER} from '../bus-access/planning-center.mjs';
const center=CONVENTION_CENTER.point;
test('rounded display preserves the source and clearly marks its approximation',()=>{
 const before=JSON.stringify(source),out=roundedPlanningArea(source,center);
 assert.equal(out.type,'Feature');assert.equal(out.properties.displayOnly,true);assert.equal(out.properties.approximate,true);
 assert.equal(out.properties.minutes,undefined);assert.equal(out.properties.sourceMinutes,45);
 assert.equal(JSON.stringify(source),before);assert.equal(out.geometry.coordinates[0].length,181);
 assert.ok(source.geometry.coordinates[0].length>1000);
 assert.equal(turf.booleanValid(out),true);assert.equal(turf.kinks(out).features.length,0);
 assert.ok(turf.booleanPointInPolygon(turf.point([...center].reverse()),out));
 assert.deepEqual(out.geometry.coordinates[0][0],out.geometry.coordinates[0].at(-1));
 assert.deepEqual(out,roundedPlanningArea(source,center));
 const ratio=turf.area(out)/turf.area(source);assert.ok(ratio>.8&&ratio<1.5,'display must remain comparable in overall area');
});
test('all 22 built-in hall markers remain within the rounded planning guide',()=>{
 const out=roundedPlanningArea(source,center);assert.equal(sites.length,22);
 for(const s of sites)assert.ok(turf.booleanPointInPolygon(turf.point([s.lng,s.lat]),out),s.name);
});
test('invalid, open or displaced-source rings are not silently converted to valid guides',()=>{
 for(const shape of [null,{geometry:{type:'Point',coordinates:[0,0]}},{geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[NaN,1],[0,0]]]}}])assert.throws(()=>roundedPlanningArea(shape,center));
 const open=structuredClone(source);open.geometry.coordinates[0].pop();assert.throws(()=>roundedPlanningArea(open,center));
 assert.throws(()=>roundedPlanningArea(source,[90,0]));assert.throws(()=>roundedPlanningArea(source,[0,0]));
});
test('the selector changes only one non-interactive overlay, with a visible solid outline by default',()=>{
 const dom=new JSDOM('<select id="s"><option value="rounded">Rounded</option><option value="detailed">Detailed</option></select><p id="n"></p>');
 const selector=dom.window.document.querySelector('#s'),note=dom.window.document.querySelector('#n'),events=[];
 const layer={data:null,style:null,addTo(){return this},clearLayers(){events.push('clear');return this},addData(data){this.data=data;return this},setStyle(style){this.style=style;return this},getBounds(){return 'bounds'}};
 let creations=0;const L={geoJSON(data,options){creations++;assert.equal(options.interactive,false);layer.data=data;layer.style=options.style;return layer}};
 const map={fitBounds:bounds=>events.push(bounds)};const before=JSON.stringify(source);
 assert.equal(mountPlanningBoundary(L,map,source,center,{selector,note}),layer);
 assert.equal(selector.value,'rounded');assert.equal(layer.style.weight,5);assert.equal(layer.style.dashArray,null);assert.match(note.textContent,/approximate/);
 selector.value='detailed';selector.dispatchEvent(new dom.window.Event('change'));
 assert.equal(layer.data,source);assert.match(note.textContent,/calculated 45-minute driving estimate/);assert.equal(layer.style.dashArray,'9 7');
 selector.value='rounded';selector.dispatchEvent(new dom.window.Event('change'));
 assert.equal(layer.data.properties.displayOnly,true);assert.equal(layer.style.dashArray,null);assert.equal(creations,1);assert.equal(JSON.stringify(source),before);
 assert.deepEqual(events,['clear','bounds','clear','bounds']);dom.window.close();
});
test('rounded view is wired into Bus Review without replacing travel-time or traffic-layout data',()=>{
 const app=fs.readFileSync('bus-access/app-v2.js','utf8'),html=fs.readFileSync('bus-access/index.html','utf8');
 assert.match(app,/boundaryLayer=mountPlanningBoundary/);assert.match(app,/drive-time-area\.mjs\?v=bus-drive-time-20261023-54/);
 assert.match(html,/id="boundaryDisplay"/);assert.match(html,/Rounded planning guide/);assert.match(html,/Detailed driving estimate/);
 assert.match(html,/id="boundaryDisplayNote"/);assert.match(html,/approximate 45-minute planning guide/);
 assert.match(app,/traffic-planner\.mjs\?v=traffic-20261023-48/);assert.match(html,/app\.js\?v=bus-boundary-20261023-55/);
});

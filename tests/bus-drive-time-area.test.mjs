import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import * as turf from '@turf/turf';
import {DRIVE_TIME_AREA as area, DRIVE_TIME_CHECKS as checks, driveTimeEstimateFor} from '../bus-access/drive-time-area.mjs';
import {CONVENTION_CENTER, recenterPlanningBoundary} from '../bus-access/planning-center.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const audit=JSON.parse(read('bus-access/drive-time/audit.json'));
test('snapshot is the returned road contour, not a translated radius',()=>{
 const raw=JSON.parse(read('drive-time-audit/auto-45.json')).features.find(f=>f.geometry.type==='Polygon');
 assert.deepEqual(area.geometry,raw.geometry);
 assert.deepEqual(JSON.parse(read('bus-access/drive-time/convention-center-45.geojson')),area);
 assert.equal(area.properties.minutes,45); assert.equal(area.properties.costing,'auto');
 assert.equal(area.properties.liveTraffic,false);assert.equal(area.properties.predictiveTraffic,false);
 assert.equal(turf.booleanValid(area),true);assert.equal(turf.kinks(area).features.length,0);
 assert.ok(area.geometry.coordinates[0].length>1000);
 assert.ok(turf.booleanPointInPolygon(turf.point([...CONVENTION_CENTER.point].reverse()),area));
});
test('every displayed hall estimate is tied to returned route time and exact public coordinate',()=>{
 const src=JSON.parse(read('drive-time-audit/sites.json')),out=JSON.parse(read('drive-time-audit/auto-outbound.json')).sources_to_targets[0],back=JSON.parse(read('drive-time-audit/auto-inbound.json')).sources_to_targets;
 assert.equal(checks.length,22);
 for(const row of checks){const i=src.findIndex(s=>s.id===row.id);assert.ok(i>=0);assert.equal(row.outboundSeconds,out[i].time);assert.equal(row.returnSeconds,back[i][0].time);assert.equal(row.lat,src[i].lat);assert.equal(row.lng,src[i].lng);assert.ok(turf.booleanPointInPolygon(turf.point([row.lng,row.lat]),area));}
});
test('Castle Rock mismatch is corrected without changing its approval or source location',()=>{
 const data=read('bus-access/data.js'),old=JSON.parse(data.match(/export const DTC_BOUNDARY=(\[[^;]+\]);/)[1]),center=JSON.parse(data.match(/export const DTC=(\[[^;]+\]);/)[1]);
 const sketch=turf.polygon([recenterPlanningBoundary(old,center).map(p=>[p[1],p[0]])]);const site=checks.find(s=>s.id==='26'),point=turf.point([site.lng,site.lat]);
 assert.equal(turf.booleanPointInPolygon(point,sketch),false);assert.equal(turf.booleanPointInPolygon(point,area),true);assert.ok(site.outboundSeconds>38*60&&site.outboundSeconds<40*60);
 assert.equal(driveTimeEstimateFor(site).outboundMinutes,39);
});
test('static estimate cannot be presented for a custom location or a moved coordinate',()=>{
 const site=checks.find(s=>s.id==='21');assert.deepEqual(driveTimeEstimateFor(site),{outboundMinutes:29,returnMinutes:29});
 assert.equal(driveTimeEstimateFor({...site,customLocation:true}),null);
 assert.equal(driveTimeEstimateFor({...site,lat:site.lat+.02}),null);
 assert.equal(driveTimeEstimateFor({...site,lng:NaN}),null);
 assert.equal(driveTimeEstimateFor({id:'unknown',lat:39,lng:-105}),null);
 assert.equal(driveTimeEstimateFor(null),null);
});
test('provenance includes source, static speed settings and return direction caveats',()=>{
 assert.equal(audit.checks.length,26);assert.equal(audit.engine.version,'3.9.1-618cad5');
 assert.deepEqual(audit.request.costing_options.auto.speed_types,['freeflow','constrained']);assert.equal(audit.request.date_time,undefined);
 assert.match(audit.limitations,/outbound only/);assert.match(audit.limitations,/live\/predicted/);assert.equal(area.properties.busClearanceVerified,false);
 assert.match(read('bus-access/index.html'),/No live traffic, loading time, or bus-clearance verification/);
 assert.doesNotMatch(read('bus-access/app-v2.js'),/recenterPlanningBoundary|L\.polygon\(PLANNING_BOUNDARY/);
});
test('real Leaflet reads longitude/latitude correctly and renders the complete contour layer',()=>{
 const dom=new JSDOM('<!doctype html><div id="map"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
 const require=createRequire(import.meta.url),L=require('leaflet');const layer=L.geoJSON(area);const bounds=layer.getBounds();
 assert.ok(bounds.contains(CONVENTION_CENTER.point));assert.ok(Math.abs(bounds.getNorth()-40.36456)<.000001);assert.ok(bounds.contains([39.3485,-104.83]));assert.equal(layer.getLayers().length,1);
 dom.window.close();delete globalThis.window;delete globalThis.document;
});
test('selected hall card displays estimates without upgrading its bus-access status',()=>{
 const source=read('bus-access/app-v2.js'),context=vm.createContext({publicData:new Map(),statusInfo:()=>({label:'Not reviewed',color:'#667085'}),driveTimeEstimateFor,escapeHtml:v=>String(v),markerLabel:l=>l.id,typeLabel:()=> 'Kingdom Hall',BUS_SIZE_LABELS:{},congregationsBlock:()=>'',mapsUrl:()=> '#',directionsUrl:()=> '#',appleUrl:()=> '#',streetViewUrl:()=> '#'});
 vm.runInContext(source.slice(source.indexOf('function publicCard('),source.indexOf('const options=')),context);
 const html=context.publicCard(checks.find(s=>s.id==='21'));assert.match(html,/about 29 min out \/ 29 min return/);assert.match(html,/Not reviewed/);assert.match(html,/no live traffic/);
});

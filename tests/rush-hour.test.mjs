import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseRange,parseForecast,rankedLocations,sameLocation} from '../rush-hour/model.mjs';
const data=JSON.parse(fs.readFileSync('rush-hour/data.json','utf8'));
test('all approved meeting locations and activity points have both source-backed forecasts',()=>{
  assert.equal(data.locations.length,31);assert.equal(new Set(data.locations.map(l=>l.id)).size,31);
  assert.equal(data.locations.filter(l=>l.groups.includes('meetings')).length,26);
  assert.equal(data.locations.filter(l=>l.groups.includes('activities')).length,6);
  for(const site of data.locations)for(const period of ['am','pm']){
    const forecast=site.forecasts[period];assert.equal(forecast.departureLocal,'2026-11-10T'+(period==='am'?'08:00':'17:00'));
    assert.equal(new URL(forecast.sourceUrl).hostname,'www.google.com');assert.ok(forecast.sourceUrl.includes('/maps/dir/'));
    assert.ok(forecast.routes.length>0);for(const route of forecast.routes){assert.ok(route.low>0);assert.ok(route.high>=route.low);assert.ok(route.miles>0);assert.ok(route.via);}
  }
});
test('short ranges, mixed hour ranges and forecasts without arrival labels parse correctly',()=>{
  assert.deepEqual(parseRange('7–16 min'),{low:7,high:16});assert.deepEqual(parseRange('40 min to 1 hr 15 min'),{low:40,high:75});assert.deepEqual(parseRange('1–2 hr'),{low:60,high:120});
  assert.equal(parseForecast('    - link "Driving typically 7–12 min 1.4 miles via 15th St Details Preview":')[0].high,12);
  assert.throws(()=>parseRange('50–20 min'));assert.throws(()=>parseRange('unknown'));
});
test('morning and afternoon independently rank by upper forecast plus bus allowance',()=>{
  const sites=data.locations.filter(l=>l.groups.includes('meetings'));
  const am=rankedLocations(sites,'am',15),pm=rankedLocations(sites,'pm',15);
  assert.notDeepEqual(am.map(l=>l.id),pm.map(l=>l.id));
  for(const rows of [am,pm]){for(let i=0;i<rows.length;i++){assert.equal(rows[i].planningMinutes,rows[i].forecast.routes[0].high+15);assert.equal(rows[i].rank,i+1);if(i)assert.ok(rows[i].planningMinutes>=rows[i-1].planningMinutes);}}
  const yaleAm=am.find(l=>l.id==='19'),yalePm=pm.find(l=>l.id==='19');assert.equal(yaleAm.planningMinutes,70);assert.equal(yalePm.planningMinutes,90);
  assert.throws(()=>rankedLocations(sites,'am',-1));assert.throws(()=>rankedLocations(sites,'pm',NaN));
});
test('new or moved locations cannot reuse a stale traffic ranking',()=>{
  const site=data.locations[0];assert.equal(sameLocation(site,site),true);assert.equal(sameLocation({...site,lat:site.lat+.01},site),false);assert.equal(sameLocation({...site,address:'99 Different St'},site),false);
  const rows=rankedLocations([{id:'new',name:'New approved site'},site],'pm',0);
  assert.equal(rows.at(-1).id,'new');assert.equal(rows.at(-1).rank,null);assert.equal(rows.at(-1).planningMinutes,null);
});
test('every overview route ends at its intended property and starts at the convention center',()=>{
  const offset=(coord,point)=>Math.hypot((coord[1]-point.lat)*111320,(coord[0]-point.lng)*85000);
  for(const site of data.locations){const geometry=site.roadRoute.geometry;assert.equal(geometry.type,'LineString');assert.ok(geometry.coordinates.length>2);assert.ok(offset(geometry.coordinates[0],data.origin)<150,site.name+' origin');assert.ok(offset(geometry.coordinates.at(-1),site)<150,site.name+' destination');}
});
test('activity ranking reuses the fairgrounds forecast and retains pickup/drop-off distinctions',()=>{
  const activities=data.locations.filter(l=>l.groups.includes('activities'));
  assert.ok(activities.find(l=>l.id==='eSrIsd55mpr1U3ZESZSG').groups.includes('meetings'));
  assert.ok(activities.some(l=>l.id==='activity-commons'));assert.ok(activities.some(l=>l.id==='activity-confluence'));
  assert.match(activities.find(l=>l.id==='activity-four-mile').address,/4846 E Exposition/);
});

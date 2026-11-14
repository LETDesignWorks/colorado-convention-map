import {test} from 'node:test';

test('older route-plan records preserve coordinates, date, buffers, notes and stored road geometry',()=>{
 const record={recordType:'route-plan',originLat:39.7,originLng:-105,destinationLat:39.8,destinationLng:-104.9,hotelName:'Hotel',destinationName:'Hall',meetingDateTimeLocal:'2027-07-16T09:00',loadingBuffer:20,arriveEarly:10,routeBuffer:15,routeNotes:'Preserve this note',routeCoordinates:[{lat:39.7,lng:-105},{lat:39.8,lng:-104.9}]};
 const p=legacyPlan(record);assert.equal(p.stops[0].lat,39.7);assert.equal(p.time,'2027-07-16T09:00');assert.equal(p.boarding,20);assert.equal(p.notes,'Preserve this note');
 const r=savedRoute(record);assert.equal(r.planning,false);assert.deepEqual(r.legs[0].segments[0].points,[[39.7,-105],[39.8,-104.9]]);
});
test('connecting rail journeys preserve train identities and minimum transfer time',()=>{
 const airport=data.stations.find(s=>s.name==='Denver Airport Station');
 const r=planRail(data,airport.id,ridge.id,at('2026-11-20T07:00'),{transferMinutes:10});
 assert(r.segments.length>=2);for(let i=1;i<r.segments.length;i++){assert.equal(r.segments[i-1].to,r.segments[i].from);assert(r.segments[i].depart-r.segments[i-1].arrive>=10*60000);}
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculateSchedule,serializePlan,legacyPlan,validatePlan} from '../travel-routes/model.mjs';
import {parseDenver,denverInput} from '../routes/travel-plan.mjs';
import {planRail,serviceActive,inCoverage} from '../assets/rail-network.mjs';
import {road,createRouter} from '../travel-routes/providers.mjs';
import {permittedTypes,savedRoute,territoryShapes} from '../planning-map/model.mjs';
const at=s=>+parseDenver(s),local=n=>denverInput(new Date(n));
const stop=(name,mode='bus',startTime='',dwell=0)=>({id:name,name,address:name+' address',lat:39.7,lng:-104.9,mode,startTime,dwell});
const base=()=>({name:'Test trip',stops:[stop('Hotel'),stop('Field service')],time:'2027-07-16T09:00',timing:'arrive',boarding:15,allowance:10,arrivalBuffer:10,reminder:30,transfer:10,wait:15,notes:'',parking:'',tickets:'mobile',extraReminders:''});
const router=async(a,b,t,reverse)=>({mode:a.mode,depart:reverse?t-30*60000:t,arrive:reverse?t:t+30*60000,segments:[{mode:a.mode,points:[[a.lat,a.lng],[b.lat,b.lng]]}],label:'Test duration'});
test('arrive-by includes travel, arrival, boarding and reminder allowances',async()=>{
 const p=base(),r=await calculateSchedule(p,router);
 assert.equal(local(r.arrive),'2027-07-16T08:50');assert.equal(local(r.depart),'2027-07-16T08:20');assert.equal(local(r.ready),'2027-07-16T08:05');assert.equal(local(r.legs[0].reminder),'2027-07-16T07:35');
});
test('four-stop plan protects intermediate activity start times',async()=>{
 const p=base();p.time='2027-07-16T16:00';p.stops=[stop('Hotel'),stop('Field service','car','2027-07-16T09:00',120),stop('Encouraging Gathering','bus','2027-07-16T13:00',90),stop('Hotel return')];
 const r=await calculateSchedule(p,router);
 assert.equal(r.legs.length,3);assert.equal(local(r.legs[0].arrive),'2027-07-16T08:50');assert.equal(local(r.legs[1].arrive),'2027-07-16T12:50');assert.deepEqual(r.conflicts,[]);
});
test('impossible intermediate fixed start and duration are flagged',async()=>{
 const p=base();p.time='2027-07-16T10:00';p.stops=[stop('Hotel'),stop('Field service','car','2027-07-16T09:00',120),stop('Return')];
 const r=await calculateSchedule(p,router);assert.match(r.conflicts.join(),/ends after volunteers/);
});
test('depart-at waits for activity start and includes duration before loading',async()=>{
 const p=base();p.timing='depart';p.time='2027-07-16T07:00';p.stops=[stop('Hotel'),stop('Activity','car','2027-07-16T09:00',60),stop('Return')];
 const r=await calculateSchedule(p,router);assert.equal(local(r.legs[1].ready),'2027-07-16T10:00');assert.equal(local(r.legs[1].depart),'2027-07-16T10:15');
});
test('depart-at flags late critical arrivals instead of claiming on-time',async()=>{
 const p=base();p.timing='depart';p.stops[1].startTime='2027-07-16T09:15';
 assert.match((await calculateSchedule(p,router)).conflicts.join(),/25 min too late/);
});
test('Denver daylight saving gaps and empty coordinates fail validation',()=>{
 const p=base();p.time='2027-03-14T02:30';assert.throws(()=>validatePlan(p),/does not exist/);
 p.time='2027-07-16T09:00';p.stops[0].lat='';assert.throws(()=>validatePlan(p),/address pin/);
});
test('shared records retain gathering address and critical times but never credentials or nested coordinate arrays',async()=>{
 const p=base();p.stops[1]={...stop('encouraging-gathering','bus','2027-07-16T09:00'),name:'Encouraging Gathering',address:'123 Test Street'};p.key='SECRET';p.tomtomKey='SECRET';p.stops[0].key='SECRET';
 const r=await calculateSchedule(p,router),stored=serializePlan(p,r);
 assert(!JSON.stringify(stored).includes('SECRET'));assert.equal(stored.plan.stops[1].address,'123 Test Street');assert.equal(typeof stored.resultJson,'string');
 assert.equal(legacyPlan(stored).stops[1].startTime,'2027-07-16T09:00');assert.equal(savedRoute(stored).legs.length,1);
 function nested(v){if(Array.isArray(v)){assert(!v.some(Array.isArray));v.forEach(nested);}else if(v&&typeof v==='object')Object.values(v).forEach(nested);}nested(stored);
});
test('existing Field Service route opens without mutating its record',()=>{
 const old={recordType:'bus-route',routeName:'Old route',origin:{lat:39,lng:-105},destination:{lat:40,lng:-104},hotelName:'Hotel',destinationName:'Hall',meetingLocal:'2027-07-16T09:00',boardingBuffer:20,parkingNotes:'Park at signed lot'};
 const before=JSON.stringify(old),p=legacyPlan(old);assert.equal(p.stops.length,2);assert.equal(p.boarding,20);assert.equal(p.parking,'Park at signed lot');assert.equal(JSON.stringify(old),before);
});
test('private overlay subscriptions are limited to permitted sections',()=>{
 assert.deepEqual(permittedTypes(()=>false),[]);
 const types=permittedTypes(s=>s==='routes').map(p=>p.type);assert.deepEqual(types,['bus-route','route-plan']);
 assert(!permittedTypes(s=>s==='activities').some(p=>p.type==='territory-plan'));
});
test('saved territory JSON and legacy route connectors decode without invented road geometry',()=>{
 const shapes=territoryShapes({recordType:'territory-plan',territoriesJson:JSON.stringify([{name:'A',geometryJson:JSON.stringify({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]})}])});assert.equal(shapes.length,1);
 const r=savedRoute({recordType:'bus-route',origin:{lat:39,lng:-105},destination:{lat:40,lng:-104}});assert.equal(r.planning,true);assert.deepEqual(r.legs,[]);
});
const data=JSON.parse(fs.readFileSync(new URL('../data/rtd-rail.json',import.meta.url)));
const union=data.stations.find(s=>s.name==='Union Station Transit Center'),ridge=data.stations.find(s=>s.name==='RidgeGate Parkway Station');
test('official feed includes all station records and non-service stations are distinguishable',()=>{
 assert(data.stations.length>=70);assert(data.patterns.length>10);
 const convention=data.stations.find(s=>/Theatre District/.test(s.name));assert(convention);assert.equal(convention.lines.length,0);
});
test('official E Line example matches the published timetable',()=>{
 const r=planRail(data,union.id,ridge.id,at('2026-11-20T07:00'));
 assert.equal(r.scheduled,true);assert.equal(local(r.depart),'2026-11-20T07:11');assert.equal(local(r.arrive),'2026-11-20T08:04');assert.equal(r.segments[0].route,'E');assert(r.segments[0].points.length>100);
});
test('arrive-by selects the latest train that reaches the destination on time',()=>{
 const r=planRail(data,union.id,ridge.id,at('2026-11-20T08:05'),{arriveBy:true});
 assert.equal(local(r.depart),'2026-11-20T07:11');assert(r.arrive<=at('2026-11-20T08:05'));
});
test('dates outside feed coverage use explicitly estimated rail and arrival constraint',()=>{
 assert.equal(inCoverage(data,new Date(at('2027-07-16T07:00'))),false);
 const r=planRail(data,union.id,ridge.id,at('2027-07-16T09:00'),{arriveBy:true,waitMinutes:20,transferMinutes:12});
 assert.equal(r.scheduled,false);assert.match(r.label,/Planning estimate/);assert.equal(r.arrive,at('2027-07-16T09:00'));assert.equal(r.segments[0].depart-r.depart,20*60000);
});
test('stations without a connecting published route fail instead of inventing a train',()=>{
 const noService=data.stations.find(s=>/Theatre District/.test(s.name));
 assert.throws(()=>planRail(data,noService.id,ridge.id,at('2026-11-20T07:00')),/No rail journey/);
 assert.throws(()=>planRail(data,noService.id,ridge.id,at('2027-07-16T07:00')),/not connected/);
});
test('calendar exceptions override normal weekly service',()=>{
 const d={exceptions:[{service_id:'x',date:'20261120',exception_type:'2'},{service_id:'x',date:'20261121',exception_type:'1'}],calendar:[{service_id:'x',start_date:'20260101',end_date:'20261231',friday:'1',saturday:'0'}]};
 assert.equal(serviceActive(d,'x','20261120'),false);assert.equal(serviceActive(d,'x','20261121'),true);
});
test('GTFS after-midnight times work on the following calendar date',()=>{
 const d={coverage:{start:'20261120',end:'20261121'},stations:[{id:'a',lat:39,lng:-105},{id:'b',lat:40,lng:-105}],routes:[{id:'r',name:'X',color:'111111'}],shapes:{},patterns:[{id:'p',route:'r',shapeId:'',stops:['a','b'],trips:[['fri',[25*3600,25.5*3600],[25*3600,25.5*3600],'North']]}],calendar:[{service_id:'fri',start_date:'20261120',end_date:'20261120',friday:'1'}],exceptions:[]};
 const r=planRail(d,'a','b',at('2026-11-21T00:45'));assert.equal(local(r.depart),'2026-11-21T01:00');assert.equal(local(r.arrive),'2026-11-21T01:30');
});
test('walking without a key is explicit allowance with walking link, never a car road path',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Walking estimate must not call driving provider');};
 try{const r=await road({lat:39.7,lng:-104.9},{lat:39.71,lng:-104.91},0,false,'walk','');assert.equal(r.estimated,true);assert.match(r.label,/not a verified walking path/);assert.match(r.directions,/travelmode=walking/);}finally{globalThis.fetch=original;}
});
test('TomTom car/bus requests use selected time and matching provider geometry',async()=>{
 const original=globalThis.fetch;let url;globalThis.fetch=async u=>{url=new URL(u);return {ok:true,json:async()=>({routes:[{summary:{travelTimeInSeconds:600,lengthInMeters:1000},legs:[{points:[{latitude:39,longitude:-105},{latitude:40,longitude:-104}]}],guidance:{instructions:[]}}]})};};
 try{const r=await road({lat:39,lng:-105},{lat:40,lng:-104},at('2027-07-16T09:00'),true,'bus','example-key');assert.equal(url.searchParams.get('travelMode'),'bus');assert(url.searchParams.has('arriveAt'));assert(!url.searchParams.has('departAt'));assert.equal(url.searchParams.get('traffic'),'true');assert.deepEqual(r.points,[[39,-105],[40,-104]]);assert.equal(r.minutes,10);}finally{globalThis.fetch=original;}
});

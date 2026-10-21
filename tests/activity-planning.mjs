import assert from 'node:assert/strict';
import {calculate,routePoints,wallTime,conflicts,encodeRecord,decodeRecord,legacyRoute} from '../activity-planning/model.mjs';
const plan={name:'CCC to activity',coachId:'Bus 3',startLocal:'2027-07-20T08:00',stops:[{name:'CCC',lat:39.74,lng:-104.99,dwell:20},{name:'Activity',lat:39.7,lng:-104.92,dwell:120}],roundTrip:true,buffer:10,runs:2,turnaround:15,buses:1,seats:50,delegates:50,passengers:'new',costBasis:'day',rate:1200,extras:100,overrides:{}};
const legs=[{minutes:30,miles:10,path:[[-104.99,39.74],[-104.92,39.7]]},{minutes:30,miles:10,path:[[-104.92,39.7],[-104.99,39.74]]}];
const s=calculate(plan,legs);
assert.equal(s.totalMinutes,455);assert.equal(s.endLocal,'2027-07-20T15:35');assert.equal(s.miles,40);assert.equal(s.totalCost,1300);assert.equal(s.uniqueDelegates,100);assert.equal(s.costPerDelegate,13);assert.equal(s.timeline.length,6);
assert.equal(calculate({...plan,passengers:'same'},legs).costPerDelegate,26);
assert.equal(calculate({...plan,costBasis:'run'},legs).totalCost,2500);
assert.equal(calculate({...plan,buses:2,rate:120,costBasis:'hour'},legs).totalCost,1920);
assert.equal(calculate({...plan,overrides:{0:45}},legs).totalMinutes,485);
assert.throws(()=>calculate({...plan,delegates:51},legs),/only 50 seats/);
assert.throws(()=>calculate({...plan,roundTrip:false},legs.slice(0,1)),/Repeated runs/);
assert.throws(()=>calculate({...plan,runs:0},legs),/number of runs/);
assert.throws(()=>calculate({...plan,rate:-1},legs),/bus cost/);
assert.throws(()=>calculate({...plan,startLocal:''},legs),/date and start/);
assert.throws(()=>calculate({...plan,stops:[...plan.stops,{name:'Bad',dwell:0,lat:null,lng:null}]},legs),/Locate Bad/);
assert.equal(routePoints(plan).length,3);
assert.equal(routePoints({...plan,stops:[...plan.stops,plan.stops[0]]}).length,3);
const overnight=calculate({...plan,startLocal:'2027-07-20T23:00',runs:1},legs);assert.equal(overnight.endLocal,'2027-07-21T02:40');
assert.equal(wallTime('2027-07-20T08:00'),Date.UTC(2027,6,20,8));assert.throws(()=>wallTime('2027-02-30T08:00'));
const a={id:'a',coachId:' Bus 3 ',startLocal:'2027-07-20T08:00',endLocal:'2027-07-20T12:00'};
assert.equal(conflicts([a,{...a,id:'b',coachId:'bus 3',startLocal:'2027-07-20T11:59'}]).length,1);
assert.equal(conflicts([a,{...a,id:'b',startLocal:'2027-07-20T12:00'}]).length,0);
assert.equal(conflicts([a,{...a,id:'b',coachId:''}]).length,0);
const encoded=encodeRecord({...plan,summary:s,legs},legs);assert.equal(typeof encoded.legsJson,'string');assert.ok(!JSON.parse(encoded.planJson).summary);assert.deepEqual(decodeRecord({...encoded,id:'shared1'}).summary,s);
assert.equal(decodeRecord({...encoded,planJson:'invalid'}),null);
const legacy=legacyRoute({id:'old',recordType:'bus-route',routeName:'Ministry',hotelName:'Hotel',origin:plan.stops[0],destination:plan.stops[1],destinationId:'21',reportLocal:'2027-07-20T08:00',meetingLocal:'2027-07-20T09:00'});
assert.equal(legacy.stops.length,2);assert.equal(legacy.stops[1].hallId,'21');assert.equal(legacy.coachId,'');assert.equal(legacy.legacy,true);
console.log('Activity planning: timing, return legs, repeat runs, unique delegates, pricing, capacity, midnight, conflicts, persistence and legacy route checks passed.');

const boardingPlan={...plan,stops:plan.stops.map(p=>({...p,boarding:10}))};
const boardingSchedule=calculate(boardingPlan,legs);
assert.equal(boardingSchedule.timeline[0].ready,'2027-07-20T08:10');
assert.equal(boardingSchedule.timeline[0].arrival,'2027-07-20T08:00');
assert.equal(boardingSchedule.timeline[0].departure,'2027-07-20T08:20');
assert.equal(boardingSchedule.timeline[1].ready,'2027-07-20T10:50');
assert.equal(boardingSchedule.timeline[2].ready,null); // automatic return is drop-off only
assert.equal(boardingSchedule.timeline[3].ready,'2027-07-20T12:05');
assert.equal(boardingSchedule.totalMinutes,s.totalMinutes); // included, not added twice
assert.equal(boardingSchedule.totalCost,s.totalCost);
assert.equal(s.timeline[0].ready,null); // old plans keep existing times
assert.equal(calculate({...boardingPlan,startLocal:'2027-07-20T23:55'},legs).timeline[0].ready,'2027-07-21T00:05');
assert.throws(()=>calculate({...plan,stops:plan.stops.map(p=>({...p,boarding:30}))},legs),/cannot exceed stop minutes/);
assert.throws(()=>calculate({...plan,stops:plan.stops.map(p=>({...p,boarding:-1}))},legs),/loading minutes/);
const restored=decodeRecord({...encodeRecord(boardingPlan,legs),id:'boarding'});
assert.deepEqual(restored.summary,boardingSchedule);
assert.equal(restored.stops[0].boarding,10);
console.log('Delegate loading: ready times, repeated runs, overnight, drop-off return, legacy defaults, duration/cost consistency and saved-route round-trip passed.');

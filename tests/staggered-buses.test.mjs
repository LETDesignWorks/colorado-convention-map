import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDenver} from '../routes/travel-plan.mjs';
import {staggerPlan,staggerStops,stopKey,scheduleFleet,staggerSheets} from '../activity-planning/stagger-model.mjs';
const routePlan={name:'Hotel to activity to service',buffer:5,roundTrip:false,stops:[{id:'hotel',name:'Hotel',lat:39.7,lng:-105,dwell:15,boarding:10},{id:'activity',name:'Activity',lat:39.8,lng:-105,dwell:60,boarding:10},{id:'service',name:'Service',lat:39.9,lng:-105,dwell:0,boarding:0}]};
const input={route:routePlan,buses:3,gap:10,departure:'2027-07-16T08:00',autoAdjust:false};
const deadline=(index,time,notBefore='')=>({[stopKey(routePlan.stops[index],index)]:{deadline:time,notBefore}});
const minute=60000;
test('all buses retain departure spacing, loading is included, and baseline travel is reused per leg',async()=>{
 const calls=[],plan=staggerPlan(input),result=await scheduleFleet(plan,{route:async(a,b,at)=>{calls.push({a,b,at});return {minutes:a.id==='hotel'?30:20,miles:10};}});
 assert.equal(calls.length,2);assert.equal(result.rows.length,9);assert.equal(result.lastDeparture-result.firstDeparture,20*minute);
 for(const stop of [1,2]){const rows=result.rows.filter(r=>r.stop===stop);assert.equal(rows[1].depart-rows[0].depart,10*minute);assert.equal(rows[2].depart-rows[1].depart,10*minute);assert(rows.every(r=>r.depart-r.arrive===plan.points[stop-1].dwell*minute));assert(rows.every(r=>r.depart-r.ready===10*minute));}
 assert.equal(result.hasDeadlines,false);assert.equal(result.rows.at(-1).ready,null);
});
test('traffic differences cause holding while departures retain the exact interval and every bus gets its stop time',async()=>{
 const plan=staggerPlan({...input,route:{...routePlan,buffer:0}});const result=await scheduleFleet(plan,{key:'private-key',route:async(a,b,at)=>({minutes:a.id==='hotel'?{0:20,10:50,20:10}[new Date(at).getUTCMinutes()]:20,miles:10,label:'Traffic'})});
 const rows=result.rows.filter(r=>r.stop===2);assert.deepEqual(rows.map(r=>r.wait),[30,0,40]);assert.deepEqual(rows.map(r=>r.depart-rows[0].depart),[0,10*minute,20*minute]);assert(rows.every(r=>r.depart-r.arrive>=60*minute));assert(!JSON.stringify(result).includes('private-key'));
});
test('automatic departure moves the whole fleet earlier until the last bus meets the deadline',async()=>{
 const plan=staggerPlan({...input,autoAdjust:true,constraints:deadline(2,'2027-07-16T10:15')});const result=await scheduleFleet(plan,{route:async a=>({minutes:a.id==='hotel'?30:20,miles:10})});
 assert.equal(result.shiftMinutes,5);assert.equal(result.attempts,2);assert.equal(result.allMet,true);assert.equal(result.rows.at(-1).arrive,+parseDenver('2027-07-16T10:15'));assert.equal(result.routeCalls,2);
});
test('an activity cannot release buses before its fixed end; incompatible later deadlines remain visibly failed',async()=>{
 const constraints={...deadline(1,'2027-07-16T10:00','2027-07-16T12:00'),...deadline(2,'2027-07-16T11:00')};
 const result=await scheduleFleet(staggerPlan({...input,autoAdjust:true,constraints}),{route:async()=>({minutes:20,miles:5})});
 assert.equal(result.allMet,false);assert(result.violations.length>0);assert.equal(result.rows.find(r=>r.stop===2&&r.bus===1).depart,+parseDenver('2027-07-16T12:00'));
 assert(staggerSheets(result)[2].rows.some(row=>String(row[1]).includes('DEADLINES NOT MET')));
});
test('invalid stop times, missing pins, DST gaps and missing deadlines are rejected; return stops and larger fleets are supported',()=>{
 assert.equal(staggerStops({...routePlan,roundTrip:true}).length,4);assert.equal(staggerPlan({...input,buses:150}).buses,150);
 for(const change of [{buses:0},{gap:-1},{gap:1.5},{departure:'2027-03-14T02:30'},{autoAdjust:true}])assert.throws(()=>staggerPlan({...input,...change}));
 assert.throws(()=>staggerPlan({...input,route:{...routePlan,stops:[{...routePlan.stops[0],boarding:30},...routePlan.stops.slice(1)]}}));
 assert.throws(()=>staggerPlan({...input,route:{...routePlan,stops:[{...routePlan.stops[0],lat:null},...routePlan.stops.slice(1)]}}));
});
test('manual leg estimates are honored and cancellation prevents a completed schedule',async()=>{
 const plan=staggerPlan({...input,route:{...routePlan,overrides:{0:12,1:15}}});let calls=0;const result=await scheduleFleet(plan,{route:async()=>calls++});assert.equal(calls,0);assert.equal(result.rows.find(r=>r.stop===2).driveMinutes,12);
 const controller=new AbortController();controller.abort();await assert.rejects(scheduleFleet(staggerPlan(input),{signal:controller.signal,route:async()=>calls++}));assert.equal(calls,0);
});

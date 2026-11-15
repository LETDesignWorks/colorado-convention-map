import test from 'node:test';
import assert from 'node:assert/strict';
import {reachPlan,compareServiceLocations,fleetSelection,reachSheets} from '../activity-planning/service-reach-model.mjs';
const origin={id:'activity',name:'Activity',address:'1 Main St',lat:39.7,lng:-105};
const input={origin,buses:2,startLocal:'2027-07-16T09:00',duration:1.5,durationUnit:'hours',serviceLocal:'2027-07-16T12:00',boarding:15,allowance:15,early:10};
const point=(id,extra={})=>({id,name:id,address:'2 Hall Street',lat:39.8,lng:-105,group:'Field service / meeting places',busStatus:'approved',...extra});
test('timing uses Denver time and includes activity, boarding, travel and early-arrival allowances',()=>{
 const p=reachPlan(input);assert.equal(p.duration,90);assert.equal(new Date(p.start).toISOString(),'2027-07-16T15:00:00.000Z');assert.equal(new Date(p.depart).toISOString(),'2027-07-16T16:45:00.000Z');assert.equal(new Date(p.target).toISOString(),'2027-07-16T17:50:00.000Z');assert.equal(p.driveBudget,50);
 for(const change of [{buses:0},{buses:2.5},{buses:''},{duration:-1},{origin:{...origin,lat:''}},{serviceLocal:'2027-07-16T08:00'},{startLocal:'2027-03-14T02:30'}])assert.throws(()=>reachPlan({...input,...change}));
});
test('routes leave the activity by bus and exact arrival targets are reachable; failures and unsuitable places do not inflate counts',async()=>{
 const calls=[],plan=reachPlan(input),points=[point('short'),point('edge'),point('late'),point('missing',{lat:null}),point('unsuitable',{busStatus:'not-suitable'})];
 const result=await compareServiceLocations(plan,points,{key:'private-key',route:async(...args)=>{calls.push(args);return {minutes:{short:10,edge:50,late:51}[args[1].id],miles:12,label:'Traffic estimate'};}});
 assert.equal(result.reachable,2);assert.equal(result.late,1);assert.equal(result.unknown,1);assert.equal(result.total,4);assert.equal(result.rows.find(r=>r.point.id==='edge').margin,0);
 for(const call of calls){assert.equal(call[0].id,'activity');assert.equal(call[2],plan.depart);assert.equal(call[4],'bus');assert.equal(call[5],'private-key');}assert(!JSON.stringify(result).includes('private-key'));
});
test('one bus per distinct reachable meeting caps the suggested fleet and permits swapping alternatives',async()=>{
 const plan=reachPlan(input),result=await compareServiceLocations(plan,[point('a'),point('a'),point('b'),point('c'),point('late')],{route:async(_a,b)=>({minutes:{a:10,b:20,c:30,late:100}[b.id],miles:5})});
 const suggested=fleetSelection(result);assert.equal(result.reachable,3);assert.deepEqual(suggested.keys,['meeting:a','meeting:b']);assert.equal(suggested.capacity,2);assert.equal(suggested.unused,0);
 assert.deepEqual(fleetSelection(result,['meeting:a','meeting:c']).keys,['meeting:a','meeting:c']);assert.throws(()=>fleetSelection(result,['meeting:a','meeting:b','meeting:c']));assert.throws(()=>fleetSelection(result,['meeting:late']));assert.throws(()=>fleetSelection(result,['meeting:a','meeting:a']));
 result.plan.buses=10;assert.equal(fleetSelection(result).capacity,3);assert.equal(fleetSelection(result).unused,7);
 const sheets=reachSheets(result,['meeting:c']);assert.equal(sheets[0].rows.length,1);assert.equal(sheets[0].rows[0][1],'c');assert(sheets[2].rows.some(r=>r[0]==='Buses available'&&r[1]===10));
});
test('impossible schedules do not spend routing requests; canceled calculations do not complete',async()=>{
 let calls=0;await assert.rejects(compareServiceLocations(reachPlan({...input,duration:4}),[point('a')],{route:async()=>calls++}));assert.equal(calls,0);
 const abort=new AbortController();abort.abort();await assert.rejects(compareServiceLocations(reachPlan(input),[point('a')],{route:async()=>calls++,signal:abort.signal}));assert.equal(calls,0);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseScenario,pointKey,compareTravelScenarios,compareCongregationScenarios,draftHostingScenario} from '../assets/scenario-model.mjs';
import {defaultHostingPlan} from '../assignments/hosting-model.mjs';
import {parseDenver} from '../routes/travel-plan.mjs';
const point=(id,more={})=>({id,name:id,lat:39.74,lng:-104.99,busStatus:'approved',group:'Convention centers',...more});
const locations=[point('ccc',{name:'Colorado Convention Center'}),point('dtc',{name:'DTC Center Point'})];
const cong=id=>({id,name:id,home:{status:'mapped',point:{lat:39.74,lng:-104.99}}});
const data={ready:true,locations:[point('m1'),point('m2'),point('bad',{busStatus:'unsuitable'})],congregations:[cong('a'),cong('b')],centers:locations,assignments:[]};
const plan=(ids=['ccc','dtc'])=>({name:'Test',time:'2027-05-25T08:00',timing:'depart',boarding:0,arrivalBuffer:0,allowance:0,transfer:0,wait:0,reminder:0,stops:ids.map(id=>({...point(id),mode:'bus',dwell:0}))});
const router=minutes=>async(a,b,at,arrive)=>{const duration=typeof minutes==='function'?minutes(a,b):minutes;return {depart:arrive?at-duration*60000:at,arrive:arrive?at:at+duration*60000,minutes:duration,label:'Test road baseline',points:[]};};
test('parses real example, aliases, arrival deadline and fleet spacing',()=>{
 const x=parseScenario('3 buses from CCC to DTC on May 25, arrive by 9 AM, stagger by 10 minutes.',{locations});
 assert.deepEqual(x.pointKeys,locations.map(pointKey));assert.equal(x.time,'09:00');assert.equal(x.timing,'arrive');assert.equal(x.buses,3);assert.equal(x.stagger,10);assert.deepEqual(x.dates,['2027-05-25']);
});
test('preserves return visits, warns for unsupported exclusions and multiple times',()=>{
 const x=parseScenario('From DTC to CCC then DTC on May 23 through 25. Leave 8 AM, arrive by 10 AM. Avoid tolls.',{locations});
 assert.deepEqual(x.pointKeys,[pointKey(locations[1]),pointKey(locations[0]),pointKey(locations[1])]);assert.equal(x.dates.length,3);assert.equal(x.time,'10:00');assert.equal(x.warnings.length,2);
 const y=parseScenario('On May 25 host 300 delegates including 100 from DTC. 50 delegates per host.');assert.equal(y.total,300);assert.equal(y.dtc,100);assert.equal(y.capacity,50);
 assert.throws(()=>parseScenario(''));
});
test('compares intermediate order with actual leg durations and retains fixed endpoints',async()=>{
 const p=plan(['o','slow','fast','end']);const r=await compareTravelScenarios(p,{reorder:true,router:router((a,b)=>a.id==='o'&&b.id==='slow'?60:10)});
 assert.equal(r.results.length,2);assert.deepEqual(r.best.plan.stops.map(p=>p.id),['o','fast','slow','end']);assert.deepEqual(p.stops.map(p=>p.id),['o','slow','fast','end']);
});
test('unavailable and infeasible routes are not recommended',async()=>{
 const p=plan();p.stops[1].startTime='2027-05-25T08:10';
 assert.equal((await compareTravelScenarios(p,{router:router(20)})).best,null);
 const r=await compareTravelScenarios(plan(),{router:async()=>{throw Error('Unavailable');}});assert.equal(r.best,null);assert.equal(r.results[0].error,'Unavailable');
});
test('arrival fleet is staggered earlier, never after deadline',async()=>{
 const p={...plan(),timing:'arrive',time:'2027-05-25T09:00'};
 const r=await compareTravelScenarios(p,{router:router(20),buses:3,stagger:10,windowMinutes:30,traffic:true});
 assert.equal(r.results.length,3);assert(r.results.every(x=>x.schedule.arrive<=+parseDenver(p.time)));
 assert.equal(r.fleet.length,3);assert.equal(r.fleet[2].schedule.arrive,+parseDenver(p.time));assert.equal(r.fleet[1].schedule.depart-r.fleet[0].schedule.depart,600000);
});
test('baseline does not invent time-dependent improvements, cancellation stops work',async()=>{
 assert.equal((await compareTravelScenarios(plan(),{router:router(10),windowMinutes:60})).results.length,1);
 const c=new AbortController();c.abort();await assert.rejects(compareTravelScenarios(plan(),{router:router(10),signal:c.signal}),{name:'AbortError'});
});
test('assignments use approved locations and shortest known drives only',async()=>{
 const seen=[];const r=await compareCongregationScenarios({data,congregationIds:['a','b']},{driveTo:async(cs,p)=>{seen.push(p.id);return p.id==='m1'?[{seconds:600},{seconds:6000}]:[{seconds:1200},{seconds:null}];}});
 assert.deepEqual(seen.sort(),['m1','m2']);assert.equal(r.assignments.length,1);assert.equal(r.assignments[0].point.id,'m1');assert.equal(r.unmatched[0].congregation.id,'b');assert.equal(r.unknown,1);
});
test('group comparison minimizes longest drive and supports explicit higher limit',async()=>{
 const driveTo=async(cs,p)=>p.id==='m1'?[{seconds:100},{seconds:5400}]:[{seconds:3000},{seconds:3000}];
 const r=await compareCongregationScenarios({data,congregationIds:['a','b'],together:true},{driveTo});assert(r.assignments.every(x=>x.point.id==='m2'));
 const high=await compareCongregationScenarios({data,congregationIds:['b'],meetingIds:['m1'],limitMinutes:100},{driveTo:async()=>[{seconds:5400}]});assert.equal(high.assignments.length,1);
});
test('missing home prevents a false whole-group recommendation',async()=>{
 const d=structuredClone(data);d.congregations[0].home.point=null;
 const r=await compareCongregationScenarios({data:d,congregationIds:['a','b'],together:true},{driveTo:async()=>[{seconds:10}]});assert.equal(r.assignments.length,0);assert.equal(r.unmatched.length,2);
 await assert.rejects(compareCongregationScenarios({data:{...data,ready:false},congregationIds:['a']},{driveTo:async()=>[]}),/Wait/);
});
test('hosting filters additions, preserves existing slots and respects combined capacity',()=>{
 const p=defaultHostingPlan();p.slots.push({id:'existing',date:'2027-05-25',hub:'ccc',congregationId:'a',meetingPointId:'m1',delegates:50});const before=JSON.stringify(p);
 const r=draftHostingScenario({plan:p,data,dates:['2027-05-25'],total:150,dtc:50,congregationIds:['b'],meetingIds:['m2']});
 assert.equal(r.plan.slots.length,2);assert.equal(r.additions[0].congregationId,'b');assert.equal(r.additions[0].meetingPointId,'m2');assert.equal(r.additions[0].hub,'dtc');assert.equal(r.remaining[0].ccc,50);assert.equal(JSON.stringify(p),before);
});
test('hosting validates DTC counts and service dates; visitors need availability',()=>{
 const p=defaultHostingPlan();assert.throws(()=>draftHostingScenario({plan:p,data,dates:['2027-05-25'],total:10,dtc:20}),/cannot exceed/);
 assert.throws(()=>draftHostingScenario({plan:p,data,dates:['2027-05-28'],total:10}),/service dates/);
 const d=structuredClone(data);d.congregations.forEach(c=>c.home.point={lat:40.8,lng:-104.9});assert.equal(draftHostingScenario({plan:p,data:d,dates:['2027-05-25'],total:50}).additions.length,0);
});

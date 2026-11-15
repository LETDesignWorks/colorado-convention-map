import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateBusGroups,encodeGroupPlan,readGroupPlan,nextGroupRevision,busGroupSheets} from '../activity-planning/bus-groups-model.mjs';
import {parseDenver,denverInput} from '../routes/travel-plan.mjs';
const point=(id,lat=39.7)=>({id,name:id,address:id+' street',lat,lng:-104.9,group:'Activities'});
const origins=[point('ccc',39.74),point('dtc',39.62)],first=point('Activity',39.72),second=point('Meeting',39.8);
const bus=(id,overrides={})=>({id,name:id,departure:'2027-07-16T08:00',destination:first,secondEnabled:false,...overrides});
const plan=(buses,extra={})=>({name:'Friday buses',boarding:'15',allowance:'10',groups:[{id:'group1',name:'CCC group',originId:'ccc',buses}],...extra});
const road=async()=>({minutes:20,miles:8,label:'Test road baseline'});
test('independent groups and departure times use both centers and their own first destinations',async()=>{
 const calls=[];const value=plan([bus('Bus1'),bus('Bus2',{departure:'2027-07-16T08:20',destination:second})]);value.groups.push({id:'group2',name:'DTC group',originId:'dtc',buses:[bus('Bus3',{departure:'2027-07-16T09:00'})]});
 const result=await calculateBusGroups(value,{origins,key:'private-key',route:async(...args)=>{calls.push(args);return road();}});
 assert.equal(result.ready,3);assert.deepEqual(result.rows.map(r=>r.origin.id),['ccc','ccc','dtc']);assert.deepEqual(result.rows.map(r=>denverInput(new Date(r.legs[0].arrive))),['2027-07-16T08:30','2027-07-16T08:50','2027-07-16T09:30']);
 assert.deepEqual(calls.map(c=>[c[0].id,c[1].id,c[4],c[5]]),[['ccc','Activity','bus','private-key'],['ccc','Meeting','bus','private-key'],['dtc','Activity','bus','private-key']]);assert.equal(JSON.stringify(result).includes('private-key'),false);
});
test('a second destination begins at the first stop, after hours and boarding, crossing midnight',async()=>{
 const calls=[];const result=await calculateBusGroups(plan([bus('night',{departure:'2027-07-16T23:00',secondEnabled:true,secondDestination:second,duration:'1.5',durationUnit:'hours'})]),{origins,route:async(a,b,t)=>{calls.push([a.id,b.id,denverInput(new Date(t))]);return road();}});
 assert.equal(result.ready,1);assert.deepEqual(calls,[['ccc','Activity','2027-07-16T23:00'],['Activity','Meeting','2027-07-17T01:15']]);assert.equal(denverInput(new Date(result.rows[0].legs[1].arrive)),'2027-07-17T01:45');
});
test('exact onward time keeps the first arrival, rejects impossible boarding and allows other buses to finish',async()=>{
 let calls=0;const result=await calculateBusGroups(plan([bus('early',{secondEnabled:true,secondDestination:second,secondMode:'time',secondDeparture:'2027-07-16T08:40'}),bus('okay',{secondEnabled:true,secondDestination:second,secondMode:'time',secondDeparture:'2027-07-16T10:00'})]),{origins,route:async()=>{calls++;return road();}});
 assert.equal(result.rows[0].legs.length,1);assert.match(result.rows[0].issues[0],/too early/);assert.equal(result.rows[1].legs.length,2);assert.equal(result.ready,1);assert.equal(calls,2);
});
test('arrival deadlines flag lateness on both legs without pretending the schedule meets them',async()=>{
 const result=await calculateBusGroups(plan([bus('late',{arriveBy:'2027-07-16T08:20',secondEnabled:true,secondDestination:second,duration:'30',secondArriveBy:'2027-07-16T09:30'})]),{origins,route:road});
 assert.deepEqual(result.rows[0].legs.map(l=>l.lateMinutes),[10,15]);assert.equal(result.attention,1);assert.equal(result.rows[0].issues.length,2);
});
test('provider failures and missing pins remain unknown, keep successful first legs and redact credentials',async()=>{
 const bad=point('Bad');bad.lat=null;
 const result=await calculateBusGroups(plan([bus('failed',{secondEnabled:true,secondDestination:second}),bus('missing',{destination:bad})]),{origins,key:'secret',route:async(a)=>{if(a.id==='Activity')throw Error('Failed with secret');return road();}});
 assert.equal(result.rows[0].legs.length,1);assert.equal(result.rows[1].legs.length,0);assert.equal(result.attention,2);assert.match(result.rows[0].issues[0],/unavailable/);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('unknown travel minutes are not turned into zero-minute arrivals',async()=>{
 for(const minutes of [undefined,NaN,Infinity,-1]){const result=await calculateBusGroups(plan([bus('bad')]),{origins,route:async()=>({minutes})});assert.equal(result.ready,0);assert.equal(result.rows[0].legs.length,0);}
 const result=await calculateBusGroups(plan([bus('same')]),{origins,route:async()=>({minutes:0})});assert.equal(result.ready,1);assert.equal(result.rows[0].legs[0].arrive-result.rows[0].departure,10*60000);
});
test('time-dependent estimates use each departure, while baselines reuse the same road journey',async()=>{
 const value=plan([bus('a'),bus('b',{departure:'2027-07-16T09:00'})]);let calls=0;const route=async()=>{calls++;return road();};await calculateBusGroups(value,{origins,route});assert.equal(calls,1);calls=0;await calculateBusGroups(value,{origins,route,key:'private'});assert.equal(calls,2);
});
test('cancellation aborts in-flight work and does not return a partial finished plan',async()=>{
 const controller=new AbortController();let started=0;const pending=calculateBusGroups(plan([bus('a'),bus('b'),bus('c')]),{origins,key:'key',signal:controller.signal,route:async(a,b,t,x,y,z,signal)=>new Promise((resolve,reject)=>{started++;signal.addEventListener('abort',()=>reject(signal.reason));})});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(started,1);
});
test('requests time out without invalidating other valid buses',async()=>{
 const result=await calculateBusGroups(plan([bus('timeout')]),{origins,timeoutMs:5,route:async(a,b,t,x,y,z,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))});assert.equal(result.ready,0);assert.match(result.rows[0].issues[0],/unavailable/);
});
test('Denver date validation rejects a daylight-saving gap',async()=>{
 const result=await calculateBusGroups(plan([bus('gap',{departure:'2027-03-14T02:30'})]),{origins,route:road});assert.equal(result.ready,0);assert.match(result.rows[0].issues[0],/does not exist/);
});
test('saved plans preserve two-leg inputs and discard keys and provider results',()=>{
 const value=plan([bus('one',{secondEnabled:true,secondDestination:second,duration:'2',durationUnit:'hours',key:'secret'})]);value.key='secret';value.rows=['never save'];
 const payload=encodeGroupPlan(value),record={id:'saved',revision:3,...payload};const read=readGroupPlan(record);assert.equal(read.plan.groups[0].buses[0].secondDestination.name,'Meeting');assert.equal(read.plan.groups[0].buses[0].durationUnit,'hours');assert.equal(JSON.stringify(payload).includes('secret'),false);assert.equal('rows' in read.plan,false);assert.equal('planJson' in payload,false);assert.equal(nextGroupRevision(record,3),4);
 assert.throws(()=>nextGroupRevision(record,2),/changed elsewhere/);assert.throws(()=>nextGroupRevision(null,3),/changed elsewhere/);assert.equal(readGroupPlan({...record,planningSubtype:'another-kind'}),null);assert.equal(readGroupPlan({...record,groupsJson:'invalid'}),null);
});
test('large plans and duplicated bus IDs are rejected, incomplete drafts remain saveable',()=>{
 assert.throws(()=>encodeGroupPlan(plan([bus('a'),bus('a')])),/distinct/);assert.throws(()=>encodeGroupPlan(plan(Array.from({length:1001},(_,i)=>bus('bus'+i)))),/1,000/);assert.doesNotThrow(()=>encodeGroupPlan(plan([bus('draft',{departure:'',destination:null})])));
});
test('exports retain all buses, issues, timing assumptions, names and Denver dates',async()=>{
 const result=await calculateBusGroups(plan([bus('good'),bus('bad',{destination:null})]),{origins,route:road});const sheets=busGroupSheets(result);assert.equal(sheets[0].rows.length,2);assert.equal(sheets[1].rows.length,1);assert.match(sheets[0].rows[0][7],/2027/);assert.match(sheets[0].rows[1][12],/destination 1/);assert.ok(sheets[2].rows.some(r=>r[0]==='Traffic'&&r[1].includes('without')));
});

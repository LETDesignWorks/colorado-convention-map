import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveTimes,driveResult,prepareAssignmentDrives} from '../assignments/drive-times.mjs';
const home=(lat=39.7)=>({point:{lat,lng:-105},status:'mapped'}),a={id:'a',lat:39.8,lng:-104.9},b={id:'b',lat:40,lng:-104.8};
const response=data=>({ok:true,json:async()=>data});
test('export enriches duration-only cache with road miles, keeps direction and reuses co-located trips',async()=>{
 let calls=0;const engine=createDriveTimes({fetcher:async url=>{calls++;assert.match(url,/-105\.000000,39\.700000;-104\.900000,39\.800000/);assert.match(url,/sources=0&destinations=1/);return response({code:'Ok',durations:[[1200]],...(url.endsWith('duration,distance')?{distances:[[16093.44]]}:{})});}});
 await engine.ensure([home(),home()],a);assert.equal(engine.state(home(),a).meters,null);
 await engine.ensure([home()],a,{includeDistance:true});assert.equal(engine.state(home(),a).meters,16093.44);assert.equal(calls,2);
 await engine.ensure([home()],a,{includeDistance:true});assert.equal(calls,2);
 assert.equal(engine.state(home(39.71),a).status,'pending');
 assert.equal(driveResult(null,100).meters,null);assert.equal(driveResult(0,0).meters,0);
});
test('unsupported distance tables fall back to directed routes and reject distant road snaps',async()=>{
 const urls=[];const engine=createDriveTimes({fetcher:async url=>{urls.push(url);return response(url.includes('/table/')?{code:'NotImplemented'}:{code:'Ok',routes:[{duration:4801,distance:20000}],waypoints:[{distance:0},{distance:5}]});}});
 await engine.ensure([home()],a,{includeDistance:true});assert.equal(engine.state(home(),a).status,'over');assert.equal(engine.state(home(),a).meters,20000);assert.equal(urls.length,2);assert.match(urls[1],/\/route\/v1\/driving\/-105\.000000,39\.700000;-104\.900000,39\.800000/);
 const invalid=createDriveTimes({fetcher:async()=>response({code:'Ok',durations:[[120]],distances:[[30]],sources:[{distance:1501}]})});
 await invalid.ensure([home()],a,{includeDistance:true});assert.equal(invalid.state(home(),a).seconds,null);assert.equal(invalid.state(home(),a).meters,null);
});
test('assignment export checks every saved destination regardless of directory filters',async()=>{
 const cs=['one','two','three','four'].map(id=>({id})),calls=[],progress=[];
 await prepareAssignmentDrives({congregations:[...cs,cs[0]],locations:[a,b],assignmentFor:id=>({meetingPointId:{one:'a',two:'a',three:'b'}[id]}),resolveHome:c=>({...home(),id:c.id}),drives:{ensure:async(homes,point,options)=>calls.push({ids:homes.map(h=>h.id),point:point.id,options})},onProgress:(done,total)=>progress.push([done,total])});
 assert.deepEqual(calls.map(c=>[c.point,c.ids]),[['a',['one','two']],['b',['three']]]);assert(calls.every(c=>c.options.includeDistance));assert.deepEqual(progress.at(-1),[2,2]);
});
test('map grays only congregations proven over 80 minutes from every candidate',async()=>{
 const homes=[home(),home(39.71),home(39.72)],engine=createDriveTimes({fetcher:async url=>{assert.match(url,/sources=0;1;2&destinations=3;4/);return response({code:'Ok',durations:[[4800,5000],[4801,6000],[null,6000]]});}});
 await engine.ensureAny(homes,[a,b]);assert.deepEqual(homes.map(h=>engine.stateAny(h,[a,b]).status),['within','over','unknown']);
 assert.equal(engine.stateAny(home(39.71),[a,b,{id:'bad'}]).status,'unknown');
 assert.equal(engine.stateAny({point:null,status:'missing'},[a,b]).status,'missing');
 assert.equal(engine.stateAny(home(),[]).status,'no-destination');
 assert.equal(engine.state(home(),b).status,'over','Selected-point limit remains separate from overall reachability');
});
test('coverage batches stay bounded and late nearby locations can remove the gray state',async()=>{
 let requests=0;const points=Array.from({length:46},(_,i)=>({id:String(i),lat:40+i*.001,lng:-104.8}));
 const engine=createDriveTimes({fetcher:async url=>{requests++;const parsed=new URL(url),sources=parsed.searchParams.get('sources').split(';'),targets=parsed.searchParams.get('destinations').split(';');assert(sources.length<=50);assert(targets.length<=45);return response({code:'Ok',durations:sources.map(()=>targets.map(()=>requests===1?5000:1200))});}});
 await engine.ensureAny([home()],points);assert.equal(requests,2);assert.equal(engine.stateAny(home(),points).status,'within');
 const far=createDriveTimes({fetcher:async()=>response({code:'Ok',durations:[[5000]]})});await far.ensureAny([home()],[a]);assert.equal(far.stateAny(home(),[a]).status,'over');assert.equal(far.stateAny(home(),[a,b]).status,'pending');
});
test('unknown and synthetic straight-line routes never become gray confirmed travel',async()=>{
 for(const data of [{code:'Ok',durations:[[5000]],fallback_speed_cells:[[0,0]]},{code:'Ok',durations:[[5000]],destinations:[{distance:2000}]},{code:'Ok',durations:[[null]]}]){
  const engine=createDriveTimes({fetcher:async()=>response(data)});await engine.ensureAny([home()],[a]);assert.equal(engine.stateAny(home(),[a]).status,'unknown');
 }
});

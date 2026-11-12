import test from 'node:test';
import assert from 'node:assert/strict';
import {stationRecords,filterStations,createRailDirectory,RTD_LAYER} from '../rush-hour/trip-rail.mjs';
import {validateTrip,tripSummary,checkedTraffic,tripKey,tripHtml} from '../rush-hour/trip-model.mjs';
const feature=(overrides={})=>({attributes:{PID:125,NAME:'Belleview Station',ADDRESS:'4855 S Quebec St',CITY:'Denver',ZIPCODE:'80237',RAIL_LINE:'E-R-T',...overrides},geometry:{x:-104.90457,y:39.62769}});
const payload={features:[feature(),feature({PID:67,NAME:'Theatre District / Convention Center',RAIL_LINE:null}),feature({PID:221,NAME:'Denver Airport Station',RAIL_LINE:'A'})]};
const memory=()=>{const data=new Map();return{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};};
test('RTD locations retain stable IDs, coordinates and stations without a listed line',()=>{
 const list=stationRecords({...payload,features:[...payload.features,feature(),{...feature({PID:9}),geometry:{x:null,y:0}}]});
 assert.equal(list.length,3);assert.equal(list[0].id,'rtd-125');assert.equal(list[0].kind,'rail');assert.equal(list[0].address,'4855 S Quebec St, Denver, CO 80237');
 assert.deepEqual(list[0].lines,['E','R','T']);assert.match(list.find(p=>p.id==='rtd-67').note,/No rail line is listed/);
 for(const bad of [{},{error:{message:'fail'}},{features:[]},{...payload,exceededTransferLimit:true}])assert.throws(()=>stationRecords(bad));
});
test('station searches match cities, punctuation and exact line letters',()=>{
 const list=stationRecords(payload);assert.equal(filterStations(list,'e').length,1);assert.equal(filterStations(list,'Convention Center').length,1);
 assert.equal(filterStations(list,'Belleview Denver').length,1);assert.equal(filterStations(list,'unknown').length,0);assert.equal(filterStations(list,'').length,3);
});
test('refresh requests current RTD data, shares inflight work and preserves cached data on failure',async()=>{
 const storage=memory();let calls=0,fail=false;
 const directory=createRailDirectory({storage,now:()=>100000,fetcher:async(url,options)=>{calls++;assert.ok(String(url).startsWith(RTD_LAYER));assert.equal(new URL(url).searchParams.get('outSR'),'4326');assert.equal(options.cache,'no-store');if(fail)throw Error('offline');return{ok:true,json:async()=>payload};}});
 const [a,b]=await Promise.all([directory.refresh(),directory.refresh()]);assert.equal(calls,1);assert.equal(a,b);assert.equal(a.cached,false);
 const saved=createRailDirectory({storage,now:()=>100001});assert.equal(saved.snapshot().cached,true);assert.equal(saved.snapshot().stations.length,3);
 fail=true;await assert.rejects(directory.refresh(),/offline/);assert.equal(directory.snapshot(),a);
 const invalid=createRailDirectory({storage:{getItem:()=>'{broken'}});assert.equal(invalid.snapshot(),null);
});
test('rail endpoints work in both directions and reports retain traffic rules',()=>{
 const rail=stationRecords(payload)[0],center={id:'ccc',kind:'ccc',name:'Colorado Convention Center',address:'700 14th St, Denver, CO 80202',lat:39.74314,lng:-104.99556},departure='2027-05-20T08:00';
 validateTrip(rail,center,departure,15);validateTrip(center,rail,departure,15);
 const traffic=checkedTraffic(25,40,'I-25',tripKey(rail,center,departure));
 const result=tripSummary({from:rail,to:center,departure,allowance:15,road:{minutes:20,miles:15},traffic});
 assert.equal(result.minutes,55);assert.match(tripHtml(result),/Belleview Station/);
 assert.equal(tripSummary({...result,from:center,to:rail}).minutes,null);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {durationMinutes,durationDisplay,clearStopPin,validatePlan,serializePlan,legacyPlan,filterLocations} from '../travel-routes/model.mjs';
import {createRoutingKeyStore} from '../travel-routes/key-store.mjs';
import {savedRoute} from '../planning-map/model.mjs';
import {catalog} from '../assets/planning-common.mjs';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
const point={id:'test',name:'Meeting',address:'123 Test St',lat:39.7,lng:-105,mode:'bus',dwell:90,dwellUnit:'hours',startTime:''};
const plan=()=>({name:'Test',stops:[{...point},{...point}],time:'2027-07-16T09:00',timing:'arrive',boarding:15,allowance:10,arrivalBuffer:10,transfer:10,wait:15,reminder:30});
test('hours convert to canonical minutes and display without changing stored duration',()=>{
 assert.equal(durationMinutes(1.5,'hours'),90);assert.equal(durationMinutes(2.25,'hours'),135);assert.equal(durationDisplay(point),1.5);
 assert.equal(durationDisplay({...point,dwellUnit:'minutes'}),90);assert.equal(durationMinutes(37,'minutes'),37);
 assert.throws(()=>durationMinutes(25,'hours'));assert.throws(()=>durationMinutes(-1,'hours'));assert.throws(()=>durationMinutes('','hours'));
});
test('removing a pin keeps its name and address without mutating the shared location',()=>{
 const cleared=clearStopPin(point);assert.equal(cleared.lat,null);assert.equal(cleared.lng,null);assert.equal(cleared.address,point.address);assert.equal(cleared.name,point.name);assert.equal(point.lat,39.7);
});
test('missing-pin drafts remain editable after reload and expose no old map route',()=>{
 const p=plan();p.stops[1]=clearStopPin(p.stops[1]);validatePlan(p,{allowMissingPoints:true});assert.throws(()=>validatePlan(p),/address pin/);
 const draft=serializePlan(p);assert.equal(draft.travelDraft,true);assert.equal(draft.resultJson,'null');assert.equal(draft.plannedTravelMinutes,null);assert.equal(draft.departureLocal,'');
 const loaded=legacyPlan(draft);assert.equal(loaded.stops[1].lat,null);assert.equal(loaded.stops[1].pinRemoved,true);assert.equal(loaded.stops[1].dwellUnit,'hours');assert.equal(loaded.stops[1].dwell,90);
 assert.deepEqual(savedRoute(draft).legs,[]);
});
test('drafts reject malformed partial coordinates and invalid durations',()=>{
 const p=plan();p.stops[1].lat=null;assert.throws(()=>validatePlan(p,{allowMissingPoints:true}),/address pin/);p.stops[1]=clearStopPin(p.stops[1]);p.stops[0].dwell=null;assert.throws(()=>validatePlan(p,{allowMissingPoints:true}),/duration/);
});
test('meeting picker contains base halls and added meeting areas without unrelated records',()=>{
 const c=catalog([{id:'new-meeting',customLocation:true,locationType:'meeting-area',name:'Added area',address:'1 Test St',lat:39.9,lng:-105},{id:'profile',recordType:'congregation-address',name:'Private profile'}]);
 const meetings=filterLocations(c,'Field service / meeting places');assert(meetings.length>=20);assert(meetings.some(p=>p.id==='new-meeting'));assert(!meetings.some(p=>p.id==='profile'));assert(!meetings.some(p=>p.group==='Hotels'));
});
test('remembering key is opt-in and works across tab sessions on the same device',()=>{
 const session=storage(),device=storage(),first=createRoutingKeyStore({session,device});
 first.save('example-key',false);assert.equal(device.data.size,0);assert.equal(first.read().key,'example-key');
 first.save('example-key',true);const second=createRoutingKeyStore({session:storage(),device});assert.deepEqual(second.read(),{key:'example-key',remember:true});
 first.save('example-key',false);assert.equal(device.data.size,0);assert.equal(first.read().key,'example-key');
});
test('Clear key removes session and remembered copies',()=>{
 const session=storage(),device=storage(),keys=createRoutingKeyStore({session,device});keys.save('example-key',true);keys.clear();assert.equal(session.data.size,0);assert.equal(device.data.size,0);assert.equal(keys.read().key,'');
});
test('blocked browser storage returns a truthful failure without losing page usability',()=>{
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const keys=createRoutingKeyStore({session:blocked,device:blocked});assert.equal(keys.read().key,'');assert.equal(keys.save('example-key',true).remembered,false);assert.equal(keys.clear().deviceCleared,false);
});
test('draft exports never contain routing credentials or browser preference flags',()=>{
 const p=plan();p.tomtomKey='do-not-export';p.rememberKey=true;p.stops[0].tomtomKey='do-not-export';const json=JSON.stringify(serializePlan(p));assert(!json.includes('do-not-export'));assert(!json.includes('rememberKey'));
});

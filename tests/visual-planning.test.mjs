import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {travelEntries,filterTravelEntries} from '../assets/travel-register.mjs';
import {serializePlan,legacyPlan,validatePlan} from '../travel-routes/model.mjs';
import {travelCostDraft,calculateTravelCost,encodeTravelCost,decodeTravelCost} from '../activity-planning/travel-cost-model.mjs';
import {decodeRecord} from '../activity-planning/model.mjs';
const stops=[
 {id:'H1',name:'Hotel One',address:'1 Hotel Way',group:'Hotels',lat:39.7,lng:-105,mode:'bus',dwell:0},
 {id:'hall-1',name:'Meeting One',address:'2 Hall Way',group:'Field service / meeting places',lat:39.8,lng:-105,mode:'rail',dwell:60,startTime:'2027-07-16T09:00'},
 {id:'park',name:'Activity Park',address:'3 Park Way',group:'Activities',lat:39.74,lng:-104.9,mode:'car',dwell:30},
 {id:'H1',name:'Hotel One',address:'1 Hotel Way',group:'Hotels',lat:39.7,lng:-105,mode:'bus',dwell:0}
];
const plan=()=>({name:'Morning group',time:'2027-07-16T08:00',timing:'depart',boarding:15,allowance:10,arrivalBuffer:10,transfer:10,wait:15,reminder:30,passengers:40,vehicle:'Bus 3',planningStatus:'confirmed',assignedHotelIds:['H2'],assignedCongregationIds:['C001','C002'],stops:structuredClone(stops)});
const route=(id='one')=>({id,recordType:'bus-route',travelSchemaVersion:1,plan:plan(),resultJson:JSON.stringify({ready:1815745500000,arrive:1815751200000,legs:[{ready:1815745500000,depart:1815746400000,arrive:1815749100000,label:'Road estimate'},{ready:1815749100000,depart:1815749400000,arrive:1815750300000,label:'Rail timetable'},{ready:1815750300000,depart:1815750600000,arrive:1815751200000,label:'Road estimate'}]})});
test('one hotel can have multiple dated routes with distinct vehicles, modes and meeting links',()=>{
 const a=route(),b=route('two');b.plan.name='Afternoon';b.plan.vehicle='Bus 7';b.plan.time='2027-07-16T13:00';
 const entries=travelEntries([a,b]);assert.equal(entries.length,2);assert.deepEqual(entries[0].hotelIds,['H2','H1']);
 assert.deepEqual(filterTravelEntries(entries,{date:'2027-07-16',hotel:'H1',meeting:'1',congregation:'C002'}).map(r=>r.id),['one','two']);
 assert.equal(filterTravelEntries(entries,{date:'2027-07-17'}).length,0);assert.equal(filterTravelEntries(entries,{hotel:'H3'}).length,0);
 assert.deepEqual(entries.map(r=>r.vehicle),['Bus 3','Bus 7']);assert.equal(entries[0].modes.length,3);
});
test('legacy endpoint names resolve to catalog hotels and canonical meeting ids',()=>{
 const r={id:'old',recordType:'bus-route',hotelName:'Hotel One',destinationName:'Meeting One',meetingLocal:'2027-07-16T09:00',origin:{lat:39.7,lng:-105},destination:{lat:39.8,lng:-105}};
 const entries=travelEntries([r],stops);assert.equal(filterTravelEntries(entries,{hotel:'H1',meeting:'1'}).length,1);
});
test('route roster round-trips and rejects invalid group data without serializing credentials',()=>{
 const p=validatePlan(plan());p.tomtomKey='DO-NOT-SAVE';p.stops[0].secret='DO-NOT-SAVE';
 const record=serializePlan(p),restored=legacyPlan(record);assert.equal(restored.vehicle,'Bus 3');assert.deepEqual(restored.assignedHotelIds,['H2']);assert.equal(restored.stops[1].group,'Field service / meeting places');assert.equal(restored.passengers,40);assert(!JSON.stringify(record).includes('DO-NOT-SAVE'));
 assert.throws(()=>validatePlan({...plan(),passengers:2.5}));assert.throws(()=>validatePlan({...plan(),assignedHotelIds:'H1'}));
});
test('cost import preserves every leg, mixed transport, addresses, stop duration and critical start',()=>{
 const d=travelCostDraft(route());assert.equal(d.legs.length,3);assert.deepEqual(d.legs.map(l=>l.mode),['bus','rail','car']);assert.deepEqual(d.legs.map(l=>l.basis),['hour','person','vehicle']);
 assert.equal(d.legs[0].hours,1);assert.equal(d.legs[0].from.address,'1 Hotel Way');assert.equal(d.legs[0].criticalStart,'2027-07-16T09:00');assert.equal(d.legs[0].stopMinutes,60);assert(d.legs[0].departure);assert(d.legs[0].ready);
});
test('costs combine vehicle hours, per-person fares, cars and extras, preserving source',()=>{
 const r=route(),before=JSON.stringify(r),d=travelCostDraft(r);d.legs[0].quantity=2;d.legs[0].rate=100;d.legs[1].rate=5;d.legs[2].quantity=10;d.legs[2].rate=20;d.extras=40;
 const result=calculateTravelCost(d);assert.deepEqual(result.rows,[200,200,200]);assert.equal(result.total,640);assert.equal(result.perPerson,16);assert.equal(JSON.stringify(r),before);
 d.tomtomKey='DO-NOT-SAVE';const encoded=encodeTravelCost(d),loaded=decodeTravelCost({...encoded,id:'cost1'});assert.equal(loaded.id,'cost1');assert.equal(calculateTravelCost(loaded.draft).total,640);assert.equal(encoded.sourceTravelRouteId,'one');assert(!JSON.stringify(encoded).includes('DO-NOT-SAVE'));assert.equal(decodeRecord(encoded),null);
});
test('uncalculated drafts require billable hours and walking defaults to no charge',()=>{
 const r=route();r.resultJson='null';r.travelDraft=true;r.plan.stops[1].mode='walk';const d=travelCostDraft(r);assert.equal(d.sourceDraft,true);assert.equal(d.legs[0].hours,'');assert.equal(d.legs[1].basis,'none');assert.throws(()=>calculateTravelCost(d),/billable hours/);
 d.legs[0].hours=2;assert.equal(calculateTravelCost(d).total,0);d.people=0;assert.throws(()=>calculateTravelCost(d),/passenger count/);
});
test('activity route review retains all stops and modes from a Travel Route',()=>{
 const decoded=decodeRecord(route());assert.equal(decoded.travelRoute,true);assert.equal(decoded.stops.length,4);assert.deepEqual(decoded.stops.map(s=>s.mode),['bus','rail','car','bus']);assert.equal(decoded.coachId,'Bus 3');
});
const source=fs.readFileSync(new URL('../assignments/app-v3.mjs',import.meta.url),'utf8');
function directory(){
 const congregations=[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Free'}],assignments=new Map([['a',{meetingPointId:'m'}],['b',{meetingPointId:'m'}]]);
 const checked={checked:false,value:'all'},selected=new Set(),revealed=new Set();
 const ctx=vm.createContext({CONGREGATIONS:congregations,locations:[],nearestMeetingPointId:'',focusedMeetingPointId:'',selectedCongregations:selected,revealedCongregations:revealed,els:{searchInput:{value:''},statusFilter:{value:'all'},meetingFilter:{value:'all'}},clean:x=>String(x||''),document:{getElementById:()=>checked},assignmentFor:id=>assignments.get(id),meetingPointForAssignment:()=>null,resolveHome:()=>({address:'',status:'missing'}),rankCongregations:items=>items,isAdmin:()=>true,renderCongregationList(){}});
 vm.runInContext(source.slice(source.indexOf('function filteredCongregations('),source.indexOf('function renderStats()')),ctx);
 vm.runInContext(source.slice(source.indexOf('function selectFromMap('),source.indexOf('const drives=')),ctx);
 return {ctx,checked,selected,revealed,ids:map=>Array.from(ctx.filteredCongregations({forMap:map}),c=>c.id)};
}
test('assigned congregations hide only in directory; checkbox and map clicks reveal them',()=>{
 const f=directory();assert.deepEqual(f.ids(false),['c']);assert.deepEqual(f.ids(true),['a','b','c']);f.checked.checked=true;assert.deepEqual(f.ids(false),['a','b','c']);f.checked.checked=false;
 f.ctx.selectFromMap('a');f.ctx.selectFromMap('b');assert.deepEqual([...f.selected],['a','b']);assert.deepEqual(f.ids(false),['a','b','c']);
 f.ctx.selectFromMap('a');assert.deepEqual([...f.selected],['b']);assert(f.ids(false).includes('a'));
 f.ctx.focusedMeetingPointId='m';assert.deepEqual(f.ids(false),['a','b']);
});
test('bulk map assignment saves all selected records and hides them again; failed eligibility saves nothing',async()=>{
 const selected=new Set(['a','b']),revealed=new Set(['a','b']),assignments=new Map(),writes=[],messages=[];let eligible=true;
 const ctx=vm.createContext({assignmentBusy:false,isAdmin:()=>true,publicReady:true,locations:[{id:'m',name:'Meeting',address:'1 Main',locationType:'Kingdom Hall'}],els:{assignmentDestination:{value:'m'}},CONGREGATIONS:[{id:'a',name:'Alpha',sourceName:'Alpha'},{id:'b',name:'Beta',sourceName:'Beta'}],selectedCongregations:selected,revealedCongregations:revealed,assignments,renderSelectionControls(){},renderAll(){},requireEligible:async()=>{if(!eligible)throw Error('Too far');},db:{},currentUser:{email:'test@example.test'},markerLabel:()=>1,serverTimestamp:()=>123,resolveHome:()=>({address:'2 Main'}),assignmentDocumentId:id=>'congregation-'+id,doc:(_db,c,id)=>{assert.equal(c,'halls');return id;},writeBatch:()=>({set:(id,data)=>writes.push({id,data}),commit:async()=>{}}),toast:t=>messages.push(t),friendlyError:e=>e.message});
 vm.runInContext(source.slice(source.indexOf('async function assignSelected('),source.indexOf('async function clearSelectedAssignments(')),ctx);
 eligible=false;await ctx.assignSelected();assert.equal(writes.length,0);assert.equal(selected.size,2);
 eligible=true;await ctx.assignSelected();assert.equal(writes.length,2);assert.equal(assignments.size,2);assert.equal(selected.size,0);assert.equal(revealed.size,0);assert.equal(writes[1].data.meetingPointId,'m');assert.equal(ctx.assignmentBusy,false);
});

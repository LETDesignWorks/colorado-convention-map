import test from 'node:test';
import assert from 'node:assert/strict';
import {newTrafficPlan,validatePlan,clone,readLayouts,appendLayout,removeLayout,createTrafficStorage,DEFAULT_PARKING_SPACE_WIDTH_FEET,MAX_PARKING_SPACES,estimateParkingRow,parkingRowCount,parkingSummary} from '../bus-access/traffic-model.mjs';

const location={id:'parking-test',name:'Sample meeting location',address:'Synthetic parking test',lat:39.6,lng:-105};
const plan=()=>newTrafficPlan(location,new Date('2026-11-07T18:00:00Z'));
// Build a point at a known geodesic distance and bearing so the expected count
// does not depend on the implementation's distance or row-estimation helpers.
function destination(start,feet,bearing=0){
  const radians=Math.PI/180,distance=feet*.3048/6371008.8,lat=start[0]*radians,lng=start[1]*radians,angle=bearing*radians;
  const endLat=Math.asin(Math.sin(lat)*Math.cos(distance)+Math.cos(lat)*Math.sin(distance)*Math.cos(angle));
  const endLng=lng+Math.atan2(Math.sin(angle)*Math.sin(distance)*Math.cos(lat),Math.cos(distance)-Math.sin(lat)*Math.sin(endLat));
  return [endLat/radians,endLng/radians];
}
function row(id='row-1',feet=90,bearing=0,patch={}){
  const start=[location.lat,location.lng];
  return {id,kind:'parking-row',label:id,points:[start,destination(start,feet,bearing)],spaceWidthFeet:DEFAULT_PARKING_SPACE_WIDTH_FEET,countOverride:null,...patch};
}

test('new and legacy layouts distinguish an uncounted lot from an explicitly adjusted zero',()=>{
  const p=plan();assert.deepEqual(p.parking,{totalOverride:null});
  const uncounted={rowCount:0,estimatedTotal:0,rowTotal:0,total:null,adjusted:false,totalOverride:null};
  assert.deepEqual(parkingSummary(p),uncounted);
  const legacy=clone(p);delete legacy.parking;
  const loaded=validatePlan(legacy,location.id);assert.deepEqual(loaded.parking,{totalOverride:null});assert.deepEqual(parkingSummary(loaded),uncounted);
  assert.equal('parking' in legacy,false,'loading an older layout does not mutate its original data');
  for(const empty of [undefined,null,'','   ']){
    assert.equal(validatePlan({...p,parking:{totalOverride:empty}},location.id).parking.totalOverride,null);
  }
  p.parking.totalOverride='0';const zero=validatePlan(p,location.id);
  assert.deepEqual(parkingSummary(zero),{...uncounted,total:0,adjusted:true,totalOverride:0});
  p.parking.totalOverride=-0;assert.equal(Object.is(validatePlan(p,location.id).parking.totalOverride,-0),false);
});

test('parking rows estimate complete marked lengths in either direction, through bends, and with adjusted space widths',()=>{
  for(const bearing of [0,90,180,270]){
    const r=row('sample',90,bearing),before=JSON.stringify(r);
    assert.equal(estimateParkingRow(r),10);assert.equal(parkingRowCount(r),10);
    assert.equal(estimateParkingRow({...r,points:[...r.points].reverse()}),10);
    assert.equal(estimateParkingRow({...r,points:[r.points[0],r.points[0],r.points[1]]}),10);
    assert.equal(JSON.stringify(r),before,'estimating does not change geometry or saved preferences');
  }
  const bent=row();bent.points=[bent.points[0],destination(bent.points[0],60,0)];bent.points.push(destination(bent.points[1],30,90));
  assert.equal(estimateParkingRow(bent),10,'the count follows the marked row, not the straight endpoint distance');
  assert.equal(estimateParkingRow(row('narrow',85,0,{spaceWidthFeet:'8.5'})),10);
  assert.equal(estimateParkingRow(row('wider',90,0,{spaceWidthFeet:10})),9);
  assert.equal(estimateParkingRow(row('below-half',94.4)),10);
  assert.equal(estimateParkingRow(row('above-half',94.6)),11);
  assert.equal(estimateParkingRow(row('very-short',2)),0,'a short row never invents a minimum of one parking space');
});

test('row corrections and an overall correction retain the original estimates and obey explicit zero overrides',()=>{
  const p=plan();p.items=[row('north',90,0,{countOverride:'8'}),row('east',180,90),{id:'cone',kind:'cone',label:'',point:[39.6,-105]}];
  assert.equal(parkingRowCount(p.items[0]),8);
  assert.deepEqual(parkingSummary(p),{rowCount:2,estimatedTotal:30,rowTotal:28,total:28,adjusted:true,totalOverride:null});
  p.parking.totalOverride='25';assert.deepEqual(parkingSummary(p),{rowCount:2,estimatedTotal:30,rowTotal:28,total:25,adjusted:true,totalOverride:25});
  p.parking.totalOverride=0;assert.equal(parkingSummary(p).total,0);assert.equal(parkingSummary(p).rowTotal,28);
  p.parking.totalOverride='';p.items[0].countOverride=0;
  assert.equal(parkingRowCount(p.items[0]),0);assert.equal(parkingSummary(p).total,20);
  p.items[0].countOverride=null;assert.deepEqual(parkingSummary(p),{rowCount:2,estimatedTotal:30,rowTotal:30,total:30,adjusted:false,totalOverride:null});
  p.items[0].countOverride=10;assert.equal(parkingSummary(p).adjusted,true,'an explicit correction remains identified even if it equals the estimate');
});

test('saved copies and JSON roundtrips preserve parking rows, corrections, and legacy layouts without overwriting older copies',()=>{
  const old=plan();delete old.parking;
  const legacy=JSON.stringify({schemaVersion:1,layouts:[{id:'old',savedAt:1,plan:old}]}),beforeLegacy=legacy;
  const p=plan();p.items=[row('row-a',90,0,{countOverride:8}),row('row-b',180,90)];p.parking.totalOverride=26;
  const before=JSON.stringify(p),one=appendLayout(legacy,p,'counted',2);
  assert.equal(JSON.stringify(p),before);assert.equal(legacy,beforeLegacy);
  const checked=validatePlan(JSON.parse(JSON.stringify(p)),location.id);assert.deepEqual(checked,p);
  const records=readLayouts(one,location.id);assert.equal(records.length,2);assert.deepEqual(records[0].plan,p);
  assert.equal(parkingSummary(records[1].plan).total,null,'older copies remain uncounted');
  p.items[0].countOverride=7;p.parking.totalOverride=24;
  const two=appendLayout(one,p,'revised',3),copies=readLayouts(two,location.id);
  assert.equal(parkingSummary(copies[0].plan).total,24);assert.equal(parkingSummary(copies[1].plan).total,26);
  assert.equal(copies[1].plan.items[0].countOverride,8);
  const removed=readLayouts(removeLayout(two,location.id,'counted'),location.id);
  assert.deepEqual(removed.map(r=>r.id),['revised','old']);assert.equal(parkingSummary(removed[0].plan).total,24);
  assert.throws(()=>readLayouts(two,'another-location'),/different meeting location/);
});

test('invalid parking counts, widths, settings, and row geometry are rejected before a layout can be saved',()=>{
  const badCounts=[true,false,-1,1.5,NaN,Infinity,'unknown','12abc','2.5','3.0','1e2','-1',[],{},MAX_PARKING_SPACES+1];
  for(const value of badCounts){
    const p=plan();p.parking.totalOverride=value;assert.throws(()=>validatePlan(p,location.id),/whole number/);
    p.parking.totalOverride=null;p.items=[row('bad-count',90,0,{countOverride:value})];assert.throws(()=>validatePlan(p,location.id),/whole number/);
  }
  for(const value of [undefined,null,'',true,false,NaN,Infinity,0,.99,100.01,[],{},'wide','1e1']){
    const p=plan();p.items=[row('bad-width',90,0,{spaceWidthFeet:value})];assert.throws(()=>validatePlan(p,location.id),/feet per parking space/);
  }
  for(const value of [false,12,'12',[]])assert.throws(()=>validatePlan({...plan(),parking:value},location.id),/settings are invalid/);
  const invalidPoints=[[],[[39.6,-105]],[[39.6,-105],[39.6,-105]],[[null,-105],[39.6,-105]],[[86,-105],[39.6,-105]],Array.from({length:201},(_,i)=>destination([39.6,-105],i))];
  for(const points of invalidPoints){const p=plan();p.items=[row('bad-points',90,0,{points})];assert.throws(()=>validatePlan(p,location.id),/points|coordinates/);}
  const p=plan();p.items=[row('integer-string',90,0,{spaceWidthFeet:'9.5',countOverride:' 12 '})];p.parking.totalOverride='31';
  const checked=validatePlan(p,location.id);assert.equal(checked.parking.totalOverride,31);assert.equal(checked.items[0].countOverride,12);assert.equal(checked.items[0].spaceWidthFeet,9.5);
});

test('row and lot bounds prevent oversized totals and share the route-vertex limit',()=>{
  const p=plan();p.items=[row('one',90,0,{countOverride:60000}),row('two',90,90,{countOverride:60000})];
  assert.throws(()=>validatePlan(p,location.id),/total from the parking rows/);
  p.parking.totalOverride=1;assert.throws(()=>validatePlan(p,location.id),/total from the parking rows/,'an overall correction does not bypass the aggregate bound');
  p.parking.totalOverride=null;p.items=[row('estimated-one',9*60000),row('estimated-two',9*60000,90)];
  assert.throws(()=>validatePlan(p,location.id),/total from the parking rows/);
  assert.throws(()=>estimateParkingRow(row('oversized',9*(MAX_PARKING_SPACES+1))),/cannot exceed/);
  p.items=[row('at-limit',90,0,{countOverride:MAX_PARKING_SPACES}),row('zero',90,90,{countOverride:0})];
  assert.equal(parkingSummary(validatePlan(p,location.id)).total,MAX_PARKING_SPACES);
  const points=Array.from({length:200},(_,i)=>destination([39.6,-105],i));
  p.items=[{id:'route',kind:'route',routeType:'bus',label:'Bus route',points},...Array.from({length:24},(_,i)=>row('parking-'+i,90,0,{points}))];
  assert.equal(validatePlan(p,location.id).items.length,25);
  p.items.push(row('too-many-points'));assert.throws(()=>validatePlan(p,location.id),/too many route or parking-row points/);
});

test('cloud storage captures corrected parking counts without changing unrelated inspection data',async()=>{
  let record={internalNotes:'Keep existing notes',contact1:{name:'Private contact'}},serial=0;
  const writes=[],host={db:{},doc:(_,collection,id)=>({collection,id}),isAdmin:()=>true,makeId:()=>`saved-${++serial}`,now:()=>1000,
    getDocFromServer:async()=>({exists:()=>true,data:()=>clone(record)}),
    runTransaction:async(_,callback)=>callback({get:async()=>({exists:()=>true,data:()=>clone(record)}),set:(ref,fields,options)=>{writes.push({ref,fields,options});record={...record,...fields};}})
  };
  const p=plan();p.items=[row('saved-row',90,0,{countOverride:8})];p.parking.totalOverride=7;
  const store=createTrafficStorage(host),saved=await store.save(p);
  p.items[0].countOverride=3;p.parking.totalOverride=2;
  const loaded=(await store.list(location.id))[0];assert.equal(parkingSummary(loaded.plan).total,7);assert.equal(parkingRowCount(loaded.plan.items[0]),8);
  assert.deepEqual(loaded.plan,saved.plan);
  assert.deepEqual(writes[0].ref,{collection:'reviews',id:location.id});assert.deepEqual(Object.keys(writes[0].fields),['trafficLayoutsJson']);assert.deepEqual(writes[0].options,{merge:true});
  assert.equal(record.internalNotes,'Keep existing notes');assert.deepEqual(record.contact1,{name:'Private contact'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPlan,gathering,analyze,fromGroups,fromActivity,mergeSource,encode,decode,nextRevision,cleanPlan,isCenter} from '../convention-center/model.mjs';
import {parseDenver} from '../routes/travel-plan.mjs';
import {reportSheets} from '../convention-center/export.mjs';
import {workbookBytes} from '../assignments/excel-export.mjs';
const at=t=>'2027-07-16T'+t;
const plan=()=>({...emptyPlan(),date:'2027-07-16'});
const visit=(id,arrival,departure,count=1,extra={})=>({id,name:id,arrival:at(arrival),departure:at(departure),count,diverted:0,alternateId:'',override:false,reason:'',...extra});
test('four-hour gathering restricts its first and last hour only, with exact boundaries',()=>{
 const p=plan();p.gatherings=[gathering(at('09:00'),'g')];assert.equal(p.gatherings[0].end,at('13:00'));
 p.visits=[visit('start','09:00','09:10'),visit('middle','10:00','11:59'),visit('last','12:00','12:05'),visit('end','13:00','13:15')];
 const r=analyze(p);assert.equal(r.restricted,2);assert.deepEqual(r.rows.map(v=>v.conflicts.length),[2,0,2,0]);
 assert.equal(r.intervals.find(s=>s.from===+parseDenver(at('10:00'))).noBus.length,0);
});
test('extensions, full blocks, gathering override and per-visit exceptions remain separate from capacity',()=>{
 const p=plan(),g=gathering(at('09:00'),'g');g.before=30;g.after=30;p.gatherings=[g];p.visits=[visit('early','08:45','08:50',13)];assert.equal(analyze(p).restricted,1);
 p.visits[0].override=true;assert.throws(()=>analyze(p),/reason/);p.visits[0].reason='Coordinator approval';let r=analyze(p);assert.equal(r.restricted,0);assert.equal(r.exceptions,1);assert.equal(r.maxExcess,1);
 g.mode='full';p.visits=[visit('middle','11:00','11:30')];assert.equal(analyze(p).restricted,1);g.mode='off';assert.throws(()=>analyze(p),/reason/);g.reason='Event canceled';assert.equal(analyze(p).restricted,0);
});
test('capacity catches minute-long overlap and releases departing buses before arrivals at the same time',()=>{
 const p=plan();p.visits=[visit('group','08:00','08:30',12),visit('late','08:29','08:45')];let r=analyze(p);assert.equal(r.peak,13);assert.equal(r.maxExcess,1);assert.equal(r.intervals.find(s=>s.excess).to-r.intervals.find(s=>s.excess).from,60000);
 p.visits[1].arrival=at('08:30');r=analyze(p);assert.equal(r.peak,12);assert.equal(r.maxExcess,0);
});
test('parked buses do not create a movement conflict while a gathering is underway',()=>{
 const p=plan();p.gatherings=[gathering(at('09:00'),'g')];p.visits=[visit('parked','08:00','14:00',12)];const r=analyze(p);assert.equal(r.restricted,0);assert.equal(r.peak,12);assert.ok(r.intervals.some(s=>s.noBus.length&&s.count===12));
});
test('split overflow reduces center occupancy, identifies the exact pickup and flags alternate capacity',()=>{
 const p=plan();p.alternates=[{id:'alt',name:'Approved pickup',address:'123 Test Street',capacity:1,notes:'West entrance'}];p.visits=[visit('group','08:00','08:30',14,{diverted:2,alternateId:'alt'})];const r=analyze(p);assert.equal(r.peak,12);assert.equal(r.maxExcess,0);assert.equal(r.rows[0].alternate.address,'123 Test Street');assert.equal(r.rows[0].alternateOver,true);
 p.alternates[0].address='';assert.throws(()=>analyze(p),/pickup address/);p.visits[0].diverted=15;assert.throws(()=>analyze(p),/0 to 14/);
});
test('overnight occupancy carries into the next date and a midnight departure appears on that date',()=>{
 const p=plan();p.visits=[visit('overnight','23:45','23:59',12)];p.visits[0].departure='2027-07-17T00:15';p.date='2027-07-17';let r=analyze(p);assert.equal(r.peak,12);assert.equal(r.intervals[0].count,12);
 p.visits[0].departure='2027-07-17T00:00';r=analyze(p);assert.equal(r.peak,0);assert.equal(r.rows.length,1);
});
test('Denver DST days and nonexistent times are handled independently of machine timezone',()=>{
 const p=plan();p.date='2027-03-14';let r=analyze(p);assert.equal((r.intervals.at(-1).to-r.intervals[0].from)/3600000,23);p.date='2027-11-07';r=analyze(p);assert.equal((r.intervals.at(-1).to-r.intervals[0].from)/3600000,25);
 p.visits=[{...visit('gap','02:30','03:30'),arrival:'2027-03-14T02:30',departure:'2027-03-14T03:30'}];assert.throws(()=>analyze(p),/does not exist/);
});
test('bus groups import outgoing and returning center visits and encouraging gatherings',()=>{
 const c={id:'ccc',name:'Colorado Convention Center'},g={id:'encouraging-gathering',name:'Encouraging Gathering'},start=+parseDenver(at('08:00'));
 const result={plan:{boarding:15,groups:[{id:'g',buses:[{id:'b',destination:g,secondDestination:c}]}]},rows:[{groupId:'g',busId:'b',groupName:'Group',busName:'Bus',origin:c,departure:start,issues:[],legs:[{to:g,arrive:start+60*60000},{to:c,arrive:start+360*60000}]}]};
 const imported=fromGroups(result,'src');assert.equal(imported.visits.length,2);assert.equal(imported.visits[0].arrival,at('07:45'));assert.equal(imported.visits[1].departure,at('14:15'));assert.equal(imported.gatherings[0].start,at('09:00'));
 const p=mergeSource(plan(),imported,'src');p.gatherings[0].end=at('14:00');const refreshed=mergeSource(p,imported,'src');assert.equal(refreshed.visits.length,2);assert.equal(refreshed.gatherings.length,1);assert.equal(refreshed.gatherings[0].end,at('14:00'));
});
test('activity routes import each run and full dwell rather than just arrival moments',()=>{
 const c={id:'ccc',name:'Colorado Convention Center',lat:39.74248,lng:-104.99567,dwell:20,boarding:10},g={id:'encouraging-gathering',name:'Encouraging Gathering',lat:39.8,lng:-104.9,dwell:240,boarding:10};
 const p={name:'Route',coachId:'01',startLocal:at('08:00'),stops:[c,g],roundTrip:true,runs:2,buffer:0,turnaround:15,buses:3,seats:50,delegates:150,passengers:'same',costBasis:'day',rate:0,extras:0,legs:[{minutes:20,miles:10},{minutes:20,miles:10}]};const imported=fromActivity(p,'activity');assert.equal(imported.visits.length,4);assert.equal(imported.visits[0].departure,at('08:20'));assert.equal(imported.visits[0].count,3);assert.equal(imported.gatherings.length,2);assert.ok(isCenter({name:'Encouraging Gathering',address:'700 14th St, Denver'}));
});
test('shared revision guards, invalid backups and Excel export preserve the complete plan',()=>{
 const p=plan();p.gatherings=[gathering(at('09:00'),'g')];p.visits=[visit('bus','08:00','08:15')];const record={...encode(p),id:'saved',revision:3};assert.deepEqual(decode(record).plan,cleanPlan(p));assert.equal(nextRevision(record,3),4);assert.throws(()=>nextRevision(record,2),/changed elsewhere/);assert.equal(decode({...record,centerJson:'bad'}),null);
 const sheets=reportSheets(analyze(p));assert.equal(sheets.length,5);assert.equal(sheets[0].rows.length,1);const bytes=workbookBytes(sheets);assert.equal(String.fromCharCode(...bytes.slice(0,2)),'PK');assert.throws(()=>cleanPlan({...p,visits:[p.visits[0],p.visits[0]]}),/duplicate/);
});

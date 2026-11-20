import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVICE_DATES,dateLabel,defaultHostingPlan,cleanHostingPlan,congregationProfile,hostingReport,suggestHosting,hostingPayload,readHostingRecord,hostingRevision,hostingSheets} from '../assignments/hosting-model.mjs';
const center=(id,lat)=>({id,name:id,lat,lng:-104.99});
const point=(id,lat,busStatus='approved')=>({...center(id,lat),address:id+' address',busStatus});
const home=(id,lat)=>({id,name:id,home:{address:id+' home',point:lat?center(id,lat):null,status:lat?'mapped':'missing'}});
const data=()=>({ready:true,centers:[center('ccc',39.74),center('dtc',39.62)],locations:[point('Denver hall',39.745),point('DTC hall',39.621),point('Conditional',39.74,'conditional'),point('Unsuitable',39.74,'not-suitable'),point('Unreviewed',39.74,'not-reviewed')],congregations:[home('Local central',39.744),home('Local south',39.622),home('Visiting',40.8),home('Address missing',null)],assignments:[]});
const setup=(date=SERVICE_DATES[0],total=100,dtc=50)=>{const plan=defaultHostingPlan();Object.assign(plan.days.find(d=>d.date===date),{total,dtc});return plan;};
const slot=(id,overrides={})=>({id,date:SERVICE_DATES[0],congregationId:'Local central',meetingPointId:'Denver hall',hub:'ccc',delegates:50,...overrides});
// IDs are deliberately independent of display names.
function fixture(){const d=data();for(const c of d.congregations)c.id=c.id.replaceAll(' ','_');for(const p of d.locations)p.id=p.id.replaceAll(' ','_');return d;}
const validSlot=(id,overrides={})=>({...slot(id),congregationId:'Local_central',meetingPointId:'Denver_hall',...overrides});
test('the seven service dates exclude May 28–30 and include the two confirmed post-convention days',()=>{
 assert.deepEqual(SERVICE_DATES,['2027-05-23','2027-05-24','2027-05-25','2027-05-26','2027-05-27','2027-05-31','2027-06-01']);assert.match(dateLabel(SERVICE_DATES[0]),/Sun/);assert.equal(defaultHostingPlan().days[5].policy,'local-only');assert.equal(defaultHostingPlan().days[2].policy,'visiting-first');
});
test('DTC is part of the daily total, unknown totals stay unknown, zero is a valid forecast',()=>{
 const p=setup(),d=fixture();let r=hostingReport(p,d);assert.deepEqual(r.days[0].demand,{ccc:50,dtc:50});assert.equal(r.days[1].demand.ccc,null);
 Object.assign(p.days[0],{total:0,dtc:0});r=hostingReport(p,d);assert.equal(r.days[0].shortfall.ccc,0);p.days[0].dtc=1;r=hostingReport(p,d);assert.equal(r.days[0].demand.ccc,null);assert.match(r.days[0].issues[0],/cannot exceed/);assert.throws(()=>suggestHosting(p,d,SERVICE_DATES[0]),/cannot exceed/);
});
test('local and visiting classification can be overridden, while missing addresses are flagged',()=>{
 const p=defaultHostingPlan(),d=fixture();assert.equal(congregationProfile(p,d.congregations[0],d.centers).kind,'local');assert.equal(congregationProfile(p,d.congregations[2],d.centers).available.length,0);assert.equal(congregationProfile(p,d.congregations[3],d.centers).kind,'unknown');
 p.profiles.push({id:'Address_missing',kind:'visiting',dates:['2027-05-27'],capacity:30,notes:'In Denver for convention'});const prof=congregationProfile(p,d.congregations[3],d.centers);assert.equal(prof.kind,'visiting');assert.deepEqual(prof.available,['2027-05-27']);assert.equal(prof.capacity,30);
});
test('suggestions match DTC delegates near DTC and Denver demand near the Convention Center, using approved venues only',()=>{
 const p=setup(),d=fixture(),suggestions=suggestHosting(p,d,SERVICE_DATES[0]);assert.equal(suggestions.slots.length,2);assert.equal(suggestions.slots.find(s=>s.hub==='dtc').meetingPointId,'DTC_hall');assert.equal(suggestions.slots.find(s=>s.hub==='ccc').meetingPointId,'Denver_hall');assert.deepEqual(suggestions.remaining,{ccc:0,dtc:0});assert.equal(p.slots.length,0);
 for(const s of suggestions.slots)assert.equal(d.locations.find(p=>p.id===s.meetingPointId).busStatus,'approved');
});
test('visiting congregations enter suggestions only on their stated dates, with local hosts favored afterward',()=>{
 const d=fixture(),p=setup('2027-05-27',50,0);p.profiles.push({id:'Visiting',kind:'auto',dates:['2027-05-27','2027-06-01'],capacity:null,notes:''});
 assert.equal(suggestHosting(p,d,'2027-05-27').slots[0].congregationId,'Visiting');Object.assign(p.days[0],{total:50,dtc:0});assert.notEqual(suggestHosting(p,d,'2027-05-23').slots[0].congregationId,'Visiting');
 Object.assign(p.days[6],{total:50,dtc:0});assert.notEqual(suggestHosting(p,d,'2027-06-01').slots[0].congregationId,'Visiting');p.days[6].policy='visiting-first';assert.equal(suggestHosting(p,d,'2027-06-01').slots[0].congregationId,'Visiting');
});
test('all congregations remain in coverage, with availability and hosting reported separately',()=>{
 const d=fixture(),p=setup();p.slots=[validSlot('host')];const r=hostingReport(p,d);assert.equal(r.totalCongregations,4);assert.equal(r.hostedCount,1);assert.equal(r.unplanned.length,3);assert.ok(r.unplanned.some(c=>c.id==='Address_missing'));assert.equal(r.profiles.get('Visiting').available.length,0);
});
test('daily venue capacity is shared across pickup areas and congregations',()=>{
 const d=fixture(),p=setup('2027-05-23',100,30);d.locations=[d.locations[0]];const suggested=suggestHosting(p,d,SERVICE_DATES[0]);assert.equal(suggested.slots.reduce((n,s)=>n+s.delegates,0),50);assert.equal(suggested.remaining.ccc+suggested.remaining.dtc,50);
 p.meetingLimits=[{id:'Denver_hall',capacity:100}];assert.equal(suggestHosting(p,d,SERVICE_DATES[0]).slots.reduce((n,s)=>n+s.delegates,0),80);
});
test('over-capacity and duplicate daily hosts are flagged and excluded from coverage',()=>{
 const p=setup(),d=fixture();p.slots=[validSlot('one'),validSlot('two',{congregationId:'Local_south',hub:'dtc'})];let r=hostingReport(p,d);assert.equal(r.days[0].planned.ccc+r.days[0].planned.dtc,0);assert.ok(r.rows.every(r=>r.issues.some(s=>s.includes('meeting point’s daily capacity'))));
 p.slots[1].meetingPointId='DTC_hall';p.slots[1].congregationId='Local_central';r=hostingReport(p,d);assert.ok(r.rows.every(r=>r.issues.some(s=>s.includes('more than one hosting slot'))));
});
test('changed approvals keep old slots visible for review without counting their delegates',()=>{
 const p=setup(),d=fixture();p.slots=[validSlot('saved')];assert.equal(hostingReport(p,d).days[0].planned.ccc,50);d.locations[0].busStatus='conditional';const r=hostingReport(p,d);assert.equal(r.rows.length,1);assert.equal(r.days[0].planned.ccc,0);assert.equal(r.approvalProblems,1);assert.throws(()=>suggestHosting(p,d,SERVICE_DATES[0]),/flagged/);
});
test('changing availability or post-convention policy reveals invalid saved slots',()=>{
 const p=setup('2027-06-01',50,0),d=fixture();p.slots=[validSlot('visitor',{date:'2027-06-01',congregationId:'Visiting'})];p.profiles=[{id:'Visiting',kind:'visiting',dates:['2027-06-01'],capacity:50,notes:''}];assert.match(hostingReport(p,d).rows[0].issues.join(' '),/local congregations only/);p.days[6].policy='visiting-first';assert.equal(hostingReport(p,d).rows[0].valid,true);p.profiles[0].dates=[];assert.match(hostingReport(p,d).rows[0].issues.join(' '),/not available/);
});
test('suggestions preserve existing hosts and rotate to congregations without another hosting day',()=>{
 const p=setup('2027-05-24',50,0),d=fixture();p.slots=[validSlot('prior')];const next=suggestHosting(p,d,'2027-05-24');assert.equal(next.slots[0].congregationId,'Local_south');assert.equal(p.slots.length,1);p.slots.push({...next.slots[0],id:'accepted'});assert.equal(suggestHosting(p,d,'2027-05-24').slots.length,0);
});
test('planning inputs save and reload with revision checks without changing map assignments',()=>{
 const p=setup();p.slots=[validSlot('slot')];p.apiKey='never-save';const payload=hostingPayload(p),record={id:'record',revision:2,...payload};assert.equal(readHostingRecord(record).plan.slots[0].meetingPointId,'Denver_hall');assert.equal(hostingRevision(record,2),3);assert.throws(()=>hostingRevision(record,1),/changed elsewhere/);assert.throws(()=>hostingRevision(null,1),/changed elsewhere/);assert.equal(JSON.stringify(payload).includes('never-save'),false);assert.equal(readHostingRecord({...record,recordType:'congregation-assignment'}),null);
});
test('malformed dates, non-whole delegate counts and duplicate slot identifiers are rejected',()=>{
 const p=setup();p.slots=[validSlot('a',{date:'2027-05-28'})];assert.throws(()=>cleanHostingPlan(p),/seven service dates/);p.slots=[validSlot('a'),validSlot('a')];assert.throws(()=>cleanHostingPlan(p),/identifier/);p.slots=[];p.days[0].total=10.5;assert.throws(()=>cleanHostingPlan(p),/whole number/);
});
test('Excel includes day totals, meeting names, congregation names, availability and transparent assumptions',()=>{
 const p=setup(),d=fixture();p.slots=[validSlot('one')];const sheets=hostingSheets(p,d);assert.equal(sheets.length,4);assert.equal(sheets[0].rows.length,7);assert.equal(sheets[1].rows[0][1],'Denver hall');assert.equal(sheets[1].rows[0][3],'Local central');assert.equal(sheets[2].rows.length,4);assert.ok(sheets[3].rows.some(r=>String(r[1]).includes('not driving times')));
});

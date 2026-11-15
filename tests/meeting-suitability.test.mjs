import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveMeetingStatus,withMeetingStatus,tagMeetingIcon,suitabilityPayload} from '../assets/meeting-suitability-model.mjs';
import {SERVICE_DAYS,cleanServiceDays,serviceDaysId,serviceDaysPayload,readServiceDays} from '../assignments/service-days-model.mjs';
import {assignmentSheets} from '../assignments/excel-export.mjs';
test('Castle Rock correction overrides legacy green, while later explicit decisions are respected',()=>{
 assert.equal(effectiveMeetingStatus('26',{busStatus:'approved'}),'not-suitable');assert.equal(effectiveMeetingStatus('hall-26',{}),'not-suitable');assert.equal(effectiveMeetingStatus('26',{busStatus:'approved',suitabilityRevision:1}),'approved');assert.equal(effectiveMeetingStatus('2',{busStatus:'approved'}),'approved');
 const original={busStatus:'approved',publicSummary:'Keep',busSize:'Coach'};assert.equal(withMeetingStatus('26',original).publicSummary,'Keep');assert.equal(original.busStatus,'approved');
});
test('meeting markers carry a location id; hotels, activities and congregation pins never inherit hall colors',()=>{
 const icon=()=>({options:{html:'<span style="color:red">2</span>'}});
 assert.match(tagMeetingIcon(icon(),{id:'hall-26',group:'Field service / meeting places'}).options.html,/data-bus-location-id="26"/);
 for(const p of [{id:'H1',group:'Hotels'},{id:'26',group:'Congregations'},{id:'26',group:'Activities'},{id:'ccc',group:'Convention centers'},{id:'custom',name:'Hall'}])assert.doesNotMatch(tagMeetingIcon(icon(),p).options.html,/data-bus-location-id/);
});
test('suitability writes are minimal and cannot overwrite review details or congregation records',()=>{
 const p=suitabilityPayload({id:'26',address:'Keep',notes:'Private'},'not-suitable');assert.deepEqual(Object.keys(p).sort(),['busStatus','suitabilityRevision','updatedBy']);assert.throws(()=>suitabilityPayload({id:'congregation-c001'},'approved'));assert.throws(()=>suitabilityPayload({id:'26'},'unknown'));
});
test('service days are ordered, allow several weekdays, and are independent of meeting assignments',()=>{
 assert.deepEqual(cleanServiceDays(['Friday','Monday','Friday']),['Monday','Friday']);assert.throws(()=>cleanServiceDays(['Someday']));assert.throws(()=>cleanServiceDays('Monday'));assert.equal(serviceDaysId('C001'),'congregation-service-days-c001');
 const p=serviceDaysPayload({id:'C001',name:'First'},['Tuesday','Thursday']);assert.equal(p.recordType,'congregation-service-days');assert(!('meetingPointId'in p));assert.deepEqual(serviceDaysPayload({id:'C001',name:'First'},[]).serviceDays,[]);assert.deepEqual(readServiceDays({serviceDays:['Sunday','bad']}),['Sunday']);
});
test('Excel export includes saved service days for every congregation',()=>{
 const c={id:'C001',name:'First'},s=assignmentSheets({congregations:[c],visible:[c],selected:new Set(),locations:[],resolveHome:()=>({address:'',status:'missing',point:null}),assignmentFor:()=>null,driveState:()=>({}),serviceDaysFor:()=>['Monday','Thursday'],sharedReady:true});assert.equal(s[0].headers.at(-1),'Service participation days');assert.equal(s[0].rows[0].at(-1),'Monday, Thursday');assert.equal(s[1].rows[0].at(-1),'Monday, Thursday');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {CONGREGATIONS,CONGREGATION_SOURCE} from '../assignments/congregations-data.mjs';
import {HOME_POINTS} from '../assignments/home-points.mjs';
import {homeFor,addressKey,validPoint,suggestionsFor,groupHomes,addressPayload,addressCandidates} from '../assignments/location-model.mjs';
import fs from 'node:fs';
const c={id:'C001',name:'Example',homeAddress:'123 Main St, Denver CO 80202'};
const points=[{id:'a',name:'Hall',address:c.homeAddress,lat:39.7,lng:-104.9},{id:'b',name:'Meeting area',address:'Elsewhere',lat:39.8,lng:-104.9}];
test('spreadsheet contains all 211 unique congregation numbers and retains original IDs',()=>{
 assert.equal(CONGREGATION_SOURCE.spreadsheetCount,211);assert.equal(CONGREGATIONS.length,214);assert.equal(new Set(CONGREGATIONS.map(c=>c.id)).size,214);assert.equal(new Set(CONGREGATIONS.map(c=>c.number).filter(Boolean)).size,211);
 for(let n=1;n<=96;n++)assert.ok(CONGREGATIONS.some(c=>c.id===`C${String(n).padStart(3,'0')}`));
 assert.equal(CONGREGATIONS.find(c=>c.number==='123281').homeAddress,'16300 E Costilla Ave, Foxfield CO 80016');
 assert.equal(CONGREGATIONS.filter(c=>!c.homeAddress).length,117);
});
test('missing and unresolved addresses are distinct; edits never inherit stale coordinates',()=>{
 assert.equal(homeFor(c,null,points).status,'mapped');assert.equal(homeFor(c,{homeAddress:''},points).status,'missing');assert.equal(homeFor(c,{homeAddress:'456 New St'},points).status,'pin-needed');
 assert.equal(homeFor(c,{homeAddress:c.homeAddress,lat:null,lng:null},points).status,'pin-needed');assert.equal(homeFor({...c,addressNeedsReview:true},null,points).status,'review');
 assert.equal(homeFor(c,{homeAddress:c.homeAddress,lat:39.7,lng:-104.9},points).status,'mapped');assert.equal(homeFor(c,null,[{...points[0],address:'123 Main St, Boulder CO 80301'}]).status,'pin-needed');
 assert.equal(validPoint('',null),false);assert.equal(validPoint(91,-105),false);
});
test('suggestions use distance only among approved or conditional points, without changing assignments',()=>{
 const status=new Map([['a',{busStatus:'not-suitable'}],['b',{busStatus:'approved'}]]),home=homeFor(c,null,points);const before=JSON.stringify(points);assert.equal(suggestionsFor(home,points,status)[0].id,'b');
 status.set('a',{busStatus:'conditional'});assert.equal(suggestionsFor(home,points,status)[0].id,'a');assert.equal(suggestionsFor({...home,status:'review'},points,status).length,0);assert.equal(suggestionsFor({point:null},points,status).length,0);assert.equal(JSON.stringify(points),before);
});
test('co-located congregations remain individually reachable in map groups',()=>{
 const cs=[c,{...c,id:'C002'},{id:'x',homeAddress:''}];const groups=groupHomes(cs,c=>homeFor(c,null,points));assert.equal(groups.length,1);assert.deepEqual(groups[0].congregations.map(c=>c.id),['C001','C002']);
});
test('address writes cannot replace assignment fields and missing values remain flags',()=>{
 const p=addressPayload(c,'',39.7,-104.9);assert.equal(p.lat,null);assert.equal(p.homeAddress,'');assert.equal(p.recordType,'congregation-address');assert.equal(p.meetingPointId,undefined);
 assert.throws(()=>addressPayload(c,c.homeAddress,39.7,''));assert.throws(()=>addressPayload(c,c.homeAddress,95,0));assert.equal(addressPayload(c,c.homeAddress,'','').lat,null);
});
test('address lookup rejects street-only and wrong-country matches',()=>{
 const f={properties:{housenumber:'123',street:'Main St',city:'Denver',countrycode:'US',state:'Colorado'},geometry:{coordinates:[-104.9,39.7]}};
 assert.equal(addressCandidates({features:[f]}).length,1);assert.equal(addressCandidates({features:[{...f,properties:{...f.properties,housenumber:null}}]}).length,0);assert.equal(addressCandidates({features:[{...f,properties:{...f.properties,countrycode:'CA'}}]}).length,0);
});
test('supplemental address points remain tied to source address and require valid coordinates',()=>{
 assert.equal(HOME_POINTS.length,14);for(const p of HOME_POINTS){assert.ok(validPoint(p.lat,p.lng));assert.ok(p.address);assert.ok(p.source);}
});
import {rankCongregations} from '../assignments/location-model.mjs';
import {driveResult,createDriveTimes} from '../assignments/drive-times.mjs';
import {assignmentSheets,workbookBytes} from '../assignments/excel-export.mjs';
test('nearest sorting is stable, keeps unmapped homes last, and never mutates roster',()=>{
 const cs=[{name:'Z',p:{lat:40,lng:-105}},{name:'A',p:null},{name:'B',p:{lat:39.7,lng:-104.9}}],before=[...cs];assert.deepEqual(rankCongregations(cs,points[0],c=>({point:c.p})).map(c=>c.name),['B','Z','A']);assert.deepEqual(cs,before);
});
test('drive threshold is strictly over 80 minutes; unknown is never treated as zero',()=>{
 assert.equal(driveResult(4800).allowed,true);assert.equal(driveResult(4800.1).status,'over');assert.equal(driveResult(0).allowed,true);
 for(const value of [null,undefined,'4800',NaN,-1]){assert.equal(driveResult(value).status,'unknown');assert.equal(driveResult(value).allowed,false);}
});
test('road table batches co-located homes, uses congregation-to-meeting direction, invalidates changed pins',async()=>{
 let calls=0;const engine=createDriveTimes({fetcher:async url=>{calls++;assert.match(url,/sources=0&destinations=1/);return {ok:true,json:async()=>({code:'Ok',durations:[[4900]],sources:[{distance:0}],destinations:[{distance:0}]})};}}),home={point:points[0],status:'mapped'};
 await engine.ensure([home,home],points[1]);assert.equal(calls,1);assert.equal(engine.state(home,points[1]).status,'over');await engine.ensure([home],points[1]);assert.equal(calls,1);
 assert.equal(engine.state({...home,point:{...home.point,lat:40}},points[1]).status,'pending');assert.equal(engine.state({...home,status:'review'},points[1]).status,'missing');
});
test('unreachable routes, distant snapped pins, and lookup errors remain blocked',async()=>{
 for(const result of [{code:'Ok',durations:[[null]]},{code:'Ok',durations:[[120]],sources:[{distance:2000}]},null]){
 const engine=createDriveTimes({fetcher:async()=>{if(!result)throw Error('offline');return {ok:true,json:async()=>result};}});const home={status:'mapped',point:points[0]};await engine.ensure([home],points[1]);assert.equal(engine.state(home,points[1]).allowed,false);assert.equal(engine.state(home,points[1]).status,'unknown');}
});
test('Excel includes saved assignments separately from unsaved selection and preserves unknown times',()=>{
 const context={congregations:[c],visible:[c],selected:new Set([c.id]),locations:points,resolveHome:()=>homeFor(c,null,points),assignmentFor:()=>({meetingPointId:'b'}),driveState:()=>driveResult(null),point:points[0],sharedReady:true,now:new Date('2026-11-13T12:00:00Z')};
 const sheets=assignmentSheets(context);assert.equal(sheets.length,5);assert.equal(sheets[0].rows[0][5],'Yes');assert.equal(sheets[0].rows[0][6],'Meeting area');assert.equal(sheets[0].rows[0][10],'');
 const bytes=workbookBytes(sheets);assert.equal(bytes[0],80);fs.writeFileSync('/tmp/assignment-export-test.xlsx',bytes);
 fs.writeFileSync('/tmp/excel-string-test.xlsx',workbookBytes([{name:'Strings',headers:['Name'],rows:[['=HYPERLINK("x")'],['Á < > &']]}]));
});

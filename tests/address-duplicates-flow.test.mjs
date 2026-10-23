import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as turf from '@turf/turf';
import { createMeetingSessionManager } from '../territories/meeting-session-service.js';
import { mountDuplicateAddressReview } from '../territories/address-duplicates-ui.js';
import { scanDuplicateAddresses } from '../territories/address-duplicates.js';
const home=(id,extra={})=>({id,address:'9355 Princeton Cir',lat:39.54,lng:-104.93,included:true,territoryId:'13',...extra});
function harness(extra={}) {
 let current={hallId:'21',hallName:'Highlands Ranch',congregation:'Highlands Ranch',generation:1,editId:null,editing:false,houses:[home('a'),home('b')],territories:[{id:'13',name:'Territory 13',houseIds:['a','b'],geometry:null}],boundary:null};
 const records=new Map(), calls=[],saved=[];let yes=true;
 const host={turf,isAdmin:()=>true,status:()=> 'ready',capture:()=>structuredClone(current),context:()=>[current.hallId,current.generation],records:()=>new Map(records),hall:()=>({id:current.hallId,name:current.hallName}),readBase:()=>null,readSnapshot:async()=>{throw Error('unexpected read')},paint:async()=>{},loading(){},confirm:async message=>{calls.push(['confirm',message]);return yes;},askName:async()=> 'Clean session',saveSnapshot:async(d,o)=>{saved.push(structuredClone(d));return 'saved';},apply:(draft)=>{calls.push(['apply']);current={...structuredClone(draft),generation:current.generation+1};},message:m=>calls.push(['message',m]),...extra};
 return {manager:createMeetingSessionManager(host),calls,saved,records,host,set yes(v){yes=v},get current(){return current},set current(v){current=v}};
}
test('selected and whole-place scans are read-only',async()=>{const h=harness();const before=JSON.stringify(h.current);const r=await h.manager.reviewDuplicates();assert.equal(r.report.duplicates,1);assert.equal(JSON.stringify(h.current),before);assert.equal(h.saved.length,0);assert.equal(h.calls.some(c=>c[0]==='apply'),false);});
test('confirmed repair updates only the editable session; a later complete save persists it',async()=>{const h=harness();const r=await h.manager.reviewDuplicates();await h.manager.repairDuplicates(r.token);assert.equal(h.current.houses.length,1);assert.equal(h.saved.length,0);await h.manager.save();assert.equal(h.saved[0].houses.length,1);assert.equal(h.saved[0].territories.length,1);});
test('declining cleanup leaves every source and current row unchanged',async()=>{const h=harness();const r=await h.manager.reviewDuplicates();h.yes=false;assert.equal(await h.manager.repairDuplicates(r.token),null);assert.equal(h.current.houses.length,2);});
test('an edit made after preview prevents stale cleanup',async()=>{const h=harness();const r=await h.manager.reviewDuplicates();h.current.houses.push(home('new',{address:'10 New St'}));await assert.rejects(h.manager.repairDuplicates(r.token),/changed/);assert.equal(h.current.houses.length,3);});
test('a saved-record update after preview prevents stale cleanup',async()=>{const h=harness();const r=await h.manager.reviewDuplicates();h.records.set('changed',{id:'changed',recordType:'territory-name-choice'});await assert.rejects(h.manager.repairDuplicates(r.token),/changed/);assert.equal(h.current.houses.length,2);});
test('a meeting-place change while confirming cannot change the new place',async()=>{const h=harness();h.host.confirm=async()=>{h.current.hallId='22';return true};const r=await h.manager.reviewDuplicates();await assert.rejects(h.manager.repairDuplicates(r.token),/changed/);assert.equal(h.current.hallId,'22');assert.equal(h.current.houses.length,2);});
test('failed save preserves cleaned edits and older data rather than claiming saved',async()=>{const h=harness({saveSnapshot:async()=>{throw Error('offline')}});const r=await h.manager.reviewDuplicates();await h.manager.repairDuplicates(r.token);await assert.rejects(h.manager.save(),/offline/);assert.equal(h.current.houses.length,1);assert.equal(h.saved.length,0);});
test('SAVE YOUR WORK rechecks and confirms safe duplicates before publishing',async()=>{const h=harness();await h.manager.save();assert.equal(h.saved[0].houses.length,1);assert.match(h.calls.find(c=>c[0]==='confirm')[1],/repeated address/);});
test('canceling the save duplicate confirmation performs no publication',async()=>{const h=harness();h.yes=false;assert.equal(await h.manager.save(),null);assert.equal(h.saved.length,0);assert.equal(h.current.houses.length,2);});
test('cross-territory duplication blocks save until a destination is reviewed',async()=>{const h=harness();h.current.houses[1].territoryId='5';h.current.territories.push({id:'5',name:'Territory 5',houseIds:['b']});h.current.territories[0].houseIds=['a'];await assert.rejects(h.manager.save(),/multiple territories/);const r=await h.manager.reviewDuplicates();const g=r.report.groups[0];await h.manager.repairDuplicates(r.token,{[g.key]:{keepIndex:g.entries[0].index,territoryId:'13'}});assert.equal(h.current.houses.length,1);assert.equal(h.current.houses[0].territoryId,'13');await h.manager.save();assert.equal(h.saved[0].houses.length,1);});
test('different map locations require a warning rather than silent merging during save',async()=>{const h=harness();h.current.houses[1].lat=39.9;await h.manager.save();assert.equal(h.saved[0].houses.length,2);assert.match(h.calls.find(c=>c[0]==='confirm')[1],/NOT been combined/);});
test('sign-out blocks scanning and cleanup',async()=>{const h=harness({isAdmin:()=>false});await assert.rejects(h.manager.reviewDuplicates(),/Sign in/);});
test('a drawing in progress blocks duplicate review',async()=>{const h=harness();h.current.editing=true;await assert.rejects(h.manager.reviewDuplicates(),/boundary edit/);});
test('scan includes selected saved territories not yet loaded in workspace',async()=>{const h=harness();h.current.houses=[];h.current.territories=[];const plan={id:'p',recordType:'territory-plan',hallId:'21',congregation:'Highlands Ranch',houseCount:2,chunkIds:['c'],territories:[{id:'13',name:'Territory 13',houseIds:['a','b']}]};h.records.set('p',plan);h.records.set('c',{id:'c',planId:'p',recordType:'territory-plan-chunk',houses:[home('a'),home('b')]});const r=await h.manager.reviewDuplicates();assert.equal(r.report.duplicates,1);assert.equal(h.current.houses.length,0);});
function uiHarness(){const dom=new JSDOM('<section id="savedTerritoriesCard"></section>',{url:'https://example.invalid'});globalThis.window=dom.window;globalThis.document=dom.window.document;const h=harness();const api={isAdmin:()=>true,getSavedRecordsStatus:()=> 'ready',getSelectedHall:()=>({id:'21'}),getSelectedCongregation:()=> 'Highlands Ranch',getWorkspaceGeneration:()=>1,getTerritories:()=>h.current.territories,getHouses:()=>h.current.houses,meetingSessionManager:h.manager};return{dom,h,api,ui:mountDuplicateAddressReview(api)}}
const settle=()=>new Promise(r=>setTimeout(r,35));
test('selecting territory 13 checks addresses without loading, saving, or deleting them',()=>{const x=uiHarness();x.ui.selectVersion({id:'selected',hallId:'21',territory:x.h.current.territories[0],houses:x.h.current.houses});assert.match(document.getElementById('duplicateAutoStatus').textContent,/Territory 13: 1 repeated/);assert.equal(x.h.calls.length,0);assert.equal(x.h.saved.length,0);x.dom.window.close();});
test('the all-territories button exposes a preview then explicit cleanup',async()=>{const x=uiHarness();document.getElementById('scanAllDuplicates').click();await settle();assert.equal(document.querySelectorAll('[data-duplicate-group]').length,1);assert.equal(x.h.current.houses.length,2);document.getElementById('applyDuplicateCleanup').click();await settle();assert.equal(x.h.current.houses.length,1);assert.equal(x.h.saved.length,0);assert.match(document.getElementById('duplicateScanStatus').textContent,/SAVE YOUR WORK/);x.dom.window.close();});
test('untrusted address/source text is escaped in the review',async()=>{const x=uiHarness();x.h.current.houses[0].source='<img src=x onerror=alert(1)>';document.getElementById('scanAllDuplicates').click();await settle();assert.equal(document.querySelectorAll('#duplicateAddressCard img').length,0);x.dom.window.close();});
test('an error leaves the scan controls usable',async()=>{const x=uiHarness();x.api.meetingSessionManager.reviewDuplicates=async()=>{throw Error('connection problem')};document.getElementById('scanAllDuplicates').click();await settle();assert.match(document.getElementById('duplicateScanStatus').textContent,/connection problem/);assert.equal(document.getElementById('scanAllDuplicates').disabled,false);x.dom.window.close();});

test('cleanup signals the saved library to display the cleaned current-session version',async()=>{const x=uiHarness();let signals=0;window.addEventListener('territory-planner:duplicates-cleaned',()=>signals++);document.getElementById('scanAllDuplicates').click();await settle();document.getElementById('applyDuplicateCleanup').click();await settle();assert.equal(signals,1);assert.equal(x.h.current.houses.length,1);x.dom.window.close();});

test('reviewed distant duplicates stay removed through rescan, new uploads and complete saves',async()=>{
 const h=harness();h.current.territories[0].id='24';h.current.territories[0].name='Territory 24';h.current.houses.forEach(x=>x.territoryId='24');
 h.current.houses[1].lat+=.001;const older=structuredClone(h.current);h.host.readBase=()=>structuredClone(older);
 const r=await h.manager.reviewDuplicates();assert.equal(r.report.safe,0);
 const group=r.report.groups[0];await h.manager.repairDuplicates(r.token,{[group.key]:{keepIndex:group.entries[0].index}});
 assert.equal(h.current.houses.length,1);assert.equal(h.current.sessionScope,'meeting-place');
 assert.equal((await h.manager.reviewDuplicates()).report.groups.length,0);
 h.current.currentPlanId=null;h.current.houses.push(home('new-upload',{address:'200 Test Ct',territoryId:null}));
 await h.manager.save();assert.equal(h.saved[0].houses.length,2);assert.equal(h.saved[0].territories[0].houseIds.length,1);
 assert.equal((await h.manager.reviewDuplicates()).report.groups.length,0);assert.equal(older.houses.length,2);
});
test('cleanup result survives the library selecting the newly cleaned session version',async()=>{
 const x=uiHarness();x.ui.selectVersion({id:'older',hallId:'21',territory:x.h.current.territories[0],houses:x.h.current.houses});
 window.addEventListener('territory-planner:duplicates-cleaned',()=>x.ui.selectVersion({id:'fresh',source:'session',hallId:'21',territory:x.h.current.territories[0],houses:x.h.current.houses}));
 document.getElementById('scanSelectedDuplicates').click();await settle();document.getElementById('applyDuplicateCleanup').click();await settle();
 assert.match(document.getElementById('duplicateScanStatus').textContent,/Removed 1/);assert.match(document.getElementById('duplicateScanStatus').textContent,/SAVE YOUR WORK/);x.dom.window.close();
});
test('uncertain groups remain visible, can be explicitly chosen, and report what was left',async()=>{
 const x=uiHarness();x.h.current.houses.push(home('c',{address:'100 Test Dr'}),home('d',{address:'100 Test Dr',lat:39.541}));x.h.current.territories[0].houseIds.push('c','d');
 document.getElementById('scanAllDuplicates').click();await settle();
 assert.match(document.getElementById('duplicateChoiceStatus').textContent,/1 repeated record\(s\) selected.*1 group/);
 assert.equal(document.querySelectorAll('details[open][data-duplicate-group]').length,1);
 document.getElementById('applyDuplicateCleanup').click();await settle();assert.equal(x.h.current.houses.length,3);
 assert.equal(document.getElementById('reviewRemainingDuplicates').hidden,false);
 document.getElementById('reviewRemainingDuplicates').click();await settle();
 const action=document.querySelector('[data-dup-action]');action.value='merge';action.dispatchEvent(new window.Event('change',{bubbles:true}));
 assert.match(document.getElementById('duplicateChoiceStatus').textContent,/1 repeated record/);
 document.getElementById('applyDuplicateCleanup').click();await settle();assert.equal(x.h.current.houses.length,2);assert.equal(document.getElementById('reviewRemainingDuplicates').hidden,true);x.dom.window.close();
});
test('leaving every uncertain match separate explains why nothing was removed',async()=>{
 const x=uiHarness();x.h.current.houses[1].lat+=.01;document.getElementById('scanAllDuplicates').click();await settle();
 document.getElementById('applyDuplicateCleanup').click();await settle();assert.equal(x.h.current.houses.length,2);
 assert.match(document.getElementById('duplicateScanStatus').textContent,/No changes were applied.*Combine these copies/);x.dom.window.close();
});


test('review remaining matches uses the cleaned session even without a saved-library refresh listener',async()=>{
 const x=uiHarness();x.h.current.houses.push(home('c',{address:'100 Test Dr'}),home('d',{address:'100 Test Dr',lat:39.541}));x.h.current.territories[0].houseIds.push('c','d');
 x.ui.selectVersion({id:'old-pdf',source:'pdf',hallId:'21',territory:structuredClone(x.h.current.territories[0]),houses:structuredClone(x.h.current.houses)});
 document.getElementById('scanSelectedDuplicates').click();await settle();document.getElementById('applyDuplicateCleanup').click();await settle();
 assert.equal(x.h.current.houses.length,3);document.getElementById('reviewRemainingDuplicates').click();await settle();
 assert.equal(document.querySelectorAll('[data-duplicate-group]').length,1);assert.match(document.getElementById('duplicateScanStatus').textContent,/1 repeated/);x.dom.window.close();
});

test('Bellmore spelling button combines only after explicit keeper confirmation',async()=>{
 const x=uiHarness();x.h.current.houses[0].address='9439 BELLMORE LN HIGHLANDS RANCH CO 80126';x.h.current.houses[1].address='9439 S BELLMORE LN, HIGHLANDS RANCH, CO, 80126';x.h.current.houses[1].lat+=.001;
 await x.ui.reviewVersion({id:'selected',hallId:'21',territory:x.h.current.territories[0],houses:x.h.current.houses});
 assert.equal(x.h.current.houses.length,2);const button=document.getElementById('combineSpellingDuplicates');assert.equal(button.hidden,false);assert.match(button.textContent,/1 repeated/);
 button.click();await settle();assert.equal(x.h.current.houses.length,1);assert.match(x.h.current.houses[0].address,/ S BELLMORE/);assert.equal(x.h.saved.length,0);
 const confirmation=x.h.calls.find(c=>c[0]==='confirm')[1];assert.match(confirmation,/KEEP 9439 S BELLMORE/);assert.match(confirmation,/map positions.*differ/);
 assert.equal((await x.h.manager.reviewDuplicates()).report.groups.length,0);await x.h.manager.save();assert.equal(x.h.saved[0].houses.length,1);x.dom.window.close();
});
test('canceling batch spelling cleanup keeps both original records and the review',async()=>{
 const x=uiHarness();x.h.current.houses[0].address='9439 BELLMORE LN HIGHLANDS RANCH CO 80126';x.h.current.houses[1].address='9439 S BELLMORE LN, HIGHLANDS RANCH, CO, 80126';x.h.current.houses[1].lat+=.001;
 document.getElementById('scanAllDuplicates').click();await settle();x.h.yes=false;document.getElementById('combineSpellingDuplicates').click();await settle();assert.equal(x.h.current.houses.length,2);assert.equal(x.h.saved.length,0);assert.equal(document.getElementById('combineSpellingDuplicates').disabled,false);x.dom.window.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDuplicateAddresses, duplicateReviewWorkspace, scanDuplicateAddresses } from '../territories/address-duplicates.js';
import { assembleMeetingSession, withSessionTerritories } from '../territories/meeting-session-model.js';
const home=(id,extra={})=>({id,address:'100 Test Dr',lat:39.54,lng:-104.93,included:true,territoryId:'24',...extra});
const base=()=>({id:'older-main',hallId:'21',congregation:'Test congregation',houses:[home('a'),home('b',{lat:39.541}),home('unassigned',{address:'102 Test Dr',territoryId:null})],territories:[{id:'24',name:'Territory 24',houseIds:['a','b']}],boundary:null});
function cleaned(){const w=base(),report=scanDuplicateAddresses(w.houses,w.territories);return {...cleanDuplicateAddresses(w,{decisions:{[report.groups[0].key]:{keepIndex:0}}}).draft,sessionScope:'meeting-place'};}
test('complete cleaned session: another scan cannot resurrect a removed row from the older base',()=>{const current=cleaned(),old=base(),before=JSON.stringify(old);const next=duplicateReviewWorkspace(current,withSessionTerritories([],current),{base:old});assert.equal(next.houses.length,2);assert.equal(scanDuplicateAddresses(next.houses,next.territories).duplicates,0);assert.equal(JSON.stringify(old),before);});
test('complete cleaned session: SAVE YOUR WORK cannot reimport an older duplicate',()=>{const current=cleaned(),next=assembleMeetingSession(current,[],{base:base()});assert.equal(next.houses.length,2);assert.equal(scanDuplicateAddresses(next.houses,next.territories).duplicates,0);});
test('an isolated or legacy workspace still restores unrelated homes and territories from the base',()=>{const current={hallId:'21',congregation:'Test congregation',houses:[],territories:[],boundary:null};const old=base();old.houses=[home('other',{address:'200 Other Ct',territoryId:'25'})];old.territories=[{id:'25',name:'Territory 25',houseIds:['other']}];const result=assembleMeetingSession(current,[],{base:old});assert.equal(result.territories.length,1);assert.equal(result.houses.length,1);assert.equal(result.houses[0].address,'200 Other Ct');});
test('new uploads and avoid flags in a complete session survive scan and save after cleanup',()=>{const current=cleaned();current.houses.push(home('new',{address:'300 Newly Uploaded Ct',territoryId:null}),home('avoid',{address:'400 Avoid Ct',territoryId:null,avoid:true,included:false,avoidTerritoryId:'24'}));const next=duplicateReviewWorkspace(current,withSessionTerritories([],current),{base:base()});const saved=assembleMeetingSession(next,[],{base:base()});assert.equal(saved.houses.length,4);assert.equal(saved.houses.find(h=>h.id==='avoid').avoid,true);assert.equal(saved.houses.find(h=>h.id==='avoid').included,false);assert.equal(saved.houses.find(h=>h.id==='new').territoryId,null);});

test('directional and apartment safeguards still require appropriate review',()=>{
 const w=base();w.houses=[home('a',{address:'100 N Test Dr'}),home('b',{address:'100 S Test Dr'}),home('u1',{address:'102 Test Dr Apt 1'}),home('u2',{address:'102 Test Dr Apt 2'})];
 assert.equal(scanDuplicateAddresses(w.houses,w.territories).duplicates,0);assert.equal(cleanDuplicateAddresses(w).draft.houses.length,4);
});
test('complete-session rescans preserve separate units, avoided copies and unrelated territories',()=>{
 const current=cleaned();current.houses.push(home('unit1',{address:'300 Cedar Ct Apt 1',territoryId:'25'}),home('unit2',{address:'300 Cedar Ct Apt 2',territoryId:'25'}),home('avoid',{address:'400 Avoid Ct',avoid:true,included:false,territoryId:null,avoidTerritoryId:'25'}));current.territories.push({id:'25',name:'Territory 25',houseIds:['unit1','unit2']});
 const saved=assembleMeetingSession(duplicateReviewWorkspace(current,withSessionTerritories([],current),{base:base()}),[],{base:base()});
 assert.equal(saved.houses.length,5);assert.equal(saved.territories.length,2);assert.deepEqual(saved.territories.find(t=>t.id==='25').houseIds,['unit1','unit2']);assert.equal(saved.houses.find(h=>h.id==='avoid').avoid,true);
});
test('explicitly opening a historical version remains possible and does not change its records',()=>{
 const current=cleaned(),old=base(),version={id:'old-version',hallId:'21',territory:old.territories[0],houses:old.houses.filter(h=>h.territoryId==='24')};
 const before=JSON.stringify(version);const next=duplicateReviewWorkspace(current,[],{selected:version});
 assert.equal(scanDuplicateAddresses(next.houses,next.territories).duplicates,1);assert.equal(JSON.stringify(version),before);
});


test('review does not clone a same-ID address when its format cannot be parsed',()=>{
 const current={hallId:'21',congregation:'Test',sessionScope:'meeting-place',houses:[home('gate',{address:'Gate A / private entrance'})],territories:[{id:'24',name:'Territory 24',houseIds:['gate']}]};
 for(let i=0;i<3;i++) {const next=duplicateReviewWorkspace(current,withSessionTerritories([],current));assert.equal(next.houses.length,1);assert.equal(next.houses[0].id,'gate');Object.assign(current,next);}
});

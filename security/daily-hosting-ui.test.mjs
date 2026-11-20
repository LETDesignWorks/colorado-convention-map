import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountHostingPlanner} from '../assignments/hosting-ui.mjs';
import {SERVICE_DATES,defaultHostingPlan} from '../assignments/hosting-model.mjs';
const settle=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const p=(id,lat)=>({id,name:id,lat,lng:-104.99,address:id+' Street',busStatus:'approved'});
const data=()=>({ready:true,centers:[p('ccc',39.74),p('dtc',39.62)],locations:[p('Central-hall',39.745),p('South-hall',39.621),{...p('Conditional-hall',39.74),busStatus:'conditional'}],congregations:[{id:'central',name:'Central Congregation',home:{address:'Central home',point:p('home',39.744),status:'mapped'}},{id:'south',name:'South Congregation',home:{address:'South home',point:p('home',39.622),status:'mapped'}},{id:'visiting',name:'Visiting Congregation',home:{address:'Far home',point:p('home',40.8),status:'mapped'}},{id:'missing',name:'Address Needed',home:{address:'',point:null,status:'missing'}}],assignments:[]});
function setup(extra={}){const dom=new JSDOM('<section id="host"></section>',{url:'https://planner.test'}),root=dom.window.document.getElementById('host'),saved=new Map();const ui=mountHostingPlanner(root,{storage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},saveShared:async()=>({id:'saved',revision:1}),deleteShared:async()=>{},exportExcel:()=>{},exportJson:()=>{},importJson:async()=>null,...extra});const source=data();ui.setData(source);const $=s=>root.querySelector(s),click=s=>$(s).click(),change=(s,v)=>{const el=$(s);el.value=v;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));},check=(s,v)=>{const el=$(s);el.checked=v;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};const demand=(total=100,dtc=50)=>{change('[data-date="2027-05-23"] [data-day-field="total"]',String(total));change('[data-date="2027-05-23"] [data-day-field="dtc"]',String(dtc));};return {dom,root,ui,source,$,click,change,check,demand,saved};}
test('daily demand counts DTC within the total and does not turn blank totals into zero',()=>{
 const a=setup();assert.equal(a.ui.getReport().days[0].total,null);a.demand();assert.deepEqual(a.ui.getReport().days[0].demand,{ccc:50,dtc:50});a.change('[data-date="2027-05-23"] [data-day-field="dtc"]','120');assert.match(a.$('[data-hp-days]').textContent,/cannot exceed/);a.click('[data-action="suggest"]');assert.match(a.$('[data-hp-status]').textContent,/cannot exceed/);
});
test('suggestions need review before applying, match both areas, and preserve all congregations',()=>{
 const a=setup();a.demand();a.click('[data-action="suggest"]');assert.equal(a.ui.getPlan().slots.length,0);assert.match(a.$('[data-hp-preview]').textContent,/review before adding/i);a.click('[data-action="accept"]');assert.equal(a.ui.getPlan().slots.length,2);assert.equal(a.ui.getReport().hostedCount,2);assert.match(a.$('[data-hp-congregations]').textContent,/Visiting Congregation/);assert.match(a.$('[data-hp-congregations]').textContent,/Address Needed/);
});
test('availability editor explicitly controls the dates a visiting congregation is in Denver',()=>{
 const a=setup();a.click('[data-action="profile"][data-id="visiting"]');a.check('[data-profile-date="2027-05-27"]',true);assert.deepEqual(a.ui.getPlan().profiles[0].dates,['2027-05-27']);a.change('[data-date="2027-05-27"] [data-day-field="total"]','50');a.change('[data-hp-day]','2027-05-27');a.click('[data-action="suggest"]');a.click('[data-action="accept"]');assert.equal(a.ui.getPlan().slots[0].congregationId,'visiting');a.check('[data-profile-date="2027-05-27"]',false);assert.match(a.$('[data-hp-slots]').textContent,/not available/);assert.equal(a.ui.getReport().hostedCount,0);
});
test('local confirmation and capacity controls preserve editable hosting assumptions',()=>{
 const a=setup();a.click('[data-action="profile"][data-id="central"]');assert.equal(a.ui.getReport().profiles.get('central').assumed,true);a.click('[data-action="confirm-dates"]');assert.equal(a.ui.getReport().profiles.get('central').assumed,false);a.change('[data-profile="capacity"]','30');assert.equal(a.ui.getReport().profiles.get('central').capacity,30);a.change('[data-setting="localMiles"]','1');assert.equal(a.ui.getPlan().localMiles,1);
});
test('manual choices include only approved venues and reject an unavailable visiting host',()=>{
 const a=setup();assert.doesNotMatch(a.$('[data-manual="meetingPointId"]').textContent,/Conditional/);a.change('[data-manual="congregationId"]','visiting');a.change('[data-manual="meetingPointId"]','Central-hall');a.change('[data-manual="delegates"]','20');a.click('[data-action="manual-save"]');assert.equal(a.ui.getPlan().slots.length,0);assert.match(a.$('[data-hp-status]').textContent,/not available/);
 a.change('[data-manual="congregationId"]','central');a.click('[data-action="manual-save"]');assert.equal(a.ui.getPlan().slots.length,1);assert.equal(a.ui.getPlan().slots[0].delegates,20);
});
test('a planned host can move to another approved venue or be removed without altering map assignments',()=>{
 const a=setup();a.demand(50,0);a.click('[data-action="suggest"]');a.click('[data-action="accept"]');const before=JSON.stringify(a.source.assignments);a.click('[data-action="edit-slot"]');a.change('[data-manual="meetingPointId"]','South-hall');a.click('[data-action="manual-save"]');assert.equal(a.ui.getPlan().slots[0].meetingPointId,'South-hall');a.click('[data-action="remove-slot"]');assert.equal(a.ui.getPlan().slots.length,0);assert.equal(JSON.stringify(a.source.assignments),before);
});
test('changed approval invalidates a preview and flags existing slots without erasing them',()=>{
 const a=setup();a.demand(50,0);a.click('[data-action="suggest"]');a.source.locations[0].busStatus='not-suitable';a.ui.setData(structuredClone(a.source));assert.equal(a.$('[data-action="accept"]'),null);
 a.source.locations[0].busStatus='approved';a.ui.setData(structuredClone(a.source));a.click('[data-action="suggest"]');a.click('[data-action="accept"]');a.source.locations[0].busStatus='conditional';a.ui.setData(structuredClone(a.source));assert.equal(a.ui.getPlan().slots.length,1);assert.equal(a.ui.getReport().hostedCount,0);assert.match(a.$('[data-hp-slots]').textContent,/not currently approved/);
});
test('data updates cannot leave stale suggestions applicable after approval changes',()=>{
 const a=setup();a.demand(50,0);a.click('[data-action="suggest"]');const next=structuredClone(a.source);next.locations[0].busStatus='conditional';a.ui.setData(next);assert.equal(a.$('[data-action="accept"]'),null);
});
test('device saves reload expected delegates, availability and slots with unsaved-draft confirmation',()=>{
 const a=setup();a.demand(50,0);a.click('[data-action="suggest"]');a.click('[data-action="accept"]');a.click('[data-action="save-device"]');a.change('[data-date="2027-05-23"] [data-day-field="total"]','75');a.click('[data-action="load-device"]');assert.equal(a.ui.getPlan().days[0].total,75);a.click('[data-action="confirm-load"]');assert.equal(a.ui.getPlan().days[0].total,50);assert.equal(a.ui.getPlan().slots.length,1);
});
test('shared revisions and save errors protect the current draft',async()=>{
 const calls=[],a=setup({saveShared:async(plan,ref)=>{calls.push(ref);throw Error('This shared plan changed elsewhere.');}});const plan=defaultHostingPlan();plan.name='Shared May plan';a.ui.setShared({items:[{id:'existing',revision:2,plan}],read:true,write:true,current:true,enabled:true});a.click('[data-action="load-shared"]');a.demand(50,0);a.click('[data-action="save-shared"]');await settle();assert.deepEqual(calls[0],{id:'existing',revision:2});assert.equal(a.ui.getPlan().days[0].total,50);assert.match(a.$('[data-hp-status]').textContent,/changed elsewhere/);assert.equal(a.$('[data-hp-editor]').disabled,false);
});
test('revoking access during a shared save clears the private plan and ignores late completion',async()=>{
 const pending=deferred(),a=setup({saveShared:()=>pending.promise});const plan=defaultHostingPlan();plan.name='Private May plan';a.ui.setShared({items:[{id:'existing',revision:1,plan}],read:true,write:true,current:true,enabled:true});a.click('[data-action="load-shared"]');a.click('[data-action="save-shared"]');a.ui.setShared({reset:true});pending.resolve({id:'existing',revision:2});await settle();assert.equal(a.root.textContent.includes('Private May plan'),false);assert.equal(a.$('[data-action="save-shared"]').disabled,true);assert.equal(a.$('[data-hp-editor]').disabled,false);
});
test('viewers can try local alternatives but cannot save shared plans or delete them',()=>{
 const a=setup();a.ui.setShared({items:[],read:true,write:false,current:true,enabled:true});a.demand();assert.equal(a.ui.getPlan().days[0].total,100);assert.equal(a.$('[data-action="save-shared"]').disabled,true);assert.equal(a.$('[data-action="delete"]'),null);
});
test('meeting capacity is editable and bulk clearing requires confirmation',()=>{
 const a=setup();a.demand(50,0);a.change('[data-meeting-limit="Central-hall"]','25');a.click('[data-action="suggest"]');a.click('[data-action="accept"]');assert.ok(a.ui.getPlan().slots.length);a.click('[data-action="clear-day"]');assert.ok(a.ui.getPlan().slots.length);a.click('[data-action="confirm-clear-day"]');assert.equal(a.ui.getPlan().slots.length,0);
});
test('Excel gets the full seven-day plan and map actions use the chosen real location',async()=>{
 let exported,mapped;const a=setup({exportExcel:(plan,data)=>{exported={plan,data};},showMeeting:id=>{mapped=id;}});a.demand();a.click('[data-action="excel"]');await settle();assert.equal(exported.plan.days.length,7);a.click('[data-action="map"][data-id="South-hall"]');assert.equal(mapped,'South-hall');
});
test('names and notes are rendered as text, not executable markup',()=>{
 const a=setup();a.source.congregations[0].name='<img src=x onerror=alert(1)>';a.ui.setData(structuredClone(a.source));a.click('[data-action="profile"][data-id="central"]');a.change('[data-profile="notes"]','</textarea><svg onload=alert(1)>');assert.equal(a.root.querySelector('img'),null);assert.equal(a.root.querySelector('svg'),null);
});

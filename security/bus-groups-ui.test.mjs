import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {mountBusGroups} from '../activity-planning/bus-groups-ui.mjs';
const origins=[{id:'ccc',name:'Colorado Convention Center',address:'700 14th',lat:39.74,lng:-104.99},{id:'dtc',name:'DTC Center Point',address:'Belleview',lat:39.62,lng:-104.90}];
const locations=[{id:'activity',name:'Activity One',address:'1 Main',lat:39.8,lng:-104.9,group:'Activities'},{id:'meeting',name:'Meeting for service',address:'2 Main',lat:39.7,lng:-104.8,group:'Field service / meeting places'},{id:'encouraging-gathering',name:'Encouraging Gathering',address:'',lat:null,lng:null,customAddress:true,group:'Activities'}];
const road=async()=>({minutes:20,miles:9,label:'Road baseline'});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(extra={}){
 const dom=new JSDOM('<section id="root"></section>',{url:'https://planner.example/'}),root=dom.window.document.getElementById('root');const data=new Map();
 const ui=mountBusGroups(root,{origins,route:road,storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},saveShared:async()=>({id:'saved',revision:1}),removeShared:async()=>{},...extra});ui.setLocations(locations);
 const $=s=>root.querySelector(s),click=s=>$(s).click(),input=(s,v)=>{const el=$(s);el.value=v;el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},check=(s,v=true)=>{const el=$(s);el.checked=v;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 const dest=(field,index=0)=>input('[data-field="'+field+'"]',JSON.stringify([locations[index].group,locations[index].id]));
 const valid=()=>{input('[data-field="departure"]','2027-07-16T08:00');dest('destination');};
 return {dom,root,ui,$,click,input,check,dest,valid,data};
}
test('groups choose independent centers and each bus keeps its own departure and destination',()=>{
 const a=setup();a.valid();a.click('[data-action="add-bus"]');a.click('[data-action="add-group"]');const p=a.ui.getPlan();assert.equal(p.groups.length,2);assert.equal(p.groups[0].buses.length,2);assert.equal(p.groups[0].buses[0].departure,'2027-07-16T08:00');assert.equal(p.groups[0].buses[1].departure,'');assert.equal(p.groups[1].originId,'dtc');assert.equal(p.groups[1].buses[0].name,'Bus 3');a.click('[data-action="remove-bus"]');assert.equal(a.ui.getPlan().groups[0].buses.length,1);a.click('[data-action="remove-group"]');assert.equal(a.ui.getPlan().groups.length,1);
});
test('second destination controls render hours or exact onward departure and calculate the right arrival',async()=>{
 const a=setup();a.valid();a.check('[data-field="secondEnabled"]');a.dest('secondDestination',1);a.input('[data-field="durationUnit"]','hours');a.input('[data-field="duration"]','2');a.click('[data-action="calculate"]');await settle();assert.equal(a.ui.getResult().rows[0].legs.length,2);assert.match(a.$('[data-bg-results]').textContent,/Meeting for service/);assert.equal(a.$('[data-action="export"]').disabled,false);
 a.input('[data-field="secondMode"]','time');assert.ok(a.$('[data-field="secondDeparture"]'));assert.equal(a.ui.getResult(),null);assert.equal(a.$('[data-action="export"]').disabled,true);a.input('[data-field="secondDeparture"]','2027-07-16T08:05');a.click('[data-action="calculate"]');await settle();assert.equal(a.ui.getResult().rows[0].legs.length,1);assert.match(a.$('[data-bg-results]').textContent,/too early/);
});
test('a missing pin offers address entry and explicit suggested-pin selection',async()=>{
 const a=setup({findAddress:async()=>[{address:'123 Exact St',lat:39.8,lng:-104.7,approximate:false},{address:'Denver',lat:39.7,lng:-104.9,approximate:true}]});a.dest('destination',2);assert.ok(a.$('[data-point="address"]'));a.input('[data-point="address"]','123 Exact St');a.click('[data-action="find-address"]');await settle();assert.equal(a.root.querySelectorAll('[data-action="use-pin"]').length,1);a.click('[data-action="use-pin"]');assert.equal(a.ui.getPlan().groups[0].buses[0].destination.lat,39.8);a.input('[data-point="address"]','456 Other St');assert.equal(a.ui.getPlan().groups[0].buses[0].destination.lat,null);
});
test('a stale address response cannot change a replacement destination',async()=>{
 const pending=deferred(),a=setup({findAddress:()=>pending.promise});a.dest('destination',2);a.input('[data-point="address"]','123 Exact St');a.click('[data-action="find-address"]');a.dest('destination',1);pending.resolve([{address:'Wrong old match',lat:39.8,lng:-104.8}]);await settle();assert.equal(a.ui.getPlan().groups[0].buses[0].destination.id,'meeting');assert.equal(a.$('[data-action="use-pin"]'),null);
});
test('edits and cancellation discard late calculation results',async()=>{
 let resolve;const a=setup({route:()=>new Promise(r=>{resolve=r;})});a.valid();a.click('[data-action="calculate"]');a.input('[data-field="departure"]','2027-07-16T10:00');resolve(await road());await settle();assert.equal(a.ui.getResult(),null);assert.equal(a.$('[data-action="export"]').disabled,true);a.click('[data-action="calculate"]');a.click('[data-action="cancel"]');resolve(await road());await settle();assert.equal(a.ui.getResult(),null);assert.match(a.$('[data-bg-message]').textContent,/canceled/);
});
test('device plans round-trip every bus and second stop, then require recalculation',async()=>{
 const a=setup();a.valid();a.check('[data-field="secondEnabled"]');a.dest('secondDestination',1);a.click('[data-action="add-group"]');a.click('[data-action="save-device"]');a.click('[data-action="new"]');assert.equal(a.ui.getPlan().groups.length,1);a.click('[data-action="load-device"]');assert.equal(a.ui.getPlan().groups.length,2);assert.equal(a.ui.getPlan().groups[0].buses[0].secondDestination.id,'meeting');assert.equal(a.ui.getResult(),null);assert.match(a.$('[data-bg-message]').textContent,/Calculate/);
});
test('shared plans honor read/edit access, use revisions and clear private content when access changes',async()=>{
 const calls=[],a=setup({saveShared:async(plan,ref)=>{calls.push({plan,ref});return {id:'existing',revision:5};}});a.valid();const value=a.ui.getPlan();value.name='Private group plan';a.ui.setShared({items:[{id:'existing',revision:4,plan:value}],canRead:true,canWrite:false,current:true});assert.equal(a.$('[data-action="save-shared"]').disabled,true);a.click('[data-action="load-shared"]');assert.equal(a.ui.getPlan().name,'Private group plan');assert.equal(a.ui.getResult(),null);
 a.ui.setShared({items:[{id:'existing',revision:4,plan:value}],canRead:true,canWrite:true,current:true});a.click('[data-action="save-shared"]');await settle();assert.deepEqual(calls[0].ref,{id:'existing',revision:4});a.click('[data-action="save-copy"]');await settle();assert.equal(calls[1].ref,null);a.ui.setShared({reset:true});assert.equal(a.root.textContent.includes('Private group plan'),false);assert.equal(a.ui.getResult(),null);assert.equal(a.$('[data-action="save-shared"]').disabled,true);
});
test('failed shared saves preserve edits and allow save as a new plan after a conflict',async()=>{
 const a=setup({saveShared:async()=>{throw Error('This shared plan changed elsewhere.');}});a.valid();a.ui.setShared({canRead:true,canWrite:true,current:true});a.click('[data-action="save-shared"]');await settle();assert.equal(a.ui.getPlan().groups[0].buses[0].departure,'2027-07-16T08:00');assert.match(a.$('[data-bg-message]').textContent,/changed elsewhere/);assert.equal(a.$('[data-bg-editor]').disabled,false);
});
test('revocation during an existing shared save prevents a late response restoring the private plan',async()=>{
 const pending=deferred(),a=setup({saveShared:()=>pending.promise});a.valid();const value=a.ui.getPlan();value.name='Hidden after revoke';a.ui.setShared({items:[{id:'private',revision:1,plan:value}],canRead:true,canWrite:true,current:true});a.click('[data-action="load-shared"]');a.click('[data-action="save-shared"]');assert.equal(a.$('[data-bg-editor]').disabled,true);a.ui.setShared({reset:true});pending.resolve({id:'private',revision:2});await settle();assert.equal(a.root.textContent.includes('Hidden after revoke'),false);assert.equal(a.$('[data-bg-editor]').disabled,false);assert.equal(a.$('[data-action="save-copy"]').hidden,true);
});
test('shared deletion requires a second explicit click and uses the loaded revision',async()=>{
 const removed=[],a=setup({removeShared:async r=>removed.push(r)});const value=a.ui.getPlan();a.ui.setShared({items:[{id:'existing',revision:3,plan:value}],canRead:true,canWrite:true,current:true});a.click('[data-action="delete-shared"]');assert.equal(removed.length,0);a.click('[data-action="confirm-delete"]');await settle();assert.deepEqual(removed,[{id:'existing',revision:3}]);
});
test('baseline estimate label, partial results and Excel export remain honest',async()=>{
 let exported;const a=setup({exportResult:r=>{exported=r;}});a.valid();a.click('[data-action="add-bus"]');a.click('[data-action="calculate"]');await settle();assert.equal(a.ui.getResult().rows.length,2);assert.equal(a.ui.getResult().attention,1);assert.match(a.$('[data-bg-results]').textContent,/without time-of-day traffic/);a.click('[data-action="export"]');await settle();assert.equal(exported.rows.length,2);assert.match(a.$('[data-bg-results]').textContent,/Choose destination 1/);
});
test('user-entered text is escaped in names, results and saved-plan lists',()=>{
 const a=setup();a.input('[data-field="name"]','<img src=x onerror=alert(1)>');a.click('[data-action="add-bus"]');assert.equal(a.root.querySelector('img'),null);const value=a.ui.getPlan();value.name='<svg onload=alert(1)>';a.ui.setShared({items:[{id:'saved',revision:1,plan:value}],canRead:true});assert.equal(a.root.querySelector('svg'),null);
});
test('both pages link to the bus-group planner and the shared save flow reuses Activity Planning access',()=>{
 const page=fs.readFileSync(new URL('../activity-planning/index.html',import.meta.url),'utf8'),travel=fs.readFileSync(new URL('../travel-routes/index.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../activity-planning/bus-groups-app.mjs',import.meta.url),'utf8');assert.match(page,/id="busGroups"/);assert.match(page,/bus-groups-app.mjs/);assert.match(travel,/activity-planning\/#busGroups/);assert.match(app,/canEdit\('activityPlanning'\)/);assert.match(app,/nextGroupRevision/);
});

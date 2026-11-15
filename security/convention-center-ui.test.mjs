import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountCenter} from '../convention-center/ui.mjs';
import {emptyPlan,gathering,STORAGE_KEY} from '../convention-center/model.mjs';
const tick=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(extra={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://planner.example/convention-center/'}),root=dom.window.document.querySelector('main'),data=new Map();
 const ui=mountCenter(root,{storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},saveShared:async()=>({id:'saved',revision:2}),...extra});
 const $=s=>root.querySelector(s),click=s=>$(s).click(),input=(s,v)=>{const el=$(s);el.value=v;el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},check=(s,v)=>{const el=$(s);el.checked=v;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 input('[data-plan][data-field="date"]','2027-07-16');return {dom,root,ui,data,$,click,input,check};
}
test('manual visits show 13 buses, resolve overflow at a named alternate, and retain exact address in schedule',()=>{
 const a=setup();a.click('[data-action="add-visit"]');a.input('[data-kind="visits"] [data-field="count"]','13');assert.equal(a.ui.getReport().maxExcess,1);assert.match(a.$('[data-errors]').textContent,/1 bus/);
 a.click('[data-action="add-alternate"]');a.input('[data-kind="alternates"] [data-field="name"]','West pickup');a.input('[data-kind="alternates"] [data-field="address"]','123 Test Avenue');const alternate=a.ui.getPlan().alternates[0];a.input('[data-field="alternateId"]',alternate.id);a.input('[data-field="diverted"]','1');assert.equal(a.ui.getReport().peak,12);assert.match(a.$('[data-schedule]').textContent,/West pickup/);assert.match(a.$('[data-schedule]').textContent,/123 Test Avenue/);
 a.click('[data-kind="alternates"] [data-action="remove"]');assert.equal(a.ui.getPlan().alternates.length,1);assert.match(a.$('[data-message]').textContent,/Reassign/);
});
test('no-bus conflicts change with extensions and require a reason for an exception',()=>{
 const a=setup();a.click('[data-action="add-gathering"]');a.click('[data-action="add-visit"]');a.input('[data-field="arrival"]','2027-07-16T09:05');a.input('[data-field="departure"]','2027-07-16T09:15');assert.equal(a.ui.getReport().restricted,1);a.check('[data-field="override"]',true);assert.equal(a.ui.getReport(),null);a.input('[data-kind="visits"] [data-field="reason"]','Approved by coordinator');assert.equal(a.ui.getReport().exceptions,1);assert.match(a.$('[data-schedule]').textContent,/Approved by coordinator/);
 a.input('[data-field="mode"]','off');assert.equal(a.ui.getReport(),null);a.input('[data-kind="gatherings"] [data-field="reason"]','Gathering moved');assert.equal(a.ui.getReport().restricted,0);assert.match(a.$('[data-errors]').textContent,/Gathering moved/);
});
test('device saving, reopening and exports preserve visits, gathering rules and alternates',async()=>{
 const exports=[],a=setup({download:(kind,value)=>exports.push({kind,value})});a.click('[data-action="add-gathering"]');a.click('[data-action="add-visit"]');a.click('[data-action="save-device"]');assert.ok(a.data.has(STORAGE_KEY));a.click('[data-action="new"]');assert.equal(a.ui.getPlan().visits.length,0);a.click('[data-action="load-device"]');assert.equal(a.ui.getPlan().visits.length,1);assert.equal(a.ui.getPlan().gatherings.length,1);a.click('[data-action="export"]');a.click('[data-action="backup"]');await tick();assert.deepEqual(exports.map(e=>e.kind),['excel','backup']);
});
test('source import is explicit and repeating it replaces visits without duplication',async()=>{
 const a=setup({importSource:async()=>({visits:[{id:'source:v',source:'src',name:'Imported bus',arrival:'2027-07-16T08:00',departure:'2027-07-16T08:15',count:1,diverted:0}],gatherings:[gathering('2027-07-16T09:00','source:g','src')],warnings:[]})});a.ui.setSources([{id:'src',name:'Morning group',kind:'Bus groups'}]);assert.equal(a.ui.getPlan().visits.length,0);a.input('[data-source]','src');a.click('[data-action="import-source"]');await tick();assert.equal(a.ui.getPlan().visits.length,1);a.click('[data-action="import-source"]');await tick();assert.equal(a.ui.getPlan().visits.length,1);assert.equal(a.ui.getPlan().gatherings.length,1);a.click('[data-action="remove-source"]');assert.equal(a.ui.getPlan().visits.length,0);assert.equal(a.ui.getPlan().gatherings.length,1);
});
test('revoked access discards pending private imports and clears opened shared plans',async()=>{
 const pending=deferred(),a=setup({importSource:()=>pending.promise});a.ui.setSources([{id:'private',name:'Private source',kind:'Bus groups',private:true}]);a.input('[data-source]','private');a.click('[data-action="import-source"]');a.ui.setShared({reset:true});pending.resolve({visits:[],gatherings:[gathering('2027-07-16T09:00','private-g')],warnings:[]});await tick();assert.equal(a.ui.getPlan().gatherings.length,0);
 const p={...emptyPlan(),name:'Private plan'};a.ui.setShared({items:[{id:'private',revision:1,plan:p}],edit:false,current:true});a.click('[data-action="load-shared"]');assert.equal(a.ui.getPlan().name,'Private plan');assert.equal(a.$('[data-action="save-shared"]').disabled,true);a.ui.setShared({reset:true});assert.notEqual(a.ui.getPlan().name,'Private plan');assert.ok(!a.root.textContent.includes('Private plan'));
});
test('shared saves pass revisions and keep the draft on conflict; late saves cannot restore revoked data',async()=>{
 const calls=[],a=setup({saveShared:async(p,ref)=>{calls.push(ref);throw Error('Changed elsewhere');}}),p={...emptyPlan(),name:'Shared original'};a.ui.setShared({items:[{id:'private',revision:7,plan:p}],edit:true,current:true});a.click('[data-action="load-shared"]');a.click('[data-action="save-shared"]');await tick();assert.deepEqual(calls,[{id:'private',revision:7}]);assert.equal(a.ui.getPlan().name,p.name);assert.match(a.$('[data-message]').textContent,/Changed elsewhere/);
 const pending=deferred(),b=setup({saveShared:()=>pending.promise});b.ui.setShared({items:[{id:'private',revision:1,plan:p}],edit:true,current:true});b.click('[data-action="load-shared"]');b.click('[data-action="save-shared"]');b.ui.setShared({reset:true});pending.resolve({id:'private',revision:2});await tick();assert.notEqual(b.ui.getPlan().name,p.name);assert.equal(b.$('[data-action="save-copy"]').hidden,true);
});
test('invalid edits clear stale results, escape user text, and never overwrite a valid device backup',()=>{
 const a=setup();a.click('[data-action="add-visit"]');a.input('[data-kind="visits"] [data-field="name"]','<img src=x onerror=alert(1)>');assert.equal(a.root.querySelector('img'),null);a.click('[data-action="save-device"]');const saved=a.data.get(STORAGE_KEY);a.input('[data-field="departure"]','2027-07-16T07:00');assert.equal(a.ui.getReport(),null);assert.equal(a.$('[data-action="export"]').disabled,true);assert.equal(a.$('[data-schedule]').textContent,'');a.click('[data-action="save-device"]');assert.equal(a.data.get(STORAGE_KEY),saved);
});

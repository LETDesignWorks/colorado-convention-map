import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountTravelCosts} from '../activity-planning/travel-costs.mjs';
import {createTravelRegister} from '../assets/travel-register-ui.mjs';
const settle=()=>new Promise(r=>setTimeout(r,5));
function record(id='trip'){return {id,recordType:'bus-route',travelSchemaVersion:1,plan:{name:'Hotel to Service',time:'2027-07-16T08:00',passengers:20,vehicle:'Bus 2',assignedHotelIds:['H1'],assignedCongregationIds:['C1'],stops:[{id:'H1',name:'Hotel',address:'1 Hotel St',group:'Hotels',mode:'bus'},{id:'hall-3',name:'Service meeting',address:'2 Hall St',group:'Field service / meeting places',mode:'rail',dwell:60,startTime:'2027-07-16T09:00'},{id:'activity',name:'Gathering',address:'3 Activity St',mode:'walk'}]},resultJson:JSON.stringify({legs:[{ready:1815745500000,depart:1815746400000,arrive:1815749100000},{ready:1815749100000,depart:1815749400000,arrive:1815750300000}]})};}
function setup(){const dom=new JSDOM('<div id="costs"></div><div id="register"></div>',{url:'https://example.test/activity-planning/'});const doc=dom.window.document;globalThis.document=doc;const saves=[];let resolveSave=null;const costs=mountTravelCosts(doc.getElementById('costs'),{save:async(p,id)=>{saves.push({p,id});if(resolveSave)await resolveSave;return id||'estimate';}});return {dom,doc,costs,saves,pending:p=>resolveSave=p,$:s=>doc.querySelector(s),input(s,value){const el=doc.querySelector(s);el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},change(s,value){const el=doc.querySelector(s);el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}};}
test('cost UI imports mixed legs, calculates entered fares, saves a snapshot and reopens it',async()=>{
 const f=setup();f.costs.setData({routes:[record()],access:true,canSave:true});f.change('[data-cost-route]','trip');f.$('[data-cost-import]').click();assert.equal(f.doc.querySelectorAll('[data-cost-leg]').length,2);assert.match(f.$('[data-cost-editor]').textContent,/09:00/);
 f.input('[data-cost-leg="0"] [data-cost-key="rate"]','100');f.input('[data-cost-leg="1"] [data-cost-key="rate"]','5');f.$('[data-cost-form]').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));assert.match(f.$('[data-cost-total]').textContent,/\$200\.00/);
 f.$('[data-cost-save]').click();await settle();assert.equal(f.saves.length,1);assert.equal(f.saves[0].p.sourceTravelRouteId,'trip');assert.equal(f.saves[0].id,null);
 f.costs.setData({routes:[record()],estimates:[{...f.saves[0].p,id:'estimate'}],access:true,canSave:true,reset:true});f.$('[data-cost-open]').click();assert.match(f.$('[data-cost-total]').textContent,/\$200\.00/);f.$('[data-cost-save]').click();await settle();assert.equal(f.saves[1].id,'estimate');f.dom.window.close();
});
test('cost date filter clears unavailable choices and read-only access blocks shared saves',()=>{
 const f=setup();f.costs.setData({routes:[record()],access:true,canSave:false});f.change('[data-cost-route]','trip');assert.equal(f.$('[data-cost-import]').disabled,false);f.change('[data-cost-date]','2027-07-17');assert.equal(f.$('[data-cost-route]').value,'');assert.equal(f.$('[data-cost-import]').disabled,true);
 f.change('[data-cost-date]','');f.costs.importRoute('trip');assert.equal(f.$('[data-cost-save]').disabled,true);f.$('[data-cost-save]').click();assert.equal(f.saves.length,0);f.dom.window.close();
});
test('revoked access clears imported private data even while a save finishes',async()=>{
 const f=setup();let resolve;f.pending(new Promise(r=>resolve=r));f.costs.setData({routes:[record()],access:true,canSave:true});f.costs.importRoute('trip');f.$('[data-cost-save]').click();f.costs.setData({routes:[],estimates:[],access:false,canSave:false,reset:true});resolve();await settle();assert(!f.doc.body.textContent.includes('Hotel to Service'));assert.equal(f.$('[data-cost-editor]').innerHTML,'');assert.equal(f.$('[data-cost-import]').disabled,true);f.dom.window.close();
});
test('route register filters multiple trips for one hotel/day and clears private rows on sign-out',()=>{
 const f=setup(),register=createTravelRegister(f.$('#register')),a=record(),b=record('trip2');b.plan.name='Second group';b.plan.vehicle='Car group 1';const locations=a.plan.stops;
 register.update({records:[a,b],locations,congregations:[{id:'C1',name:'Congregation One'}],access:true});assert.equal(f.doc.querySelectorAll('.register-route').length,2);f.change('[data-filter="hotel"]','H1');f.change('[data-filter="date"]','2027-07-16');register.meeting('3');assert.equal(f.doc.querySelectorAll('.register-route').length,2);assert.match(f.$('.register-route a').href,/travel-routes\/\?route=trip$/);
 f.change('[data-filter="date"]','2027-07-17');assert.equal(f.doc.querySelectorAll('.register-route').length,0);register.update({records:[],access:false});assert(!f.$('#register').textContent.includes('Second group'));f.dom.window.close();
});

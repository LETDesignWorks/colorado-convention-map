import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountStaggeredFleet} from '../activity-planning/stagger-ui.mjs';
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
function fixture(router){
 const dom=new JSDOM('<section id="root"></section>'),root=dom.window.document.getElementById('root'),exports=[];
 const plan={name:'Activity trip',startLocal:'2027-07-16T07:45',buffer:5,buses:3,runs:1,roundTrip:false,stops:[{id:'hotel',name:'Hotel',address:'1 Main St',lat:39.7,lng:-105,dwell:15,boarding:10},{id:'activity',name:'Activity',lat:39.8,lng:-105,dwell:60,boarding:10},{id:'service',name:'Service',lat:39.9,lng:-105,dwell:0,boarding:0}]};
 const ui=mountStaggeredFleet(root,{getPlan:()=>plan,route:router||(async a=>({minutes:a.id==='hotel'?30:20,miles:10})),onBusesChange:n=>{plan.buses=n;ui.refresh();},exportResult:r=>exports.push(r)});
 const $=s=>root.querySelector(s),field=name=>$('[data-fleet-'+name+']'),event=(el,name)=>el.dispatchEvent(new dom.window.Event(name,{bubbles:true,cancelable:true}));
 const rules=[...root.querySelectorAll('[data-fleet-rule]')];rules[2].querySelector('[data-fleet-deadline]').value='2027-07-16T10:15';
 return {dom,root,plan,ui,exports,$,field,event,submit:()=>event(field('form'),'submit')};
}
test('staggered UI shows the earlier departure, each bus at each stop and an Excel export',async()=>{
 const f=fixture();assert.equal(f.field('departure').value,'2027-07-16T08:00');f.submit();await settle();assert.equal(f.field('results').hidden,false);assert.match(f.field('results').textContent,/Initial departure moved 5 minutes earlier/);assert.equal(f.field('results').querySelectorAll('tbody tr').length,9);f.field('export').click();assert.equal(f.exports[0].allMet,true);f.dom.window.close();
});
test('stop timing controls persist through route refresh but changes invalidate old schedules and exports',async()=>{
 const f=fixture();f.submit();await settle();f.plan.stops[1].dwell=80;f.ui.refresh();assert.equal(f.field('results').hidden,true);assert.equal(f.field('export'),null);assert.equal(f.root.querySelectorAll('[data-fleet-deadline]')[2].value,'2027-07-16T10:15');f.field('buses').value='5';f.event(f.field('buses'),'input');assert.equal(f.plan.buses,5);f.dom.window.close();
});
test('incompatible activity end and service deadline are flagged instead of claimed on time',async()=>{
 const f=fixture();f.root.querySelector('[data-fleet-not-before]').value='2027-07-16T12:00';f.submit();await settle();assert.match(f.field('status').textContent,/needs changes/);assert(f.root.querySelector('.fleet-conflict'));f.field('export').click();assert.equal(f.exports[0].allMet,false);f.dom.window.close();
});
test('canceled schedules ignore late routing responses',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));f.submit();f.field('cancel').click();finish({minutes:20,miles:10});await settle();assert.equal(f.field('results').hidden,true);assert.match(f.field('status').textContent,/canceled/);f.dom.window.close();
});

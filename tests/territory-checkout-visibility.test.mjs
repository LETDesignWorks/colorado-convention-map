import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {initializeCheckoutSheet} from '../territories/territory-checkout-ui.js';
const html=`<aside class="side-panel"><section class="card setup-card"><select id="hallSelect"><option>Sample meeting place</option></select><section id="savedTerritoriesCard"><div class="card-heading"><h2>All saved territories</h2></div></section></section><section class="card saved-card"><div class="card-heading"><h2>Return to your territories</h2></div><div id="savedWorkList"></div></section></aside>`;
function harness(){
 const dom=new JSDOM(html,{url:'https://example.invalid/territories/'}),w=dom.window,d=w.document;
 let next=0,admin=true,status='ready',scrolls=0;const pending=new Map();
 w.setTimeout=(fn)=>{const id=++next;pending.set(id,fn);return id;};w.clearTimeout=id=>pending.delete(id);
 w.HTMLElement.prototype.scrollIntoView=function(){scrolls++;};
 w.URL.createObjectURL=()=> 'blob:sample';w.URL.revokeObjectURL=()=>{};
 const api={isAdmin:()=>admin,getSelectedHall:()=>({id:'21',name:'Sample meeting place'}),getSelectedCongregation:()=> 'Sample host',getSavedRecordsStatus:()=>status,meetingSessionManager:{registerSnapshot:async()=>({rows:[]})}};
 return {w,d,api,pending,get scrolls(){return scrolls},set admin(x){admin=x},set status(x){status=x},async start(){return initializeCheckoutSheet({document:d,window:w});},fire(){const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn());},update(){w.dispatchEvent(new w.Event('territory-planner:data'));},cleanup(ui){ui?.dispose();w.close();}};
}
test('checkout appears before saved territories without the asynchronous SAVE YOUR WORK panel',async()=>{
 const h=harness(),ui=await h.start();assert.ok(ui);const card=h.d.getElementById('territoryCheckoutSheet');
 assert.equal(card.nextElementSibling.id,'savedTerritoriesCard');assert.equal(h.d.getElementById('hallAddressSetCard'),null);
 assert.match(card.textContent,/Loading the territory check-out tools/);assert.equal(card.querySelector('[data-export]').disabled,true);h.cleanup(ui);
});
test('slow startup beyond the former ten-second window recovers without a refresh',async()=>{
 const h=harness(),ui=await h.start();for(let i=0;i<15;i++)h.fire();
 assert.equal(h.d.querySelectorAll('#territoryCheckoutSheet').length,1);assert.ok(h.pending.size);
 h.w.__denverTerritoryPlannerAPI=h.api;h.fire();assert.equal(h.d.querySelector('[data-export]').disabled,false);assert.equal(h.pending.size,0);assert.match(h.d.querySelector('[data-place]').textContent,/Sample meeting place/);h.cleanup(ui);
});
test('data-ready events stop the polling timer and keep the sheet outside collapsed or workflow-hidden areas',async()=>{
 const h=harness(),ui=await h.start();h.w.__denverTerritoryPlannerAPI=h.api;h.update();
 assert.equal(h.pending.size,0);const card=h.d.getElementById('territoryCheckoutSheet');assert.equal(card.closest('details,[hidden],.territory-workflow-hidden'),null);
 assert.equal(h.d.querySelector('[data-export]').disabled,false);h.cleanup(ui);
});
test('shortcuts from both saved-territory sections open and focus the sheet',async()=>{
 const h=harness();h.w.__denverTerritoryPlannerAPI=h.api;const ui=await h.start();
 for(const target of ['#savedTerritoriesCard','.saved-card']){const link=h.d.querySelector(target+' [data-checkout-shortcut]');assert.ok(link);link.click();assert.equal(h.d.activeElement.id,'territoryCheckoutSheet');}
 assert.equal(h.scrolls,2);h.cleanup(ui);
});
test('a late SAVE YOUR WORK card receives one shortcut and repeated initialization is idempotentent',async()=>{
 const h=harness(),ui=await h.start();const save=h.d.createElement('section');save.id='hallAddressSetCard';save.innerHTML='<div class="card-heading"><h2>SAVE YOUR WORK</h2></div>';h.d.querySelector('.side-panel').append(save);
 await Promise.resolve();assert.equal(save.querySelectorAll('[data-checkout-shortcut]').length,1);assert.equal(await h.start(),ui);assert.equal(h.d.querySelectorAll('#territoryCheckoutSheet').length,1);
 h.cleanup(ui);assert.equal(h.pending.size,0);assert.equal(h.d.querySelectorAll('[data-checkout-shortcut]').length,0);
});
test('loading and signed-out states explain disabled export without hiding the sheet',async()=>{
 const h=harness();h.w.__denverTerritoryPlannerAPI=h.api;h.admin=false;const ui=await h.start();assert.match(h.d.querySelector('[data-place]').textContent,/Sign in/);
 h.admin=true;h.status='loading';h.update();assert.match(h.d.querySelector('[data-place]').textContent,/waiting for saved territories/);assert.equal(h.d.querySelector('[data-export]').disabled,true);
 h.status='ready';h.update();assert.equal(h.d.querySelector('[data-export]').disabled,false);h.cleanup(ui);
});
test('page bootstrap starts the checkout sheet before app and extension loading; entry point bypasses old cache',()=>{
 const s=fs.readFileSync('territories/bootstrap.js','utf8');assert.ok(s.indexOf("import('./territory-checkout-ui.js?v=checkout-20261023-52')")<s.indexOf("await import('./app-main.js"));
 assert.match(fs.readFileSync('territories/index.html','utf8'),/bootstrap\.js\?v=checkout-20261023-52/);
});

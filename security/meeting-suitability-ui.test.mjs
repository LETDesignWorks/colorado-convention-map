import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createSuitabilityUI} from '../assets/meeting-suitability-ui.mjs';
import {createServiceDaysEditor} from '../assignments/service-days-ui.mjs';
import {mountMeetingListToggle} from '../assignments/meeting-list-toggle.mjs';
const settle=()=>new Promise(r=>setTimeout(r,10));
test('meeting point list minimizes, restores and remembers its state without hiding the map',()=>{
 const dom=new JSDOM('<div id="map"></div><button id="toggle" aria-controls="list"></button><div id="list">Meeting points</div>',{url:'https://example.test'}),doc=dom.window.document,button=doc.getElementById('toggle'),content=doc.getElementById('list');
 mountMeetingListToggle(button,content,{storage:dom.window.localStorage});assert.equal(content.hidden,false);button.click();assert.equal(content.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(button.textContent,'Expand list');assert.equal(doc.getElementById('map').hidden,false);
 const next=doc.createElement('button'),list=doc.createElement('div');mountMeetingListToggle(next,list,{storage:dom.window.localStorage});assert.equal(list.hidden,true);next.click();assert.equal(list.hidden,false);dom.window.close();
});
function mapFixture({edit=true,ready=true,fail=false}={}){
 const dom=new JSDOM('<div class="leaflet-container"><div class="leaflet-marker-icon"><div class="meeting-map-pin" data-bus-location-id="26">26<span class="assignment-count">3</span></div></div><div class="leaflet-marker-icon"><div class="congregation-pin">26</div></div><div class="leaflet-marker-icon planning-map-icon"><span>26</span></div></div><div class="leaflet-container"><div class="leaflet-marker-icon"><div class="hall-pin">26</div></div></div>'),doc=dom.window.document,saves=[];
 const ui=createSuitabilityUI(doc,{canEdit:()=>edit,ready:()=>ready,save:async(loc,status)=>{saves.push({id:loc.id,status});if(fail)throw Error('Denied');return {busStatus:status,suitabilityRevision:1};}});
 ui.update([{id:'26',busStatus:'approved'}]);return {dom,doc,ui,saves,$:s=>doc.querySelector(s),setEdit:x=>edit=x};
}
test('Castle Rock appears unsuitable on multiple map styles without coloring congregation or route-number pins',()=>{
 const f=mapFixture();assert.equal(f.$('.meeting-map-pin').dataset.meetingSuitability,'not-suitable');assert.equal(f.$('.hall-pin').dataset.meetingSuitability,'not-suitable');assert(!f.$('.congregation-pin').dataset.meetingSuitability);assert(!f.$('.planning-map-icon span').dataset.meetingSuitability);f.ui.destroy();f.dom.window.close();
});
test('clicking a meeting marker opens controls, preserves existing click behavior, and saves to every map',async()=>{
 const f=mapFixture();let existing=0;f.$('.meeting-map-pin').addEventListener('click',()=>existing++);f.$('.meeting-map-pin').click();assert.equal(existing,1);assert.match(f.$('.meeting-suitability-panel').textContent,/Castle Rock/);
 f.$('[data-suitability="approved"]').click();await settle();assert.deepEqual(f.saves,[{id:'26',status:'approved'}]);assert.equal(f.$('.meeting-map-pin').dataset.meetingSuitability,'approved');assert.equal(f.$('.hall-pin').dataset.meetingSuitability,'approved');assert.match(f.$('[data-suitability-message]').textContent,/Saved/);f.ui.destroy();f.dom.window.close();
});
test('failed saves and view-only access preserve the shared suitability',async()=>{
 const f=mapFixture({fail:true});f.$('.meeting-map-pin').click();f.$('[data-suitability="approved"]').click();await settle();assert.equal(f.$('.meeting-map-pin').dataset.meetingSuitability,'not-suitable');assert.match(f.$('[data-suitability-message]').textContent,/Could not save/);f.setEdit(false);f.ui.update();assert.equal(f.$('[data-suitability="approved"]').disabled,true);f.ui.destroy();f.dom.window.close();
});
test('service day editor saves multiple weekdays for a selected group and preserves saved days on failure',async()=>{
 const dom=new JSDOM('<section></section>'),el=dom.window.document.querySelector('section'),saves=[],profiles=new Map([['a',{serviceDays:['Monday']}],['b',{serviceDays:['Friday']}] ]);let fail=false;
 const ui=createServiceDaysEditor(el,{save:async(list,days)=>{if(fail)throw Error('Denied');saves.push({ids:list.map(c=>c.id),days});}});
 ui.update({congregations:[{id:'a',name:'First'},{id:'b',name:'Second'}],selected:['a','b'],profiles,canEdit:true,ready:true});assert.match(el.textContent,/different days/);
 for(const day of ['Tuesday','Thursday']){const box=el.querySelector('[data-service-day="'+day+'"]');box.checked=true;box.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
 el.querySelector('[data-days-save]').click();await settle();assert.deepEqual(saves,[{ids:['a','b'],days:['Tuesday','Thursday']}]);assert.deepEqual(profiles.get('a').serviceDays,['Monday']);
 fail=true;el.querySelector('[data-days-save]').click();await settle();assert.match(el.querySelector('[data-days-message]').textContent,/Could not save/);ui.update({canEdit:false,needsRules:true});assert(el.querySelector('fieldset').disabled);assert.match(el.textContent,/database rules/);dom.window.close();
});

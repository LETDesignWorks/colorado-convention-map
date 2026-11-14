import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {MODES,calculateSchedule,legacyPlan,serializePlan} from '../travel-routes/model.mjs';
import {denverInput,formatDenver} from '../routes/travel-plan.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const settle=()=>new Promise(r=>setTimeout(r,5));
function setup(){
 const dom=new JSDOM(read('travel-routes/index.html'),{url:'https://letdesignworks.github.io/colorado-convention-map/travel-routes/',runScripts:'outside-only'});
 const w=dom.window,state={edit:true,view:true,access:null,pending:null,saves:[],records:{}};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 const group=()=>({items:[],addTo(target){target.addLayer?.(this);return this;},addLayer(layer){this.items.push(layer);return this;},clearLayers(){this.items=[];},getLayers(){return this.items;},getBounds(){return {isValid:()=>true};},bindPopup(){return this;},eachLayer(cb){this.items.forEach(cb);}});
 const map={layers:new Set(),addLayer(l){this.layers.add(l);},removeLayer(l){this.layers.delete(l);},on(){},setView(){},fitBounds(){}};
 const catalog=()=>[{id:'H1',name:'Hotel',address:'One Hotel St',lat:39.7,lng:-105,group:'Hotels'},{id:'ccc',name:'Colorado Convention Center',address:'700 14th St',lat:39.74,lng:-105,group:'Centers'},{id:'encouraging-gathering',name:'Encouraging Gathering',address:'',lat:null,lng:null,group:'Activities',customAddress:true}];
 Object.assign(w,{structuredClone:globalThis.structuredClone,AbortController:globalThis.AbortController,AbortSignal:globalThis.AbortSignal,MODES,legacyPlan,serializePlan,denverInput,formatDenver,catalog,esc:x=>String(x??'').replaceAll('<','&lt;'),icon:()=>({}),mapBase:()=>map,railLayers:()=>({stations:group(),lines:group()}),loadRail:async()=>({stations:[{id:'station',name:'Station',lines:['E'],lat:39.7,lng:-105}],patterns:[],shapes:{},routes:[],coverage:{start:'20260927',end:'20270102'},generatedAt:'2026-11-14'}),findAddress:async()=>[],validPoint:()=>true,nearestStation:()=>null,
 calculateSchedule:async(...args)=>state.pending?state.pending:calculateSchedule(...args),
 createRouter:()=>async(a,b,t,reverse)=>({mode:a.mode,depart:reverse?t-30*60000:t,arrive:reverse?t:t+30*60000,minutes:30,segments:[{mode:a.mode,points:[[a.lat,a.lng],[b.lat,b.lng]],minutes:30,label:'Test route',instructions:[]}],label:'Test route',allowanceMinutes:0}),
 auth:{},canEdit:()=>state.edit,canView:()=>state.view,observeSiteAccess:(_auth,cb)=>{state.access=cb;cb();},watchHalls:cb=>{cb([]);return()=>{};},watchRecords:(type,cb)=>{state.records[type]=cb;cb([]);return()=>{};},saveRoute:async(payload,id)=>{state.saves.push(payload);return id||'new-trip';},removeRoute:async()=>{},
 L:{featureGroup:group,layerGroup:group,marker:group,polyline:group}});
 const context=dom.getInternalVMContext();
 vm.runInContext(read('travel-routes/app.mjs').replace(/^import .*;\r?\n/gm,''),context);
 return {dom,w,state,run:s=>vm.runInContext(s,context),$:id=>w.document.getElementById(id)};
}
test('Travel UI supports 2/3/4 stops, per-stop critical start and addressable gathering',async()=>{
 const app=setup();await settle();const {w,$,run}=app;
 assert.equal($('stops').querySelectorAll('[data-stop]').length,2);
 $('third').checked=true;$('third').dispatchEvent(new w.Event('change'));assert.equal(run('stops.length'),3);
 $('fourth').checked=true;$('fourth').dispatchEvent(new w.Event('change'));assert.equal(run('stops.length'),4);
 let select=$('stops').querySelector('[data-stop="2"] [data-action="location"]');select.value='encouraging-gathering';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(run('stops[2].name'),'Encouraging Gathering');assert($('stops').querySelector('[data-stop="2"] [data-field="address"]'));
 const checkbox=$('stops').querySelector('[data-stop="2"] [data-action="critical"]');checkbox.checked=true;checkbox.dispatchEvent(new w.Event('change',{bubbles:true}));assert(run('stops[2].startTime'));
 $('third').checked=false;$('third').dispatchEvent(new w.Event('change'));assert.equal(run('stops.length'),2);assert.equal($('fourth').checked,false);assert.equal($('fourth').disabled,true);
 app.dom.window.close();
});
test('rush-hour preset sets departure while custom time remains editable',async()=>{
 const app=setup();await settle();const {w,$}=app;
 $('preset').value='am';$('preset').dispatchEvent(new w.Event('change'));assert.equal($('timing').value,'depart');assert.match($('time').value,/T08:00$/);
 $('time').value='2027-07-16T07:56';$('time').dispatchEvent(new w.Event('input'));assert.equal($('preset').value,'custom');assert.match($('time').value,/T07:56$/);app.dom.window.close();
});
test('changing input invalidates an in-flight calculation and suppresses stale map/export/save results',async()=>{
 const app=setup();await settle();const {w,$,state,run}=app;let resolve;state.pending=new Promise(r=>resolve=r);
 $('planner').dispatchEvent(new w.Event('submit',{cancelable:true}));
 $('boarding').value='25';$('boarding').dispatchEvent(new w.Event('input'));resolve({legs:[],conflicts:[],minutes:0,depart:0,arrive:0,ready:0});await settle();
 assert.equal(run('result'),null);assert.equal($('results').hidden,true);assert.equal($('calculate').disabled,false);assert.equal(state.saves.length,0);app.dom.window.close();
});
test('successful calculation enables saving and input changes hide the old result',async()=>{
 const app=setup();await settle();const {w,$,state,run}=app;
 $('planner').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
 assert.equal($('results').hidden,false);assert.equal($('save').disabled,false);
 $('save').click();await settle();assert.equal(state.saves.length,1);assert.equal(typeof state.saves[0].resultJson,'string');
 $('allowance').value='20';$('allowance').dispatchEvent(new w.Event('input'));assert.equal(run('result'),null);assert.equal($('results').hidden,true);app.dom.window.close();
});
test('revoking view access clears loaded private routes and shared results',async()=>{
 const app=setup();await settle();const {w,$,state,run}=app;
 state.records['bus-route']([{id:'private',recordType:'bus-route',routeName:'Private plan',origin:{lat:39.7,lng:-105},destination:{lat:39.8,lng:-105},hotelName:'Private hotel',destinationName:'Hall',meetingLocal:'2027-07-16T09:00'}]);
 $('saved').querySelector('[data-load]').click();assert.equal(run('activeId'),'private');
 state.view=false;state.edit=false;state.access();assert.equal(run('activeId'),null);assert(!w.document.body.textContent.includes('Private hotel'));assert.equal($('save').disabled,true);app.dom.window.close();
});
test('new pages load shared navigation and no old static image map',()=>{
 for(const p of ['index.html','full-map.html','map-fullscreen.html']){assert.match(read(p),/planning-map\/app.mjs/);assert(!read(p).includes('full-map-content.html'));}
 assert.match(read('travel-routes/index.html'),/TomTom creates/);assert.match(read('routes/index.html'),/location.replace/);assert.match(read('rush-hour/index.html'),/location.replace/);
});


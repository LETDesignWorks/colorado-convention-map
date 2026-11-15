import {tagMeetingIcon} from '../assets/meeting-suitability-model.mjs';
import {railMeetingPoints,isMeetingLocation} from '../assets/rail-meeting-points.mjs';
import {landmarkIcon,addLandmarkReferences} from '../assets/landmark-markers.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {MODES,calculateSchedule,legacyPlan,serializePlan,validatePlan,durationMinutes,durationDisplay,clearStopPin,LOCATION_GROUPS,filterLocations,locationGroupLabel} from '../travel-routes/model.mjs';
import {createRoutingKeyStore} from '../travel-routes/key-store.mjs';
import {CONGREGATIONS} from '../assignments/congregations-data.mjs';
import {HOME_POINTS} from '../assignments/home-points.mjs';
import {travelEntries,filterTravelEntries,locationKey} from '../assets/travel-register.mjs';
import {homeFor,groupHomes,validPoint} from '../assignments/location-model.mjs';
import {denverInput,formatDenver} from '../routes/travel-plan.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const settle=()=>new Promise(r=>setTimeout(r,5));
function setup({deviceKey='',search=''}={}){
 const dom=new JSDOM(read('travel-routes/index.html'),{url:'https://letdesignworks.github.io/colorado-convention-map/travel-routes/'+search,runScripts:'outside-only'});
 const w=dom.window;
 if(deviceKey)w.localStorage.setItem('denver2027.travel.tomtom-key',deviceKey);
 const state={edit:true,view:true,access:null,pending:null,saves:[],saveIds:[],records:{}};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 const group=(initial=[])=>({items:Array.isArray(initial)?[...initial]:[],events:{},options:{},on(name,cb){this.events[name]=cb;return this;},bindTooltip(){return this;},addTo(target){target.addLayer?.(this);return this;},addLayer(layer){this.items.push(layer);return this;},clearLayers(){this.items=[];},getLayers(){return this.items;},getBounds(){return {isValid:()=>true};},bindPopup(){return this;},eachLayer(cb){this.items.forEach(cb);}});
 const map={layers:new Set(),hasLayer(l){return this.layers.has(l);},closePopup(){},invalidateSize(){},addLayer(l){this.layers.add(l);},removeLayer(l){this.layers.delete(l);},on(){},setView(){},fitBounds(){}};
 const catalog=()=>[{id:'hall-1',number:1,name:'Test Kingdom Hall',address:'100 Hall St',lat:39.8,lng:-104.8,group:'Field service / meeting places'},{id:'meeting-area',markerLabel:'M1',name:'Saved meeting area',address:'200 Meeting St',lat:39.9,lng:-104.7,group:'Field service / meeting places'},{id:'H1',name:'Hotel',address:'One Hotel St',lat:39.7,lng:-105,group:'Hotels'},{id:'ccc',name:'Colorado Convention Center',address:'700 14th St',lat:39.74,lng:-105,group:'Centers'},{id:'encouraging-gathering',name:'Encouraging Gathering',address:'',lat:null,lng:null,group:'Activities',customAddress:true}];
 Object.assign(w,{tagMeetingIcon,railMeetingPoints,isMeetingLocation,CONGREGATIONS,HOME_POINTS,homeFor,groupHomes,travelEntries,filterTravelEntries,locationKey,structuredClone:globalThis.structuredClone,AbortController:globalThis.AbortController,AbortSignal:globalThis.AbortSignal,MODES,legacyPlan,serializePlan,validatePlan,durationMinutes,durationDisplay,clearStopPin,LOCATION_GROUPS,filterLocations,locationGroupLabel,createRoutingKeyStore,denverInput,formatDenver,catalog,esc:x=>String(x??'').replaceAll('<','&lt;'),icon:()=>({}),landmarkIcon:(point,options)=>landmarkIcon(point,{...options,leaflet:w.L}),addLandmarkReferences:(map,options)=>addLandmarkReferences(map,{...options,leaflet:w.L}),mapBase:()=>map,railLayers:()=>({stations:group(),lines:group()}),loadRail:async()=>({stations:[{id:'station',name:'Station',lines:['E'],lat:39.7,lng:-105}],patterns:[],shapes:{},routes:[],coverage:{start:'20260927',end:'20270102'},generatedAt:'2026-11-14'}),findAddress:async()=>[],validPoint,nearestStation:()=>null,
 calculateSchedule:async(...args)=>state.pending?state.pending:calculateSchedule(...args),
 createRouter:()=>async(a,b,t,reverse)=>({mode:a.mode,depart:reverse?t-30*60000:t,arrive:reverse?t:t+30*60000,minutes:30,segments:[{mode:a.mode,points:[[a.lat,a.lng],[b.lat,b.lng]],minutes:30,label:'Test route',instructions:[]}],label:'Test route',allowanceMinutes:0}),
 auth:{},canEdit:()=>state.edit,canView:()=>state.view,observeSiteAccess:(_auth,cb)=>{state.access=cb;cb();},watchHalls:cb=>{cb([]);return()=>{};},watchRecords:(type,cb)=>{state.records[type]=cb;cb([]);return()=>{};},saveRoute:async(payload,id)=>{state.saves.push(payload);state.saveIds.push(id);return id||'new-trip';},removeRoute:async()=>{},
 L:{divIcon:options=>({options}),featureGroup:group,layerGroup:group,marker:(coords,options)=>Object.assign(group(),{coords,options}),polyline:group}});
 const context=dom.getInternalVMContext();
 for(const [path,exports]of [['assets/travel-register-ui.mjs',['createTravelRegister']],['travel-routes/visual-map.mjs',['createVisualTravelMap']]]){
   const code=read(path).replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*?\};?\r?\n/gm,'').replace(/export function /g,'function ').replaceAll('import.meta.url',JSON.stringify('https://letdesignworks.github.io/colorado-convention-map/'+path));
   Object.assign(w,vm.runInContext('(function(){'+code+';return {'+exports.join(',')+'};})()',context));
 }
 vm.runInContext(read('travel-routes/app.mjs').replace(/^import .*;\r?\n/gm,''),context);
 return {dom,w,state,map,run:s=>vm.runInContext(s,context),$:id=>w.document.getElementById(id)};
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

test('switching duration units preserves time and supports fractional hours',async()=>{
 const app=setup();await settle();const {w,$,run}=app;
 let input=$('stops').querySelector('[data-stop="1"] [data-field="dwell"]');input.value='90';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 let units=$('stops').querySelector('[data-stop="1"] [data-field="dwellUnit"]');units.value='hours';units.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(run('stops[1].dwell'),90);assert.equal($('stops').querySelector('[data-stop="1"] [data-field="dwell"]').value,'1.5');
 input=$('stops').querySelector('[data-stop="1"] [data-field="dwell"]');input.value='2.25';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(run('stops[1].dwell'),135);
 units=$('stops').querySelector('[data-stop="1"] [data-field="dwellUnit"]');units.value='minutes';units.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal($('stops').querySelector('[data-stop="1"] [data-field="dwell"]').value,'135');app.dom.window.close();
});
test('Meetings for field service filter lists halls and saved meeting areas',async()=>{
 const app=setup();await settle();const {w,$,run}=app;
 const group=$('stops').querySelector('[data-stop="1"] [data-action="locationGroup"]');group.value='Field service / meeting places';group.dispatchEvent(new w.Event('change',{bubbles:true}));
 const select=$('stops').querySelector('[data-stop="1"] [data-action="location"]');
 assert(select.querySelector('option[value="hall-1"]'));assert(select.querySelector('option[value="meeting-area"]'));assert(!select.querySelector('option[value="H1"]'));
 assert(select.querySelector('optgroup[label="Meetings for field service"]'));
 select.value='meeting-area';select.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(run('stops[1].name'),'Saved meeting area');assert.equal(run('stops[1].lat'),39.9);app.dom.window.close();
});
test('removed pin is absent from map and survives saving and reopening an existing route',async()=>{
 const app=setup();await settle();const {w,$,state,run}=app;
 $('planner').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
 $('save').click();await settle();const original=state.saves[0];
 state.records['bus-route']([{...original,id:'existing-route'}]);$('saved').querySelector('[data-load]').click();
 assert.equal(run('journey.getLayers().length'),2);
 $('stops').querySelector('[data-stop="1"] [data-action="removePin"]').click();
 assert.equal(run('stops[1].lat'),null);assert.equal(run('stops[1].lng'),null);assert.equal(run('journey.getLayers().length'),1);assert.equal($('results').hidden,true);
 $('saveDraft').click();await settle();
 const draft=state.saves.at(-1);assert.equal(state.saveIds.at(-1),'existing-route');assert.equal(draft.travelDraft,true);assert.equal(draft.resultJson,'null');assert.equal(draft.plan.stops[1].lat,null);assert.equal(draft.departureLocal,'');
 state.records['bus-route']([{...draft,id:'existing-route'}]);$('saved').querySelector('[data-load]').click();
 assert.equal(run('stops[1].lat'),null);assert.equal(run('journey.getLayers().length'),1);assert.equal($('stops').querySelector('[data-stop="1"] [data-field="lat"]').value,'');
 assert.equal(run('stops[1].address'),'700 14th St');app.dom.window.close();
});
test('draft save requires edit access and invalid coordinates cannot become a completed route',async()=>{
 const app=setup();await settle();const {w,$,state}=app;
 $('stops').querySelector('[data-stop="1"] [data-action="removePin"]').click();
 $('planner').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.match($('status').textContent,/address pin/);assert.equal($('results').hidden,true);
 state.edit=false;state.access();assert.equal($('saveDraft').disabled,true);$('saveDraft').click();await settle();assert.equal(state.saves.length,0);app.dom.window.close();
});
test('remembered TomTom key loads on a new visit and Clear key removes both stores',async()=>{
 const app=setup({deviceKey:'example-browser-key'});await settle();const {w,$}=app;
 assert.equal($('tomtomKey').value,'example-browser-key');assert.equal($('rememberKey').checked,true);
 $('clearKey').click();assert.equal($('tomtomKey').value,'');assert.equal($('rememberKey').checked,false);assert.equal(w.localStorage.getItem('denver2027.travel.tomtom-key'),null);assert.equal(w.sessionStorage.getItem('denver-rush-hour-tomtom-session'),null);
 $('tomtomKey').value='new-example-key';$('tomtomKey').dispatchEvent(new w.Event('input'));
 assert.equal(w.localStorage.getItem('denver2027.travel.tomtom-key'),null);
 $('rememberKey').checked=true;$('rememberKey').dispatchEvent(new w.Event('change'));assert.equal(w.localStorage.getItem('denver2027.travel.tomtom-key'),'new-example-key');
 $('rememberKey').checked=false;$('rememberKey').dispatchEvent(new w.Event('change'));assert.equal(w.localStorage.getItem('denver2027.travel.tomtom-key'),null);assert.equal(w.sessionStorage.getItem('denver-rush-hour-tomtom-session'),'new-example-key');app.dom.window.close();
});
test('Travel branding is in the header and map overlay branding is suppressed',()=>{
 const dom=new JSDOM(read('travel-routes/index.html'));assert(dom.window.document.querySelector('body.travel-routes header .travel-logo'));assert(!dom.window.document.querySelector('.map-card .travel-logo'));
 assert.match(read('assets/planning.css'),/body\.travel-routes \.denver-2027-map-brand\{display:none!important\}/);dom.window.close();
});

test('visual map toggles location layers and fills the chosen stop without changing its transport or duration',async()=>{
 const app=setup();await settle();const {w,$,run,map}=app;
 const hotelLayer=[...map.layers].find(l=>l.items?.some(m=>m.options?.title==='Hotel'));
 const hotel=hotelLayer.items.find(m=>m.options.title==='Hotel');
 const box=w.document.querySelector('[data-travel-layer="hotels"]');box.checked=false;box.dispatchEvent(new w.Event('change'));assert.equal(map.hasLayer(hotelLayer),false);box.checked=true;box.dispatchEvent(new w.Event('change'));assert.equal(map.hasLayer(hotelLayer),true);
 run('stops[1].mode="car";stops[1].dwell=90;');$('mapTarget').value='1';hotel.events.click({});assert.equal(run('stops[1].id'),'H1');assert.equal(run('stops[1].mode'),'car');assert.equal(run('stops[1].dwell'),90);
 $('mapTarget').value='0';const hall=[...map.layers].flatMap(l=>l.items||[]).find(m=>m.options?.title==='Saved meeting area');hall.events.click({});assert.equal(run('stops[0].id'),'meeting-area');assert.match($('status').textContent,/Starting point set/);
 $('expandMap').click();assert(w.document.body.classList.contains('travel-map-expanded'));w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert(!w.document.body.classList.contains('travel-map-expanded'));app.dom.window.close();
});

test('saved roster can reopen through a register link and clears on access changes',async()=>{
 const app=setup({search:'?route=trip'});await settle();const {state,run,$,w}=app;
 const plan=run('initial()');plan.assignedHotelIds=['H1'];plan.assignedCongregationIds=['C001'];plan.vehicle='Bus Three';plan.passengers=42;
 const payload=serializePlan(plan);state.records['bus-route']([{...payload,id:'trip'}]);assert.equal(run('activeId'),'trip');assert.equal($('vehicle').value,'Bus Three');assert.equal($('passengers').value,'42');assert.equal($('routeHotels').selectedOptions[0].value,'H1');assert.equal(run('readPlan().assignedCongregationIds[0]'),'C001');
 state.view=false;state.edit=false;state.access();assert(!w.document.body.textContent.includes('Bus Three'));assert.equal($('vehicle').value,'');app.dom.window.close();
});

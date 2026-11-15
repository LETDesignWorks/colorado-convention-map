import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {initCongregationLocations,focusMapPoint} from '../assignments/location-ui.mjs';
import {homeFor} from '../assignments/location-model.mjs';

const source=fs.readFileSync(new URL('../assignments/app-v3.mjs',import.meta.url),'utf8');
const unassignSource=source.slice(source.indexOf('async function unassignCongregation('),source.indexOf('async function saveAssignment('));
const record={recordType:'congregation-assignment',congregationId:'C001',meetingPointId:'a'};
function service({current=record,admin=true,ready=true,fail=false,newer=false}={}){
 const address={recordType:'congregation-address',homeAddress:'123 Main St, Denver CO',lat:39.7,lng:-105};
 const records=new Map([['congregation-c001',{...current}],['congregation-address-c001',address],['a',{name:'Meeting A'}],['congregation-c002',{...record,congregationId:'C002'}]]);
 const assignments=new Map([['C001',record],['C002',records.get('congregation-c002')]]),selected=new Set(['C001','C002']),deleted=[];
 const context=vm.createContext({isAdmin:()=>admin,publicReady:ready,db:{},assignments,selectedCongregations:selected,assignmentFor:id=>assignments.get(id),assignmentDocumentId:id=>'congregation-'+id.toLowerCase(),doc:(_db,collection,id)=>{assert.equal(collection,'halls');return id;},runTransaction:async(_db,work)=>{
   const pending=[];await work({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),delete:ref=>pending.push(ref)});
   if(fail)throw Error('Permission denied');
   for(const ref of pending){records.delete(ref);deleted.push(ref);}
   if(newer)assignments.set('C001',{...record,meetingPointId:'b'});
 }});
 vm.runInContext(unassignSource,context);
 return{records,address,assignments,selected,deleted,run:()=>context.unassignCongregation({id:'C001'})};
}
test('unassign deletes only the requested assignment and preserves address, coordinates, other congregation and hall',async()=>{
 const f=service();await f.run();
 assert.deepEqual(f.deleted,['congregation-c001']);assert.equal(f.records.get('congregation-address-c001'),f.address);
 assert.ok(f.records.has('a'));assert.ok(f.records.has('congregation-c002'));assert.equal(f.assignments.has('C001'),false);assert.equal(f.assignments.has('C002'),true);
 assert.deepEqual([...f.selected],['C002']);
});
test('failed, unauthorized, stale, or misidentified unassign operations preserve records',async()=>{
 for(const options of [{fail:true},{admin:false},{ready:false},{current:{...record,meetingPointId:'b'}},{current:{...record,recordType:'congregation-address'}}]){
  const f=service(options);await assert.rejects(f.run());assert.equal(f.deleted.length,0);assert.ok(f.assignments.has('C001'));assert.equal(f.records.get('congregation-address-c001'),f.address);
 }
});
test('unassign is idempotent and does not overwrite a newer assignment snapshot',async()=>{
 const f=service();await f.run();await f.run();assert.equal(f.deleted.length,1);
 const g=service({newer:true});await g.run();assert.equal(g.assignments.get('C001').meetingPointId,'b');
});

class Element{
 constructor(){this.value='';this.disabled=false;this.children=[];this.events={};this.innerHTML='';this.classList={values:new Set(),add(value){this.values.add(value);},remove(value){this.values.delete(value);},contains(value){return this.values.has(value);}};}
 addEventListener(name,fn){this.events[name]=fn;}
 set innerHTML(value){this.html=value;this.suggestions=[...value.matchAll(/data-suggestion="([^"]+)"/g)].map(match=>{const button=new Element();button.dataset={suggestion:match[1]};return button;});}
 get innerHTML(){return this.html;}
 querySelectorAll(selector){return selector==='[data-suggestion]'?this.suggestions:[];}
 append(child){this.children.push(child);}
 replaceChildren(){this.children=[];}
 scrollIntoView(){} focus(){}
}
function uiFixture({focus='',admin=true,ready=true,fail=false,meeting='a',allowed=false}={}){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};
 globalThis.document={getElementById:get,createElement:()=>new Element(),addEventListener(){}};
 const layers=[];
 globalThis.L={
  layerGroup:()=>{const layer={items:[],addTo(){return this;},clearLayers(){this.items=[];}};layers.push(layer);return layer;},
  divIcon:options=>options,
  marker:(coords,options)=>({coords,options,events:{},addTo(layer){layer.items.push(this);return this;},bindPopup(popup){this.popup=popup;return this;},bindTooltip(text,options){this.tooltip={text,options};return this;},on(name,fn){this.events[name]=fn;return this;}}),
  polyline:(coords,options)=>({coords,options,addTo(layer){layer.items.push(this);return this;},bindTooltip(){return this;}})
 };
 const congregations=[
  {id:'one',name:'One',homeAddress:'123 A Street',point:{lat:39.7,lng:-105}},
  {id:'two',name:'Two',homeAddress:'123 A Street',point:{lat:39.7,lng:-105}},
  {id:'missing',name:'Missing',homeAddress:''},
  {id:'outside',name:'Outside',homeAddress:'456 B Street',point:{lat:40,lng:-105}},
  {id:'free',name:'Unassigned',homeAddress:'789 C Street',point:{lat:39.9,lng:-105}}
 ];
 const locations=[{id:'a',name:'Meeting A',lat:39.71,lng:-104.99},{id:'b',name:'Meeting B',lat:40,lng:-105}];
 const assignments=new Map([['one',{meetingPointId:'a'}],['two',{meetingPointId:'a'}],['missing',{meetingPointId:'a'}],['outside',{meetingPointId:'b'}]]);
 const selected=new Set(['outside']),toasts=[];let loggedIn=0,unassigned=0,ui;
 const map={zoom:10,views:[],stops:0,popupsClosed:0,tooltipsClosed:0,fitBounds(){},setView(coords,zoom){this.views.push({coords,zoom});this.zoom=zoom;},getZoom(){return this.zoom;},stop(){this.stops++;},closePopup(){this.popupsClosed++;},closeTooltip(){this.tooltipsClosed++;}};
 const ctx={map,congregations,source:{spreadsheetCount:5,file:'Test',retainedCount:0},escapeHtml:String,
 resolveHome:c=>({address:c.homeAddress,point:c.point||null,status:c.point?'mapped':'missing'}),getLocations:()=>locations,getAddressPoints:()=>locations,getStatuses:()=>new Map(),getProfile:()=>null,
 getAssignment:id=>assignments.get(id),getMeetingPoint:()=>focus||meeting,getFocusedMeetingPoint:()=>focus,getVisible:()=>congregations,getSelected:()=>selected,
 isAdmin:()=>admin,isReady:()=>ready,driveState:()=>({allowed,status:allowed?'within':'over',label:allowed?'Within travel limit':'Over 1 hr 20 min'}),loadDrives:async()=>{},openLogin:()=>loggedIn++,toast:(...args)=>toasts.push(args),
 unassignCongregation:async c=>{unassigned++;if(fail)throw Error('Save failed');assignments.delete(c.id);},refresh:()=>ui.render()};
 ui=initCongregationLocations(ctx);
 return {ui,get,layers,congregations,assignments,toasts,selected,map,ctx,setMeeting:value=>meeting=value,setFocus:value=>focus=value,unassigned:()=>unassigned,logins:()=>loggedIn};
}
test('single-congregation override enables a longer trip while preserving its warning and unknown-time blocking',async()=>{
 const f=uiFixture();let override='',saved;
 f.ctx.travelOverrideEnabled=id=>override===id;
 f.ctx.canAssignTravel=(travel,id)=>travel.allowed||(travel.status==='over'&&override===id);
 f.ctx.setTravelOverride=(id,enabled)=>{override=enabled?id:'';f.ui.render();};
 f.ctx.saveAssignment=async(c,id)=>{saved={c,id};};
 f.ui.select('one');f.get('congregationDestination').value='b';f.get('congregationDestination').events.change();
 assert.equal(f.get('saveCongregationAssignment').disabled,true);assert.equal(f.get('congregationTravelOverrideLabel').hidden,false);
 f.get('congregationTravelOverride').checked=true;f.get('congregationTravelOverride').events.change();assert.equal(f.get('saveCongregationAssignment').disabled,false);assert.match(f.get('assignmentDraftStatus').textContent,/Over 1 hr 20 min/);assert.match(f.get('assignmentDraftStatus').textContent,/override enabled/);
 await f.get('saveCongregationAssignment').events.click();assert.equal(saved.id,'b');assert.equal(saved.c.id,'one');
 f.ctx.driveState=()=>({status:'unknown',allowed:false,label:'Travel time unavailable'});f.ui.render();assert.equal(f.get('saveCongregationAssignment').disabled,true);assert.equal(f.get('congregationTravelOverrideLabel').hidden,true);
});
test('focused map shows only assigned homes with visible names and one line per shared address',()=>{
 const f=uiFixture();f.ui.select('outside');f.setFocus('a');f.ui.render();
 assert.equal(f.layers[0].items.length,1);assert.equal(f.layers[0].items[0].tooltip.text,'One · Two');assert.equal(f.layers[0].items[0].tooltip.options.permanent,true);
 assert.equal(f.layers[1].items.length,1);assert.deepEqual(f.layers[1].items[0].coords,[[39.7,-105],[39.71,-104.99]]);
 f.setFocus('');f.ui.render();assert.equal(f.layers[0].items.length,3);
 assert.equal(f.layers[0].items[0].tooltip.options.permanent,false);
});
test('single unassign works despite an over-limit travel flag and updates focused pins and lines',async()=>{
 const f=uiFixture({focus:'a'});f.ui.select('one');
 assert.equal(f.get('unassignCongregation').disabled,false);
 await f.ui.unassign('one');assert.equal(f.assignments.has('one'),false);assert.equal(f.congregations[0].homeAddress,'123 A Street');assert.ok(f.congregations[0].point);
 assert.equal(f.layers[0].items[0].tooltip.text,'Two');assert.equal(f.layers[1].items.length,1);
 await f.ui.unassign('two');assert.equal(f.layers[0].items.length,0);assert.equal(f.layers[1].items.length,0);assert.ok(f.assignments.has('missing'));
});
test('unassign UI keeps saved data on failure and enforces sign-in and fresh shared data',async()=>{
 const failed=uiFixture({fail:true});await failed.ui.unassign('one');assert.ok(failed.assignments.has('one'));assert.match(failed.toasts.at(-1)[0],/Save failed/);
 const signedOut=uiFixture({admin:false});await signedOut.ui.unassign('one');assert.equal(signedOut.unassigned(),0);assert.equal(signedOut.logins(),1);
 const loading=uiFixture({ready:false});await loading.ui.unassign('one');assert.equal(loading.unassigned(),0);assert.ok(loading.assignments.has('one'));
});

test('saved map check marks remain across other meeting selections, no selection, and a fresh render',()=>{
 const f=uiFixture();f.ui.render();
 const marker=name=>f.layers[0].items.find(item=>item.options.title.includes(name));
 for(const meeting of ['a','b','']){
  f.setMeeting(meeting);f.ui.render();
  assert.match(marker('One').options.icon.html,/congregation-pin[^\"]* assigned/);
  assert.match(marker('One').options.icon.html,/assigned-badge[^>]*>✓2</);
  assert.match(marker('Outside').options.icon.html,/assigned-badge[^>]*>✓1</);
  assert.doesNotMatch(marker('Unassigned').options.icon.html,/assigned-badge/);
 }
 assert.match(marker('One').popup.children[0].textContent,/✓ Assigned to Meeting A/);
 const reopened=uiFixture({meeting:''});reopened.ui.render();
 assert.equal(reopened.layers[0].items.filter(item=>item.options.icon.html.includes('assigned-badge')).length,2);
});

test('saved assignment and green check remain while the congregation is actively selected',()=>{
 const f=uiFixture({meeting:'b'});f.selected.add('one');f.ui.select('one');
 const html=f.layers[0].items.find(item=>item.options.title.includes('One')).options.icon.html;
 assert.match(html,/congregation-pin[^\"]* active[^\"]* checked[^\"]* assigned/);
 assert.match(html,/selection-badge/);assert.match(html,/assigned-badge[^>]*>✓2</);
});

test('shared-address badges count all saved assignments and disappear only after the last one is removed',async()=>{
 const f=uiFixture({meeting:'b'});f.ui.render();
 const home=()=>f.layers[0].items.find(item=>item.options.title.includes('One'));
 await f.ui.unassign('one');assert.match(home().options.icon.html,/assigned-badge[^>]*>✓1\/2</);
 await f.ui.unassign('two');assert.doesNotMatch(home().options.icon.html,/assigned-badge|congregation-pin[^\"]* assigned/);
 assert.deepEqual(home().coords,[39.7,-105]);
 f.assignments.set('one',{meetingPointId:'a'});f.ui.render();
 assert.match(home().options.icon.html,/assigned-badge[^>]*>✓1\/2</);
});

test('meeting focus removes unrelated meeting markers and DTC context, then restores them',()=>{
 const markerSource=source.slice(source.indexOf('function syncMarkers()'),source.indexOf('function sortedLocations()'));
 const layers=new Set(),map={removeLayer:layer=>layers.delete(layer),hasLayer:layer=>layers.has(layer)};
 const layer=()=>({addTo(){layers.add(this);return this;},on(){return this;},bindTooltip(){return this;},setLatLng(){},setIcon(){},setTooltipContent(){}});
 const boundary=layer().addTo(map),center=layer().addTo(map),markers=new Map();
 const context=vm.createContext({map,locations:[{id:'a',name:'A',lat:39,lng:-105},{id:'b',name:'B',lat:40,lng:-105}],focusedMeetingPointId:'',boundaryLayer:boundary,centerMarker:center,markers,L:{marker:()=>layer()},assignedCountAt:()=>1,meetingPointIcon:()=>({}),markerLabel:p=>p.id,escapeHtml:String,selectMeetingPoint(){}});
 vm.runInContext(markerSource,context);context.syncMarkers();assert.equal(markers.size,2);
 context.focusedMeetingPointId='a';context.syncMarkers();assert.deepEqual([...markers.keys()],['a']);assert.equal(layers.has(boundary),false);assert.equal(layers.has(center),false);
 context.focusedMeetingPointId='';context.syncMarkers();assert.equal(markers.size,2);assert.equal(layers.has(boundary),true);assert.equal(layers.has(center),true);
});

test('focused directory retains assigned congregations with missing addresses and excludes other meetings',()=>{
 const filterSource=source.slice(source.indexOf('function filteredCongregations('),source.indexOf('function renderStats()'));
 const cs=[{id:'mapped',name:'Mapped',point:{lat:39.7,lng:-105}},{id:'missing',name:'Missing'},{id:'other',name:'Other',point:{lat:40,lng:-105}}];
 const context=vm.createContext({revealedCongregations:new Set(),selectedCongregations:new Set(),clean:value=>String(value||'').trim(),CONGREGATIONS:cs,els:{searchInput:{value:''},statusFilter:{value:'all'},meetingFilter:{value:'a'}},focusedMeetingPointId:'a',nearestMeetingPointId:'a',locations:[{id:'a'}],document:{getElementById:()=>({value:'all'})},assignmentFor:id=>({meetingPointId:id==='other'?'b':'a'}),meetingPointForAssignment:()=>null,resolveHome:c=>({address:'',point:c.point||null,status:c.point?'mapped':'missing'}),rankCongregations:items=>items});
 vm.runInContext(filterSource,context);
 assert.deepEqual(Array.from(context.filteredCongregations(),c=>c.id),['mapped','missing']);
});
test('explicit meeting overview still fits every assigned pin, including congregations beyond the nearest ten',()=>{
 const selectionSource=source.slice(source.indexOf('function selectMeetingPoint('),source.indexOf('function focusMeetingPoint('));
 const homes=Array.from({length:12},(_,i)=>({point:{lat:39+i/100,lng:-105}}));
 let bounds;
 const context=vm.createContext({routeRegister:{meeting(){}},selectionRevision:0,locations:[{id:'a',name:'Meeting A',lat:39,lng:-104}],selectedMeetingPointId:'',nearestMeetingPointId:'',focusedMeetingPointId:'a',loadDrives:async()=>{},els:{searchInput:{value:''},statusFilter:{value:'all'},meetingFilter:{value:'a'},assignmentDestination:{value:''}},isAdmin:()=>false,syncMarkers(){},renderMeetingPointList(){},renderSelectedMeetingPoint(){},locationUi:{meetingPointChosen(){}},renderCongregationList(){},renderMeetingFocus(){},map:{fitBounds:points=>bounds=points},assignedCongregationsAt:()=>homes,filteredCongregations:()=>homes,resolveHome:c=>c,markers:new Map()});
 vm.runInContext(selectionSource,context);context.selectMeetingPoint('a',true,true,true);
 assert.equal(bounds.length,13);
});

test('point focusing zooms into valid coordinates and preserves an already closer view',()=>{
 const f=uiFixture();
 assert.equal(focusMapPoint(f.map,{lat:'39.71',lng:'-104.99'}),true);
 assert.deepEqual(f.map.views.at(-1),{coords:[39.71,-104.99],zoom:15});
 f.map.zoom=18;focusMapPoint(f.map,{lat:40,lng:-105});
 assert.deepEqual(f.map.views.at(-1),{coords:[40,-105],zoom:18});
 const views=f.map.views.length;
 for(const point of [null,{lat:null,lng:-105},{lat:91,lng:-105},{lat:39,lng:''}])assert.equal(focusMapPoint(f.map,point),false);
 assert.equal(focusMapPoint(null,{lat:39,lng:-105}),false);assert.equal(f.map.views.length,views);
});

test('individual and shared congregation marker clicks, popup choices, and directory selection focus their home',()=>{
 const f=uiFixture();f.ui.render();
 const marker=name=>f.layers[0].items.find(item=>item.options.title.includes(name));
 marker('Outside').events.click();assert.deepEqual(f.map.views.at(-1),{coords:[40,-105],zoom:15});
 marker('One').events.click();assert.deepEqual(f.map.views.at(-1),{coords:[39.7,-105],zoom:15});
 marker('One').popup.children[1].events.click();
 assert.match(f.get('congregationDetail').innerHTML,/<h2>Two<\/h2>/);assert.deepEqual(f.map.views.at(-1).coords,[39.7,-105]);
 f.map.zoom=18;f.ui.select('free',true);assert.deepEqual(f.map.views.at(-1),{coords:[39.9,-105],zoom:18});
 f.ui.selectionChanged('one',true);assert.deepEqual(f.map.views.at(-1),{coords:[39.7,-105],zoom:18});
});

test('meeting suggestions and destination dropdown focus the destination without writing assignments',()=>{
 const f=uiFixture({allowed:true});f.ctx.getStatuses=()=>new Map([['a',{busStatus:'approved'}],['b',{busStatus:'approved'}]]);
 const before=JSON.stringify([...f.assignments]);f.ui.select('one');
 f.get('congregationDestination').value='b';f.get('congregationDestination').events.change();
 assert.deepEqual(f.map.views.at(-1),{coords:[40,-105],zoom:15});
 const suggestion=f.get('congregationDetail').querySelectorAll('[data-suggestion]').find(button=>button.dataset.suggestion==='a');
 suggestion.events.click();assert.deepEqual(f.map.views.at(-1).coords,[39.71,-104.99]);
 assert.equal(f.get('congregationDestination').value,'a');assert.equal(JSON.stringify([...f.assignments]),before);
});

function meetingSelectionContext(f){
 const context=vm.createContext({routeRegister:{meeting(){}},selectionRevision:0,locations:f.ctx.getLocations(),selectedMeetingPointId:'',nearestMeetingPointId:'',focusedMeetingPointId:'',loadDrives:async()=>{},els:{searchInput:f.get('searchInput'),statusFilter:f.get('statusFilter'),meetingFilter:f.get('meetingFilter'),assignmentDestination:f.get('assignmentDestination')},document:globalThis.document,isAdmin:()=>false,syncMarkers(){},renderMeetingPointList(){},renderSelectedMeetingPoint(){},locationUi:f.ui,renderCongregationList(){},renderMeetingFocus(){},map:f.map,assignedCongregationsAt:()=>f.congregations,resolveHome:f.ctx.resolveHome,markers:new Map(),focusMapPoint});
 vm.runInContext(source.slice(source.indexOf('function selectMeetingPoint('),source.indexOf('function clearMeetingFocus(')),context);
 return context;
}
test('meeting selections zoom to their point even during a filtered view, while the overview remains explicit',()=>{
 const f=uiFixture(),context=meetingSelectionContext(f);let overview;
 f.map.fitBounds=points=>overview=points;
 context.selectMeetingPoint('a',true);assert.deepEqual(f.map.views.at(-1).coords,[39.71,-104.99]);assert.equal(overview,undefined);
 context.focusedMeetingPointId='a';context.selectMeetingPoint('b',true);
 assert.deepEqual(f.map.views.at(-1).coords,[40,-105]);assert.equal(overview,undefined);
 context.focusMeetingPoint('a',false);assert.deepEqual(f.map.views.at(-1).coords,[39.71,-104.99]);assert.equal(overview,undefined);
 context.focusMeetingPoint('a');assert.equal(overview.length,5);
});

function escapeContext(f){
 const routeChoices=[],context=vm.createContext({selectionRevision:1,selectedMeetingPointId:'a',nearestMeetingPointId:'a',focusedMeetingPointId:'a',serviceDayFocus:'one',revealedCongregations:new Set(['one']),selectedCongregations:f.selected,els:{assignmentDestination:f.get('assignmentDestination'),meetingFilter:f.get('meetingFilter'),loginModal:f.get('loginModal'),loginButton:f.get('loginButton')},routeRegister:{meeting:id=>routeChoices.push(id)},map:f.map,markers:new Map(),locationUi:f.ui,document:globalThis.document,closeLogin:()=>f.get('loginModal').classList.remove('open'),renderAll:()=>f.ui.render()});
 f.ctx.getMeetingPoint=()=>context.selectedMeetingPointId;f.ctx.getFocusedMeetingPoint=()=>context.focusedMeetingPointId;
 f.ctx.onCongregationSelected=id=>{context.serviceDayFocus=id;context.selectionRevision++;};
 vm.runInContext(source.slice(source.indexOf('function exitSelection('),source.indexOf('function updateAuthUi(')),context);
 const escape=()=>{const event={key:'Escape',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};context.handleSelectionEscape(event);return event;};
 return {context,escape,routeChoices};
}
test('Escape clears local drafts, selections and focus but preserves saved assignments and allows the next selection',()=>{
 for(const admin of [true,false]){
  const f=uiFixture({admin}),before=JSON.stringify([...f.assignments]),keys=escapeContext(f);
  f.ui.select('one');f.ui.meetingPointChosen({id:'b'});
  keys.escape();
  for(const key of ['selectedMeetingPointId','nearestMeetingPointId','focusedMeetingPointId','serviceDayFocus'])assert.equal(keys.context[key],'');
  assert.equal(f.selected.size,0);assert.equal(keys.context.revealedCongregations.size,0);
  assert.equal(f.get('assignmentDestination').value,'');assert.equal(f.get('meetingFilter').value,'all');
  assert.match(f.get('congregationDetail').innerHTML,/Select a congregation/);assert.equal(f.layers[1].items.length,0);
  assert.ok(f.map.popupsClosed);assert.ok(f.map.tooltipsClosed);assert.deepEqual(keys.routeChoices,['']);
  f.ui.meetingPointChosen({id:'a'});assert.match(f.get('congregationDetail').innerHTML,/Select a congregation/);
  f.ui.select('outside',true);assert.match(f.get('congregationDetail').innerHTML,/<h2>Outside<\/h2>/);
  assert.equal(f.get('congregationDestination').value,'b');assert.equal(JSON.stringify([...f.assignments]),before);
 }
});

test('Escape closes address and login dialogs before clearing the underlying congregation selection',()=>{
 for(const modalId of ['addressModal','loginModal']){
  const f=uiFixture(),keys=escapeContext(f);f.ui.select('one');f.get(modalId).classList.add('open');
  keys.escape();assert.equal(f.get(modalId).classList.contains('open'),false);
  assert.equal(keys.context.selectedMeetingPointId,'a');assert.match(f.get('congregationDetail').innerHTML,/<h2>One<\/h2>/);
  keys.escape();assert.equal(keys.context.selectedMeetingPointId,'');assert.match(f.get('congregationDetail').innerHTML,/Select a congregation/);
 }
});

test('finishing a single assignment save after Escape does not reopen the cleared congregation or draft',async()=>{
 const f=uiFixture({allowed:true}),keys=escapeContext(f);let finish;
 f.ctx.saveAssignment=(congregation,point)=>new Promise(resolve=>finish=()=>{f.assignments.set(congregation.id,{meetingPointId:point});resolve();});
 f.ui.select('one');f.ui.meetingPointChosen({id:'b'});
 const saving=f.get('saveCongregationAssignment').events.click();keys.escape();
 finish();await saving;
 assert.match(f.get('congregationDetail').innerHTML,/Select a congregation/);assert.equal(f.layers[1].items.length,0);assert.equal(keys.context.selectedMeetingPointId,'');
 assert.equal(f.assignments.get('one').meetingPointId,'b');
});

test('a bulk assignment already saving can finish after Escape without reselecting its old destination',async()=>{
 const f=uiFixture({allowed:true}),keys=escapeContext(f),context=keys.context;let finish;
 f.selected.clear();f.selected.add('one');f.get('assignmentDestination').value='a';
 Object.assign(context,{assignmentBusy:false,isAdmin:()=>true,publicReady:true,locations:f.ctx.getLocations(),CONGREGATIONS:f.congregations,assignments:f.assignments,requireEligible:async()=>{},db:{},currentUser:{email:'test@example.com'},writeBatch:()=>({set(){},commit:()=>new Promise(resolve=>finish=resolve)}),doc:()=>({}),assignmentDocumentId:id=>id,markerLabel:p=>p.id,resolveHome:f.ctx.resolveHome,serverTimestamp:()=>null,renderSelectionControls(){},toast(){},friendlyError:error=>error.message});
 vm.runInContext(source.slice(source.indexOf('async function assignSelected('),source.indexOf('async function clearSelectedAssignments(')),context);
 const saving=context.assignSelected();await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof finish,'function');keys.escape();finish();await saving;
 assert.equal(context.assignmentBusy,false);assert.equal(context.selectedMeetingPointId,'');assert.equal(f.get('assignmentDestination').value,'');
 assert.match(f.get('congregationDetail').innerHTML,/Select a congregation/);assert.equal(f.assignments.get('one').meetingPointId,'a');
});


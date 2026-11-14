import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {initCongregationLocations} from '../assignments/location-ui.mjs';
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
 constructor(){this.value='';this.disabled=false;this.children=[];this.events={};this.innerHTML='';this.classList={add(){},remove(){},contains(){return false;}};}
 addEventListener(name,fn){this.events[name]=fn;}
 querySelectorAll(){return [];}
 append(child){this.children.push(child);}
 replaceChildren(){this.children=[];}
 scrollIntoView(){} focus(){}
}
function uiFixture({focus='',admin=true,ready=true,fail=false}={}){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};
 globalThis.document={getElementById:get,createElement:()=>new Element(),addEventListener(){}};
 const layers=[];
 globalThis.L={
  layerGroup:()=>{const layer={items:[],addTo(){return this;},clearLayers(){this.items=[];}};layers.push(layer);return layer;},
  divIcon:options=>options,
  marker:(coords,options)=>({coords,options,addTo(layer){layer.items.push(this);return this;},bindPopup(){return this;},bindTooltip(text,options){this.tooltip={text,options};return this;},on(){return this;}}),
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
 const ctx={map:{fitBounds(){},setView(){},closePopup(){}},congregations,source:{spreadsheetCount:5,file:'Test',retainedCount:0},escapeHtml:String,
 resolveHome:c=>({address:c.homeAddress,point:c.point||null,status:c.point?'mapped':'missing'}),getLocations:()=>locations,getAddressPoints:()=>locations,getStatuses:()=>new Map(),getProfile:()=>null,
 getAssignment:id=>assignments.get(id),getMeetingPoint:()=>focus||'a',getFocusedMeetingPoint:()=>focus,getVisible:()=>congregations,getSelected:()=>selected,
 isAdmin:()=>admin,isReady:()=>ready,driveState:()=>({allowed:false,status:'over',label:'Over 1 hr 20 min'}),loadDrives:async()=>{},openLogin:()=>loggedIn++,toast:(...args)=>toasts.push(args),
 unassignCongregation:async c=>{unassigned++;if(fail)throw Error('Save failed');assignments.delete(c.id);},refresh:()=>ui.render()};
 ui=initCongregationLocations(ctx);
 return {ui,get,layers,congregations,assignments,toasts,setFocus:value=>focus=value,unassigned:()=>unassigned,logins:()=>loggedIn};
}
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
 const filterSource=source.slice(source.indexOf('function filteredCongregations()'),source.indexOf('function renderStats()'));
 const cs=[{id:'mapped',name:'Mapped',point:{lat:39.7,lng:-105}},{id:'missing',name:'Missing'},{id:'other',name:'Other',point:{lat:40,lng:-105}}];
 const context=vm.createContext({clean:value=>String(value||'').trim(),CONGREGATIONS:cs,els:{searchInput:{value:''},statusFilter:{value:'all'},meetingFilter:{value:'a'}},focusedMeetingPointId:'a',nearestMeetingPointId:'a',locations:[{id:'a'}],document:{getElementById:()=>({value:'all'})},assignmentFor:id=>({meetingPointId:id==='other'?'b':'a'}),meetingPointForAssignment:()=>null,resolveHome:c=>({address:'',point:c.point||null,status:c.point?'mapped':'missing'}),rankCongregations:items=>items});
 vm.runInContext(filterSource,context);
 assert.deepEqual(Array.from(context.filteredCongregations(),c=>c.id),['mapped','missing']);
});
test('focused map fits every assigned pin, including congregations beyond the usual nearest-ten view',()=>{
 const selectionSource=source.slice(source.indexOf('function selectMeetingPoint('),source.indexOf('function focusMeetingPoint('));
 const homes=Array.from({length:12},(_,i)=>({point:{lat:39+i/100,lng:-105}}));
 let bounds;
 const context=vm.createContext({locations:[{id:'a',name:'Meeting A',lat:39,lng:-104}],selectedMeetingPointId:'',nearestMeetingPointId:'',focusedMeetingPointId:'a',loadDrives:async()=>{},els:{searchInput:{value:''},statusFilter:{value:'all'},meetingFilter:{value:'a'},assignmentDestination:{value:''}},isAdmin:()=>false,syncMarkers(){},renderMeetingPointList(){},renderSelectedMeetingPoint(){},locationUi:{meetingPointChosen(){}},renderCongregationList(){},renderMeetingFocus(){},map:{fitBounds:points=>bounds=points},assignedCongregationsAt:()=>homes,filteredCongregations:()=>homes,resolveHome:c=>c,markers:new Map()});
 vm.runInContext(selectionSource,context);context.selectMeetingPoint('a',true,true);
 assert.equal(bounds.length,13);
});

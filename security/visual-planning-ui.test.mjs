import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountTravelCosts} from '../activity-planning/travel-costs.mjs';
import {createTravelRegister} from '../assets/travel-register-ui.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import {railMeetingPoints} from '../assets/rail-meeting-points.mjs';
import {travelCostDraft,encodeTravelCost} from '../activity-planning/travel-cost-model.mjs';
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
test('saved estimate values render as text without injecting HTML',()=>{
 const f=setup(),draft=travelCostDraft(record());draft.legs[0].stopMinutes='<img src=x onerror=alert(1)>';const saved={...encodeTravelCost(draft),id:'estimate'};
 f.costs.setData({estimates:[saved],access:false,canSave:false});f.$('[data-cost-open]').click();assert.equal(f.$('[data-cost-editor] img'),null);assert.match(f.$('[data-cost-editor]').textContent,/<img src=x/);f.dom.window.close();
});
test('route register filters multiple trips for one hotel/day and clears private rows on sign-out',()=>{
 const f=setup(),register=createTravelRegister(f.$('#register')),a=record(),b=record('trip2');b.plan.name='Second group';b.plan.vehicle='Car group 1';const locations=a.plan.stops;
 register.update({records:[a,b],locations,congregations:[{id:'C1',name:'Congregation One'}],access:true});assert.equal(f.doc.querySelectorAll('.register-route').length,2);f.change('[data-filter="hotel"]','H1');f.change('[data-filter="date"]','2027-07-16');register.meeting('3');assert.equal(f.doc.querySelectorAll('.register-route').length,2);assert.match(f.$('.register-route a').href,/travel-routes\/\?route=trip$/);
 f.change('[data-filter="date"]','2027-07-17');assert.equal(f.doc.querySelectorAll('.register-route').length,0);register.update({records:[],access:false});assert(!f.$('#register').textContent.includes('Second group'));f.dom.window.close();
});
test('assignment station picker groups and searches stations, and rail pins toggle while focused assignments stay visible',()=>{
 const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'),source=read('assignments/app-v3.mjs');
 const dom=new JSDOM(read('assignments/index.html')),$=id=>dom.window.document.getElementById(id);
 const locations=[{id:'1',name:'Hall',markerLabel:'1',locationType:'kingdom-hall',lat:39.8,lng:-105},...railMeetingPoints({stations:[{id:'rtd-66',name:'Osage Station',address:'1 Osage',lat:39.7,lng:-105,lines:['E']},{id:'rtd-67',name:'Union Station',address:'2 Union',lat:39.75,lng:-105,lines:['A']}]})];
 const markers=new Map(),clicks=[],layers=new Set();
 const ctx=vm.createContext({locations,markers,selectedMeetingPointId:'',focusedMeetingPointId:'',boundaryLayer:null,centerMarker:null,document:dom.window.document,map:{removeLayer:m=>layers.delete(m),hasLayer:m=>layers.has(m)},L:{divIcon:o=>o,marker:(_point,o)=>({options:o,addTo(){layers.add(this);return this;},on(){return this;},bindTooltip(){return this;},setLatLng(){},setIcon(icon){this.options.icon=icon;},setTooltipContent(){}})},els:{assignmentDestination:$('assignmentDestination'),meetingFilter:$('meetingFilter'),meetingPointList:$('meetingPointList'),meetingPointCount:$('meetingPointCount')},clean:x=>String(x||'').trim(),markerLabel:p=>p.markerLabel,escapeHtml:String,assignedCountAt:id=>id==='rtd-66'?2:0,selectMeetingPoint:id=>clicks.push(id)});
 for(const [a,b]of [['function meetingPointIcon(','function initMap('],['function syncMarkers(','function selectMeetingPoint('],['function renderMeetingPointList(','function filteredCongregations(']])vm.runInContext(source.slice(source.indexOf(a),source.indexOf(b)),ctx);
 ctx.populateMeetingPointOptions();const rail=$('assignmentDestination').querySelector('optgroup[label="Light rail / RTD stations"]');assert.equal(rail.children.length,2);assert.equal($('assignmentDestination').querySelector('optgroup[label="Current Kingdom Halls"]').children.length,1);
 $('meetingPointSearch').value='Osage';ctx.renderMeetingPointList();assert.equal($('meetingPointList').querySelectorAll('[data-point]').length,1);$('meetingPointList').querySelector('button').click();assert.deepEqual(clicks,['rtd-66']);
 ctx.syncMarkers();assert.equal(markers.size,3);assert.match(markers.get('rtd-66').options.icon.html,/rail-station/);assert.match(markers.get('rtd-66').options.icon.html,/assignment-count[^>]*>2</);
 $('showRailMeetingPoints').checked=false;ctx.syncMarkers();assert.deepEqual([...markers.keys()],['1']);ctx.focusedMeetingPointId='rtd-66';ctx.syncMarkers();assert.deepEqual([...markers.keys()],['rtd-66']);dom.window.close();
});

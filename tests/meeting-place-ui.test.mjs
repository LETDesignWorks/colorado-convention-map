import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as turf from '@turf/turf';
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
test('selecting meeting places restores saved homes after records arrive, including earlier address sets',async()=>{
 const dom=new JSDOM('<body><div class="field"><select id="hallSelect"></select></div><input id="bulkFocus" type="checkbox" checked><input id="assessorBoundaryPadding" value="0.12"></body>');
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.turf=turf;
 const geometry=turf.bboxPolygon([-105.02,39.57,-105.01,39.58]).geometry;
 const makeHome=id=>({id,address:`${id} Test St`,lat:39.575,lng:-105.015});
 let hall={id:'21',name:'Hall21',lat:39.575,lng:-105.015},congregation='A',generation=0,homes=[],territories=[],boundary=null,ready='loading';
 const main={id:'work21',recordType:'territory-plan',saveKind:'work',hallId:'21',hallName:'Hall21',congregation:'A',updatedAt:1,houseCount:2};
 const legacy={id:'legacy22',recordType:'territory-plan',addressSetMode:true,hallId:'22',hallName:'Hall22',congregation:'A',updatedAt:1,houseCount:1};
 const records=new Map([[main.id,main],[legacy.id,legacy]]),loads=[],fits=[];
 const data=()=>window.dispatchEvent(new window.Event('territory-planner:data'));
 const map={fitBounds:bounds=>fits.push(bounds),removeLayer(){}};
 globalThis.L={latLngBounds:points=>points,geoJSON:()=>({addTo(){return this;}})};
 const api={getSavedRecords:()=>records,getSavedRecordsStatus:()=>ready,getSelectedHall:()=>hall,getSelectedCongregation:()=>congregation,
  getWorkspaceGeneration:()=>generation,isAdmin:()=>true,getHouses:()=>homes,getTerritories:()=>territories,getBoundaryGeometry:()=>boundary,
  getMap:()=>map,render:data,setMeetingSearchBoundary:g=>boundary=g,saveMeetingPlaceBoundary:()=>{},
  loadPlanRecord:id=>{loads.push(id);generation++;homes=id==='work21'?[makeHome('1'),makeHome('2')]:[makeHome('3')];territories=[{id:'T1'}];boundary=structuredClone(geometry);globalThis.__denverMeetingPlaceFlow?.reset();data();return true;}};
 globalThis.__denverTerritoryPlannerAPI=api;
 let scans=0;globalThis.__denverFullBoundaryAssessor={cancel(){},async run(){scans++;return{status:'complete'};}};
 await import('../territories/meeting-place-ui.js');await tick();assert.deepEqual(loads,[]);
 ready='ready';window.dispatchEvent(new window.Event('territory-planner:saved-records'));await tick();
 assert.deepEqual(loads,['work21']);assert.equal(homes.length,2);assert.equal(document.getElementById('bulkFocus').checked,false);assert.equal(fits.length,1);
 assert.match(document.getElementById('meetingAddressStatus').textContent,/Loaded 2 addresses/);
 hall={...hall,id:'22',name:'Hall22'};generation++;homes=[];territories=[];boundary=null;data();await tick();
 assert.deepEqual(loads,['work21','legacy22']);assert.equal(homes.length,1);assert.match(document.getElementById('meetingAddressStatus').textContent,/latest earlier address set/);
 homes.push(makeHome('unsaved'));window.dispatchEvent(new window.Event('territory-planner:saved-records'));await tick();
 assert.equal(loads.length,2);assert.equal(homes.length,2);assert.equal(scans,0);
 globalThis.__denverMeetingPlaceFlow.reset();dom.window.close();
});

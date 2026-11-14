import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingAddressPin,resolveAddressPin} from '../assignments/address-pin.mjs';
import {initCongregationLocations} from '../assignments/location-ui.mjs';
import {homeFor} from '../assignments/location-model.mjs';

const hall={id:'4',name:'Wesley Ave',address:'2779 W Wesley Ave, Denver CO 80219',lat:39.67376,lng:-105.02175};
const feature=(number='2779')=>({properties:{housenumber:number,street:'West Wesley Avenue',city:'Denver',state:'Colorado',postcode:'80219',countrycode:'US'},geometry:{coordinates:[hall.lng,hall.lat]}});
test('automatic matching tolerates spelling conventions, preserves city and supplied ZIP',()=>{
 assert.equal(matchingAddressPin('2779 West Wesley Avenue, Denver, Colorado 80219',[hall]),hall);
 assert.equal(matchingAddressPin('2779 W Wesley Ave, Denver CO',[hall]),hall);
 for(const address of ['2780 W Wesley Ave, Denver CO 80219','2779 W Wesley Ave, Boulder CO 80219','2779 W Wesley Ave, Denver CO 80220','W Wesley Ave, Denver CO','2779 W Wesley Ave'])assert.equal(matchingAddressPin(address,[hall]),null);
 assert.equal(matchingAddressPin(hall.address,[hall,{...hall,lat:40}]),null);
});
test('known hall pin needs no network; exact remote match is usable; nearby alternatives are not automatic',async()=>{
 let calls=0;const lookup=async()=>{calls++;return [hall];};
 assert.equal((await resolveAddressPin(hall.address,[hall],{lookup})).pin, hall);assert.equal(calls,0);
 assert.equal((await resolveAddressPin(hall.address,[],{lookup})).pin,hall);assert.equal(calls,1);
 assert.equal((await resolveAddressPin('2778 W Wesley Ave, Denver CO 80219',[],{lookup})).pin,null);
});

class Element{
 constructor(id){this.id=id;this.value='';this.disabled=false;this.hidden=false;this.children=[];this.events={};this.classList={values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);},contains(v){return this.values.has(v);}};this.innerHTML='';}
 addEventListener(type,cb){(this.events[type]??=[]).push(cb);}
 fire(type){for(const cb of this.events[type]||[])cb({preventDefault(){},target:this});}
 querySelectorAll(){return this.id==='addressForm'?this.controls||[]:[];}
 replaceChildren(){this.children=[];}
 append(child){this.children.push(child);}
 focus(){} scrollIntoView(){this.scrolled=true;}
}
function fixture({known=[hall],fetcher=async()=>({ok:true,json:async()=>({features:[feature()]})})}={}){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 globalThis.document={getElementById:get,createElement:()=>new Element('created'),addEventListener(){}};
 const layers=[];globalThis.L={
  layerGroup:()=>{const layer={items:[],addTo(){return this;},clearLayers(){this.items=[];}};layers.push(layer);return layer;},
  divIcon:options=>options,
  marker:(coords,options)=>({coords,options,dragging:{disable(){},enable(){}},addTo(layer){layer.items?.push(this);return this;},on(){return this;},bindTooltip(){return this;},bindPopup(){return this;},getLatLng(){return {lat:coords[0],lng:coords[1]};}}),
  map:()=>({setView(){return this;},on(){},invalidateSize(){},removeLayer(){}}),
  tileLayer:()=>({addTo(){}}),
  polyline:()=>({addTo(){return this;},bindTooltip(){return this;}})
 };
 let lookups=0;globalThis.fetch=(...args)=>{lookups++;return fetcher(...args);};
 const c={id:'new',name:'New congregation',homeAddress:''},profiles=new Map(),writes=[],map={setView(coords,zoom){this.lastView={coords,zoom};},fitBounds(){},closePopup(){}};
 const resolve=c=>homeFor(c,profiles.get(c.id),known);
 const ui=initCongregationLocations({map,congregations:[c],source:{spreadsheetCount:1,file:'Test',retainedCount:0},resolveHome:resolve,isAdmin:()=>true,escapeHtml:String,getSelected:()=>new Set(),getMeetingPoint:()=>'',getVisible:()=>[],getLocations:()=>known,getAddressPoints:()=>known,getProfile:id=>profiles.get(id),getAssignment:()=>null,getStatuses:()=>new Map(),isReady:()=>true,driveState:()=>({allowed:false,label:'Not selected'}),loadDrives:async()=>{},refresh(){},toast(){},saveAssignment(){},saveAddress:async(c,values)=>{writes.push(values);profiles.set(c.id,{homeAddress:values.address,lat:values.lat,lng:values.lng});}});
 get('addressForm').controls=['homeAddress','homeLat','homeLng','addressKnown','findHomeAddress','saveHomeAddress','saveWithoutPin','cancelAddress'].map(get);
 ui.edit('new');
 return {get,ui,map,writes,profiles,layers,lookups:()=>lookups};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('saving a typed address immediately finds a pin and displays it despite a missing-address filter',async()=>{
 const f=fixture();f.get('homeAddress').value=hall.address;f.get('homeAddress').fire('input');f.get('addressForm').fire('submit');await flush();
 assert.equal(f.writes.length,1);assert.equal(f.lookups(),0);assert.equal(Number(f.writes[0].lat),hall.lat);assert.equal(f.layers[0].items.length,1);assert.deepEqual(f.map.lastView.coords,[hall.lat,hall.lng]);assert.equal(f.get('map').scrolled,true);assert.equal(f.get('addressModal').classList.contains('open'),false);
});
test('a newly entered remote address is pinned on save without requiring Find address',async()=>{
 const f=fixture({known:[]});f.get('homeAddress').value=hall.address;f.get('homeAddress').fire('input');f.get('addressForm').fire('submit');await flush();
 assert.equal(f.lookups(),1);assert.equal(f.writes.length,1);assert.equal(Number(f.writes[0].lng),hall.lng);
});
test('ambiguous lookup keeps the editor open and offers an explicit save without a pin',async()=>{
 const f=fixture({known:[],fetcher:async()=>({ok:true,json:async()=>({features:[feature('2778')]})})});
 f.get('homeAddress').value=hall.address;f.get('homeAddress').fire('input');f.get('addressForm').fire('submit');await flush();
 assert.equal(f.writes.length,0);assert.equal(f.get('saveWithoutPin').hidden,false);assert.equal(f.get('addressModal').classList.contains('open'),true);
 f.get('saveWithoutPin').fire('click');await flush();assert.equal(f.writes.length,1);assert.equal(f.writes[0].lat,'');assert.equal(f.writes[0].address,hall.address);
});
test('lookup outage does not save a guessed pin and allows retry or saving the address alone',async()=>{
 const f=fixture({known:[],fetcher:async()=>{throw Error('Offline');}});f.get('homeAddress').value=hall.address;f.get('addressForm').fire('submit');await flush();
 assert.equal(f.writes.length,0);assert.match(f.get('addressEditorStatus').textContent,/Offline/);assert.equal(f.get('saveWithoutPin').hidden,false);f.get('cancelAddress').fire('click');
});
test('manual coordinates cancel the pending automatic lookup and are preserved on save',async()=>{
 const f=fixture({known:[]});f.get('homeAddress').value=hall.address;f.get('homeAddress').fire('input');
 f.get('homeLat').value='39.5';f.get('homeLat').fire('input');f.get('homeLng').value='-105.1';f.get('homeLng').fire('input');f.get('addressForm').fire('submit');await flush();
 assert.equal(f.lookups(),0);assert.equal(f.writes[0].lat,'39.5');assert.equal(f.writes[0].lng,'-105.1');
});
test('typing automatically previews a pin, and a late lookup cannot replace a new edit',async()=>{
 const f=fixture();f.get('homeAddress').value=hall.address;f.get('homeAddress').fire('input');await new Promise(r=>setTimeout(r,950));
 assert.equal(Number(f.get('homeLat').value),hall.lat);assert.equal(f.writes.length,0);f.get('cancelAddress').fire('click');
 let finish;
 const g=fixture({known:[],fetcher:()=>new Promise(resolve=>finish=resolve)});
 g.get('homeAddress').value=hall.address;g.get('findHomeAddress').fire('click');
 g.get('homeAddress').value='123 New Street, Denver CO 80202';g.get('homeAddress').fire('input');g.get('cancelAddress').fire('click');g.ui.edit('new');
 finish({ok:true,json:async()=>({features:[feature()]})});await flush();
 assert.equal(g.get('homeLat').value,'');assert.equal(g.get('homeAddress').value,'');assert.equal(g.writes.length,0);g.get('cancelAddress').fire('click');
});

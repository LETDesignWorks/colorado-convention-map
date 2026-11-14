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


const cardAction=(container,label)=>container.children[0]?.children[2]?.children.find(button=>button.textContent===label);
const streetFeature=()=>({properties:{name:'West Wesley Avenue',city:'Denver',state:'Colorado',countrycode:'US',osm_key:'highway',type:'street'},geometry:{coordinates:[hall.lng,hall.lat]}});

test('search keeps street suggestions, excludes foreign records, and retries a missing number as a street query',async()=>{
 const {addressCandidates,findAddress}=await import('../assignments/location-model.mjs');
 const street=streetFeature();
 assert.equal(addressCandidates({features:[street]})[0].kind,'street');
 assert.equal(addressCandidates({features:[street,street]}).length,1);
 assert.equal(addressCandidates({features:[{...street,properties:{...street.properties,countrycode:'CA'}}]}).length,0);
 const queries=[];
 const results=await findAddress('2779 West Wesley Avenue, Denver CO',{fetcher:async url=>{
  queries.push(url.searchParams.get('q'));
  return {ok:true,json:async()=>({features:queries.length===1?[]:[street]})};
 }});
 assert.deepEqual(queries,['2779 West Wesley Avenue, Denver CO','West Wesley Avenue, Denver CO']);
 assert.equal(results[0].approximate,true);
 assert.equal(matchingAddressPin(results[0].address,results),null);
});

test('reverse suggestions are restricted to nearby US locations and sorted by distance',async()=>{
 const {nearbyAddresses}=await import('../assignments/location-model.mjs');
 const point={lat:hall.lat,lng:hall.lng};
 const nearby={...feature(),geometry:{coordinates:[hall.lng+.0002,hall.lat]}},far={...feature('9999'),geometry:{coordinates:[hall.lng+1,hall.lat]}};
 const results=await nearbyAddresses(point,{fetcher:async url=>{
  assert.equal(url.pathname,'/reverse');assert.equal(url.searchParams.get('radius'),'0.15');
  return {ok:true,json:async()=>({features:[far,nearby,feature(),{...feature(),properties:{...feature().properties,countrycode:'MX'}}]})};
 }});
 assert.equal(results.length,2);assert.equal(results[0].miles,0);assert.ok(results[1].miles>0);
});

test('a suggested street address can be used or its pin can keep the original typed address',async()=>{
 for(const useAddress of [false,true]){
  const f=fixture({known:[],fetcher:async()=>({ok:true,json:async()=>({features:[feature('2778')]})})});
  f.get('homeAddress').value=hall.address;f.get('findHomeAddress').fire('click');await flush();
  const label=useAddress?'Use suggested address & pin':'Pin & keep my address';
  cardAction(f.get('addressMatches'),label).fire('click');
  assert.equal(f.writes.length,0);
  assert.equal(f.get('homeAddress').value.startsWith('2778'),useAddress);
  f.get('addressForm').fire('submit');await flush();
  assert.equal(f.writes.length,1);assert.equal(Number(f.writes[0].lat),hall.lat);
  if(!useAddress)assert.equal(f.writes[0].address,hall.address);
 }
});

test('showing a street result pans the map without creating a route-eligible pin',async()=>{
 const f=fixture({known:[],fetcher:async()=>({ok:true,json:async()=>({features:[streetFeature()]})})});
 f.get('homeAddress').value=hall.address;f.get('findHomeAddress').fire('click');await flush();
 cardAction(f.get('addressMatches'),'Show area on map').fire('click');
 assert.equal(f.get('homeLat').value,'');assert.equal(f.get('homeLng').value,'');assert.equal(f.preview.zoom,15);assert.equal(f.writes.length,0);
 f.get('addressForm').fire('submit');await flush();assert.equal(f.writes.length,0);
 f.preview.fire('click',{latlng:{lat:39.6738,lng:-105.0218}});await flush();
 f.get('addressForm').fire('submit');await flush();assert.equal(f.writes.length,1);assert.equal(f.writes[0].lat,'39.6738000');
});

test('map-first placement requires an address and accepting a nearby suggestion never moves the pin',async()=>{
 const f=fixture({known:[]}),point={lat:hall.lat+.0002,lng:hall.lng+.0002};
 f.preview.fire('click',{latlng:point});await flush();
 const coords=[f.get('homeLat').value,f.get('homeLng').value];
 f.get('addressForm').fire('submit');await flush();assert.equal(f.writes.length,0);
 assert.match(f.get('addressEditorStatus').textContent,/Add the congregation meeting address/);
 cardAction(f.get('nearbyAddressMatches'),'Use this address').fire('click');
 assert.deepEqual([f.get('homeLat').value,f.get('homeLng').value],coords);
 assert.match(f.get('homeAddress').value,/2779/);
 f.get('addressForm').fire('submit');await flush();
 assert.equal(f.writes.length,1);assert.equal(Number(f.writes[0].lat),Number(point.lat.toFixed(7)));
 assert.deepEqual(f.map.lastView.coords,coords.map(Number));
});

test('manual pin and edited address can be saved even when address services are unavailable',async()=>{
 const f=fixture({known:[],fetcher:async()=>{throw Error('Offline');}});
 f.preview.fire('click',{latlng:{lat:39.7,lng:-104.9}});await flush();
 assert.match(f.get('nearbyAddressStatus').textContent,/pin is kept/);
 f.get('homeAddress').value='123 New Street, Denver CO 80202';f.get('homeAddress').fire('input');
 assert.equal(f.get('homeLat').value,'39.7000000');
 f.get('addressForm').fire('submit');await flush();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].address,'123 New Street, Denver CO 80202');assert.equal(f.writes[0].lat,'39.7000000');
});

test('map center placement requires a close view and dragging refreshes nearby suggestions',async()=>{
 const f=fixture({known:[]});
 f.get('pinMapCenter').fire('click');assert.equal(f.get('homeLat').value,'');assert.match(f.get('addressEditorStatus').textContent,/Zoom in/);
 f.preview.setView([hall.lat,hall.lng],17);f.get('pinMapCenter').fire('click');await flush();
 assert.equal(Number(f.get('homeLat').value),hall.lat);
 const marker=f.markers.at(-1);marker.coords=[hall.lat+.0003,hall.lng];marker.fire('dragend');await flush();
 assert.equal(Number(f.get('homeLat').value),Number((hall.lat+.0003).toFixed(7)));assert.equal(f.lookups(),2);
 f.get('cancelAddress').fire('click');
});

test('late reverse results cannot replace suggestions for a newer pin or reopen a closed editor',async()=>{
 const pending=[];
 const f=fixture({known:[],fetcher:()=>new Promise(resolve=>pending.push(resolve))});
 f.preview.fire('click',{latlng:{lat:hall.lat,lng:hall.lng}});
 f.preview.fire('click',{latlng:{lat:hall.lat+.0002,lng:hall.lng}});
 pending[0]({ok:true,json:async()=>({features:[feature('100')]})});await flush();
 assert.equal(f.get('nearbyAddressMatches').children.length,0);
 pending[1]({ok:true,json:async()=>({features:[feature('200')]})});await flush();
 assert.match(f.get('nearbyAddressMatches').children[0].children[0].textContent,/200/);
 assert.equal(Number(f.get('homeLat').value),Number((hall.lat+.0002).toFixed(7)));
 f.get('suggestPinAddress').fire('click');f.get('cancelAddress').fire('click');
 pending[2]({ok:true,json:async()=>({features:[feature('300')]})});await flush();
 assert.equal(f.get('addressModal').classList.contains('open'),false);assert.equal(f.writes.length,0);
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
 const layers=[],markers=[],preview={center:{lat:39.74,lng:-104.99},zoom:10,events:{},setView(coords,zoom){this.center=Array.isArray(coords)?{lat:coords[0],lng:coords[1]}:coords;this.zoom=zoom;return this;},getCenter(){return this.center;},getZoom(){return this.zoom;},on(type,handler){this.events[type]=handler;return this;},fire(type,data){this.events[type]?.(data);},invalidateSize(){},removeLayer(){}};
globalThis.L={
  layerGroup:()=>{const layer={items:[],addTo(){return this;},clearLayers(){this.items=[];}};layers.push(layer);return layer;},
  divIcon:options=>options,
  marker:(coords,options)=>{const marker={coords,options,events:{},dragging:{disable(){},enable(){}},addTo(layer){layer.items?.push(this);return this;},on(type,handler){this.events[type]=handler;return this;},fire(type){this.events[type]?.();},bindTooltip(){return this;},bindPopup(){return this;},getLatLng(){return {lat:this.coords[0],lng:this.coords[1]};}};markers.push(marker);return marker;},
  map:()=>preview,
  tileLayer:()=>({addTo(){}}),
  polyline:()=>({addTo(){return this;},bindTooltip(){return this;}})
 };
 let lookups=0;globalThis.fetch=(...args)=>{lookups++;return fetcher(...args);};
 const c={id:'new',name:'New congregation',homeAddress:''},profiles=new Map(),writes=[],map={setView(coords,zoom){this.lastView={coords,zoom};},fitBounds(){},closePopup(){}};
 const resolve=c=>homeFor(c,profiles.get(c.id),known);
 const ui=initCongregationLocations({map,congregations:[c],source:{spreadsheetCount:1,file:'Test',retainedCount:0},resolveHome:resolve,isAdmin:()=>true,escapeHtml:String,getSelected:()=>new Set(),getMeetingPoint:()=>'',getVisible:()=>[],getLocations:()=>known,getAddressPoints:()=>known,getProfile:id=>profiles.get(id),getAssignment:()=>null,getStatuses:()=>new Map(),isReady:()=>true,driveState:()=>({allowed:false,label:'Not selected'}),loadDrives:async()=>{},refresh(){},toast(){},saveAssignment(){},saveAddress:async(c,values)=>{writes.push(values);profiles.set(c.id,{homeAddress:values.address,lat:values.lat,lng:values.lng});}});
 get('addressForm').controls=['homeAddress','homeLat','homeLng','addressKnown','findHomeAddress','saveHomeAddress','saveWithoutPin','cancelAddress','pinMapCenter','suggestPinAddress'].map(get);
 ui.edit('new');
 return {get,ui,map,writes,profiles,layers,preview,markers,lookups:()=>lookups};
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

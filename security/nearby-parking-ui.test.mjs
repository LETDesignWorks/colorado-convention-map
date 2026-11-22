import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountNearbyParking} from '../assignments/parking-ui.mjs';
import {parkingRecords} from '../assignments/parking-model.mjs';
const station={id:'rtd-1',name:'Example station',lat:39.64,lng:-104.91,locationType:'rail-station'};
const snapshot=(name='Example lot')=>({...parkingRecords({elements:[{id:1,type:'node',lat:39.641,lon:-104.91,tags:{amenity:'parking',name,access:'yes',fee:'no',website:'javascript:alert(1)'}}]},station),checkedAt:Date.now(),cached:false});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(searcher){
 const dom=new JSDOM('<input id="toggle" type="checkbox"><section id="root"></section>'),document=dom.window.document,root=document.getElementById('root'),toggle=document.getElementById('toggle'),layers=[];
 const map={views:[],setView(p,z){this.views.push({p,z});},getZoom:()=>13,fitBounds(p){this.bounds=p;},removeLayer(){},getContainer:()=>({scrollIntoView(){}})};
 const L={layerGroup(){const group={items:[],addTo(){layers.push(this);return this;},clearLayers(){this.items=[];}};return group;},divIcon:o=>o,marker(point,options){return {point,options,addTo(group){group.items.push(this);return this;},bindPopup(html){this.popup=html;return this;},on(name,fn){this[name]=fn;return this;},openPopup(){this.open=true;}};}};
 const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const ui=mountNearbyParking({root,map,L,toggle,searcher,storage});
 return {dom,root,toggle,ui,map,layers,saved,el:name=>root.querySelector(`[data-parking="${name}"]`),change(node){node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}};
}
test('station selection loads parking, map and card toggles hide and restore the same layer',async()=>{
 let calls=0;const f=fixture({search:async()=>{calls++;return snapshot();}});
 assert.equal(f.root.hidden,true);assert.equal(f.toggle.disabled,true);f.ui.selectStation(station);await tick();
 assert.equal(calls,1);assert.equal(f.root.hidden,false);assert.equal(f.layers[0].items.length,1);assert.equal(f.toggle.checked,true);assert.match(f.el('status').textContent,/nearest first/);
 f.el('show').checked=false;f.change(f.el('show'));assert.equal(f.layers[0].items.length,0);assert.equal(f.toggle.checked,false);assert.equal(f.el('content').hidden,true);
 f.toggle.checked=true;f.change(f.toggle);assert.equal(f.layers[0].items.length,1);assert.equal(f.el('show').checked,true);assert.equal(calls,1);
 f.el('list').querySelector('button').click();assert.equal(f.map.views.length,1);assert.equal(f.layers[0].items[0].open,true);assert.ok(f.el('list').querySelector('.parking-selected'));
 f.el('fit').click();assert.equal(f.map.bounds.length,2);
 f.ui.selectStation({id:'hall',locationType:'kingdom-hall'});assert.equal(f.root.hidden,true);assert.equal(f.layers[0].items.length,0);assert.equal(f.toggle.disabled,true);
});
test('out-of-order results and cancelled selections cannot show pins at the wrong station',async()=>{
 const requests=[];const f=fixture({search:(point,radius,options)=>new Promise(resolve=>requests.push({point,radius,options,resolve}))});
 f.ui.selectStation(station);f.ui.selectStation({...station,id:'rtd-2',name:'Next station',lat:39.645});assert.equal(requests[0].options.signal.aborted,true);
 requests[1].resolve(snapshot('New lot'));await tick();requests[0].resolve(snapshot('Stale lot'));await tick();assert.match(f.root.textContent,/New lot/);assert.doesNotMatch(f.root.textContent,/Stale lot/);
 f.el('refresh').click();f.ui.selectStation(undefined);requests[2].resolve(snapshot('Late lot'));await tick();assert.equal(f.root.hidden,true);assert.equal(f.layers[0].items.length,0);
});
test('hide while loading cancels request and switching stations respects hidden preference',async()=>{
 const requests=[];const f=fixture({search:(_,__,o)=>new Promise(resolve=>requests.push({resolve,...o}))});f.ui.selectStation(station);
 f.toggle.checked=false;f.change(f.toggle);assert.equal(requests[0].signal.aborted,true);requests[0].resolve(snapshot());await tick();assert.equal(f.layers[0].items.length,0);
 f.ui.selectStation({...station,id:'other',lat:39.65});assert.equal(requests.length,1);assert.equal(f.el('content').hidden,true);
 f.toggle.checked=true;f.change(f.toggle);assert.equal(requests.length,2);requests[1].resolve(snapshot());await tick();assert.equal(f.layers[0].items.length,1);
});
test('radius refresh, errors, retry and empty results remain usable without fake parking pins',async()=>{
 let calls=0;const args=[];const f=fixture({search:async(_,radius,options)=>{args.push({radius,...options});if(++calls===1)throw Error('Search busy');return calls===2?{places:[],restricted:2,checkedAt:Date.now()}:snapshot();}});
 f.ui.selectStation(station);await tick();assert.match(f.el('status').textContent,/Search busy/);assert.equal(f.el('refresh').disabled,false);assert.equal(f.layers[0].items.length,0);
 f.el('refresh').click();await tick();assert.equal(args[1].refresh,true);assert.match(f.el('status').textContent,/No parking options/);assert.match(f.el('status').textContent,/2 private/);
 f.el('radius').value='1609';f.change(f.el('radius'));await tick();assert.equal(args[2].radius,1609);assert.equal(f.layers[0].items.length,1);
 f.ui.selectStation({...station});assert.equal(calls,3);
});
test('source text is escaped in cards and map popups, with honest fees and working direction links',async()=>{
 const f=fixture({search:async()=>snapshot('<img src=x onerror=alert(1)>')});f.ui.selectStation(station);await tick();
 assert.equal(f.root.querySelector('img'),null);assert.match(f.root.textContent,/<img src=x/);assert.doesNotMatch(f.layers[0].items[0].popup,/<img/);
 assert.equal(f.root.querySelector('[href^="javascript:"]'),null);assert.match(f.root.textContent,/Mapped as free — confirm/);
 const url=new URL(f.el('list').querySelector('a').href);assert.equal(url.searchParams.get('destination'),'39.64,-104.91');assert.equal(url.searchParams.get('travelmode'),'walking');
 assert.match(f.root.textContent,/RTD parking requires use of RTD transit/);
});
test('list and directions work when the map library is unavailable',async()=>{
 const dom=new JSDOM('<section></section>'),root=dom.window.document.querySelector('section');const ui=mountNearbyParking({root,searcher:{search:async()=>snapshot()}});
 ui.selectStation(station);await tick();assert.match(root.textContent,/Example lot/);assert.equal(root.querySelector('[data-parking-pin]').disabled,true);
});

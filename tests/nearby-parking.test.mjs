import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parkingRecords,parkingFee,parkingQuery,createParkingSearch,walkingUrl,safeParkingUrl,validParkingPoint} from '../assignments/parking-model.mjs';
const station={id:'rtd-test',name:'Example station',lat:39.64,lng:-104.91,locationType:'rail-station'};
const item=(id,tags={},point={lat:39.641,lon:-104.91})=>({id,type:'way',center:point,tags:{amenity:'parking',...tags}});
const data={elements:[item(1,{name:'Public lot',access:'yes',fee:'no','addr:housenumber':'100','addr:street':'Example St',capacity:'40'}),item(2,{fee:'yes',charge:'3 USD/hour'},{lat:39.642,lon:-104.91})]};
test('query validates coordinates and bounded radius without allowing injected input',()=>{
 assert.match(parkingQuery(station),/nwr\["amenity"="parking"\]\(around:805,39.64,-104.91\)/);
 for(const bad of [null,'',undefined,' ',true,'1);out;',91])assert.equal(validParkingPoint({lat:bad,lng:-104}),false);
 assert.throws(()=>parkingQuery({...station,lat:'1);out;'}));assert.throws(()=>parkingQuery(station,500000));
});
test('nearest lots retain addresses, mapped capacity, source links and access uncertainty',()=>{
 const out=parkingRecords(data,station);assert.equal(out.places.length,2);assert.equal(out.places[0].address,'100 Example St');assert.equal(out.places[0].capacity,40);
 assert.equal(out.places[0].fee.kind,'free');assert.equal(out.places[1].fee.label,'Mapped rate: 3 USD/hour');assert.match(out.places[1].access,/not recorded/);
 assert.equal(out.places[1].publicAccess,false);assert.equal(out.places[0].source,'https://www.openstreetmap.org/way/1');
});
test('private, customers, permit, motorcar and closed lots are not suggested; public tags do not override restrictions',()=>{
 const out=parkingRecords({elements:[...['private','customers','no','permit','destination'].map((access,i)=>item(i,{access,fee:'no'})),item(10,{access:'yes',motorcar:'no'}),item(11,{access:'yes',disused:'yes'}),item(12,{access:'yes','access:conditional':'no @ (Mo-Fr 08:00-18:00)'})]},station);
 assert.equal(out.restricted,6);assert.equal(out.places.length,1);assert.equal(out.places[0].publicAccess,false);assert.match(out.places[0].access,/Access conditions/);
});
test('unknown fees are never treated as free and conditional rules remain visible',()=>{
 assert.equal(parkingFee({}).kind,'unknown');assert.match(parkingFee({fee:'yes'}).label,/amount unknown/);
 assert.equal(parkingFee({fee:'no','fee:conditional':'yes @ (stay > 2 hours)'}).kind,'conditional');
 assert.match(parkingFee({fee:'no','fee:conditional':'yes @ (stay > 2 hours)'}).detail,/2 hours/);
 assert.equal(parkingFee({fee:'no',charge:'2 USD/hour'}).kind,'paid');
 assert.match(parkingFee({'charge:conditional':'4 USD @ event'}).detail,/4 USD/);
});
test('invalid coordinates, non-parking, out-of-range and duplicate features are handled',()=>{
 const out=parkingRecords({elements:[item(1),item(1),item(2,{}, {lat:40,lon:-104}),item(3,{}, {lat:null,lon:null}),item(4,{amenity:'bicycle_parking'}),{...item(5),id:'<script>'}]},station);
 assert.equal(out.places.length,1);assert.throws(()=>parkingRecords({remark:'runtime error',elements:[]},station),/complete/);
 assert.throws(()=>parkingRecords({},station));
});
test('links route from car parking to the selected station and reject unsafe operator URLs',()=>{
 const url=new URL(walkingUrl({lat:39.65,lng:-104.92},station));assert.equal(url.searchParams.get('origin'),'39.65,-104.92');assert.equal(url.searchParams.get('destination'),'39.64,-104.91');assert.equal(url.searchParams.get('travelmode'),'walking');
 for(const input of ['javascript:alert(1)','data:text/html,x','https://u:p@example.com','//example.com'])assert.equal(safeParkingUrl(input),'');
 assert.equal(safeParkingUrl('https://example.com/'),'https://example.com/');
});
test('search caches by coordinates and radius, expires after one hour and supports force refresh',async()=>{
 let clock=10000000,calls=0;const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const fetcher=async(_url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.match(options.body.get('data'),/amenity/);return {ok:true,json:async()=>data};};
 const service=createParkingSearch({fetcher,storage,now:()=>clock});
 assert.equal((await service.search(station)).cached,false);assert.equal((await service.search(station)).cached,true);assert.equal(calls,1);
 await service.search(station,805,{refresh:true});assert.equal(calls,2);await service.search(station,402);assert.equal(calls,3);
 await service.search({...station,lat:39.642});assert.equal(calls,4);
 assert.equal((await createParkingSearch({fetcher,storage,now:()=>clock}).search(station)).cached,true);assert.equal(calls,4);
 clock+=3600001;assert.equal((await service.search(station)).cached,false);assert.equal(calls,5);
});
test('failed or partial lookup is retryable and never cached as an empty success',async()=>{
 let calls=0;const service=createParkingSearch({fetcher:async()=>{calls++;return calls===1?{ok:false,status:429}:{ok:true,json:async()=>data};}});
 await assert.rejects(service.search(station),/busy/);assert.equal((await service.search(station)).places.length,2);
 const partial=createParkingSearch({fetcher:async()=>({ok:true,json:async()=>({remark:'timeout',elements:[]})})});await assert.rejects(partial.search(station),/complete/);
 const empty=createParkingSearch({fetcher:async()=>({ok:true,json:async()=>({elements:[]})})});assert.equal((await empty.search(station)).places.length,0);
});
test('cancellation and timeout stop search; storage failure does not prevent results',async()=>{
 const fetcher=async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
 const controller=new AbortController(),service=createParkingSearch({fetcher});const promise=service.search(station,805,{signal:controller.signal});controller.abort();await assert.rejects(promise,{name:'AbortError'});
 await assert.rejects(createParkingSearch({fetcher,timeoutMs:5}).search(station),/timed out/);
 const storage={getItem(){throw Error('disabled');},setItem(){throw Error('full');}};
 assert.equal((await createParkingSearch({storage,fetcher:async()=>({ok:true,json:async()=>data})}).search(station)).places.length,2);
});
test('selected meeting point render passes rail, hall and cleared selections to parking controller',()=>{
 const source=readFileSync(new URL('../assignments/app-v3.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function renderSelectedMeetingPoint()'),source.indexOf('function renderMeetingPointList()'));
 const node=()=>({textContent:'',innerHTML:'',hidden:false}),seen=[];
 const context=vm.createContext({parkingUi:{selectStation:p=>seen.push(p)},locations:[station,{id:'hall',name:'Hall'}],selectedMeetingPointId:station.id,
 els:{selectedPointTitle:node(),selectedPointCount:node(),selectedPointDetail:node(),selectedPointCongregations:node(),selectedPointActions:node(),openPointMapLink:node()},assignedCongregationsAt:()=>[],markerLabel:()=>'',approvedDestination:()=>true,escapeHtml:String,locationTypeLabel:()=>'',bindUnassignButtons(){}});
 vm.runInContext(code,context);context.renderSelectedMeetingPoint();context.selectedMeetingPointId='hall';context.renderSelectedMeetingPoint();context.selectedMeetingPointId='';context.renderSelectedMeetingPoint();
 assert.equal(seen[0].id,station.id);assert.equal(seen[1].id,'hall');assert.equal(seen[2],undefined);
});

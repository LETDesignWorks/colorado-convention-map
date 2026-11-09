import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {nextWeekday,shiftDeparture,departureCandidates,parseDenver,validateTrip,tripKey,checkedTraffic,tripSummary,tripHtml,googleDirections} from '../rush-hour/trip-model.mjs';
import {addressCandidates,roadResult,findRoad,findAddresses,fetchJson} from '../rush-hour/trip-service.mjs';
import {buildTripPdf} from '../rush-hour/trip-pdf.mjs';
import {trafficRequest,trafficResult,createTrafficClient} from '../rush-hour/trip-traffic.mjs';
const from={id:'H19',kind:'hotels',name:'Hilton Garden Inn Denver Tech Center',address:'7675 E Union Ave, Denver, CO 80237',lat:39.62914,lng:-104.8992};
const to={id:'19',kind:'meetings',name:'Aurora – Yale Ave',address:'17701 E Yale Ave, Aurora, CO 80013',lat:39.6675,lng:-104.782};
const departure='2026-11-10T07:56',base={from,to,departure,allowance:15,road:{minutes:20.2,miles:15}};
test('minute-level departures and earlier/later candidates preserve exact Denver time',()=>{
  assert.equal(shiftDeparture(departure,33),'2026-11-10T08:29');assert.equal(shiftDeparture('2026-11-10T00:05',-15),'2026-11-09T23:50');
  assert.deepEqual(departureCandidates(departure,15),['2026-11-10T07:26','2026-11-10T07:41',departure,'2026-11-10T08:11','2026-11-10T08:26']);
  assert.equal(nextWeekday(new Date('2026-11-14T18:00:00Z')),'2026-11-16');assert.throws(()=>parseDenver('2027-03-14T02:30'));assert.throws(()=>departureCandidates(departure,0));
});
test('basic road estimates never become traffic forecasts or rush-hour bus plans',()=>{
  const result=tripSummary(base);assert.equal(result.baseline,21);assert.equal(result.traffic,null);assert.equal(result.minutes,null);assert.equal(result.arrival,null);assert.match(tripHtml(result),/Pending rush-hour check/);
});
test('checked traffic is tied to exact origin, destination, direction and departure',()=>{
  const traffic=checkedTraffic(35,55,'I-225',tripKey(from,to,departure));const a=tripSummary({...base,traffic});assert.equal(a.minutes,70);assert.equal(a.arrival,'2026-11-10T16:06:00.000Z');
  assert.equal(tripSummary({...base,traffic,departure:'2026-11-10T08:29'}).minutes,null);
  assert.equal(tripSummary({...base,traffic,from:to,to:from}).minutes,null);
  assert.equal(tripSummary({...base,traffic,from:{...from,address:'Moved entrance',lat:39.7}}).minutes,null);
  assert.equal(tripSummary({...base,traffic,allowance:25}).minutes,80);
  for(const range of [['',55],[0,50],[60,40],[30,1441],[NaN,50]])assert.throws(()=>checkedTraffic(...range,'',a.key));
});
test('an earlier departure and later departure can be compared by drive and arrival independently',()=>{
  const a=tripSummary({...base,traffic:checkedTraffic(35,55,'',tripKey(from,to,departure))});
  const local='2026-11-10T08:29',b=tripSummary({...base,departure:local,traffic:checkedTraffic(20,30,'',tripKey(from,to,local))});
  assert.equal(a.minutes-b.minutes,25);assert.ok(+new Date(b.arrival)>+new Date(a.arrival));
});
test('independent-address routes and destination types are validated without old hotel assumptions',()=>{
  for(const kind of ['hotels','meetings','activities','address','rally']){validateTrip({...from,kind:'address'}, {...to,kind},departure,0);}
  assert.throws(()=>validateTrip(from,from,departure,15));assert.throws(()=>validateTrip({...from,lat:null},to,departure,15));assert.throws(()=>validateTrip(from,to,departure,''));
  const url=new URL(googleDirections(from,to));assert.equal(url.searchParams.get('origin'),from.address);assert.equal(url.searchParams.get('destination'),to.address);assert.equal(url.searchParams.has('departure_time'),false);
});
test('ambiguous address lookups keep candidates for explicit selection and ignore invalid points',async()=>{
  const feature=(lat,lng,street)=>({geometry:{coordinates:[lng,lat]},properties:{housenumber:'123',street,city:'Denver',state:'Colorado',country:'United States'}});
  const payload={features:[feature(39.7,-105,'Main St'),feature(39.8,-105,'Main Ave'),feature(null,null,'Invalid')]};
  assert.equal(addressCandidates(payload).length,2);let calls=0;const fetcher=async()=>{calls++;return{ok:true,json:async()=>payload};};
  const first=await findAddresses('123 Main St, Denver, CO',{fetcher});await findAddresses('123 MAIN ST, Denver, CO',{fetcher});assert.equal(calls,1);assert.equal(first.length,2);
});
test('road service validates results, caches direction separately and handles failed services',async()=>{
  const payload={code:'Ok',routes:[{duration:1200,distance:16093.44,geometry:{type:'LineString',coordinates:[[-104.9,39.6],[-104.78,39.66]]}}]};
  const r=roadResult(payload);assert.equal(r.minutes,20);assert.equal(r.miles,10);
  for(const value of [{},{code:'NoRoute'}, {code:'Ok',routes:[{...payload.routes[0],geometry:{type:'LineString'}}]}])assert.throws(()=>roadResult(value));
  let calls=0;const fetcher=async()=>{calls++;return{ok:true,json:async()=>payload};};await findRoad(from,to,{fetcher});await findRoad(from,to,{fetcher});await findRoad(to,from,{fetcher});assert.equal(calls,2);
  await assert.rejects(fetchJson('https://example.test',{fetcher:async()=>({ok:false,status:503})}),/503/);
});
test('trip report escapes text, includes checked comparisons and creates a branded PDF',async()=>{
  const traffic=checkedTraffic(35,55,'I-225',tripKey(from,to,departure)),s=tripSummary({...base,traffic});s.from.name='<script>test</script>';s.comparisons=[s,...departureCandidates(departure,15).filter(d=>d!==departure).map(d=>tripSummary({...base,departure:d}))];
  const html=tripHtml(s);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/Departure comparisons/);assert.match(html,/Pending Google traffic check/);
  const PDFLib=createRequire(import.meta.url)('../load-tests/vendor/pdf-lib.min.js');const result=await buildTripPdf(s,{PDFLib,ribbonAssets:{header:readFileSync('assets/print-header-sky.png'),footer:readFileSync('assets/print-footer-hills.png')}});const bytes=Buffer.from(await result.blob.arrayBuffer());const doc=await PDFLib.PDFDocument.load(bytes);assert.ok(doc.getPageCount()>=2);mkdirSync('tmp',{recursive:true});writeFileSync('tmp/hotel-address-trip.pdf',bytes);
});
test('automatic traffic requests send each exact Denver departure and enable traffic routing',()=>{
  const url=trafficRequest(from,to,departure,'test-only-key');assert.equal(url.origin,'https://api.tomtom.com');assert.equal(url.searchParams.get('departAt'),'2026-11-10T14:56:00.000Z');assert.equal(url.searchParams.get('traffic'),'true');assert.equal(url.searchParams.get('travelMode'),'car');assert.match(url.pathname,/39.62914,-104.8992:39.6675,-104.782/);
  assert.equal(trafficRequest(from,to,'2026-11-10T08:29','test-only-key').searchParams.get('departAt'),'2026-11-10T15:29:00.000Z');assert.throws(()=>trafficRequest(from,to,departure,''));
});
test('automatic estimates use returned duration and never manufacture a traffic range',async()=>{
  const now=()=>new Date('2026-11-09T18:00:00Z'),data={routes:[{summary:{travelTimeInSeconds:2130,noTrafficTravelTimeInSeconds:1200,lengthInMeters:16093.44}}]},key=tripKey(from,to,departure);
  const traffic=trafficResult(data,key,now());assert.equal(traffic.low,36);assert.equal(traffic.high,36);assert.equal(traffic.provider,'TomTom');assert.equal(tripSummary({...base,traffic}).minutes,51);assert.throws(()=>trafficResult({},key));
  let calls=0;const client=createTrafficClient({now,fetcher:async()=>{calls++;return{ok:true,json:async()=>data};}});assert.equal(client.ready(),false);await assert.rejects(client.request(from,to,departure),/key/);client.connect('test-only-key');await client.request(from,to,departure);await client.request(from,to,departure);await client.request(from,to,'2026-11-10T08:29');assert.equal(calls,2);client.disconnect();assert.equal(client.ready(),false);
  const denied=createTrafficClient({now,fetcher:async()=>({ok:false,status:403})});denied.connect('test-only-key');await assert.rejects(denied.request(from,to,departure),/denied/);await assert.rejects(denied.request(from,to,'2026-11-08T08:29'),/future/);
});

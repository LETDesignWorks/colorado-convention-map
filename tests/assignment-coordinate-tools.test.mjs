import test from 'node:test';
import assert from 'node:assert/strict';
import {formatCoordinates,parseCoordinatePair,googleSearchUrl,censusCandidates,findCensusAddress} from '../assignments/address-tools.mjs';

const sample={result:{addressMatches:[{matchedAddress:'2779 W WESLEY AVE, DENVER, CO, 80219',coordinates:{x:-105.02175,y:39.67376}}]}};
test('coordinate paste accepts copied decimal pairs and rejects incomplete, swapped and out-of-range values',()=>{
 for(const value of ['39.7392, -104.9903','(39.7392, -104.9903)','39.7392 −104.9903','39.7392; -104.9903'])assert.deepEqual(parseCoordinatePair(value),{lat:39.7392,lng:-104.9903});
 for(const value of ['', '39.7392', '39.7392,', '-104.9903, 39.7392','91, -105','39, -181','NaN, -105','https://maps.google.com/@39,-105,10z','39, -105, 10'])assert.equal(parseCoordinatePair(value),null);
 assert.equal(formatCoordinates(39.7392,-104.9903),'39.739200, -104.990300');assert.equal(formatCoordinates('',null),'');
});
test('Google links search the exact address or coordinates without adding unintended query parameters',()=>{
 const address='123 Main St & 2nd Ave, Denver CO #4';
 const url=new URL(googleSearchUrl(address));assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/maps/search/');assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('query'),address);
 assert.equal([...url.searchParams.keys()].length,2);assert.equal(googleSearchUrl(''),'');
 assert.equal(new URL(googleSearchUrl('39.7, -105')).searchParams.get('query'),'39.7, -105');
});
test('Census results retain source and street-estimate precision while excluding invalid and duplicate pins',()=>{
 const candidates=censusCandidates({result:{addressMatches:[...sample.result.addressMatches,...sample.result.addressMatches,{matchedAddress:'Invalid',coordinates:{x:0,y:100}},{coordinates:{x:-105,y:39}}]}});
 assert.equal(candidates.length,1);assert.equal(candidates[0].lat,39.67376);assert.equal(candidates[0].lng,-105.02175);assert.equal(candidates[0].precision,'street-estimate');assert.match(candidates[0].source,/Census/);
});
function transport(){
 const scripts=[],scope={},page={head:{appendChild(script){scripts.push(script);}},createElement(){return {remove(){this.removed=true;}};}};
 const callback=script=>new URL(script.src).searchParams.get('callback');
 return {scope,page,scripts,callback};
}
test('Census uses the documented browser endpoint and cleans up completed JSONP requests',async()=>{
 const t=transport(),pending=findCensusAddress('2779 W Wesley Ave, Denver CO 80219',{document:t.page,scope:t.scope});
 const script=t.scripts[0],url=new URL(script.src),callback=t.callback(script);
 assert.equal(url.origin,'https://geocoding.geo.census.gov');assert.equal(url.searchParams.get('format'),'jsonp');assert.equal(url.searchParams.get('benchmark'),'Public_AR_Current');
 t.scope[callback](sample);const result=await pending;
 assert.equal(result.length,1);assert.equal(script.removed,true);assert.equal(t.scope[callback],undefined);
});
test('Census lookup cancellation, network failures and timeout reject cleanly without a guessed pin',async()=>{
 for(const mode of ['abort','error','timeout']){
  const t=transport(),controller=new AbortController(),pending=findCensusAddress('2779 W Wesley Ave, Denver CO 80219',{document:t.page,scope:t.scope,signal:controller.signal,timeoutMs:mode==='timeout'?1:10000});
  const script=t.scripts[0],callback=t.callback(script);
  if(mode==='abort')controller.abort();if(mode==='error')script.onerror();
  await assert.rejects(pending);assert.equal(script.removed,true);assert.equal(t.scope[callback],undefined);
 }
});
test('overlapping Census lookups have separate callbacks and cannot exchange results',async()=>{
 const t=transport(),first=findCensusAddress('2779 W Wesley Ave, Denver CO',{document:t.page,scope:t.scope}),second=findCensusAddress('123 Main Street, Denver CO',{document:t.page,scope:t.scope});
 const a=t.callback(t.scripts[0]),b=t.callback(t.scripts[1]);assert.notEqual(a,b);
 t.scope[b]({result:{addressMatches:[]}});t.scope[a](sample);
 assert.equal((await first).length,1);assert.equal((await second).length,0);
});

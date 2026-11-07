import test from 'node:test';
import assert from 'node:assert/strict';
import {newTrafficPlan} from '../bus-access/traffic-model.mjs';
import {layoutViewport,projectPoint,tileJobs,streetNameTileJobs,renderBasemap,wrapText,buildTrafficPdf,PDF_LOGO_URL} from '../bus-access/traffic-pdf.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const ribbonAssets={header:readFileSync('assets/print-header-sky.png'),footer:readFileSync('assets/print-footer-hills.png')};
const plan=()=>newTrafficPlan({id:'sample',name:'Sample location',address:'Synthetic test only',lat:39.6,lng:-105});
test('the official convention logo is reused, not replaced with plain text',()=>assert.match(PDF_LOGO_URL,/assets\/denver-2027-territory-logo\.png$/));
test('full-layout fit includes off-screen items and every route point',()=>{
 const p=plan();p.view={...p.view,lat:39.7,lng:-104.5,zoom:22};p.items=[{id:'r',kind:'route',points:[[39.6,-105],[39.601,-104.998],[39.603,-104.999]]},{id:'c',kind:'cone',point:[39.599,-105.002]}];
 const v=layoutViewport(p);for(const i of p.items)for(const ll of i.points||[i.point]){const q=projectPoint(ll,v);assert.ok(q.x>=44&&q.x<=v.width-44);assert.ok(q.y>=44&&q.y<=v.height-44);}
 assert.ok(tileJobs(v,'satellite').length<=90);
});
test('empty and single-cone layouts have finite, bounded viewports',()=>{
 for(const zoom of [1,19,22]){const p=plan();p.view.zoom=zoom;for(const items of [[],[{point:[39.6,-105],kind:'cone'}]]){p.items=items;const v=layoutViewport(p);assert.ok(Number.isFinite(v.scale));assert.ok(v.scale>0);assert.ok(tileJobs(v,'street').length<=90);}}
});
test('PDF backgrounds use only the selected map provider',()=>{const v=layoutViewport(plan());assert.ok(tileJobs(v,'street').every(j=>j.url.startsWith('https://tile.openstreetmap.org/')));assert.ok(tileJobs(v,'satellite').every(j=>j.url.startsWith('https://server.arcgisonline.com/')));});
test('text wrapping splits unbroken text without dropping characters',async()=>{const doc=await PDFLib.PDFDocument.create(),font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);const source='X'.repeat(160),lines=wrapText(source,font,16,500);assert.equal(lines.join(''),source);assert.ok(lines.every(s=>font.widthOfTextAtSize(s,16)<=500));});
test('PDF export fails clearly when the required logo is unavailable',async()=>{await assert.rejects(buildTrafficPdf(plan(),{PDFLib}),/logo/);});
test('PDF export is independent of live objects and paginates long notes and names',async()=>{
 const p=plan();p.name='W'.repeat(160);p.locationName='Long location name '.repeat(8);p.notes=('Long setup note with clear pedestrian access.\n').repeat(50);p.items=[{id:'c',kind:'cone',label:'',point:[39.6,-105]},{id:'r',kind:'route',routeType:'bus',label:'Arrival',points:[[39.5999,-105],[39.6001,-105.0001]]},{id:'p',kind:'pin',pinType:'entry',label:'Entrance label',point:[39.6001,-105.0001]}];
 const before=JSON.stringify(p);const built=await buildTrafficPdf(p,{PDFLib,ribbonAssets,logoBytes:readFileSync('assets/denver-2027-territory-logo.png'),mapImage:async()=>readFileSync('load-tests/assets/bible.jpg'),unsaved:true});
 assert.equal(JSON.stringify(p),before);assert.equal(built.blob.type,'application/pdf');const doc=await PDFLib.PDFDocument.load(await built.blob.arrayBuffer());assert.ok(doc.getPageCount()>=3);assert.ok(built.filename.endsWith('-traffic-plan.pdf'));
});
test('map failure cannot silently produce a PDF with blank imagery',async()=>{await assert.rejects(buildTrafficPdf(plan(),{PDFLib,ribbonAssets,logoBytes:readFileSync('assets/denver-2027-territory-logo.png'),mapImage:async()=>{throw Error('missing tile');}}),/missing tile/);});

const isStreetNameTile=url=>url.includes('/Reference/World_Transportation/');
function basemapHarness({beforeRead=async()=>{},fail=()=>false}={}){
 const requested=[],draws=[],closed=[],messages=[];let serialized=0,active=0,maxActive=0;
 const context={scale(){},fillRect(){},drawImage(image,...box){draws.push({url:image.url,box});}};
 const canvas={getContext:()=>context,toDataURL(type){assert.equal(type,'image/jpeg');serialized++;return 'data:image/jpeg;base64,fixture';}};
 const options={
  document:{createElement(tag){assert.equal(tag,'canvas');return canvas;}},
  window:{createImageBitmap:async blob=>{const url=await blob.text();return {url,close(){closed.push(url);}};}},
  fetch:async url=>{
   const index=requested.push(url)-1;active++;maxActive=Math.max(maxActive,active);
   try{await beforeRead(url,index);return {ok:!fail(url,index),status:503,arrayBuffer:async()=>new TextEncoder().encode(url).buffer};}
   finally{active--;}
  },
  progress:message=>messages.push(message)
 };
 return {options,requested,draws,closed,messages,get serialized(){return serialized;},get maxActive(){return maxActive;}};
}

test('printed street names retain geographic registration at a readable scale and cap the native tile zoom',()=>{
 for(const viewZoom of [1,19,22]){
  const p=plan();p.view.zoom=viewZoom;const viewport=layoutViewport(p),labels=streetNameTileJobs(viewport);
  const expectedZoom=Math.max(0,Math.min(19,Math.round(Math.log2(viewport.scale))));
  assert.ok(labels.length>0&&labels.length<=90);
  for(const job of labels){
   assert.ok(isStreetNameTile(job.url));const [zoom,row,column]=job.url.split('/tile/')[1].split('/').map(Number),span=256/(2**zoom);
   assert.equal(zoom,expectedZoom);
   const westDelta=viewport.left+job.x/viewport.scale-column*span;
   assert.ok(Math.abs(westDelta-Math.round(westDelta/256)*256)<1e-10,'tile west edge matches the geographic viewport, including wrapped world copies');
   assert.ok(Math.abs(viewport.top+job.y/viewport.scale-row*span)<1e-10,'tile north edge matches the geographic viewport');
   assert.ok(Math.abs(job.size/viewport.scale-span)<1e-10,'changing label zoom retains geographic scale');
  }
  if(viewZoom===19){
   assert.equal(viewport.zoom,19);assert.equal(expectedZoom,18,'label text is not reduced by the 2.5x imagery density');
   assert.ok(labels[0].size>=180,'normal labels remain near their native printed size');
  }
  if(viewZoom===22)assert.equal(expectedZoom,19,'higher print zoom reuses available native label tiles');
 }
});

test('street names are painted after all aerial tiles even when an imagery request finishes late',async()=>{
 const viewport=layoutViewport(plan()),baseJobs=tileJobs(viewport,'satellite'),labelJobs=streetNameTileJobs(viewport);
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const h=basemapHarness({beforeRead:async(url,index)=>{if(index===0){started();await gate;}}});
 const pending=renderBasemap(viewport,'satellite',h.options);await entered;
 await new Promise(resolve=>setImmediate(resolve));
 const labelsRequestedBeforeBaseFinished=h.requested.some(isStreetNameTile);release();
 assert.equal(await pending,'data:image/jpeg;base64,fixture');
 assert.equal(labelsRequestedBeforeBaseFinished,false);
 assert.equal(h.draws.length,baseJobs.length+labelJobs.length);
 assert.ok(h.draws.slice(0,baseJobs.length).every(draw=>!isStreetNameTile(draw.url)));
 assert.ok(h.draws.slice(baseJobs.length).every(draw=>isStreetNameTile(draw.url)));
 const labelBoxes=new Map(labelJobs.map(job=>[job.url,[job.x,job.y,job.size,job.size]]));
 for(const draw of h.draws.slice(baseJobs.length))assert.deepEqual(draw.box,labelBoxes.get(draw.url));
 assert.ok(h.maxActive>1&&h.maxActive<=8);assert.equal(h.closed.length,h.draws.length);assert.equal(h.serialized,1);
 assert.ok(h.messages.some(message=>message.startsWith('Adding street names')));
});

test('the street-map PDF background retains its built-in names without requesting the satellite overlay',async()=>{
 const viewport=layoutViewport(plan()),h=basemapHarness();
 await renderBasemap(viewport,'street',h.options);
 assert.equal(h.requested.length,tileJobs(viewport,'street').length);
 assert.ok(h.requested.every(url=>url.startsWith('https://tile.openstreetmap.org/')));
 assert.ok(h.draws.every(draw=>!isStreetNameTile(draw.url)));assert.equal(h.serialized,1);
 assert.ok(!h.messages.some(message=>message.startsWith('Adding street names')));
});

test('a missing street-name tile stops export before an incomplete satellite background can be returned',async()=>{
 const viewport=layoutViewport(plan()),h=basemapHarness({fail:isStreetNameTile});
 await assert.rejects(renderBasemap(viewport,'satellite',h.options),/street-name tiles.*No incomplete PDF.*Street map/);
 assert.equal(h.draws.length,tileJobs(viewport,'satellite').length,'the successful aerial pass is not returned without the names');
 assert.equal(h.serialized,0);
});

test('failed aerial imagery stops before any street-name requests or background serialization',async()=>{
 const viewport=layoutViewport(plan()),h=basemapHarness({fail:url=>!isStreetNameTile(url)});
 await assert.rejects(renderBasemap(viewport,'satellite',h.options),/map background tiles.*No incomplete PDF/);
 assert.ok(!h.requested.some(isStreetNameTile));assert.equal(h.draws.length,0);assert.equal(h.serialized,0);
});

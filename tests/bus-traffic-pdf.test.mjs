import test from 'node:test';
import assert from 'node:assert/strict';
import {newTrafficPlan} from '../bus-access/traffic-model.mjs';
import {layoutViewport,projectPoint,tileJobs,wrapText,buildTrafficPdf,PDF_LOGO_URL} from '../bus-access/traffic-pdf.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
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
 const before=JSON.stringify(p);const built=await buildTrafficPdf(p,{PDFLib,logoBytes:readFileSync('assets/denver-2027-territory-logo.png'),mapImage:async()=>readFileSync('load-tests/assets/bible.jpg'),unsaved:true});
 assert.equal(JSON.stringify(p),before);assert.equal(built.blob.type,'application/pdf');const doc=await PDFLib.PDFDocument.load(await built.blob.arrayBuffer());assert.ok(doc.getPageCount()>=3);assert.ok(built.filename.endsWith('-traffic-plan.pdf'));
});
test('map failure cannot silently produce a PDF with blank imagery',async()=>{await assert.rejects(buildTrafficPdf(plan(),{PDFLib,logoBytes:readFileSync('assets/denver-2027-territory-logo.png'),mapImage:async()=>{throw Error('missing tile');}}),/missing tile/);});

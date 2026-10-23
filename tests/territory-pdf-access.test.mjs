import { inflateSync } from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as turf from '@turf/turf';
import { jsPDF } from 'jspdf';
import { createSavedPdfView } from '../territories/saved-pdf-view.js';
import { scopePdfAddresses, duplicatePdfIssues, addPdfReviewPages, stampPdfReview } from '../territories/pdf-boundary-scope.js';
import { buildReviewedVersionPdf, preparePdfAddressSnapshot } from '../territories/pdf-address-review.js';

const shape = { type:'Polygon', coordinates:[[[-105.01,39.54],[-105,39.54],[-105,39.55],[-105.01,39.55],[-105.01,39.54]]] };
const home=(id,extra={})=>({id,address:`${10000+Number(id||0)} Example St`,territoryId:'24',included:true,lat:39.545,lng:-105.005,...extra});
const snapshot=(houses=[home('1')])=>({hall:{id:'21',name:'Test meeting place'},congregation:'Test congregation',territory:{id:'24',name:'Territory 24',geometry:shape,houseIds:houses.filter(h=>!h.avoid).map(h=>h.id)},houses});
const options={isMapped:h=>h.lat!=null&&h.lng!=null&&Number.isFinite(+h.lat)&&Number.isFinite(+h.lng),contains:(h,g)=>turf.booleanPointInPolygon(turf.point([h.lng,h.lat]),g),houseNumber:h=>/^\d+/.exec(h.address)?.[0]};
const version=()=>({id:'version-24',hallId:'21',congregation:'Test',territory:snapshot().territory,houses:snapshot().houses,pdfRecord:{id:'archive',filename:'original.pdf'}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness(buildPdf=async()=>({blob:new Blob(['pdf']),filename:'24.pdf'}),readPdf=async()=>new Blob(['old'])) {
 const dom=new JSDOM('<main></main>'),d=dom.window.document;let active=true;const revoked=[];let serial=0;
 const viewer=createSavedPdfView({document:d,isActive:()=>active,buildPdf,readPdf,urlApi:{createObjectURL:()=>`blob:test-${++serial}`,revokeObjectURL:u=>revoked.push(u)}});
 function bind(v=version()) {
  d.querySelector('main').innerHTML='<button id="view">View PDF</button><button id="original">Original</button><button id="review" hidden>Review</button><p id="status"></p><div id="links"></div>';
  const nodes={button:d.getElementById('view'),originalButton:d.getElementById('original'),reviewButton:d.getElementById('review'),status:d.getElementById('status'),links:d.getElementById('links')};
  viewer.bind(v,nodes);return nodes;
 }
 return {dom,d,viewer,bind,revoked,deactivate:()=>{active=false;viewer.clear();}};
}

test('PDF request survives a harmless saved-list redraw while generating',async()=>{
 let finish;let calls=0;const h=harness(async(v,status)=>{calls++;status.textContent='Building both maps';return await new Promise(r=>finish=r);});
 h.bind().button.click();assert.equal(h.d.getElementById('view').disabled,true);
 h.bind({...version()});assert.equal(h.d.getElementById('status').textContent,'Building both maps');assert.equal(h.d.getElementById('view').disabled,true);
 finish({blob:new Blob(['pdf']),filename:'24.pdf'});await tick();assert.equal(calls,1);assert.equal(h.d.querySelector('#links a[download]').download,'24.pdf');assert.equal(h.d.getElementById('view').disabled,false);h.dom.window.close();
});
test('completed links survive repeated harmless map and saved-record updates',async()=>{
 const h=harness();h.bind().button.click();await tick();const url=h.d.querySelector('#links a').href;
 for(let i=0;i<5;i++)h.bind();assert.equal(h.d.querySelector('#links a').href,url);assert.deepEqual(h.revoked,[]);h.deactivate();assert.deepEqual(h.revoked,[url]);h.dom.window.close();
});
test('different territory selection cannot receive a late PDF result',async()=>{
 let finish;const h=harness(async()=>new Promise(r=>finish=r));h.bind().button.click();h.bind({...version(),id:'other-version'});
 finish({blob:new Blob(['pdf']),filename:'24.pdf'});await tick();assert.equal(h.d.querySelector('#links a'),null);h.dom.window.close();
});
test('changed boundary under the same ID invalidates the prior PDF',async()=>{
 const h=harness();h.bind().button.click();await tick();const v=version();v.territory={...v.territory,geometry:{type:'Polygon',coordinates:[shape.coordinates[0].map(([x,y])=>[x+.001,y])]}};
 h.bind(v);assert.equal(h.d.querySelector('#links a'),null);assert.equal(h.revoked.length,1);h.dom.window.close();
});
test('sign-out discards an in-flight result and never publishes a link',async()=>{
 let finish;const h=harness(async()=>new Promise(r=>finish=r));h.bind().button.click();h.deactivate();finish({blob:new Blob(['pdf']),filename:'24.pdf'});await tick();assert.equal(h.d.querySelector('#links a'),null);h.dom.window.close();
});
test('original archive is an explicit independent action after generation fails',async()=>{
 let reads=0;const h=harness(async()=>{throw new Error('addresses need repair');},async record=>{reads++;assert.equal(record.id,'archive');return new Blob(['old']);});
 const nodes=h.bind();nodes.button.click();await tick();assert.equal(reads,0);assert.match(nodes.status.textContent,/addresses need repair/);
 nodes.originalButton.click();await tick();assert.equal(reads,1);assert.match(nodes.status.textContent,/earlier saved file/);assert.equal(nodes.links.querySelector('a[download]').download,'original.pdf');h.dom.window.close();
});
test('review copy requires its own action and never silently bypasses duplicate review',async()=>{
 const requests=[];const h=harness(async(v,p,opts)=>{requests.push(opts.allowReviewCopy);if(!opts.allowReviewCopy)throw Object.assign(Error('possible duplicates'),{code:'PDF_REVIEW_REQUIRED'});return{blob:new Blob(['review']),filename:'24-REVIEW.pdf',reviewCopy:true};});
 const n=h.bind();n.button.click();await tick();assert.deepEqual(requests,[false]);assert.equal(n.reviewButton.hidden,false);assert.equal(n.links.children.length,0);
 n.reviewButton.click();await tick();assert.deepEqual(requests,[false,true]);assert.match(n.status.textContent,/REVIEW COPY ready/);assert.equal(n.links.querySelector('a[download]').download,'24-REVIEW.pdf');h.dom.window.close();
});
test('a failed PDF request leaves retry and original actions usable',async()=>{
 let fail=true;const h=harness(async()=>{if(fail)throw Error('offline');return{blob:new Blob(['pdf']),filename:'retry.pdf'};});const n=h.bind();n.button.click();await tick();assert.equal(n.button.disabled,false);assert.equal(n.originalButton.disabled,false);fail=false;n.button.click();await tick();assert.equal(n.links.querySelector('a[download]').download,'retry.pdf');h.dom.window.close();
});
test('a trimmed territory prints only inside homes and reports retained outside assignments',()=>{
 const s=snapshot([home('1'),home('2',{lat:39.56}),home('3',{avoid:true,included:false,territoryId:null}),home('4',{lat:39.56,avoid:true,territoryId:null,included:false})]);const before=JSON.stringify(s),r=scopePdfAddresses(s,shape,options);
 assert.deepEqual(r.homes.map(h=>h.id),['1']);assert.deepEqual(r.avoids.map(h=>h.id),['3']);assert.equal(r.issues.length,2);assert.match(r.issues[1].reason,/AVOID/);assert.equal(JSON.stringify(s),before);
});
test('excluded, wrong-assignment, unmapped and numberless records remain accounted for',()=>{
 const s=snapshot([home('1'),home('2',{included:false}),home('3',{territoryId:'5'}),home('4',{lat:null}),home('5',{address:'No number'})]);const r=scopePdfAddresses(s,shape,options);assert.equal(r.homes.length,1);assert.equal(r.issues.length,4);assert.equal(r.homes.length+r.avoids.length+r.issues.length,s.houses.length);
});
test('trimmed MultiPolygon holes and every retained component are respected',()=>{
 const hole=[[-105.006,39.544],[-105.004,39.544],[-105.004,39.546],[-105.006,39.546],[-105.006,39.544]];
 const multi={type:'MultiPolygon',coordinates:[[shape.coordinates[0],hole],shape.coordinates.map(r=>r.map(([x,y])=>[x+.03,y]))]};
 const s=snapshot([home('1'),home('2',{lng:-105.008}),home('3',{lng:-104.975})]);const r=scopePdfAddresses(s,multi,options);assert.deepEqual(r.homes.map(h=>h.id),['2','3']);assert.equal(r.issues.length,1);
});
test('unresolved duplicates remain intact in an explicitly requested review copy',async()=>{
 const h=[home('1'),home('2',{address:home('1').address,lat:39.7})],s=snapshot(h),v={...version(),houses:h,territory:s.territory};let built=0;const before=JSON.stringify(v);
 await assert.rejects(buildReviewedVersionPdf(v,s.hall,{}, {readPdf:async()=>{throw Error('not read');},buildPdf:async()=>built++}),e=>e.code==='PDF_REVIEW_REQUIRED');
 const result=await buildReviewedVersionPdf(v,s.hall,{}, {allowReviewCopy:true,readPdf:async()=>{throw Error('not read');},buildPdf:async snap=>{built++;assert.equal(snap.pdfReviewCopy,true);assert.equal(snap.houses.length,2);return{blob:'review',reviewCopy:true};}});
 assert.equal(built,1);assert.equal(result.reviewCopy,true);assert.equal(JSON.stringify(v),before);
});
test('unreadable archive falls back to the exact saved data without loading the map',async()=>{
 const v=version();let built=0;const r=await buildReviewedVersionPdf(v,{id:'21'}, {},{readPdf:async()=>{throw Error('missing chunk');},buildPdf:async s=>{built++;assert.equal(s.territory.id,'24');return{blob:'new',filename:'new.pdf'};}});assert.equal(built,1);assert.equal(r.archiveReadFailed,true);assert.equal(r.regenerated,true);
});
test('review appendix paginates long records without clipping the footer',()=>{
 const doc=new jsPDF({orientation:'landscape',unit:'in',format:'letter'});const issues=Array.from({length:80},(_,i)=>({address:`${i} Example Street ${'Unit information '.repeat(6)}`,avoid:i===4,reason:'Outside selected boundary; retained in saved work.'}));
 addPdfReviewPages(doc,issues,()=>{});assert.ok(doc.getNumberOfPages()>3);stampPdfReview(doc,doc.getNumberOfPages());const text=doc.output();assert.match(text,/REVIEW COPY/);assert.match(text,/DO NOT VISIT/);assert.match(text,/79 Example Street/);
});
test('production renderer builds a review PDF for a clipped tail without altering any source record',async()=>{
 const source=fs.readFileSync('territories/territory-flex-grouping-pdf.js','utf8');const start=source.indexOf('export async function buildTerritoryPdf(');const end=source.indexOf('\nasync function generateTerritoryPdf(',start);const code=source.slice(start,end).replace('export async function','async function');
 const s=snapshot([home('1'),home('2',{lat:39.56}),home('3',{avoid:true,included:false,territoryId:null,lat:39.56})]),before=JSON.stringify(s),mapCalls=[];
 const context={preparePdfAddressSnapshot,scopePdfAddresses,duplicatePdfIssues,addPdfReviewPages,stampPdfReview,JSON,sortedByAddress:h=>h,validCoordinates:options.isMapped,pdfHouseNumber:options.houseNumber,territoryGeometry:t=>t.geometry,geometryRings:g=>g.coordinates,pointInsideGeometry:options.contains,
  globalThis:{jspdf:{jsPDF}},LOGO_URL:'test',imageCanvasData:async()=>'',buildStreetMapImage:async(t,h,a)=>{mapCalls.push([h.map(x=>x.id),a.map(x=>x.id)]);return{dataUrl:'test-map'};},loadNearbyCoffee:async()=>({shops:[]}),sleepFrame:async()=>{},
  drawTerritoryMapPage:(doc,logo,t,h,a,map,hall,congregation,label)=>{doc.text(label,1,1.4);doc.text(`${h.length} homes`,1,1.7);},addAddressListPages:(doc,logo,t,h)=>{doc.addPage();doc.text(h.map(x=>x.address),1,1.4);},addAvoidPages(){},pdfHeader(){},drawNearbyCoffeePage(){},pdfFooter(){},clean:v=>String(v||'').trim(),PDF_LAYOUT_VERSION:33};
 vm.createContext(context);vm.runInContext(code+'\nthis.build=buildTerritoryPdf;',context);const built=await context.build(s,{});assert.equal(JSON.stringify(s),before);assert.equal(built.reviewCopy,true);assert.match(built.filename,/-REVIEW.pdf$/);assert.equal(built.reviewIssues.length,2);assert.equal(built.snapshot.houses.length,1);assert.equal(mapCalls.length,2);assert.ok(mapCalls.every(([h,a])=>h.length===1&&a.length===0));
 const bytes=Buffer.from(await built.blob.arrayBuffer());const streams=[...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m=>inflateSync(Buffer.from(m[1],'latin1')).toString('latin1')).join('\n');assert.match(streams,/REVIEW COPY/);assert.match(streams,/DO NOT VISIT/);fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/territory24-review-fixture.pdf',bytes);
});
test('saved viewer is mounted and no longer discards links at every detail render',()=>{
 const source=fs.readFileSync('territories/saved-territories-layer.js','utf8');assert.match(source,/createSavedPdfView/);assert.match(source,/pdfView.bind/);const detail=source.slice(source.indexOf('  function renderDetail()'),source.indexOf('  function fit(target)'));assert.doesNotMatch(detail,/^\s*revokeUrls\(\);/m);assert.match(source,/openOriginalTerritoryPdf/);assert.match(source,/createReviewTerritoryPdf/);
});

test('PDF duplicate failure offers a direct read-only route into the selected version checker',async()=>{
 const dom=new JSDOM('<button id="view"></button><button id="review"></button><button id="resolve"></button><p id="status"></p><div id="links"></div>'),d=dom.window.document;let checked=null,reads=0;
 const viewer=createSavedPdfView({document:d,isActive:()=>true,reviewDuplicates:async v=>checked=v,readPdf:async()=>{reads++;},buildPdf:async()=>{throw Object.assign(Error('14 duplicates'),{code:'PDF_REVIEW_REQUIRED'});},urlApi:{revokeObjectURL(){},createObjectURL(){return 'blob:test'}}});
 const v=version(),nodes={button:d.getElementById('view'),reviewButton:d.getElementById('review'),resolveButton:d.getElementById('resolve'),status:d.getElementById('status'),links:d.getElementById('links')};viewer.bind(v,nodes);assert.equal(nodes.resolveButton.hidden,true);nodes.button.click();await tick();assert.equal(nodes.resolveButton.hidden,false);assert.match(nodes.status.textContent,/Review and clean duplicates/);nodes.resolveButton.click();await tick();assert.equal(checked,v);assert.equal(reads,0);assert.equal(nodes.links.children.length,0);dom.window.close();
});
test('review-copy success explicitly warns that duplicates remain and retains cleanup action',async()=>{
 const dom=new JSDOM('<button id="view"></button><button id="review"></button><button id="resolve"></button><p id="status"></p><div id="links"></div>'),d=dom.window.document;
 const viewer=createSavedPdfView({document:d,isActive:()=>true,reviewDuplicates:async()=>{},readPdf:async()=>{},buildPdf:async(v,p,o)=>{if(!o.allowReviewCopy)throw Object.assign(Error('14 duplicates'),{code:'PDF_REVIEW_REQUIRED'});return{blob:new Blob(['review']),filename:'review.pdf',reviewCopy:true};},urlApi:{revokeObjectURL(){},createObjectURL(){return 'blob:test'}}});
 const nodes={button:d.getElementById('view'),reviewButton:d.getElementById('review'),resolveButton:d.getElementById('resolve'),status:d.getElementById('status'),links:d.getElementById('links')};viewer.bind(version(),nodes);nodes.button.click();await tick();nodes.reviewButton.click();await tick();assert.equal(nodes.resolveButton.hidden,false);assert.match(nodes.status.textContent,/unresolved duplicate rows may still be included/);dom.window.close();
});

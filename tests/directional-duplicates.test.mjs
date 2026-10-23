import { scopePdfAddresses, duplicatePdfIssues, addPdfReviewPages, stampPdfReview } from '../territories/pdf-boundary-scope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { duplicateAddressIdentity as identity, scanDuplicateAddresses as scan, cleanDuplicateAddresses as clean } from '../territories/address-duplicates.js';
import { preparePdfAddressSnapshot, buildReviewedVersionPdf } from '../territories/pdf-address-review.js';
const home = (id, address = '30001 Sample Cir Test City CO 80001', extra = {}) => ({ id, address, lat:39.54, lng:-104.93, included:true, territoryId:'13', ...extra });
const work = houses => ({hallId:'21',congregation:'Example', houses, territories:[{id:'13',name:'Territory 13',houseIds:houses.filter(h=>!h.avoid).map(h=>h.id)}],boundary:null});
const snapshot = houses => ({hall:{id:'21',name:'Example Hall'},congregation:'Example',territory:work(houses).territories[0],houses});
const alias = () => [home('plain'),home('direction','30001 S Sample Circle, Test City, CO, 80001',{lat:39.540001})];

test('missing S is a location-confirmed duplicate candidate without equating exact street identities',()=>{
 const h=alias();assert.notEqual(identity(h[0]).key,identity(h[1]).key);const r=scan(h,work(h).territories);
 assert.equal(r.groups.length,1);assert.equal(r.safe,1);assert.equal(r.groups[0].missingDirection,true);assert.match(r.groups[0].reasons.join(' '),/omits a street direction/);
});
test('prefer directional address, retain source information, and rebuild house IDs',()=>{
 const h=alias();h[0].source='Upload';h[1].source='GIS';const w=work(h),before=JSON.stringify(w),r=clean(w);
 assert.equal(r.removed,1);assert.equal(r.draft.houses[0].id,'direction');assert.match(r.draft.houses[0].address,/S Sample/);
 assert.match(r.draft.houses[0].source,/Upload.*GIS/);assert.deepEqual(r.draft.territories[0].houseIds,['direction']);assert.equal(JSON.stringify(w),before);
});
test('the reported 45-row pattern with nine missing-direction copies produces 36 unique homes',()=>{
 const circle=Array.from({length:17},(_,i)=>home(`plain${i}`,`${30001+i} SAMPLE CIR TEST CITY CO 80001`,{lat:39.54+i*.0002}));
 const place=Array.from({length:18},(_,i)=>home(`place${i}`,`${20001+i} SAMPLE PL TEST CITY CO 80001`,{lat:39.55+i*.0002}));
 const copies=circle.filter((_,i)=>i%2===0).map(h=>({...h,id:`copy${h.id}`,address:h.address.replace(' SAMPLE CIR',' S SAMPLE CIR'),lat:h.lat+.000001}));
 const houses=[...circle,...place,...copies,home('other','1999 Example Rd, Test City CO 80001')];
 assert.equal(houses.length,45);assert.equal(scan(houses).duplicates,9);const r=clean(work(houses));assert.equal(r.draft.houses.length,36);assert.equal(r.remaining.groups.length,0);
 const p=preparePdfAddressSnapshot(snapshot(houses));assert.equal(p.removed,9);assert.equal(p.snapshot.houses.length,36);assert.equal(p.snapshot.territory.houseIds.length,36);assert.equal(houses.length,45);
});
for(const direction of ['N','S','E','W','NE','NW','SE','SW']) test(`missing ${direction} is matched with corroborating location`,()=>{
 assert.equal(scan([home('a'),home('b',`30001 ${direction} Sample Cir, Test City CO 80001`)]).safe,1);
});
test('full spelled direction and postfix direction candidates are supported',()=>{
 assert.equal(scan([home('a'),home('b','30001 South Sample Circle, Test City CO 80001')]).safe,1);
 assert.equal(scan([home('a'),home('b','30001 Sample Cir S, Test City CO 80001')]).safe,1);
});
test('N and S remain different even at the same map point',()=>assert.equal(scan([home('n','30001 N Sample Cir Test City CO 80001'),home('s','30001 S Sample Cir Test City CO 80001')]).groups.length,0));
test('an undirected address cannot bridge explicit N and S addresses into a safe group',()=>{
 const w=work([home('a'),home('n','30001 N Sample Cir Test City CO 80001'),home('s','30001 S Sample Cir Test City CO 80001')]);const r=scan(w.houses,w.territories);
 assert.equal(r.safe,0);assert.equal(r.groups[0].directionConflict,true);assert.equal(clean(w).removed,0);
 assert.throws(()=>clean(w,{decisions:{[r.groups[0].key]:{keepIndex:0}}}),/Different N\/S\/E\/W/);
});
test('North Street is not treated as a missing directional prefix',()=>assert.equal(scan([home('a','30001 North St, Test City CO 80001'),home('b','30001 St, Test City CO 80001')]).groups.length,0));
test('different apartment and building identifiers remain separate for directional candidates',()=>{
 assert.equal(scan([home('a','30001 Sample Cir Apt 1 Test City CO 80001'),home('b','30001 S Sample Cir Apt 2 Test City CO 80001')]).groups.length,0);
 assert.equal(scan([home('a','30001 Sample Cir Bldg A Apt 1 Test City CO 80001'),home('b','30001 S Sample Cir Bldg B Apt 1 Test City CO 80001')]).groups.length,0);
});
test('different cities, conflicting ZIPs, distant or missing map locations require review',()=>{
 for(const other of [home('b','30001 S Sample Cir Other City CO 80001'),home('b','30001 S Sample Cir Test City CO 80002'),home('b','30001 S Sample Cir Test City CO 80001',{lat:39.56}),home('b','30001 S Sample Cir Test City CO 80001',{lat:null})]){
  const w=work([home('a'),other]);assert.equal(scan(w.houses).groups.length,1);assert.equal(scan(w.houses).safe,0);assert.equal(clean(w).removed,0);
 }
});
test('missing direction without any locality data cannot be silently merged',()=>{
 const h=[home('a','30001 Sample Cir'),home('b','30001 S Sample Cir')];assert.equal(scan(h).safe,0);assert.equal(scan(h).groups.length,1);
});
test('short directionless and complete direction versions remain reviewable without inventing a locality',()=>{
 const h=[home('a','30001 Sample Cir'),alias()[1]];assert.equal(scan(h).safe,0);assert.equal(scan(h).duplicates,1);
});
test('directional cleanup retains avoid/exclusion flags even when keeping the normal GIS spelling',()=>{
 const h=alias();h[0].avoid=true;h[0].included=false;h[0].territoryId=null;h[0].avoidTerritoryId='13';const r=clean(work(h));
 assert.equal(r.removed,1);assert.equal(r.draft.houses[0].avoid,true);assert.equal(r.draft.houses[0].included,false);assert.equal(r.draft.houses[0].territoryId,null);assert.equal(r.draft.territories[0].houseIds.length,0);
});
test('cross-territory directional duplicates require an explicit assignment decision',()=>{
 const h=alias();h[1].territoryId='5';const w=work(h);w.territories=[{id:'13',houseIds:['plain']},{id:'5',houseIds:['direction']}];const r=scan(h,w.territories,'13');
 assert.equal(r.groups[0].confirmed,true);assert.equal(r.safe,0);assert.equal(clean(w).removed,0);
 const fixed=clean(w,{decisions:{[r.groups[0].key]:{keepIndex:1,territoryId:'13'}}});assert.equal(fixed.removed,1);assert.equal(fixed.draft.houses[0].territoryId,'13');
});
test('historical PDF is regenerated from clean data instead of returning stale archive bytes',async()=>{
 const h=alias(),s=snapshot(h),v={hallId:'21',territory:s.territory,congregation:'Example',houses:h,pdfRecord:{filename:'old.pdf'}},before=JSON.stringify(v);let reads=0,builds=0;
 const built=await buildReviewedVersionPdf(v,s.hall,{}, {readPdf:async()=>{reads++;return'old';},buildPdf:async clean=>{builds++;assert.equal(clean.houses.length,1);return{blob:'new',filename:'new.pdf'};}});
 assert.equal(reads,0);assert.equal(builds,1);assert.equal(built.blob,'new');assert.equal(built.duplicatesRemoved,1);assert.equal(built.originalArchiveRetained,true);assert.equal(JSON.stringify(v),before);
});
test('clean archived PDF is returned exactly without a needless redraw',async()=>{
 const h=[home('a')],s=snapshot(h);let builds=0;const r=await buildReviewedVersionPdf({territory:s.territory,houses:h,pdfRecord:{filename:'exact.pdf'}},s.hall,{}, {readPdf:async()=> 'exact',buildPdf:async()=>{builds++;}});
 assert.equal(r.blob,'exact');assert.equal(r.regenerated,false);assert.equal(builds,0);
});
test('ambiguous directional PDF cannot silently merge distant homes or serve the duplicate archive',async()=>{
 const h=alias();h[1].lat=40;const s=snapshot(h);let reads=0,builds=0;
 await assert.rejects(()=>buildReviewedVersionPdf({territory:s.territory,houses:h,pdfRecord:{}},s.hall,{}, {readPdf:async()=>reads++,buildPdf:async()=>builds++}),/possible duplicate.*review/);
 assert.equal(reads,0);assert.equal(builds,0);
});
test('PDF data preparation never rewrites saved addresses, boundaries or units',()=>{
 const s=snapshot(alias());s.territory.geometry={type:'Polygon',coordinates:[]};const before=JSON.stringify(s),r=preparePdfAddressSnapshot(s);
 assert.equal(JSON.stringify(s),before);assert.deepEqual(r.snapshot.territory.geometry,s.territory.geometry);assert.equal(r.snapshot.houses.length,1);
});
test('both production PDF entry paths invoke the shared guard',()=>{
 const source=fs.readFileSync(new URL('../territories/territory-flex-grouping-pdf.js',import.meta.url),'utf8');assert.match(source,/const reviewed = preparePdfAddressSnapshot\(sourceSnapshot\)/);assert.match(source,/const snapshot = reviewed.snapshot/);
 const main=fs.readFileSync(new URL('../territories/app-main.js',import.meta.url),'utf8');const fn=main.slice(main.indexOf('async function libraryVersionPdf('),main.indexOf('\nlet hallSelectionSequence'));
 assert.match(fn,/buildReviewedVersionPdf/);assert.doesNotMatch(fn,/if \(version.pdfRecord\) return/);
 const layer=fs.readFileSync(new URL('../territories/saved-territories-layer.js',import.meta.url),'utf8');assert.match(layer,/pdfView.bind/);assert.match(fs.readFileSync(new URL('../territories/saved-pdf-view.js',import.meta.url),'utf8'),/REVIEW COPY ready/);
});
test('full PDF renderer receives unique rows for both maps and the address list',async()=>{
 const source=fs.readFileSync(new URL('../territories/territory-flex-grouping-pdf.js',import.meta.url),'utf8');
 const a=source.indexOf('export async function buildTerritoryPdf('),b=source.indexOf('\nasync function generateTerritoryPdf(',a);const code=source.slice(a,b).replace('export async function','async function');
 const rows=[],mapRows=[],s=snapshot(alias());
 const context={scopePdfAddresses, duplicatePdfIssues, addPdfReviewPages, stampPdfReview, geometryRings:()=>[[]], preparePdfAddressSnapshot,JSON,sortedByAddress:h=>h,validCoordinates:()=>true,pdfHouseNumber:h=>h.address.split(' ')[0],territoryGeometry:()=>({type:'Polygon',coordinates:[]}),pointInsideGeometry:()=>true,relevantAvoids:h=>h,
  globalThis:{jspdf:{jsPDF:class{addPage(){}getNumberOfPages(){return 3;}setPage(){}output(){return'pdf-bytes';}}}},LOGO_URL:'logo',imageCanvasData:async()=>'',
  buildStreetMapImage:async(t,h)=>{mapRows.push(h.map(v=>v.id));return{dataUrl:'tile'};},loadNearbyCoffee:async()=>({shops:[]}),sleepFrame:async()=>{},
  drawTerritoryMapPage:(doc,logo,t,h)=>rows.push(['map',h.map(v=>v.id)]),addAddressListPages:(doc,logo,t,h)=>rows.push(['list',h.map(v=>v.id)]),addAvoidPages(){},pdfHeader(){},drawNearbyCoffeePage(){},pdfFooter(){},clean:v=>String(v||'').trim(),PDF_LAYOUT_VERSION:33};
 vm.createContext(context);vm.runInContext(code+'\nthis.build=buildTerritoryPdf;',context);const r=await context.build(s,{});
 assert.equal(r.duplicatesRemoved,1);assert.equal(r.snapshot.houses.length,1);assert.equal(mapRows.length,2);for(const list of mapRows)assert.equal(list.length,1);assert.equal(rows.length,3);assert.ok(rows.every(([,ids])=>ids.length===1));
});

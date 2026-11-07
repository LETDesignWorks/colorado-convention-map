import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {newTrafficPlan,MAX_PARKING_SPACES} from '../bus-access/traffic-model.mjs';
import {buildTrafficPdf,layoutViewport,projectPoint} from '../bus-access/traffic-pdf.mjs';
import {ribbonLayout} from '../assets/pdf-ribbons.mjs';

const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const logoBytes=readFileSync(new URL('../assets/denver-2027-territory-logo.png',import.meta.url));
const ribbonAssets={header:readFileSync(new URL('../assets/print-header-sky.png',import.meta.url)),footer:readFileSync(new URL('../assets/print-footer-hills.png',import.meta.url))};
const jpeg=readFileSync(new URL('../load-tests/assets/bible.jpg',import.meta.url));
const now=new Date('2026-11-07T18:00:00Z');
const plan=()=>newTrafficPlan({id:'parking-pdf',name:'Sample meeting location',address:'Software layout test only',lat:39.6,lng:-105},now);
const north=feet=>feet*.3048/6371008.8*180/Math.PI;
const row=(id,feet,overrides={})=>({id,kind:'parking-row',label:id,spaceWidthFeet:9,countOverride:null,points:[[39.6,-105],[39.6+north(feet),-105]],...overrides});

function recordDrawing(){
  const pages=[];
  const lib={...PDFLib,PDFDocument:{create:async()=>{
    const doc=await PDFLib.PDFDocument.create(),addPage=doc.addPage.bind(doc);
    doc.addPage=(...args)=>{
      const page=addPage(...args),record={page,texts:[],images:[],lines:[],rectangles:[]};pages.push(record);
      for(const [method,key]of [['drawText','texts'],['drawImage','images']]){
        const draw=page[method].bind(page);page[method]=(value,options)=>{record[key].push({value,options});return draw(value,options);};
      }
      for(const [method,key]of [['drawLine','lines'],['drawRectangle','rectangles']]){
        const draw=page[method].bind(page);page[method]=options=>{record[key].push(options);return draw(options);};
      }
      return page;
    };
    return doc;
  }}};
  return {lib,pages};
}
const printed=record=>record.pages.flatMap(page=>page.texts).map(entry=>entry.value).join('\n');
const firstPageText=record=>record.pages[0].texts.map(entry=>entry.value).join('\n');
function assertFrames(record){
  for(const [index,p]of record.pages.entries()){
    const {width,height}=p.page.getSize(),frame=ribbonLayout(width,height),top=height-frame.top;
    assert.deepEqual({width,height},{width:792,height:612});
    assert.equal(p.images.filter(image=>image.value.width===2048&&image.value.height===170).length,1,`page ${index+1} sky header`);
    assert.equal(p.images.filter(image=>image.value.width===2048&&image.value.height===130).length,1,`page ${index+1} hills footer`);
    assert.equal(p.images.filter(image=>image.value.width===997&&image.value.height===559).length,1,`page ${index+1} convention logo`);
    for(const {value,options:o}of p.texts){
      assert.ok(o.y>=frame.bottom&&o.y+o.size<=top+.001,`text stays clear of artwork: ${value}`);
      assert.ok(o.x>=23.99&&o.x+o.font.widthOfTextAtSize(value,o.size)<=width-23.99,`text fits the page: ${value}`);
    }
    for(const rectangle of p.rectangles)assert.ok(rectangle.y>=frame.bottom&&rectangle.y+rectangle.height<=top+.001,'badges and labels stay between the artwork');
  }
  const first=record.pages[0],stats=first.texts.find(entry=>/cones\s+\|/.test(entry.value)),parking=first.texts.find(entry=>entry.value.startsWith('Parking:'));
  assert.ok(stats.options.x+stats.options.font.widthOfTextAtSize(stats.value,stats.options.size)<parking.options.x-8,'parking total is separate from traffic counts');
}
async function render(source){
  const record=recordDrawing(),viewports=[];
  const result=await buildTrafficPdf(source,{PDFLib:record.lib,logoBytes,ribbonAssets,now,mapImage:async viewport=>{viewports.push(viewport);return jpeg;}});
  const parsed=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(parsed.getPageCount(),result.pages);assert.equal(result.blob.type,'application/pdf');assertFrames(record);
  return {record,result,viewports,parsed};
}
async function output(result,name){
  if(!process.env.PARKING_PDF_QA_OUTPUT)return;
  mkdirSync(process.env.PARKING_PDF_QA_OUTPUT,{recursive:true});
  writeFileSync(join(process.env.PARKING_PDF_QA_OUTPUT,name),new Uint8Array(await result.blob.arrayBuffer()));
}

test('full-layout bounds include every parking-row point even when the saved view is elsewhere',()=>{
  const p=plan();p.view={...p.view,lat:40,lng:-104,zoom:22};
  p.items=[row('west',90,{points:[[39.599,-105.002],[39.603,-105.003],[39.602,-104.997]]}),{id:'cone',kind:'cone',point:[39.6,-105]}];
  const viewport=layoutViewport(p);
  for(const item of p.items)for(const point of item.points||[item.point]){
    const projected=projectPoint(point,viewport);
    assert.ok(projected.x>=44&&projected.x<=viewport.width-44,'all row vertices fit horizontally');
    assert.ok(projected.y>=44&&projected.y<=viewport.height-44,'all row vertices fit vertically');
  }
});

test('parking PDF shows corrected totals and row provenance without changing the saved plan or traffic counts',async()=>{
  const p=plan();p.items=[row('East row',90),row('West row',180,{countOverride:17,points:[[39.6,-105.0005],[39.6+north(180),-105.0005]]})];p.parking={totalOverride:25};
  const original=JSON.stringify(p),{record,result,viewports}=await render(p),text=printed(record),map=firstPageText(record);
  assert.equal(JSON.stringify(p),original,'export is a detached snapshot');
  assert.match(map,/Parking: 25 spaces \(Adjusted\)/);
  assert.match(map,/0 cones\s+\|\s+0 routes\s+\|\s+0 labels/);
  assert.ok(map.includes('P1 · 10 spaces'));assert.ok(map.includes('P2 · 17 spaces'));
  assert.ok(text.includes('The overall total was entered manually.'));
  assert.ok(text.includes('2 marked parking rows total 27 spaces before the overall adjustment.'));
  assert.ok(text.includes('Length-based estimate before row corrections: 30 spaces.'));
  assert.ok(text.includes('P1 - East row: 10 spaces (estimated; 9 ft per space along the row).'));
  assert.ok(text.includes('P2 - West row: 17 spaces (adjusted; length-based estimate: 20 spaces; 9 ft per space along the row).'));
  assert.ok(text.includes('Parking row'));assert.ok(text.includes('P = parking row'));
  const strokes=record.pages[0].lines.filter(line=>line.thickness===3&&Math.abs(line.color?.green-215/255)<.000001);
  assert.equal(strokes.length,2,'each row is a simple non-directional line, with no route arrows');
  for(const item of p.items)for(const point of item.points){const projected=projectPoint(point,viewports[0]);assert.ok(projected.x>=44&&projected.x<=viewports[0].width-44);assert.ok(projected.y>=44&&projected.y<=viewports[0].height-44);}
  await output(result,'parking-adjusted-total.pdf');
});

test('row-derived estimates, row corrections, and an explicit zero are identified separately in the PDF',async()=>{
  const estimated=plan();estimated.items=[row('One row',90),row('Second row',180)];
  const a=await render(estimated);assert.match(firstPageText(a.record),/Parking: 30 spaces \(Estimated\)/);
  assert.ok(printed(a.record).includes('Total from 2 marked parking rows.'));
  const corrected=plan();corrected.items=[row('Closed row',90,{countOverride:0})];
  const b=await render(corrected);assert.match(firstPageText(b.record),/Parking: 0 spaces \(Adjusted\)/);
  assert.ok(firstPageText(b.record).includes('P1 · 0 spaces'));assert.ok(printed(b.record).includes('Length-based estimate before row corrections: 10 spaces.'));
  assert.ok(printed(b.record).includes('including corrected row counts'));
  await output(a.result,'parking-estimated-total.pdf');await output(b.result,'parking-corrected-zero.pdf');
});

test('legacy uncounted layouts remain unknown while a manually entered zero stays an adjusted total',async()=>{
  const legacy=plan();delete legacy.parking;
  const before=JSON.stringify(legacy),a=await render(legacy),text=printed(a.record);
  assert.equal(JSON.stringify(legacy),before);assert.match(firstPageText(a.record),/Parking: Not counted/);
  assert.ok(text.includes('No parking-space count has been entered for this layout.'));
  assert.ok(!text.includes('Parking: 0 spaces'));
  const manual=plan();manual.parking={totalOverride:0};
  const b=await render(manual);assert.match(firstPageText(b.record),/Parking: 0 spaces \(Adjusted\)/);
  assert.ok(printed(b.record).includes('The total was entered manually; no parking rows are marked in this layout.'));
  await output(a.result,'parking-not-counted.pdf');await output(b.result,'parking-manual-zero.pdf');
});

test('long row names and setup notes paginate completely while the largest allowed parking total fits the summary',async()=>{
  const p=plan();p.name='Parking-count continuation check';
  p.parking={totalOverride:MAX_PARKING_SPACES};
  p.notes=Array.from({length:35},(_,i)=>`Setup note ${i+1}: Keep this complete sentence in the PDF. END-NOTE-${i+1}`).join('\n');
  p.items=Array.from({length:18},(_,i)=>row(`Row ${i+1} - ${'W'.repeat(75)} END-${i+1}`,90,{id:'row-'+i,points:[[39.6,-105+i*.0001],[39.6+north(90),-105+i*.0001]]}));
  const before=JSON.stringify(p),{record,result}=await render(p),text=printed(record);
  assert.equal(JSON.stringify(p),before);assert.ok(result.pages>2);
  assert.match(firstPageText(record),/Parking: 100,000 spaces \(Adjusted\)/);
  for(let i=1;i<=18;i++)assert.ok(text.includes(`END-${i}`),`row ${i} complete`);
  for(let i=1;i<=35;i++)assert.ok(text.includes(`END-NOTE-${i}`),`note ${i} complete`);
  await output(result,'parking-count-overflow.pdf');
});

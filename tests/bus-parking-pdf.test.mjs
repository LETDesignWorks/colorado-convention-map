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
      const page=addPage(...args),record={page,texts:[],images:[],lines:[],rectangles:[],circles:[]};pages.push(record);
      for(const [method,key]of [['drawText','texts'],['drawImage','images']]){
        const draw=page[method].bind(page);page[method]=(value,options)=>{record[key].push({value,options});return draw(value,options);};
      }
      for(const [method,key]of [['drawLine','lines'],['drawRectangle','rectangles'],['drawCircle','circles']]){
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
const mapBounds=record=>record.pages[0].images.find(image=>image.options.width===744).options;
const mapCircles=record=>{const map=mapBounds(record);return record.pages[0].circles.filter(circle=>circle.x>=map.x&&circle.x<=map.x+map.width&&circle.y>=map.y&&circle.y<=map.y+map.height);};
const numericTags=record=>record.pages[0].texts.filter(entry=>/^\d[\d,]*$/.test(entry.value)).map(entry=>entry.value);
const teal=color=>Math.abs(color?.red-54/255)<.000001&&Math.abs(color?.green-215/255)<.000001&&Math.abs(color?.blue-183/255)<.000001;
const white=color=>color?.red===1&&color?.green===1&&color?.blue===1;
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
  const first=record.pages[0],stats=first.texts.find(entry=>/cones\s+\|/.test(entry.value)),parking=first.texts.find(entry=>entry.value.startsWith('Parking spaces:'));
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

test('parking PDF draws exact space dots with numeric tags and preserves corrections without changing the plan',async()=>{
  const p=plan();p.items=[row('East row',90),row('West row',180,{countOverride:17,points:[[39.6,-105.0005],[39.6+north(180),-105.0005]]})];p.parking={totalOverride:25};
  const original=JSON.stringify(p),{record,result,viewports}=await render(p),text=printed(record),map=firstPageText(record);
  assert.equal(JSON.stringify(p),original,'export is a detached snapshot');
  assert.match(map,/Parking spaces: 25/);
  assert.match(map,/0 cones\s+\|\s+0 routes\s+\|\s+0 labels/);
  assert.deepEqual(numericTags(record),['10','17']);
  assert.doesNotMatch(map,/\b(?:P\d+|estimated?|adjusted)\b/i);
  assert.ok(text.includes('The overall total was entered manually.'));
  assert.ok(text.includes('2 marked parking rows total 27 spaces before the overall adjustment.'));
  assert.ok(text.includes('Calculated count before row corrections: 30 spaces.'));
  assert.ok(text.includes('Row 1 - East row: 10 spaces (calculated from row length; 9 ft per space along the row).'));
  assert.ok(text.includes('Row 2 - West row: 17 spaces (entered manually; calculated count: 20 spaces; 9 ft per space along the row).'));
  assert.ok(record.pages[0].texts.some(entry=>entry.value==='Parking spaces'));
  assert.ok(!text.includes('P = parking row'));assert.doesNotMatch(text,/\bestimat(?:e|ed|es)\b/i);
  const first=record.pages[0],dots=mapCircles(record),bounds=mapBounds(record);
  assert.equal(dots.length,27,'row corrections control dot counts; an overall correction does not redistribute rows');
  assert.ok(dots.every(dot=>teal(dot.color)&&dot.borderWidth>0),'all map circles are bordered parking dots, without extra row-start anchors');
  assert.equal(first.lines.filter(line=>teal(line.color)).length,0,'parking spaces and legend have no connecting strokes');
  assert.equal(first.lines.filter(line=>white(line.color)).length,0,'numeric parking tags have no leader lines');
  const expected=[...Array.from({length:10},(_,i)=>[39.6+north((i+.5)*9),-105]),...Array.from({length:17},(_,i)=>[39.6+north((i+.5)*180/17),-105.0005])];
  expected.forEach((point,i)=>{const projected=projectPoint(point,viewports[0]);assert.ok(Math.abs(dots[i].x-(bounds.x+projected.x))<.001);assert.ok(Math.abs(dots[i].y-(bounds.y+bounds.height-projected.y))<.001);});
  for(const item of p.items)for(const point of item.points){const projected=projectPoint(point,viewports[0]);assert.ok(projected.x>=44&&projected.x<=viewports[0].width-44);assert.ok(projected.y>=44&&projected.y<=viewports[0].height-44);}
  await output(result,'parking-adjusted-total.pdf');
});

test('calculated rows and corrected zero use simple totals and draw the corresponding number of dots',async()=>{
  const calculated=plan();calculated.items=[row('One row',90),row('Second row',180)];
  const a=await render(calculated);assert.match(firstPageText(a.record),/Parking spaces: 30/);
  assert.ok(printed(a.record).includes('Total from 2 marked parking rows.'));
  assert.equal(mapCircles(a.record).length,30);assert.deepEqual(numericTags(a.record),['10','20']);
  assert.doesNotMatch(printed(a.record),/\bestimat(?:e|ed|es)\b/i);
  const corrected=plan();corrected.items=[row('Closed row',90,{countOverride:0})];
  const b=await render(corrected);assert.match(firstPageText(b.record),/Parking spaces: 0/);
  assert.deepEqual(numericTags(b.record),['0']);assert.equal(mapCircles(b.record).length,0,'an explicit zero does not produce an anchor dot');
  assert.ok(printed(b.record).includes('Calculated count before row corrections: 10 spaces.'));
  assert.ok(printed(b.record).includes('including corrected row counts'));
  await output(a.result,'parking-calculated-total.pdf');await output(b.result,'parking-corrected-zero.pdf');
});

test('legacy uncounted layouts remain unknown while a manually entered zero stays zero',async()=>{
  const legacy=plan();delete legacy.parking;
  const before=JSON.stringify(legacy),a=await render(legacy),text=printed(a.record);
  assert.equal(JSON.stringify(legacy),before);assert.match(firstPageText(a.record),/Parking spaces: Not counted/);
  assert.ok(text.includes('No parking-space count has been entered for this layout.'));
  assert.ok(!text.includes('Parking spaces: 0'));assert.equal(mapCircles(a.record).length,0);
  const manual=plan();manual.parking={totalOverride:0};
  const b=await render(manual);assert.match(firstPageText(b.record),/Parking spaces: 0/);assert.equal(mapCircles(b.record).length,0);
  assert.ok(printed(b.record).includes('The total was entered manually; no parking rows are marked in this layout.'));
  await output(a.result,'parking-not-counted.pdf');await output(b.result,'parking-manual-zero.pdf');
});

test('numeric parking tags do not remove route and location anchor markers',async()=>{
  const p=plan();p.items=[row('Parking row',90),{id:'route',kind:'route',routeType:'bus',label:'Bus entrance',points:[[39.6,-105.0005],[39.6+north(90),-105.0005]]},{id:'entry',kind:'pin',pinType:'entry',label:'Entrance',point:[39.6,-104.9995]}];
  const {record}=await render(p),map=firstPageText(record),circles=mapCircles(record);
  assert.match(map,/0 cones\s+\|\s+1 routes\s+\|\s+1 labels/);
  assert.ok(map.includes('R1'));assert.ok(map.includes('L1 Entrance'));
  assert.deepEqual(numericTags(record),['10']);assert.equal(circles.filter(circle=>teal(circle.color)).length,10);
  assert.equal(circles.filter(circle=>!teal(circle.color)).length,2,'route and location tags retain their anchor dots');
  assert.equal(record.pages[0].lines.filter(line=>white(line.color)).length,2,'only route and location tags keep leader lines');
});

test('long row names and setup notes paginate completely while the largest allowed parking total fits the summary',async()=>{
  const p=plan();p.name='Parking-count continuation check';
  p.parking={totalOverride:MAX_PARKING_SPACES};
  p.notes=Array.from({length:35},(_,i)=>`Setup note ${i+1}: Keep this complete sentence in the PDF. END-NOTE-${i+1}`).join('\n');
  p.items=Array.from({length:18},(_,i)=>row(`Row ${i+1} - ${'W'.repeat(75)} END-${i+1}`,90,{id:'row-'+i,points:[[39.6,-105+i*.0001],[39.6+north(90),-105+i*.0001]]}));
  const before=JSON.stringify(p),{record,result}=await render(p),text=printed(record);
  assert.equal(JSON.stringify(p),before);assert.ok(result.pages>2);
  assert.match(firstPageText(record),/Parking spaces: 100,000/);
  for(let i=1;i<=18;i++)assert.ok(text.includes(`END-${i}`),`row ${i} complete`);
  for(let i=1;i<=35;i++)assert.ok(text.includes(`END-NOTE-${i}`),`note ${i} complete`);
  await output(result,'parking-count-overflow.pdf');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildTrafficPdf} from '../bus-access/traffic-pdf.mjs';
import {buildPhotoPdf, publicPhotoReport} from '../bus-access/photos-pdf.mjs';
import {newTrafficPlan} from '../bus-access/traffic-model.mjs';
import {ribbonLayout} from '../assets/pdf-ribbons.mjs';
const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const ribbonAssets={header:readFileSync('assets/print-header-sky.png'),footer:readFileSync('assets/print-footer-hills.png')};
const logoBytes=readFileSync('assets/denver-2027-territory-logo.png'),jpeg=readFileSync('load-tests/assets/bible.jpg');
const now=new Date('2026-11-07T17:00:00Z');

function recordDrawing() {
  const pages=[];
  const lib={...PDFLib,PDFDocument:{create:async()=>{
    const doc=await PDFLib.PDFDocument.create(),add=doc.addPage.bind(doc);
    doc.addPage=(...args)=>{
      const page=add(...args),calls={page,images:[],texts:[],lines:[],rectangles:[]};pages.push(calls);
      for(const [method,key]of [['drawText','texts'],['drawImage','images']]) {
        const draw=page[method].bind(page);page[method]=(value,options)=>{calls[key].push({value,options});return draw(value,options);};
      }
      for(const [method,key]of [['drawLine','lines'],['drawRectangle','rectangles']]) {
        const draw=page[method].bind(page);page[method]=options=>{calls[key].push(options);return draw(options);};
      }
      return page;
    };
    return doc;
  }}};
  return {lib,pages};
}
function assertSafePages(record) {
  for (const [i,p]of record.pages.entries()) {
    const {width,height}=p.page.getSize(),box=ribbonLayout(width,height),top=height-box.top;
    const header=p.images.filter(x=>x.value.width===2048&&x.value.height===170);
    const footer=p.images.filter(x=>x.value.width===2048&&x.value.height===130);
    assert.equal(header.length,1,`page ${i+1} has the supplied header once`);
    assert.equal(footer.length,1,`page ${i+1} has the supplied footer once`);
    assert.equal(header[0].options.x,0);assert.equal(header[0].options.width,width);
    assert.equal(footer[0].options.y,0);assert.equal(footer[0].options.width,width);
    for (const {value,options:o}of p.texts) {
      assert.ok(o.y>=box.bottom,`page ${i+1}: text reaches the hills: ${value}`);
      assert.ok(o.y+o.size<=top+.001,`page ${i+1}: text reaches the sky: ${value}`);
    }
    for (const {value,options:o}of p.images) {
      if (header.some(x=>x.value===value)||footer.some(x=>x.value===value))continue;
      assert.ok(o.y>=box.bottom,`page ${i+1}: content image reaches footer`);
      assert.ok(o.y+o.height<=top+.001,`page ${i+1}: content image reaches header`);
    }
    for(const r of p.rectangles) {
      assert.ok(r.y>=box.bottom&&r.y+r.height<=top+.001,`page ${i+1}: content rectangle crosses reserved band`);
    }
    for(const l of p.lines)for(const p of [l.start,l.end])assert.ok(p.y>=box.bottom&&p.y<=top+.001,'Line crosses artwork');
  }
}
async function output(result,name) {
  if(!process.env.BUS_RIBBON_OUTPUT)return;
  mkdirSync(process.env.BUS_RIBBON_OUTPUT,{recursive:true});
  writeFileSync(join(process.env.BUS_RIBBON_OUTPUT,name),new Uint8Array(await result.blob.arrayBuffer()));
}
const report=()=>publicPhotoReport({id:'synthetic-21',markerLabel:'21',name:'Sample meeting location',address:'Synthetic parking-lot and interior photos',congregations:['Sample congregation']},{status:'Approved',busSize:'45-foot motorcoach',publicSummary:'Use the south entrance and the marked loading area.'});

test('location summary has both supplied ribbons without entering the text or footer',async()=>{
  const recorded=recordDrawing();
  const result=await buildPhotoPdf({report:report(),photos:[],loadImage:()=>assert.fail('No selected images')},{PDFLib:recorded.lib,ribbonAssets,now});
  assert.equal(result.pages,1);assertSafePages(recorded);
  const parsed=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(parsed.getPageCount(),1);
  await output(result,'bus-photo-overview-ribbons.pdf');
});

test('selected photo pages keep full-size photos and long captions clear of the new artwork',async()=>{
  const recorded=recordDrawing(),reads=[];
  const photos=Array.from({length:5},(_,i)=>({id:'photo-'+i,category:i%2?'exterior':'interior',caption:i===3?'W'.repeat(180):`Sample photo ${i+1} - verify access on site.`,selected:true}));
  photos.push({id:'not-selected',selected:false,category:'exterior'});
  const before=JSON.stringify(photos),result=await buildPhotoPdf({report:report(),photos,loadImage:async photo=>{reads.push(photo.id);return new Blob([jpeg],{type:'image/jpeg'});}},{PDFLib:recorded.lib,ribbonAssets,now});
  assert.deepEqual(reads,photos.slice(0,5).map(x=>x.id));assert.equal(JSON.stringify(photos),before);
  assert.ok(result.pages>=4);assertSafePages(recorded);
  assert.equal(recorded.pages.flatMap(p=>p.images).filter(x=>x.value.width!==2048).length,5);
  const printed=recorded.pages.flatMap(p=>p.texts).map(x=>x.value).join('');assert.ok(printed.includes('W'.repeat(180)),'Caption text is complete');
  const parsed=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(parsed.getPageCount(),result.pages);
  await output(result,'bus-location-photos-ribbons.pdf');
});

test('traffic map, logo, notes and every continuation page fit between the ribbons',async()=>{
  const recorded=recordDrawing();
  const plan=newTrafficPlan({id:'sample',name:'Sample meeting location',address:'Synthetic parking-lot test only',lat:39.6,lng:-105},now);
  plan.name='Sample bus arrival and parking layout';plan.notes=('Keep the loading zone clear. Follow the marked pedestrian path and confirm the bus turn on site.\n').repeat(26);
  plan.items=[
    {id:'r',kind:'route',routeType:'bus',label:'Arrival and departure loop',points:[[39.5999,-105.0007],[39.6004,-105.0007],[39.6004,-105.0001],[39.6,-105.0001]]},
    ...Array.from({length:8},(_,i)=>({id:'c'+i,kind:'cone',point:[39.60005+i*.00004,-105.0005]})),
    {id:'p',kind:'pin',pinType:'loading',label:'Bus loading area',point:[39.60025,-105.0003]}
  ];
  const original=JSON.stringify(plan);
  const result=await buildTrafficPdf(plan,{PDFLib:recorded.lib,ribbonAssets,logoBytes,now,unsaved:true,mapImage:async()=>jpeg});
  assert.equal(JSON.stringify(plan),original);assert.ok(result.pages>=3);assertSafePages(recorded);
  const parsed=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(parsed.getPageCount(),result.pages);
  assert.ok(recorded.pages[0].images.length>=4,'Original logo and basemap stay alongside both ribbons');
  await output(result,'bus-traffic-ribbons.pdf');
});

test('bad ribbon artwork cannot silently produce a partly branded bus PDF',async()=>{
  const bad={header:Uint8Array.of(0),footer:ribbonAssets.footer};
  await assert.rejects(buildPhotoPdf({report:report(),photos:[],loadImage:()=>assert.fail()},{PDFLib,ribbonAssets:bad}));
  const plan=newTrafficPlan({id:'sample',name:'Sample',lat:39.6,lng:-105},now);
  await assert.rejects(buildTrafficPdf(plan,{PDFLib,ribbonAssets:bad,logoBytes,mapImage:()=>assert.fail()}));
});

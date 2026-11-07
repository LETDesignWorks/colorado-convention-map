import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {PDF_LIMITS,inspectPdf,mergePdfDocuments} from '../pdf-tools/pdf-merge.mjs';
import {createPdfPresentation,fitPageToSlide} from '../pdf-tools/presentation.mjs';
import {createPdfLibRibbons} from '../assets/pdf-ribbons.mjs';

const require=createRequire(import.meta.url);
const dependencies=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'pdf-tools-qa.cjs')):require;
const PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const PptxGenJS=dependencies('pptxgenjs'),JSZip=dependencies('jszip'),canvasApi=dependencies('@napi-rs/canvas');
for (const key of ['DOMMatrix','ImageData','Path2D']) globalThis[key]??=canvasApi[key];
const pdfjs=await import(pathToFileURL(dependencies.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const pdfjsRoot=dirname(dependencies.resolve('pdfjs-dist/package.json'));
const pdfjsOptions={standardFontDataUrl:join(pdfjsRoot,'standard_fonts/'),wasmUrl:join(pdfjsRoot,'wasm/'),useWorkerFetch:false};
const ribbonAssets={header:readFileSync(new URL('../assets/print-header-sky.png',import.meta.url)),footer:readFileSync(new URL('../assets/print-footer-hills.png',import.meta.url))};
const engine={PDFLib,pdfjs,PptxGenJS,pdfjsOptions,createCanvas:canvasApi.createCanvas};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let fixturePromise;

async function fixtures() {
  if (fixturePromise) return fixturePromise;
  fixturePromise=(async()=>{
    const report=await PDFLib.PDFDocument.create(),font=await report.embedFont(PDFLib.StandardFonts.Helvetica);
    const page=report.addPage([612,792]);
    page.drawText('LOCATION REVIEW',{x:42,y:718,size:23,font});
    page.drawText('Synthetic test location',{x:42,y:682,size:14,font});
    const field=report.getForm().createTextField('saved-notes');field.setText('Saved field value appears in the presentation');
    field.addToPage(page,{x:42,y:580,width:500,height:50,fontSize:12});report.getForm().updateFieldAppearances(font);
    page.node.addAnnot(report.context.register(report.context.obj({Type:'Annot',Subtype:'Link',Rect:[42,540,200,560],Border:[0,0,0],A:{S:'URI',URI:PDFLib.PDFString.of('https://example.com/')}})));
    const ribbons=await createPdfLibRibbons(report,{ribbonAssets});ribbons.drawAllPages();
    const reportBytes=await report.save();
    const plan=await PDFLib.PDFDocument.create(),planFont=await plan.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const parking=plan.addPage([792,612]);parking.drawText('PARKING LOT PLAN',{x:32,y:535,size:23,font:planFont});
    parking.drawRectangle({x:32,y:110,width:728,height:370,color:PDFLib.rgb(.93,.96,.98)});
    for(let i=0;i<7;i++)parking.drawLine({start:{x:92+i*85,y:145},end:{x:92+i*85,y:400},thickness:2,color:PDFLib.rgb(.35,.45,.5)});
    parking.drawLine({start:{x:75,y:250},end:{x:710,y:250},thickness:8,color:PDFLib.rgb(.05,.5,.8)});
    const rotated=plan.addPage([612,792]);rotated.setCropBox(30,60,540,660);rotated.setRotation(PDFLib.degrees(90));
    rotated.drawRectangle({x:30,y:60,width:540,height:660,borderColor:PDFLib.rgb(.8,.2,.1),borderWidth:8});
    rotated.drawText('ROTATED REFERENCE',{x:60,y:350,size:28,font:planFont});
    const planRibbons=await createPdfLibRibbons(plan,{ribbonAssets});planRibbons.draw(parking);
    const planBytes=await plan.save();
    return {reportBytes,planBytes,report:{name:'Location review.pdf',blob:new Blob([reportBytes],{type:'application/pdf'})},plan:{name:'Parking & reference.pdf',blob:new Blob([planBytes],{type:'application/pdf'})}};
  })();
  return fixturePromise;
}
async function output(blob,name) {
  if(!process.env.PDF_TOOLS_QA_OUT)return;
  mkdirSync(process.env.PDF_TOOLS_QA_OUT,{recursive:true});writeFileSync(join(process.env.PDF_TOOLS_QA_OUT,name),new Uint8Array(await blob.arrayBuffer()));
}
async function unpack(result) {return JSZip.loadAsync(await result.blob.arrayBuffer());}
function slideNames(zip) {return Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));}
async function pictures(zip) {
  const paths=Object.keys(zip.files).filter(name=>/^ppt\/media\/.*\.png$/.test(name));
  return Promise.all(paths.map(async name=>({name,data:await zip.file(name).async('nodebuffer')})));
}

test('combined PDF keeps all pages in order, crop/rotation, original artwork and saved form appearance',async()=>{
  const f=await fixtures(),originalDigest=digest(f.reportBytes);
  const combined=await mergePdfDocuments([f.report,f.plan],{PDFLib,title:'Meeting packet',filename:'Meeting packet.pdf'});
  assert.equal(combined.pages,3);assert.equal(combined.filename,'Meeting-packet.pdf');assert.equal(combined.flattenedForms,true);
  const doc=await PDFLib.PDFDocument.load(await combined.blob.arrayBuffer());
  assert.deepEqual(doc.getPages().map(page=>page.getSize()),[{width:612,height:792},{width:792,height:612},{width:612,height:792}]);
  assert.equal(doc.getPage(2).getRotation().angle,90);assert.deepEqual(doc.getPage(2).getCropBox(),{x:30,y:60,width:540,height:660});
  assert.equal(doc.getForm().getFields().length,0);
  const annots=doc.getPage(0).node.Annots();assert.equal(annots.size(),1,'Flattened widgets leave no dangling annotation references');
  assert.equal(annots.lookup(0,PDFLib.PDFDict).lookup(PDFLib.PDFName.of('Subtype')).toString(),'/Link','Ordinary link annotations remain');
  const original=await PDFLib.PDFDocument.load(f.reportBytes);assert.equal(original.getForm().getTextField('saved-notes').getText(),'Saved field value appears in the presentation');
  assert.equal(digest(f.reportBytes),originalDigest);
  const loaded=await pdfjs.getDocument({data:new Uint8Array(await combined.blob.arrayBuffer()),...pdfjsOptions}).promise;
  try {
    const texts=[];for(let n=1;n<=loaded.numPages;n++)texts.push((await(await loaded.getPage(n)).getTextContent()).items.map(item=>item.str).join(' '));
    assert.match(texts[0],/LOCATION REVIEW/);assert.match(texts[0],/Saved field value appears/);
    assert.match(texts[1],/PARKING LOT PLAN/);assert.match(texts[2],/ROTATED REFERENCE/);
  }finally{await loaded.destroy();}
  await output(combined.blob,'combined-meeting-packet.pdf');
});

test('inspection reports displayed portrait, landscape and rotated crop dimensions',async()=>{
  const f=await fixtures();
  const info=await inspectPdf(f.plan.blob,{PDFLib});
  assert.equal(info.pageCount,2);
  assert.deepEqual(info.pages,[{width:792,height:612,rotation:0},{width:660,height:540,rotation:90}]);
  const report=await inspectPdf(f.report.blob,{PDFLib});assert.deepEqual(report.pages,[{width:612,height:792,rotation:0}]);
});

test('PowerPoint has one complete, crisp image per PDF page with readable original ribbons and source notes',async()=>{
  const f=await fixtures(),messages=[];
  const result=await createPdfPresentation([f.report,f.plan],{...engine,title:'Selected meeting PDFs',progress:m=>messages.push(m)});
  await output(result.blob,'selected-meeting-pdfs.pptx');
  assert.equal(result.slides,3);assert.equal(result.pages,3);assert.equal(result.filename,'Selected-meeting-PDFs.pptx');
  const zip=await unpack(result),slides=slideNames(zip);assert.equal(slides.length,3);
  const deck=await zip.file('ppt/presentation.xml').async('string');assert.match(deck,/cx="12192000" cy="6858000"/);
  const expectedRatios=[612/792,792/612,660/540];
  for(let i=0;i<slides.length;i++){
    const xml=await zip.file(slides[i]).async('string');assert.equal((xml.match(/<p:pic>/g)||[]).length,1);
    const picture=xml.match(/<p:pic>[\s\S]*?<\/p:pic>/)[0];
    const transform=picture.match(/<a:xfrm[^>]*>\s*<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    assert.ok(transform,'Slide picture has a position and size');const [,x,y,w,h]=transform.map(Number);
    assert.ok(x>=0&&y>=0&&x+w<=12192001&&y+h<=6858001);assert.ok(Math.abs(w/h-expectedRatios[i])<.000001,JSON.stringify({slide:i+1,w,h,expected:expectedRatios[i],actual:w/h}));
    const notes=await zip.file(`ppt/notesSlides/notesSlide${i+1}.xml`).async('string');
    assert.match(notes,/Source PDF/);assert.match(notes,i===0?/Location review\.pdf/:/Parking &amp; reference\.pdf/);
  }
  const media=await pictures(zip);assert.equal(media.length,3);
  const first=await canvasApi.loadImage(media[0].data);assert.equal(first.height,2800);assert.ok(first.width>2000);
  const check=canvasApi.createCanvas(first.width,first.height),ctx=check.getContext('2d');ctx.drawImage(first,0,0);
  const sky=ctx.getImageData(20,2,1,1).data,hills=ctx.getImageData(20,first.height-2,1,1).data;
  assert.ok(sky[2]>220&&sky[1]>200&&sky[0]<220,'The supplied sky is visible');
  assert.ok(hills[2]>hills[0]&&hills[1]>hills[0]&&hills[0]<60,'The supplied hills are visible');
  assert.ok(messages.some(m=>m.includes('slide 3 of 3')));
  await output(result.blob,'selected-meeting-pdfs.pptx');
  if(process.env.PDF_TOOLS_QA_OUT)for(const [i,item]of media.entries())writeFileSync(join(process.env.PDF_TOOLS_QA_OUT,`powerpoint-page-${i+1}.png`),item.data);
});

test('first-page layout follows the chosen order and keeps later portrait pages inside the slide',async()=>{
  const f=await fixtures(),result=await createPdfPresentation([f.plan,f.report],{...engine,layout:'first-page',title:'Parking first'});
  const zip=await unpack(result),deck=await zip.file('ppt/presentation.xml').async('string');
  assert.match(deck,/cx="10058400" cy="7772400"/);assert.equal(slideNames(zip).length,3);
  const notes=await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');assert.match(notes,/Parking &amp; reference\.pdf/);
  assert.deepEqual(fitPageToSlide(612,792,11,8.5),{x:(11-612*8.5/792)/2,y:0,w:612*8.5/792,h:8.5});
  await output(result.blob,'parking-first.pptx');
});

test('invalid, encrypted, XFA and oversized inputs fail clearly without creating a partial export',async()=>{
  const f=await fixtures();
  await assert.rejects(inspectPdf(new Blob(['not a PDF']),{PDFLib,name:'wrong.pdf'}),/not a PDF/);
  await assert.rejects(mergePdfDocuments([f.report,{name:'broken.pdf',blob:new Blob(['%PDF-1.7 broken'])}],{PDFLib}),/broken\.pdf.*could not be opened/);
  await assert.rejects(mergePdfDocuments([],{PDFLib}),/Select at least/);
  const oversized={name:'huge.pdf',blob:{size:PDF_LIMITS.maxFileBytes+1,arrayBuffer(){assert.fail('Oversized bytes must not be read');}}};
  await assert.rejects(mergePdfDocuments([oversized],{PDFLib}),/larger than 50 MB/);
  const locked=await PDFLib.PDFDocument.load(f.reportBytes);locked.context.trailerInfo.Encrypt=locked.context.register(locked.context.obj({Filter:'Standard',V:2,R:3,Length:128}));
  await assert.rejects(inspectPdf(new Blob([await locked.save({updateFieldAppearances:false})]),{PDFLib,name:'locked.pdf'}),/password-protected/);
  const xfa=await PDFLib.PDFDocument.create();xfa.addPage();const dict=xfa.context.obj({XFA:PDFLib.PDFString.of('<xdp/>')});xfa.catalog.set(PDFLib.PDFName.of('AcroForm'),dict);
  await assert.rejects(inspectPdf(new Blob([await xfa.save({updateFieldAppearances:false})]),{PDFLib,name:'dynamic.pdf'}),/XFA/);
  const cmapDoc=await PDFLib.PDFDocument.create(),cmapPage=cmapDoc.addPage();
  const cmapFont=cmapDoc.context.register(cmapDoc.context.obj({Type:'Font',Subtype:'Type0',BaseFont:'HeiseiMin-W3',Encoding:'UniJIS-UCS2-H',DescendantFonts:[{Type:'Font',Subtype:'CIDFontType0',BaseFont:'HeiseiMin-W3',CIDSystemInfo:{Registry:PDFLib.PDFString.of('Adobe'),Ordering:PDFLib.PDFString.of('Japan1'),Supplement:6},FontDescriptor:{Type:'FontDescriptor',FontName:'HeiseiMin-W3',Flags:6,FontBBox:[0,-200,1000,900],ItalicAngle:0,Ascent:900,Descent:-200,CapHeight:800,StemV:80},DW:1000}]}));
  cmapPage.node.set(PDFLib.PDFName.of('Resources'),cmapDoc.context.obj({Font:{F1:cmapFont}}));
  cmapPage.node.addContentStream(cmapDoc.context.register(cmapDoc.context.flateStream('BT /F1 12 Tf 40 700 Td <3042> Tj ET')));
  const cmapSource={name:'external-cmap.pdf',blob:new Blob([await cmapDoc.save()])};
  await assert.rejects(createPdfPresentation([cmapSource],{...engine,pdfjsOptions:{...pdfjsOptions,verbosity:0}}),/external-cmap\.pdf.*, page 1.*No incomplete presentation/);
});

test('cancel stops a conversion and an unreadable later page cannot silently disappear',async()=>{
  const f=await fixtures(),controller=new AbortController();controller.abort();
  await assert.rejects(mergePdfDocuments([f.report],{PDFLib,signal:controller.signal}),{name:'AbortError'});
  const active=new AbortController();
  await assert.rejects(createPdfPresentation([f.report,f.plan],{...engine,signal:active.signal,progress:message=>{if(message.startsWith('Creating slide'))active.abort();}}),{name:'AbortError'});
  const failedRenderer={...pdfjs,getDocument(options){const task=pdfjs.getDocument(options),promise=task.promise.then(pdf=>{
    const getPage=pdf.getPage.bind(pdf);pdf.getPage=async number=>{const page=await getPage(number);if(number===2)page.render=()=>({promise:Promise.reject(Error('Unsupported test image')),cancel(){}});return page;};return pdf;});
    return {promise,destroy:()=>task.destroy()};
  }};
  await assert.rejects(createPdfPresentation([f.plan],{...engine,pdfjs:failedRenderer}),/Parking & reference\.pdf.*, page 2.*No incomplete presentation/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {buildPhotoPdf,publicPhotoReport,PHOTO_PDF_PAGE} from '../bus-access/photos-pdf.mjs';
import {ribbonLayout} from '../assets/pdf-ribbons.mjs';

const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const dependencies=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'site-visit-qa.cjs')):require;
const {createCanvas}=dependencies('@napi-rs/canvas');
const logoBytes=readFileSync(new URL('../assets/denver-2027-territory-logo.png',import.meta.url));
const ribbonAssets={header:readFileSync(new URL('../assets/print-header-sky.png',import.meta.url)),footer:readFileSync(new URL('../assets/print-footer-hills.png',import.meta.url))};
const options={PDFLib,logoBytes,ribbonAssets,now:new Date('2026-11-07T18:00:00Z')};
const report=()=>publicPhotoReport({id:'test-1',markerLabel:'1',name:'Sample Kingdom Hall',address:'1234 Example Avenue, Denver, CO 80200',congregations:['Example North','Example South'],privateContact:'PRIVATE CONTACT'},
  {status:'Approved',busSize:'Shuttle bus',publicSummary:'Use the east entrance for the site visit.',internalNotes:'PRIVATE NOTE'});

function picture(kind,width,height) {
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle=kind==='inside'?'#f0ede7':'#d4e8ef';ctx.fillRect(0,0,width,height);
  ctx.fillStyle=kind==='inside'?'#8ca7b5':'#a6b391';ctx.fillRect(0,height*.68,width,height*.32);
  if(kind==='inside') {
    ctx.fillStyle='#bba88d';ctx.fillRect(width*.42,height*.15,width*.17,height*.15);
    ctx.fillStyle='#738998';for(let row=0;row<4;row++)for(let column=0;column<8;column++)ctx.fillRect(width*(.08+column*.115),height*(.42+row*.12),width*.07,height*.065);
  } else {
    ctx.fillStyle='#baab97';ctx.fillRect(width*.17,height*.28,width*.65,height*.4);
    ctx.fillStyle='#64584f';ctx.beginPath();ctx.moveTo(width*.12,height*.28);ctx.lineTo(width*.5,height*.11);ctx.lineTo(width*.87,height*.28);ctx.closePath();ctx.fill();
    ctx.fillStyle='#647f8e';for(let column=0;column<5;column++)ctx.fillRect(width*(.23+column*.105),height*.39,width*.075,height*.17);
    ctx.fillStyle='#717b81';ctx.fillRect(0,height*.79,width,height*.21);
    ctx.fillStyle='#e5d8a6';for(let column=0;column<8;column++)ctx.fillRect(column*width*.15,height*.88,width*.08,height*.012);
    ctx.fillStyle='#7d9870';ctx.beginPath();ctx.ellipse(width*.09,height*.48,width*.055,height*.16,0,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#fff';ctx.fillRect(0,height-62,width,62);ctx.fillStyle='#244c65';ctx.font='bold 22px sans-serif';
  ctx.fillText(`SYNTHETIC ${kind==='inside'?'INTERIOR':kind==='loading'?'LOADING VIEW':'EXTERIOR'} - LAYOUT CHECK`,24,height-22);
  return new Blob([canvas.toBuffer('image/jpeg')],{type:'image/jpeg'});
}
const fixtures=new Map([['inside',picture('inside',900,620)],['outside',picture('outside',1200,680)],['loading',picture('loading',1000,620)],['portrait',picture('outside',500,900)]]);
const photos=()=>[
  {id:'inside',category:'interior',caption:'Seating and access inside the meeting location.',selected:true},
  {id:'outside',category:'exterior',caption:'The selected overview photo.',selected:true},
  {id:'loading',category:'exterior',caption:'Approach to the passenger loading area.',selected:true}
];
const regularNotes='Single hall\nLocated on a two-way street\nMarked area for passenger drop-off\nKeep the driveway clear during arrivals\nCheck ramp access during the site visit';
function recordDrawing() {
  const pages=[];
  const lib={...PDFLib,PDFDocument:{create:async()=>{
    const doc=await PDFLib.PDFDocument.create(),add=doc.addPage.bind(doc);
    doc.addPage=(...args)=>{
      const page=add(...args),calls={page,images:[],texts:[],rectangles:[],lines:[],circles:[]};pages.push(calls);
      for(const [method,key]of [['drawText','texts'],['drawImage','images']]) {
        const draw=page[method].bind(page);page[method]=(value,options)=>{calls[key].push({value,options});return draw(value,options);};
      }
      for(const [method,key]of [['drawRectangle','rectangles'],['drawLine','lines'],['drawCircle','circles']]) {
        const draw=page[method].bind(page);page[method]=options=>{calls[key].push(options);return draw(options);};
      }
      return page;
    };return doc;
  }}};
  return {lib,pages};
}
const isArtwork=({value})=>value.width===2048&&(value.height===170||value.height===130);
const isLogo=({value})=>value.width===997&&value.height===559;
const contentImages=record=>record.pages.flatMap(p=>p.images).filter(i=>!isArtwork(i)&&!isLogo(i));
const printed=record=>record.pages.flatMap(p=>p.texts).map(t=>t.value).join('\n');
function assertSafe(record) {
  for(const [index,p]of record.pages.entries()) {
    const {width,height}=p.page.getSize(),frame=ribbonLayout(width,height),top=height-frame.top;
    assert.deepEqual({width,height},PHOTO_PDF_PAGE);
    assert.equal(p.images.filter(i=>i.value.width===2048&&i.value.height===170).length,1,`page ${index+1} header`);
    assert.equal(p.images.filter(i=>i.value.width===2048&&i.value.height===130).length,1,`page ${index+1} footer`);
    assert.equal(p.images.filter(isLogo).length,1,`page ${index+1} convention logo`);
    for(const {value,options:o}of p.texts) {
      assert.ok(o.y>=frame.bottom-.001&&o.y+o.size<=top+.001,`text overlaps artwork: ${value}`);
      assert.ok(o.x>=31.99&&o.x+o.font.widthOfTextAtSize(value,o.size)<=width-31.99,`text overflows page width: ${value}`);
      assert.ok(o.size>=8.5,'No tiny text used to force content onto a page');
    }
    for(const image of p.images.filter(i=>!isArtwork(i))) {
      const o=image.options;
      assert.ok(o.x>=31.99&&o.x+o.width<=width-31.99,'image is inside horizontal margins');
      assert.ok(o.y>=frame.bottom&&o.y+o.height<=top+.001,'image is outside ribbon bands');
      assert.ok(Math.abs(o.width/o.height-image.value.width/image.value.height)<.000001,'complete image retains its aspect ratio');
    }
    for(const o of p.rectangles)assert.ok(o.y>=frame.bottom&&o.y+o.height<=top+.001,'photo card avoids artwork');
    for(const line of p.lines)for(const point of [line.start,line.end])assert.ok(point.y>=frame.bottom&&point.y<=top+.001);
  }
}
async function output(result,name) {
  if(!process.env.SITE_VISIT_QA_OUTPUT)return;
  mkdirSync(process.env.SITE_VISIT_QA_OUTPUT,{recursive:true});writeFileSync(join(process.env.SITE_VISIT_QA_OUTPUT,name),new Uint8Array(await result.blob.arrayBuffer()));
}

test('the selected overview and two supporting photos share one complete branded landscape page',async()=>{
  const captured=recordDrawing(),selected=photos(),before=JSON.stringify(selected),reads=[];
  selected.push({id:'excluded',category:'exterior',selected:false});
  const result=await buildPhotoPdf({report:report(),photos:selected,notes:regularNotes,overviewPhotoId:'outside',loadImage:async p=>{reads.push(p.id);return fixtures.get(p.id);}},{...options,PDFLib:captured.lib});
  assert.equal(result.pages,1);assert.equal(result.textWarning,false);assert.equal(result.filename,'Sample-Kingdom-Hall-location-photos.pdf');
  assert.deepEqual(reads,['inside','outside','loading']);assert.equal(JSON.stringify(selected.slice(0,3)),before);
  assertSafe(captured);const images=contentImages(captured);assert.equal(images.length,3);
  assert.equal(images[0].value.width,1200,'chosen overview is the large first image');
  assert.ok(images[0].options.width*images[0].options.height>images[1].options.width*images[1].options.height*2);
  assert.ok(images[0].options.y>images[1].options.y&&images[1].options.x<images[2].options.x,'hero above side-by-side supporting photos');
  const text=printed(captured);for(const note of regularNotes.split('\n'))assert.ok(text.includes(note));
  assert.ok(!text.includes('PRIVATE'));assert.ok(text.includes('The selected overview photo.'));
  const pdf=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(pdf.getPageCount(),1);
  await output(result,'site-visit-three-photos.pdf');
});

test('notes keep negative measurements and normalize only actual list markers; no photos leaves no empty image box',async()=>{
  const captured=recordDrawing(),notes='-5% grade at the entrance\n- Keep the pedestrian route clear\n• Confirm the loading arrangement';
  const result=await buildPhotoPdf({report:report(),photos:[],notes,loadImage:()=>assert.fail('No selected photo')},{...options,PDFLib:captured.lib});
  const text=printed(captured);assert.ok(text.includes('-5% grade at the entrance'));assert.ok(text.includes('Keep the pedestrian route clear'));
  assert.ok(!text.includes('- Keep the pedestrian route clear'));assert.ok(!text.includes('• Confirm'));
  assert.equal(captured.pages.flatMap(p=>p.circles).length,3);assert.equal(contentImages(captured).length,0);
  assert.equal(captured.pages.flatMap(p=>p.rectangles).length,0,'no blank photo card is drawn');
  assert.equal(result.pages,1);assertSafe(captured);await output(result,'site-visit-no-photos.pdf');
});

test('long location details and notes continue without losing text and every selected photo appears exactly once',async()=>{
  const captured=recordDrawing(),selected=Array.from({length:40},(_,i)=>({...photos()[i%3],id:'p-'+i,caption:`Supporting view ${i+1}.`,sourceId:photos()[i%3].id}));
  selected[2].caption='W'.repeat(180);
  const notes=Array.from({length:40},(_,i)=>`Note ${i+1}: Keep the walkway clear, confirm the access points, and record measurements during the site visit. A long note must continue without being omitted. END-NOTE-${i+1}`).join('\n');
  const longReport={...report(),address:report().address+' - '+('Arrival description must remain complete. ').repeat(7)+'END-ADDRESS',congregations:Array.from({length:12},(_,i)=>`Congregation ${i+1}`),publicSummary:('A saved public summary must also remain complete. ').repeat(10)+'END-SUMMARY'};
  const before=JSON.stringify({selected,notes,longReport}),reads=[];
  const result=await buildPhotoPdf({report:longReport,photos:selected,notes,overviewPhotoId:'p-1',loadImage:async p=>{reads.push(p.id);return fixtures.get(p.sourceId);}},{...options,PDFLib:captured.lib});
  assert.equal(JSON.stringify({selected,notes,longReport}),before);assert.deepEqual(reads,selected.map(p=>p.id));
  assertSafe(captured);assert.equal(contentImages(captured).length,40);assert.ok(result.pages>20);
  const text=printed(captured);for(let i=1;i<=40;i++)assert.ok(text.includes(`END-NOTE-${i}`),`note ${i} retained`);
  assert.ok(text.includes('END-ADDRESS'));assert.ok(text.includes('END-SUMMARY'));assert.ok(text.replace(/\s+/g,'').includes('W'.repeat(180)));
  assert.ok(text.includes('Full caption follows.'));
  const pdf=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(pdf.getPageCount(),result.pages);
  await output(result,'site-visit-overflow.pdf');
});

test('a note almost as tall as a column can follow its heading and continue without refusing pagination',async()=>{
  for(const repeats of [91,96]) {
    const captured=recordDrawing(),notes=Array(repeats).fill('Entrance detail').join(' ');
    const result=await buildPhotoPdf({report:report(),photos:[],notes,loadImage:()=>assert.fail()},{...options,PDFLib:captured.lib});
    assertSafe(captured);
    const text=printed(captured);
    assert.equal((text.match(/\bEntrance\b/g)||[]).length,repeats,'every part of the note is retained');
    assert.equal((text.match(/\bdetail\b/g)||[]).length,repeats,'the entire note is retained');
    const page=captured.pages.find(p=>p.texts.some(t=>t.value==='Site visit notes'));
    const heading=page.texts.find(t=>t.value==='Site visit notes');
    assert.ok(page.texts.some(t=>t.value.includes('Entrance')&&Math.abs(t.options.x-heading.options.x-13)<.01&&t.options.y<heading.options.y),'the heading keeps at least the first note line in its column');
    const reopened=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(reopened.getPageCount(),result.pages);
    await output(result,`site-visit-near-column-${repeats}.pdf`);
  }
});

test('unavailable overview choices fall back to a selected exterior without cropping portrait views',async()=>{
  const captured=recordDrawing(),selected=[{id:'portrait',category:'interior',selected:true,caption:'Portrait view'},{id:'outside',category:'exterior',selected:true,caption:'Exterior view'},{id:'excluded',category:'exterior',selected:false}];
  await buildPhotoPdf({report:report(),photos:selected,overviewPhotoId:'excluded',loadImage:p=>fixtures.get(p.id)},{...options,PDFLib:captured.lib});
  const images=contentImages(captured);assert.equal(images.length,2);assert.equal(images[0].value.width,1200);assert.equal(images[1].value.width,500);assertSafe(captured);
});

test('unsupported text is visible as a notice and never silently changes the source notes',async()=>{
  const captured=recordDrawing(),notes='Acceso al salón y café\nCheck the 🚌 route';
  const result=await buildPhotoPdf({report:report(),photos:[],notes,loadImage:()=>assert.fail()},{...options,PDFLib:captured.lib});
  assert.equal(result.textWarning,true);const text=printed(captured);assert.ok(text.includes('Acceso al salón y café'));assert.ok(text.includes('Text notice'));assert.ok(text.includes('Some characters could not be printed'));
  assert.equal(notes,'Acceso al salón y café\nCheck the 🚌 route');assertSafe(captured);
});

test('missing imagery or convention logo fails clearly instead of returning a partial unbranded report',async()=>{
  await assert.rejects(buildPhotoPdf({report:report(),photos:photos(),loadImage:async p=>{if(p.id==='outside')throw Error('selected image unavailable');return fixtures.get(p.id);} },options),/selected image unavailable/);
  await assert.rejects(buildPhotoPdf({report:report(),photos:[photos()[0]],loadImage:()=>new Blob(['not a JPEG'])},options),/not a valid JPEG/);
  await assert.rejects(buildPhotoPdf({report:report(),photos:[]},{...options,logoBytes:Uint8Array.of(0)}),/convention logo/);
  let requested;
  const loaded=await buildPhotoPdf({report:report(),photos:[]},{...options,logoBytes:undefined,fetch:async url=>{requested=url;return{ok:true,arrayBuffer:async()=>logoBytes};}});
  assert.match(requested,/assets\/denver-2027-territory-logo\.png$/);assert.equal(loaded.pages,1);
  await assert.rejects(buildPhotoPdf({report:report(),photos:[]},{...options,logoBytes:undefined,fetch:async()=>({ok:false})}),/convention logo/);
});

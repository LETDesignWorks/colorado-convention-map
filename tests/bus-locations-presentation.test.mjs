import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectPresentationLocations,buildLocationsPresentation} from '../bus-access/locations-presentation.mjs';
import {newTrafficPlan} from '../bus-access/traffic-model.mjs';
import {buildPhotoPdf,publicPhotoReport} from '../bus-access/photos-pdf.mjs';
import {buildTrafficPdf} from '../bus-access/traffic-pdf.mjs';
import {mergePdfDocuments} from '../pdf-tools/pdf-merge.mjs';

const now=new Date('2026-11-08T18:00:00Z');
const location=id=>({id,name:`Sample ${id}`,markerLabel:id.toUpperCase(),address:'Synthetic meeting location',lat:39.6,lng:-105,congregations:['Sample congregation']});
const plan=(id,name=`Saved parking ${id}`)=>({...newTrafficPlan(location(id),now),name});
const record=(id,layoutId=`layout-${id}`,name)=>({id:layoutId,savedAt:100,plan:plan(id,name)});
const selection=(id,{includePhotos=true,layoutId=`layout-${id}`}={})=>({location:location(id),includePhotos,layoutId});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function freeze(value){Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return Object.freeze(value);}
function fixture(label,pages=1,extra={}) {
  return {blob:new Blob([JSON.stringify({label,pages})],{type:'application/pdf'}),filename:`${label}.pdf`,pages,isCurrent:()=>true,...extra};
}
const read=async document=>JSON.parse(await document.blob.text());
async function fakeMerge(documents,options={}) {
  const parts=await Promise.all(documents.map(read));
  return fixture(parts.map(part=>part.label).join(' → '),parts.reduce((sum,part)=>sum+part.pages,0),{filename:options.filename});
}
async function fakePresentation(documents,options={}) {
  const parts=await Promise.all(documents.map(read)),pages=parts.reduce((sum,part)=>sum+part.pages,0);
  return {blob:new Blob(['synthetic presentation']),filename:options.filename||'locations.pptx',pages,slides:pages};
}
const defaults={buildPhoto:async id=>fixture(`photos-${id}`),listLayouts:async id=>[record(id)],exportParking:async value=>fixture(`parking-${value.locationId}`),merge:fakeMerge,createPresentation:fakePresentation};

test('inspection keeps input order, limits all reads to two at a time, and exposes failures without retaining images',async()=>{
  const locations=['a','b','c','d'].map(location),gates=Object.fromEntries(locations.map(item=>[item.id,deferred()]));
  let active=0,peak=0;const starts=[],lists=[],messages=[],original=record('a');freeze(original);
  const resultPromise=inspectPresentationLocations(locations,{library:'shared',progress:message=>messages.push(message),
    inspectPhoto:async(id,options)=>{
      assert.equal(options.library,'shared');starts.push(id);active++;peak=Math.max(peak,active);
      try {await gates[id].promise;if(id==='c')throw Error('Photo library unavailable');return {photoCount:2,totalPhotos:3,hasNotes:true,overviewPhotoId:'outside',image:new Blob(['private bytes']),records:[{image:new Blob(['private bytes'])}]};}
      finally {active--;}
    },
    listLayouts:async id=>{lists.push(id);active++;peak=Math.max(peak,active);try{await turn();if(id==='d')throw Error('Saved layout read failed');return[id==='a'?original:record(id)];}finally{active--;}}
  });
  assert.deepEqual(starts,['a','b']);
  gates.b.resolve();await turn();await turn();assert.ok(starts.includes('c'));
  gates.c.resolve();await turn();assert.ok(starts.includes('d'));
  gates.d.resolve();gates.a.resolve();
  const rows=await resultPromise;
  assert.equal(peak,2);assert.deepEqual(rows.map(row=>row.location.id),['a','b','c','d']);
  assert.deepEqual(rows[0].photos,{photoCount:2,totalPhotos:3,hasNotes:true,overviewPhotoId:'outside'});
  assert.notEqual(rows[0].layouts[0].plan,original.plan);assert.ok(!lists.includes('c'));
  for(const row of rows.slice(2)){assert.equal(row.photos,null);assert.deepEqual(row.layouts,[]);assert.ok(row.error);}
  assert.match(rows[2].error,/Photo library/);assert.match(rows[3].error,/Saved layout/);assert.match(messages.at(-1),/Checked 4 of 4/);
});

test('inspection cancellation or an account change stops pending reads instead of returning ready rows',async()=>{
  for(const changed of ['cancel','account']) {
    const gate=deferred(),controller=new AbortController();let current=true,reads=0,layouts=0;
    const pending=inspectPresentationLocations(['a','b','c'].map(location),{signal:controller.signal,isCurrent:()=>current,
      inspectPhoto:async()=>{reads++;return gate.promise;},listLayouts:async()=>{layouts++;return[];}});
    assert.equal(reads,2);
    if(changed==='cancel')controller.abort();else current=false;
    gate.resolve({photoCount:0,totalPhotos:0,hasNotes:false});
    await assert.rejects(pending,changed==='cancel'?{name:'AbortError'}:/changed/);
    assert.equal(reads,2);assert.equal(layouts,0);
  }
});

test('incomplete photo metadata and invalid parking records stay visible as inspection errors',async()=>{
  const rows=await inspectPresentationLocations(['a','b'].map(location),{
    inspectPhoto:async id=>id==='a'?undefined:{photoCount:0,totalPhotos:0,hasNotes:false},
    listLayouts:async()=>[{...record('b'),savedAt:true}]
  });
  assert.ok(rows.every(row=>row.error&&row.photos===null&&row.layouts.length===0));
});

test('batch uses each chosen saved ID, keeps location/photo/parking order, and never changes source records',async()=>{
  const choices=freeze([selection('a',{layoutId:'older-a'}),selection('b',{includePhotos:false}),selection('c',{layoutId:''})]);
  const stored=freeze({a:[record('a','newer-a','Newest alternative'),record('a','older-a','Chosen saved copy')],b:[record('b')]});
  const untouched=JSON.stringify(stored),calls=[],merges=[],messages=[];let currentPhoto=true,exported;
  const result=await buildLocationsPresentation(choices,{...defaults,library:'shared',title:'Locations / planning',progress:message=>messages.push(message),
    listLayouts:async id=>{calls.push(`list:${id}`);return stored[id];},
    buildPhoto:async(id,options)=>{calls.push(`photos:${id}`);assert.equal(options.library,'shared');return fixture(`photos-${id}`,id==='a'?2:1,{textWarning:id==='a',isCurrent:()=>currentPhoto&&options.isCurrent()});},
    exportParking:async(value,options)=>{calls.push(`parking:${value.name}`);assert.equal(options.unsaved,false);assert.notEqual(value,stored[value.locationId].at(-1).plan);value.notes='Renderer-only mutation';return fixture(`parking-${value.locationId}`);},
    merge:async(documents,options)=>{merges.push(documents.map(item=>item.name));return fakeMerge(documents,options);},
    createPresentation:async(documents,options)=>{exported=await Promise.all(documents.map(read));assert.equal(options.layout,'wide');return fakePresentation(documents,options);}
  });
  assert.deepEqual(calls,['list:a','photos:a','parking:Chosen saved copy','list:b','parking:Saved parking b','photos:c']);
  assert.deepEqual(merges,[['photos-a.pdf','parking-a.pdf']]);
  assert.deepEqual(exported.map(item=>item.label),['photos-a → parking-a','parking-b','photos-c']);
  assert.equal(result.locationCount,3);assert.equal(result.slides,5);assert.equal(result.filename,'Locations---planning.pptx');
  assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/Sample a/);assert.equal(JSON.stringify(stored),untouched);
  assert.equal(result.isCurrent(),true);currentPhoto=false;assert.equal(result.isCurrent(),false,'photo guards remain live until download');
  assert.ok(messages.some(message=>message.includes('Location 3 of 3')));
});

test('fifty locations with both sources become fifty packets, not one hundred input PDFs',async()=>{
  let merges=0,files=0;
  const result=await buildLocationsPresentation(Array.from({length:50},(_,i)=>selection(`place-${i}`)),{...defaults,
    merge:async(...args)=>{merges++;return fakeMerge(...args);},
    createPresentation:async(documents,options)=>{files=documents.length;return fakePresentation(documents,options);}
  });
  assert.equal(merges,50);assert.equal(files,50);assert.equal(result.locationCount,50);assert.equal(result.slides,100);
  assert.equal(result.filename,'Denver-2027-Location-Photos-and-Parking.pptx');
});

test('empty, excessive, repeated, or content-free selections reject before reading private sources',async()=>{
  const noReads={...defaults,buildPhoto:()=>assert.fail('must not read photos'),listLayouts:()=>assert.fail('must not read saved layouts')};
  await assert.rejects(buildLocationsPresentation([],{...noReads}),/Select at least one/);
  await assert.rejects(buildLocationsPresentation(Array.from({length:51},(_,i)=>selection(`p${i}`)),noReads),/50 locations/);
  await assert.rejects(buildLocationsPresentation([selection('a'),selection('a')],noReads),/more than once/);
  await assert.rejects(buildLocationsPresentation([selection('a',{includePhotos:false,layoutId:''})],noReads),/location report or a saved parking/);
  await assert.rejects(buildLocationsPresentation([selection('a')],{...noReads,library:'unknown'}),/device or shared/);
});

test('a removed saved ID fails instead of silently substituting the newest parking plan',async()=>{
  let photos=0,parking=0,presentations=0;
  await assert.rejects(buildLocationsPresentation([selection('a',{layoutId:'deleted-id'})],{...defaults,
    buildPhoto:async()=>{photos++;return fixture('photos');},listLayouts:async()=>[record('a','newer-id')],
    exportParking:async()=>{parking++;return fixture('parking');},createPresentation:async()=>{presentations++;return {};}
  }),/Sample a.*no longer exists/);
  assert.equal(photos+parking+presentations,0);
});

test('a later photo, parking, or merge failure prevents the entire presentation',async()=>{
  for(const failure of ['photo','parking','merge']) {
    let presented=false;
    await assert.rejects(buildLocationsPresentation([selection('a'),selection('b')],{...defaults,
      buildPhoto:async id=>{if(id==='b'&&failure==='photo')throw Error('Selected image missing');return fixture(`photos-${id}`);},
      exportParking:async value=>{if(value.locationId==='b'&&failure==='parking')throw Error('Map background unavailable');return fixture(`parking-${value.locationId}`);},
      merge:async(documents,options)=>{if(documents[0].name==='photos-b.pdf'&&failure==='merge')throw Error('Packet could not merge');return fakeMerge(documents,options);},
      createPresentation:async()=>{presented=true;return {};}
    }),/Sample b.*No presentation was created/);
    assert.equal(presented,false);
  }
});

test('cancellation discards a slow source promptly and never starts the next source', {timeout:3000},async()=>{
  const gate=deferred(),started=deferred(),controller=new AbortController();let parking=0,presented=0;
  const pending=buildLocationsPresentation([selection('a'),selection('b')],{...defaults,signal:controller.signal,
    buildPhoto:()=>{started.resolve();return gate.promise;},exportParking:async()=>{parking++;return fixture('parking');},createPresentation:async()=>{presented++;return {};}
  });
  await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(parking+presented,0);gate.resolve(fixture('late-photos'));await turn();assert.equal(parking+presented,0);
});

test('photo or account changes during map, merge, or PowerPoint work invalidate the result',async()=>{
  for(const phase of ['map','merge','presentation']) {
    const gate=deferred(),started=deferred();let photoCurrent=true,accountCurrent=true;
    const pending=buildLocationsPresentation([selection('a')],{...defaults,isCurrent:()=>accountCurrent,
      buildPhoto:async()=>fixture('photos-a',1,{isCurrent:()=>photoCurrent}),
      exportParking:async()=>{if(phase==='map'){started.resolve();return gate.promise;}return fixture('parking-a');},
      merge:async(documents,options)=>{if(phase==='merge'){started.resolve();return gate.promise;}return fakeMerge(documents,options);},
      createPresentation:async()=>{started.resolve();return gate.promise;}
    });
    await started.promise;
    if(phase==='map')accountCurrent=false;else photoCurrent=false;
    gate.resolve(phase==='presentation'?{blob:new Blob(['pptx']),filename:'sample.pptx',pages:2,slides:2}:fixture(phase,phase==='merge'?2:1));
    await assert.rejects(pending,/changed/);
  }
});

test('the existing byte/page limits and complete-page requirement apply before a download can exist',async()=>{
  const options={...defaults,createPresentation:()=>assert.fail('invalid packets must not reach presentation')};
  const oversized={size:50*1024*1024+1,arrayBuffer:async()=>new ArrayBuffer(0)};
  await assert.rejects(buildLocationsPresentation([selection('a',{layoutId:''})],{...options,buildPhoto:async()=>fixture('large',1,{blob:oversized})}),/larger than 50 MB/);
  await assert.rejects(buildLocationsPresentation([selection('a',{layoutId:''}),selection('b',{layoutId:''})],{...options,buildPhoto:async id=>fixture(id,id==='a'?150:51)}),/more than 200 pages/);
  const medium={size:45*1024*1024,arrayBuffer:async()=>new ArrayBuffer(0)};
  await assert.rejects(buildLocationsPresentation(['a','b','c','d','e'].map(id=>selection(id,{layoutId:''})),{...options,buildPhoto:async id=>fixture(id,1,{blob:medium})}),/more than 200 MB/);
  await assert.rejects(buildLocationsPresentation([selection('a')],{...options,merge:async()=>fixture('incomplete',1)}),/every selected page/);
  await assert.rejects(buildLocationsPresentation([selection('a')],{...defaults,createPresentation:async()=>({blob:new Blob(['incomplete']),pages:1,slides:1})}),/every selected page/);
});

test('two locations use the actual photo, merge, and PPTX engines with original branding and page order',async()=>{
  const require=createRequire(import.meta.url),dependencies=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'locations-pptx-qa.cjs')):require;
  const PDFLib=require('../load-tests/vendor/pdf-lib.min.js'),PptxGenJS=dependencies('pptxgenjs'),JSZip=dependencies('jszip'),canvasApi=dependencies('@napi-rs/canvas');
  for(const key of ['DOMMatrix','ImageData','Path2D'])globalThis[key]??=canvasApi[key];
  const pdfjs=await import(pathToFileURL(dependencies.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href),pdfjsRoot=dirname(dependencies.resolve('pdfjs-dist/package.json'));
  const ribbonAssets={header:readFileSync(new URL('../assets/print-header-sky.png',import.meta.url)),footer:readFileSync(new URL('../assets/print-footer-hills.png',import.meta.url))};
  const logoBytes=readFileSync(new URL('../assets/denver-2027-territory-logo.png',import.meta.url)),jpeg=readFileSync(new URL('../load-tests/assets/bible.jpg',import.meta.url));
  const records={west:record('west'),east:record('east')},readPhotos=[],packets=[];let current=true;
  const actualParking=process.env.LOCATIONS_PPTX_QA_PARKING?new Blob([readFileSync(process.env.LOCATIONS_PPTX_QA_PARKING)],{type:'application/pdf'}):null;
  const result=await buildLocationsPresentation([selection('west'),selection('east')],{
    PDFLib,pdfjs,PptxGenJS,createCanvas:canvasApi.createCanvas,
    pdfjsOptions:{standardFontDataUrl:join(pdfjsRoot,'standard_fonts/'),wasmUrl:join(pdfjsRoot,'wasm/'),useWorkerFetch:false},
    buildPhoto:async id=>({...(await buildPhotoPdf({report:publicPhotoReport(location(id),{status:'Approved',publicSummary:'Synthetic site-visit overview for export verification.'}),
      notes:`${id==='west'?'West':'East'} location — sample notes.\nUse the marked parking rows.`,overviewPhotoId:'outside',
      photos:[{id:'inside',category:'interior',caption:'Synthetic interior photo',selected:true},{id:'outside',category:'exterior',caption:'Synthetic exterior overview',selected:true},{id:'excluded',category:'exterior',caption:'Excluded image',selected:false}],
      loadImage:async photo=>{readPhotos.push(`${id}:${photo.id}`);return new Blob([jpeg],{type:'image/jpeg'});}
    },{PDFLib,ribbonAssets,logoBytes,now})),isCurrent:()=>current}),
    listLayouts:async id=>[records[id]],
    exportParking:async value=>actualParking?{blob:actualParking,filename:`${value.locationId}-parking.pdf`,pages:1}:buildTrafficPdf(value,{PDFLib,ribbonAssets,logoBytes,mapImage:async()=>jpeg,now}),
    merge:async(documents,options)=>{const result=await mergePdfDocuments(documents,options);packets.push(result);return result;}
  });
  assert.equal(result.locationCount,2);assert.equal(result.slides,4);assert.deepEqual(result.warnings,[]);
  assert.deepEqual(readPhotos,['west:inside','west:outside','east:inside','east:outside']);
  for(const packet of packets){
    const pdf=await PDFLib.PDFDocument.load(await packet.blob.arrayBuffer());
    assert.deepEqual(pdf.getPages().map(page=>page.getSize()),[{width:960,height:540},{width:792,height:612}]);
    for(const page of pdf.getPages()){
      const objects=page.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
      const dimensions=objects.keys().map(key=>{const dict=objects.lookup(key).dict;return[dict.lookup(PDFLib.PDFName.of('Width'))?.asNumber(),dict.lookup(PDFLib.PDFName.of('Height'))?.asNumber()];});
      assert.ok(dimensions.some(([w,h])=>w===2048&&h===170));assert.ok(dimensions.some(([w,h])=>w===2048&&h===130));
    }
  }
  const zip=await JSZip.loadAsync(await result.blob.arrayBuffer()),slides=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));
  assert.equal(slides.length,4);
  for(const[index,path]of slides.entries()){
    const xml=await zip.file(path).async('string');assert.equal((xml.match(/<p:pic>/g)||[]).length,1);
    const notes=await zip.file(`ppt/notesSlides/notesSlide${index+1}.xml`).async('string');
    assert.match(notes,index<2?/Sample-west-location-and-parking/:/Sample-east-location-and-parking/);
    assert.match(notes,index%2===0?/Source page: 1 of 2/:/Source page: 2 of 2/);
  }
  const media=Object.keys(zip.files).filter(name=>/^ppt\/media\/.*\.png$/.test(name));assert.equal(media.length,4);
  const out=process.env.LOCATIONS_PPTX_QA_OUT;
  if(out){mkdirSync(out,{recursive:true});writeFileSync(join(out,'two-locations-synthetic.pptx'),new Uint8Array(await result.blob.arrayBuffer()));}
  for(const[index,path]of media.entries()){
    const bytes=await zip.file(path).async('nodebuffer'),image=await canvasApi.loadImage(bytes);assert.equal(Math.max(image.width,image.height),2800);
    const canvas=canvasApi.createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const sky=ctx.getImageData(20,2,1,1).data,hills=ctx.getImageData(20,image.height-2,1,1).data;
    assert.ok(sky[2]>220&&sky[1]>200&&sky[0]<220);assert.ok(hills[2]>hills[0]&&hills[1]>hills[0]&&hills[0]<60);
    if(out)writeFileSync(join(out,`slide-${index+1}.png`),bytes);
  }
  assert.equal(result.isCurrent(),true);current=false;assert.equal(result.isCurrent(),false);
});

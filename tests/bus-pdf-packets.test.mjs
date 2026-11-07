import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildParkingPdfPacket} from '../bus-access/traffic-planner.mjs';
import {mountLocationPhotos} from '../bus-access/photos.mjs';
import {newTrafficPlan} from '../bus-access/traffic-model.mjs';
import {buildTrafficPdf} from '../bus-access/traffic-pdf.mjs';
import {buildPhotoPdf, publicPhotoReport} from '../bus-access/photos-pdf.mjs';
import {mergePdfDocuments} from '../pdf-tools/pdf-merge.mjs';

const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const ribbonAssets={header:readFileSync('assets/print-header-sky.png'),footer:readFileSync('assets/print-footer-hills.png')};
const logoBytes=readFileSync('assets/denver-2027-territory-logo.png'),jpeg=readFileSync('load-tests/assets/bible.jpg');
const now=new Date('2026-11-07T18:00:00Z');
const location=()=>({id:'packet-test',markerLabel:'21',name:'Sample meeting location',address:'Synthetic meeting-place test',lat:39.6,lng:-105.0,congregations:['Sample congregation']});
const photo=(id,selected=true)=>({id,category:id==='inside'?'interior':'exterior',caption:id==='inside'?'Interior test photo':'Exterior test photo',selected,createdAt:123});
const pdfResult=(label='test')=>({filename:label+'.pdf',blob:new Blob(['%PDF-test '+label],{type:'application/pdf'}),pages:1});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('combined export keeps review and selected photos first, then landscape parking pages with both ribbons',async()=>{
  const plan=newTrafficPlan(location(),now);plan.name='Sample bus arrival';
  plan.items=[{id:'cone-1',kind:'cone',label:'',point:[39.60001,-105.00001]}];
  const untouched=structuredClone(plan),read=[];
  const review=await buildPhotoPdf({report:publicPhotoReport(location(),{status:'Approved',publicSummary:'Use the south entrance.'}),photos:[photo('inside'),photo('outside'),photo('not-selected',false)],loadImage:async p=>{read.push(p.id);return new Blob([jpeg],{type:'image/jpeg'});}},{PDFLib,ribbonAssets,now});
  const reviewBytes=new Uint8Array(await review.blob.arrayBuffer());
  let expectedLocation,parking;
  const result=await buildParkingPdfPacket(plan,{combined:true,
    getLocationPdf:async options=>{expectedLocation=options.expectedLocationId;return{...review,isCurrent:()=>true};},
    exportPdf:async captured=>{parking=await buildTrafficPdf(captured,{PDFLib,ribbonAssets,logoBytes,mapImage:async()=>'data:image/jpeg;base64,'+jpeg.toString('base64'),now});return parking;},
    mergePdfs:(documents,options)=>mergePdfDocuments(documents,{...options,PDFLib})});
  assert.equal(expectedLocation,plan.locationId);assert.deepEqual(read,['inside','outside']);assert.deepEqual(plan,untouched);
  assert.deepEqual(new Uint8Array(await review.blob.arrayBuffer()),reviewBytes);
  assert.equal(result.pages,review.pages+parking.pages);assert.equal(result.isCurrent(),true);
  const output=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());
  assert.deepEqual(output.getPages().map(p=>p.getSize()),[
    ...Array.from({length:review.pages},()=>({width:612,height:792})),
    ...Array.from({length:parking.pages},()=>({width:792,height:612}))]);
  for(const page of output.getPages()){
    const objects=page.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    const dimensions=objects.keys().map(key=>{const dict=objects.lookup(key).dict;return [dict.lookup(PDFLib.PDFName.of('Width'))?.asNumber(),dict.lookup(PDFLib.PDFName.of('Height'))?.asNumber()];});
    assert.ok(dimensions.some(([w,h])=>w===2048&&h===170),'header image retained');
    assert.ok(dimensions.some(([w,h])=>w===2048&&h===130),'footer image retained');
  }
  if(process.env.PACKET_QA_OUTPUT){mkdirSync(process.env.PACKET_QA_OUTPUT,{recursive:true});writeFileSync(process.env.PACKET_QA_OUTPUT+'/bus-review-and-parking.pdf',new Uint8Array(await result.blob.arrayBuffer()));}
});

test('separate parking export uses its existing renderer and does not read location photos or merge',async()=>{
  const parking=pdfResult('parking'),plan=newTrafficPlan(location(),now);
  const result=await buildParkingPdfPacket(plan,{exportPdf:async()=>parking,getLocationPdf:()=>assert.fail('separate export must not read photos'),mergePdfs:()=>assert.fail('separate export must not merge')});
  assert.equal(result.blob,parking.blob);assert.equal(result.filename,parking.filename);
});

test('combined export fails before map work when review photos are unavailable and never returns a partial packet',async()=>{
  const plan=newTrafficPlan(location(),now);let maps=0;
  await assert.rejects(buildParkingPdfPacket(plan,{combined:true,getLocationPdf:async()=>{throw Error('Photo library is still loading.');},exportPdf:async()=>{maps++;return pdfResult();}}),/loading/);
  await assert.rejects(buildParkingPdfPacket(plan,{combined:true,getLocationPdf:async()=>({blob:new Blob([])}),exportPdf:async()=>{maps++;return pdfResult();}}),/No combined PDF/);
  assert.equal(maps,0);
  await assert.rejects(buildParkingPdfPacket(plan,{combined:true,getLocationPdf:async()=>pdfResult('review'),exportPdf:async()=>pdfResult('parking'),mergePdfs:async()=>{throw Error('Merge unavailable');}}),/Merge unavailable/);
});

test('location, sign-in, or selected-photo changes during rendering and merging invalidate the entire packet',async()=>{
  const plan=newTrafficPlan(location(),now),renderGate=deferred();let current=true,merges=0;
  const rendering=buildParkingPdfPacket(plan,{combined:true,isCurrent:()=>current,getLocationPdf:async()=>pdfResult('review'),exportPdf:()=>renderGate.promise,mergePdfs:async()=>{merges++;return pdfResult('merged');}});
  await Promise.resolve();current=false;renderGate.resolve(pdfResult('parking'));
  await assert.rejects(rendering,/changed/);assert.equal(merges,0);
  const mergeGate=deferred(),mergeStarted=deferred();let photosCurrent=true;
  const merging=buildParkingPdfPacket(plan,{combined:true,getLocationPdf:async()=>({...pdfResult('review'),isCurrent:()=>photosCurrent}),exportPdf:async()=>pdfResult('parking'),mergePdfs:()=>{mergeStarted.resolve();return mergeGate.promise;}});
  await mergeStarted.promise;photosCurrent=false;mergeGate.resolve(pdfResult('merged'));
  await assert.rejects(merging,/changed/);
});

// A small DOM test double keeps these context/permission tests independent of
// a browser or an additional package. Production code handles all async work.
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element {
  constructor(tag,document){
    this.tagName=tag.toLowerCase();this.ownerDocument=document;this.children=[];this.parentElement=null;this.attributes=new Map();this.events=new Map();this._text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;
    this.dataset=new Proxy({}, {set:(target,key,value)=>{target[key]=String(value);this.attributes.set('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),String(value));return true;}});
    this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!classes.has(name))classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');},add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false),contains:name=>this.className.split(/\s+/).includes(name)};
  }
  get className(){return this.attributes.get('class')||'';}set className(value){this.attributes.set('class',value);}
  get id(){return this.attributes.get('id')||'';}set id(value){this.attributes.set('id',value);}
  get isConnected(){let node=this;while(node.parentElement)node=node.parentElement;return node===this.ownerDocument.root;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='value')this.value=decode(String(value));if(name==='checked')this.checked=true;if(name==='disabled')this.disabled=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  after(node){const parent=this.parentElement,index=parent.children.indexOf(this);node.remove();node.parentElement=parent;parent.children.splice(index+1,0,node);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(x=>x!==this);this.parentElement=null;}}
  set textContent(value){this.replaceChildren();this._text=String(value);}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(html){
    this.replaceChildren();const stack=[this],voids=new Set(['input','img','link','br','meta','hr']);
    for(const match of html.matchAll(/<\/?[^>]+>|[^<]+/g)){
      const token=match[0];if(!token.startsWith('<')){stack.at(-1)._text+=decode(token);continue;}
      if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
      const [,tag,attrs]=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/)||[];if(!tag)continue;
      const node=this.ownerDocument.createElement(tag);
      for(const [,name,a,b,c]of attrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))node.setAttribute(name,decode(a??b??c??''));
      stack.at(-1).append(node);if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node);
    }
  }
  querySelectorAll(selector){
    const descendants=[];const visit=node=>node.children.forEach(child=>{descendants.push(child);visit(child);});visit(this);
    const match=(node,part)=>{if(part.startsWith('#'))return node.id===part.slice(1);const a=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return a?node.attributes.has(a[1])&&(a[2]===undefined||node.getAttribute(a[1])===a[2]):node.tagName===part;};
    return descendants.filter(node=>selector.split(',').some(group=>{const parts=group.trim().split(/\s+/);if(!match(node,parts.pop()))return false;let ancestor=node.parentElement;while(parts.length){const part=parts.pop();while(ancestor&&!match(ancestor,part))ancestor=ancestor.parentElement;if(!ancestor)return false;ancestor=ancestor.parentElement;}return true;}));
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,callback){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(callback);}
  async trigger(type){const event={target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const fn of this.events.get(type)||[])await fn(event);return event;}
}
function documentStub(){
  const d={createElement:tag=>new Element(tag,d)};d.root=d.createElement('html');d.head=d.createElement('head');d.body=d.createElement('body');d.root.append(d.head,d.body);d.getElementById=id=>d.root.querySelector('#'+id);
  const detail=d.createElement('div');detail.id='detail';d.body.append(detail);return d;
}
async function settle(){for(let i=0;i<15;i++)await Promise.resolve();}
function photoPanelHarness(options={}){
  const d=documentStub(),state={location:location(),summary:{status:'Approved',publicSummary:'Saved public summary',internalNotes:'SECRET-NOTE'},owner:'admin-a',admin:true},records=options.records||[],writes=[],reads=[],sent=[],revoked=[];let url=0;
  const w={URL:{createObjectURL:()=>`blob:test-${++url}`,revokeObjectURL:url=>revoked.push(url)},confirm:()=>true,indexedDB:{}};
  const store={list:options.list|| (async()=>records),thumbnail:async()=>new Blob(['thumbnail']),image:options.image|| (async(id,p)=>{reads.push(p.id);return new Blob([jpeg],{type:'image/jpeg'});}),update:async(id,p)=>{writes.push(p.id);Object.assign(records.find(x=>x.id===p.id),p);}};
  const panel=mountLocationPhotos({document:d,window:w,getLocation:()=>state.location,getSummary:()=>state.summary,getOwner:()=>state.owner,isAdmin:()=>state.admin,createSharedStore:()=>store,
    onPdfChanged:options.onPdfChanged,
    exportPdf:options.exportPdf|| (async source=>{for(const p of source.photos.filter(x=>x.selected!==false))await source.loadImage(p);assert.ok(!JSON.stringify(source.report).includes('SECRET-NOTE'));return pdfResult('location');}),
    sendToBuilder:async(documents,config)=>{assert.equal(config.isCurrent(),true);sent.push(...documents);config.notify('Added to PDFs & PowerPoint.');}});
  panel.contextChanged();return{d,state,panel,reads,writes,sent,revoked};
}

test('location snapshot waits for loaded photos, includes only selected imagery and never saves metadata',async()=>{
  const gate=deferred(),h=photoPanelHarness({list:()=>gate.promise});
  assert.throws(()=>h.panel.buildPdfSnapshot({expectedLocationId:'packet-test'}),/still loading/);
  gate.resolve([photo('inside'),photo('outside',false)]);await settle();
  const ready=h.d.getElementById('locationPhotos').querySelector('[data-photo-pdf]');assert.equal(ready.disabled,false);
  const result=await h.panel.buildPdfSnapshot({expectedLocationId:'packet-test'});
  assert.deepEqual(h.reads,['inside']);assert.deepEqual(h.writes,[]);assert.equal(result.isCurrent(),true);assert.equal(ready.disabled,false);
  h.state.summary.publicSummary='A changed saved summary';assert.equal(result.isCurrent(),false);
  h.panel.dispose();
});

test('failed photo loading or an unsaved caption cannot silently produce an incomplete review',async()=>{
  const failed=photoPanelHarness({list:async()=>{throw Error('offline');}});await settle();
  assert.throws(()=>failed.panel.buildPdfSnapshot({expectedLocationId:'packet-test'}),/has not loaded/);failed.panel.dispose();
  const h=photoPanelHarness({records:[photo('inside')]});await settle();
  const caption=h.d.getElementById('locationPhotos').querySelector('[data-photo-caption]');caption.value='Not yet saved';await caption.trigger('input');
  assert.throws(()=>h.panel.buildPdfSnapshot({expectedLocationId:'packet-test'}),/Save the edited captions/);assert.deepEqual(h.reads,[]);h.panel.dispose();
});

test('location snapshot rejects a different location or administrator while an image is loading',async()=>{
  const gate=deferred(),started=deferred(),h=photoPanelHarness({records:[photo('inside')],image:()=>{started.resolve();return gate.promise;}});await settle();
  assert.throws(()=>h.panel.buildPdfSnapshot({expectedLocationId:'other-location'}),/changed/);
  const pending=h.panel.buildPdfSnapshot({expectedLocationId:'packet-test'});await started.promise;h.state.owner='admin-b';gate.resolve(new Blob([jpeg],{type:'image/jpeg'}));
  await assert.rejects(pending,/changed/);h.panel.dispose();
});

test('a photo selection changed during packet rendering invalidates the snapshot and completed PDF handoff',async()=>{
  const gate=deferred(),h=photoPanelHarness({records:[photo('inside')],exportPdf:()=>gate.promise});await settle();
  const pending=h.panel.buildPdfSnapshot({expectedLocationId:'packet-test'});
  const selection=h.d.getElementById('locationPhotos').querySelector('[data-photo-select]');selection.checked=false;await selection.trigger('change');gate.resolve(pdfResult('location'));
  await assert.rejects(pending,/changed/);assert.deepEqual(h.writes,['inside']);h.panel.dispose();
  const ready=photoPanelHarness();await settle();const host=ready.d.getElementById('locationPhotos');await host.querySelector('[data-photo-pdf]').trigger('click');
  const button=host.querySelectorAll('button').find(x=>x.textContent==='Add to PowerPoint');assert.ok(button);await button.trigger('click');assert.equal(ready.sent.length,1);
  ready.state.admin=false;await button.trigger('click');assert.equal(ready.sent.length,1,'signed-out context cannot transfer another PDF');ready.panel.dispose();
});

test('saved review changes revoke completed links and notify the parking packet after invalidating its snapshot',async()=>{
  let changes=0,snapshot;
  const h=photoPanelHarness({onPdfChanged:()=>{changes++;if(snapshot)assert.equal(snapshot.isCurrent(),false);}});await settle();
  const host=h.d.getElementById('locationPhotos');await host.querySelector('[data-photo-pdf]').trigger('click');
  const download=host.querySelector('[data-photo-pdf-links]').querySelector('a');assert.ok(download);
  snapshot=await h.panel.buildPdfSnapshot({expectedLocationId:'packet-test'});assert.equal(snapshot.isCurrent(),true);
  const before=changes;h.state.summary.publicSummary='Updated public summary';h.panel.contextChanged();
  assert.equal(changes,before+1);assert.equal(host.querySelector('[data-photo-pdf-links]').children.length,0);assert.ok(h.revoked.includes(download.href));
  assert.equal((await download.trigger('click')).defaultPrevented,true,'a stale link reference cannot navigate');h.panel.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createPdfLibRibbons, ribbonLayout, printRibbonMarkup, loadPdfRibbonAssets} from '../assets/pdf-ribbons.mjs';
const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const ribbonAssets={header:fs.readFileSync(new URL('../assets/print-header-sky.png',import.meta.url)),footer:fs.readFileSync(new URL('../assets/print-footer-hills.png',import.meta.url))};
test('every portrait and landscape page has the original transparent art without moving content or fields',async()=>{
 const doc=await PDFLib.PDFDocument.create(),font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
 const field=doc.getForm().createTextField('written-notes');field.setText('Editable notes retained');
 for(const [w,h] of [[612,792],[792,612],[612,792]]){
  const page=doc.addPage([w,h]),body=ribbonLayout(w,h);
  page.drawText('Example page content remains readable',{x:35,y:h-body.top-25,size:14,font});
  page.drawRectangle({x:35,y:body.bottom+30,width:w-70,height:h-body.top-body.bottom-100,color:PDFLib.rgb(.92,.96,.98)});
 }
 field.addToPage(doc.getPage(2),{x:55,y:150,width:300,height:30});
 doc.getForm().updateFieldAppearances(font);
 const before=field.acroField.getWidgets()[0].getRectangle();
 const ribbons=await createPdfLibRibbons(doc,{ribbonAssets});ribbons.drawAllPages();ribbons.drawAllPages();
 assert.deepEqual(field.acroField.getWidgets()[0].getRectangle(),before);
 const bytes=await doc.save(),loaded=await PDFLib.PDFDocument.load(bytes);
 assert.equal(loaded.getPageCount(),3);assert.equal(loaded.getForm().getTextField('written-notes').getText(),'Editable notes retained');
 assert.deepEqual(loaded.getForm().getTextField('written-notes').acroField.getWidgets()[0].getRectangle(),before);
 for(const p of loaded.getPages()){
  const refs=p.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
  assert.equal(refs.keys().length,2,'one header and one footer per page');
 }
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/shared-ribbons.pdf',bytes);
});
test('ribbon reservations fit both orientations and print markup uses local assets without CSS backgrounds',()=>{
 for(const [w,h]of[[612,792],[792,612]]){const b=ribbonLayout(w,h);assert.ok(b.top<h*.1&&b.bottom<h*.1);assert.ok(b.headerHeight>b.top);assert.ok(b.footerHeight<b.bottom);}
 assert.throws(()=>ribbonLayout(-1,612));const html=printRibbonMarkup();assert.match(html,/print-header-sky\.png/);assert.match(html,/print-footer-hills\.png/);assert.match(html,/aria-hidden="true"/);assert.doesNotMatch(html,/<script/);
});
test('a failed artwork load can be retried and successful assets share one load',async()=>{
 await assert.rejects(loadPdfRibbonAssets({fetch:async()=>({ok:false})}),/could not load/);
 let calls=0;const fetch=async url=>{calls++;return{ok:true,arrayBuffer:async()=>url.includes('header')?ribbonAssets.header:ribbonAssets.footer};};
 const [a,b]=await Promise.all([loadPdfRibbonAssets({fetch}),loadPdfRibbonAssets({fetch})]);assert.equal(calls,2);assert.equal(a,b);
});

// A small event-driven document fixture exercises browser resource completion,
// failure and retry without a network dependency.
function printDocument({styleReady=false,imagesReady=true,decode=true}={}){
 const nodes=[];
 const d={body:{append(node){nodes.push(node);node.isConnected=true;}},querySelector(selector){
   if(selector==='.print-book')return d.book;
   return nodes.find(n=>selector.includes('data-print-ribbon-style')?n.tagName==='LINK':n.getAttribute('data-print-ribbon')===(selector.includes('"header"')?'header':'footer'))||null;
 },querySelectorAll(){return nodes.slice();},createElement(){
   return {content:{children:[]},set innerHTML(markup){this.content.children=Array.from(markup.matchAll(/<(link|img)\b([^>]+)>/g),match=>{
     const node=new EventTarget(),attrs=new Map(Array.from(match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g),m=>[m[1],m[2]||'']));
     Object.assign(node,{tagName:match[1].toUpperCase(),sheet:match[1]==='link'&&styleReady?{}:null,disabled:false,complete:imagesReady,naturalWidth:imagesReady?2048:0,naturalHeight:imagesReady?170:0,getAttribute:key=>attrs.has(key)?attrs.get(key):null,setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),remove(){const i=nodes.indexOf(node);if(i>=0)nodes.splice(i,1);node.isConnected=false;},load(){if(node.tagName==='LINK')node.sheet={};else{node.complete=true;node.naturalWidth=2048;node.naturalHeight=170;}node.dispatchEvent(new Event('load'));},fail(){node.complete=true;node.dispatchEvent(new Event('error'));}});
     if(match[1]==='img'&&decode)node.decode=()=>node.complete?(node.naturalWidth?Promise.resolve():Promise.reject(new Error('invalid image'))):new Promise((resolve,reject)=>{node.addEventListener('load',resolve,{once:true});node.addEventListener('error',reject,{once:true});});
     return node;
   });}};
 }};
 return d;
}
const {waitForPrintRibbons,mountPrintRibbons}=await import('../assets/pdf-ribbons.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('print waits for both image decode and stylesheet, sharing a concurrent attempt',async()=>{
 const d=printDocument({imagesReady:false});let completed=false;
 const a=waitForPrintRibbons(d),b=waitForPrintRibbons(d);assert.equal(a,b);
 a.then(()=>{completed=true;});await tick();
 d.querySelector('img[data-print-ribbon="header"]').load();
 d.querySelector('img[data-print-ribbon="footer"]').load();await tick();
 assert.equal(completed,false,'images alone do not make the layout ready');
 d.querySelector('link[data-print-ribbon-style]').load();await a;assert.equal(completed,true);
});
test('print fails usefully on resource errors and the next click loads new decorative nodes',async()=>{
 const d=printDocument({imagesReady:false});const first=waitForPrintRibbons(d);await tick();
 const oldHeader=d.querySelector('img[data-print-ribbon="header"]');oldHeader.fail();
 await assert.rejects(first,/header, footer, or print layout could not load/);
 const retry=waitForPrintRibbons(d);await tick();
 assert.notEqual(d.querySelector('img[data-print-ribbon="header"]'),oldHeader);
 d.querySelectorAll().forEach(node=>node.load());await retry;
});
test('print resource waits are bounded and image load fallback rejects broken images',async()=>{
 const d=printDocument({imagesReady:false});
 await assert.rejects(waitForPrintRibbons(d,{timeoutMs:10}),/choose Print \/ PDF again/);
 const fallback=printDocument({styleReady:true,imagesReady:false,decode:false});
 const ready=waitForPrintRibbons(fallback);fallback.querySelectorAll().forEach(node=>node.load());await ready;
 const broken=printDocument({styleReady:true,decode:false});mountPrintRibbons(broken);
 broken.querySelector('img[data-print-ribbon="header"]').naturalWidth=0;
 await assert.rejects(waitForPrintRibbons(broken),/could not load/);
});
test('print mounting repairs partial artwork without replacing an already loaded header',async()=>{
 const d=printDocument({styleReady:true});mountPrintRibbons(d);
 const header=d.querySelector('img[data-print-ribbon="header"]');d.querySelector('img[data-print-ribbon="footer"]').remove();
 await waitForPrintRibbons(d);assert.equal(d.querySelector('img[data-print-ribbon="header"]'),header);assert.equal(d.querySelectorAll().length,3);
});

const {installOperatingPlanPrintGuard}=await import('../operating-plan/print-ribbons.mjs');
function operatingDocument(label='Print / PDF'){
 const d=printDocument({styleReady:true});let listener,prints=0;const alerts=[];d.book={};
 d.defaultView={alert:message=>alerts.push(message)};d.addEventListener=(_type,fn)=>{listener=fn;};d.removeEventListener=()=>{listener=null;};
 const attrs=new Map(),button={textContent:label,isConnected:true,disabled:false,getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key),closest:()=>button,click(){let stopped=false;listener?.({target:button,preventDefault(){},stopImmediatePropagation(){stopped=true;}});if(!stopped&&!button.disabled)prints++;}};
 return {d,button,alerts,printed:()=>prints};
}
test('Operating Plan waits, blocks duplicate clicks, and replays the original English and Spanish action once',async()=>{
 for(const label of ['Print / PDF','Imprimir / PDF']){
  const f=operatingDocument(label);let ready;installOperatingPlanPrintGuard(f.d,{wait:()=>new Promise(resolve=>{ready=resolve;})});
  f.button.click();f.button.click();assert.equal(f.printed(),0);assert.equal(f.button.getAttribute('aria-busy'),'true');
  ready();await tick();assert.equal(f.printed(),1);assert.equal(f.button.getAttribute('aria-busy'),null);
 }
});
test('Operating Plan reports readiness errors, permits retry and does not print a changed or disabled plan',async()=>{
 const f=operatingDocument();let attempts=0;installOperatingPlanPrintGuard(f.d,{wait:async()=>{if(!attempts++)throw new Error('Artwork could not load. Try Print / PDF again.');}});
 f.button.click();await tick();assert.equal(f.printed(),0);assert.match(f.alerts[0],/could not load/);
 f.button.click();await tick();assert.equal(f.printed(),1);
 for(const change of [f=>f.button.disabled=true,f=>f.button.isConnected=false,f=>f.d.book={}]){
  const next=operatingDocument();let ready;installOperatingPlanPrintGuard(next.d,{wait:()=>new Promise(resolve=>{ready=resolve;})});next.button.click();change(next);ready();await tick();assert.equal(next.printed(),0);
 }
 const unrelated=operatingDocument('Save');installOperatingPlanPrintGuard(unrelated.d,{wait:()=>{throw new Error('must not run');}});unrelated.button.click();assert.equal(unrelated.printed(),1);
});

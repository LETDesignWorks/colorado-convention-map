// Original user-supplied artwork, shared by every PDF renderer and print view.
export const HEADER_RIBBON_URL = new URL('./print-header-sky.png', import.meta.url).href;
export const FOOTER_RIBBON_URL = new URL('./print-footer-hills.png', import.meta.url).href;
const PRINT_STYLE_URL = new URL('./print-ribbons.css?v=ribbons-20261107-1', import.meta.url).href;
let assetPromise;

export function ribbonLayout(width, height) {
  if (![width,height].every(v=>Number.isFinite(v)&&v>0)) throw Error('Invalid PDF page size.');
  // Alpha bounds: header y=0..90 of 170; footer y=11..129 of 130.
  return {top:width*91/2048+8,bottom:width*119/2048+8,
    headerHeight:width*170/2048,footerHeight:width*130/2048};
}
async function readImage(url, fetcher) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetcher(url,{signal:controller.signal,cache:'force-cache'});
    if(!response.ok)throw Error('Image could not load.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<8||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw Error('Invalid image.');
    return bytes;
  } catch { throw Error('The convention header or footer could not load. Please check your connection and try the PDF again.'); }
  finally { clearTimeout(timer); }
}
export function loadPdfRibbonAssets({fetch:fetcher=globalThis.fetch}={}) {
  if(!assetPromise)assetPromise=Promise.all([readImage(HEADER_RIBBON_URL,fetcher),readImage(FOOTER_RIBBON_URL,fetcher)])
    .then(([header,footer])=>({header,footer})).catch(error=>{assetPromise=null;throw error;});
  return assetPromise;
}
export async function createPdfLibRibbons(pdf,{ribbonAssets}={}) {
  const assets=ribbonAssets||await loadPdfRibbonAssets();
  const [header,footer]=await Promise.all([pdf.embedPng(assets.header),pdf.embedPng(assets.footer)]);
  const decorated=new WeakSet();
  function draw(page) {
    if(decorated.has(page))return;
    const {width,height}=page.getSize(),box=ribbonLayout(width,height);
    page.drawImage(header,{x:0,y:height-box.headerHeight,width,height:box.headerHeight});
    page.drawImage(footer,{x:0,y:0,width,height:box.footerHeight});
    decorated.add(page);
  }
  return {draw,drawAllPages(){pdf.getPages().forEach(draw);}};
}
function asDataUrl(bytes) {
  let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return 'data:image/png;base64,'+btoa(s);
}
export async function createJsPdfRibbons(doc,{ribbonAssets}={}) {
  const assets=ribbonAssets||await loadPdfRibbonAssets(),header=asDataUrl(assets.header),footer=asDataUrl(assets.footer),decorated=new Set();
  function drawAllPages() {
    const previous=doc.internal.getCurrentPageInfo().pageNumber;
    for(let i=1;i<=doc.getNumberOfPages();i++){
      if(decorated.has(i))continue;
      doc.setPage(i);const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();
      doc.addImage(header,'PNG',0,0,width,width*170/2048,'denver-header-ribbon');
      doc.addImage(footer,'PNG',0,height-width*130/2048,width,width*130/2048,'denver-footer-ribbon');
      decorated.add(i);
    }
    doc.setPage(previous);
  }
  return {drawAllPages};
}
const escaped=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
export function printRibbonMarkup(){
  return `<link data-print-ribbon-style rel="stylesheet" href="${escaped(PRINT_STYLE_URL)}"><img class="convention-print-header" data-print-ribbon="header" src="${escaped(HEADER_RIBBON_URL)}" alt="" aria-hidden="true"><img class="convention-print-footer" data-print-ribbon="footer" src="${escaped(FOOTER_RIBBON_URL)}" alt="" aria-hidden="true">`;
}
const PRINT_READY_ERROR='The convention header, footer, or print layout could not load. Check your connection, then choose Print / PDF again.';
const printReadiness=new WeakMap(),failedPrintDocuments=new WeakSet();
const printSelectors=['link[data-print-ribbon-style]','img[data-print-ribbon="header"]','img[data-print-ribbon="footer"]'];
export function mountPrintRibbons(d=globalThis.document){
  if(!d?.body)return;
  const template=d.createElement('template');template.innerHTML=printRibbonMarkup();
  Array.from(template.content.children).forEach((node,index)=>{
    const existing=d.querySelector(printSelectors[index]),attribute=index===0?'href':'src';
    if(existing?.getAttribute(attribute)===node.getAttribute(attribute))return;
    existing?.remove();d.body.append(node);
  });
}

// Explicit print actions call this before opening the browser print dialog.
// A failed attempt replaces only our decorative nodes, so the next click can retry.
export function waitForPrintRibbons(d=globalThis.document,{timeoutMs=15000}={}){
  if(!d?.body)return Promise.reject(new Error(PRINT_READY_ERROR));
  if(printReadiness.has(d))return printReadiness.get(d);
  if(failedPrintDocuments.has(d)){
    d.querySelectorAll('[data-print-ribbon],[data-print-ribbon-style]').forEach(node=>node.remove());
    failedPrintDocuments.delete(d);
  }
  mountPrintRibbons(d);
  const nodes=printSelectors.map(selector=>d.querySelector(selector));
  const attempt=new Promise((resolve,reject)=>{
    const cleanups=[];let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);cleanups.forEach(cleanup=>cleanup());
      if(error)reject(new Error(PRINT_READY_ERROR));else resolve();
    };
    const timer=setTimeout(()=>finish(true),Number.isFinite(timeoutMs)&&timeoutMs>0?timeoutMs:15000);
    const waitForLoad=(node,ready,failed)=>new Promise((resolveLoad,rejectLoad)=>{
      if(!node){rejectLoad();return;}
      const loaded=()=>ready()?resolveLoad():rejectLoad(),errored=()=>rejectLoad();
      node.addEventListener('load',loaded);node.addEventListener('error',errored);
      cleanups.push(()=>{node.removeEventListener('load',loaded);node.removeEventListener('error',errored);});
      if(ready())resolveLoad();else if(failed?.())rejectLoad();
    });
    const [style,...images]=nodes;
    const loads=[waitForLoad(style,()=>!!style?.sheet&&!style.disabled)];
    images.forEach(image=>{
      if(typeof image?.decode==='function')loads.push(Promise.resolve().then(()=>image.decode()).then(()=>{
        if(!image.naturalWidth||!image.naturalHeight)throw new Error(PRINT_READY_ERROR);
      }));
      else loads.push(waitForLoad(image,()=>!!image?.complete&&image.naturalWidth>0&&image.naturalHeight>0,()=>image?.complete));
    });
    Promise.all(loads).then(()=>finish(nodes.some((node,index)=>node!==d.querySelector(printSelectors[index]))),()=>finish(true));
  });
  const pending=attempt.then(()=>{printReadiness.delete(d);},error=>{printReadiness.delete(d);failedPrintDocuments.add(d);throw error;});
  printReadiness.set(d,pending);return pending;
}

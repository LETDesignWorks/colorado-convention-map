// These dependencies are pinned and served by this site. PDF files stay in the browser.
const PDF_LIB_URL = new URL('../load-tests/vendor/pdf-lib.min.js', import.meta.url).href;
const PPTX_URL = new URL('./vendor/pptxgenjs-4.0.1.bundle.js', import.meta.url).href;
const PDF_JS_URL = new URL('./vendor/pdfjs-5.6.205/pdf.min.mjs', import.meta.url).href;
const PDF_WORKER_URL = new URL('./vendor/pdfjs-5.6.205/pdf.worker.min.mjs', import.meta.url).href;
export const PDFJS_ASSETS = Object.freeze({
  standardFontDataUrl: new URL('./vendor/pdfjs-5.6.205/standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./vendor/pdfjs-5.6.205/wasm/', import.meta.url).href,
  iccUrl: new URL('./vendor/pdfjs-5.6.205/iccs/', import.meta.url).href
});
const scriptLoads = new WeakMap();
let rendererLoad;

function loadScript(name, url, ready, {document:d=globalThis.document, window:w=globalThis.window}={}) {
  if (!d?.head || !w) return Promise.reject(Error(`${name} needs a web browser.`));
  if (ready(w)) return Promise.resolve(ready(w));
  let cache=scriptLoads.get(w);
  if (!cache) {cache=new Map();scriptLoads.set(w,cache);}
  if (cache.has(url)) return cache.get(url);
  const pending=new Promise((resolve,reject)=>{
    const script=d.createElement('script');script.src=url;script.async=true;
    let settled=false;
    const finish=error=>{
      if (settled) return;settled=true;clearTimeout(timer);script.onload=script.onerror=null;
      if (error) {script.remove();reject(error);} else resolve(ready(w));
    };
    const timer=setTimeout(()=>finish(Error(`${name} took too long to load. Check your connection and try again.`)),20000);
    script.onload=()=>finish(ready(w)?null:Error(`${name} could not start. Refresh the page and try again.`));
    script.onerror=()=>finish(Error(`${name} could not load. Check your connection and try again.`));
    d.head.append(script);
  }).catch(error=>{cache.delete(url);throw error;});
  cache.set(url,pending);return pending;
}

export function loadPdfLibrary(options) {
  return loadScript('The PDF tools',PDF_LIB_URL,w=>w.PDFLib?.PDFDocument?w.PDFLib:null,options);
}
export function loadPresentationLibrary(options) {
  return loadScript('The PowerPoint tools',PPTX_URL,w=>typeof w.PptxGenJS==='function'?w.PptxGenJS:null,options);
}
export function loadPdfRenderer() {
  if (!rendererLoad) {
    rendererLoad=import(PDF_JS_URL).then(pdfjs=>{
      pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER_URL;
      return pdfjs;
    }).catch(()=>{
      rendererLoad=null;
      throw Error('The PDF page renderer could not load. Check your connection, refresh this page, and try again.');
    });
  }
  return rendererLoad;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {const error=Error('Export cancelled.');error.name='AbortError';throw error;}
}
export function awaitWithAbort(promise, signal) {
  if (signal?.aborted) {
    // The asynchronous operation may already have started while evaluating this
    // call's arguments. Observe its rejection even when cancellation won first.
    Promise.resolve(promise).catch(()=>{});
    const error=Error('Export cancelled.');error.name='AbortError';return Promise.reject(error);
  }
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve,reject)=>{
    const abort=()=>{const error=Error('Export cancelled.');error.name='AbortError';reject(error);};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

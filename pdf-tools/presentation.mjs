import {PDFJS_ASSETS,loadPdfLibrary,loadPdfRenderer,loadPresentationLibrary,throwIfAborted,awaitWithAbort} from './libraries.mjs?v=packets-20261107-1';
import {PDF_LIMITS,validateSources,inspectPdf,readSourcePdf,flattenSourceForm,exportFilename} from './pdf-merge.mjs?v=packets-20261107-1';

const PPTX_MIME='application/vnd.openxmlformats-officedocument.presentationml.presentation';
const IMAGE_EDGE=2800,MAX_IMAGE_BYTES=150*1024*1024;

export function fitPageToSlide(width,height,slideWidth,slideHeight) {
  if (![width,height,slideWidth,slideHeight].every(value=>Number.isFinite(value)&&value>0)) throw Error('A PDF page has an invalid size.');
  const scale=Math.min(slideWidth/width,slideHeight/height),w=width*scale,h=height*scale;
  return {x:(slideWidth-w)/2,y:(slideHeight-h)/2,w,h};
}
function presentationSize(layout,firstPage) {
  if (layout==='wide') return {width:40/3,height:7.5};
  if (layout!=='first-page') throw Error('Choose Widescreen or Match first PDF page.');
  let width=firstPage.width/72,height=firstPage.height/72;
  const scale=Math.min(1,40/Math.max(width,height));width*=scale;height*=scale;
  if (Math.min(width,height)<1) {const grow=1/Math.min(width,height);width*=grow;height*=grow;}
  if (Math.max(width,height)>56) throw Error('The first PDF page is too narrow for this slide size. Choose Widescreen.');
  return {width,height};
}
function pageFailure(error,name,page) {
  if (error?.name==='AbortError') return error;
  return Error(`“${name}”, page ${page}, could not be converted completely. Save a new PDF from its original application and try that copy. No incomplete presentation was created.`);
}

export async function createPdfPresentation(sources,{
  title='Denver 2027 Convention',filename,layout='wide',progress=()=>{},signal,
  document:d=globalThis.document,window:w=globalThis.window,PDFLib,pdfjs,PptxGenJS,
  createCanvas,pdfjsOptions={}
}={}) {
  const selected=validateSources(sources);throwIfAborted(signal);
  const lib=PDFLib||await awaitWithAbort(loadPdfLibrary({document:d,window:w}),signal);
  let total=0,firstPage;
  for (const [index,source] of selected.entries()) {
    progress(`Checking PDF ${index+1} of ${selected.length}: ${source.name}`);
    const info=await inspectPdf(source.blob,{name:source.name,PDFLib:lib,signal});
    firstPage??=info.pages[0];total+=info.pageCount;
    if (total>PDF_LIMITS.maxPages) throw Error('The selected PDFs contain more than 200 pages. Select fewer files for one presentation.');
  }
  const size=presentationSize(layout,firstPage);throwIfAborted(signal);progress('Loading PowerPoint tools…');
  const [renderer,Presentation]=await awaitWithAbort(Promise.all([
    pdfjs||loadPdfRenderer(),PptxGenJS||loadPresentationLibrary({document:d,window:w})
  ]),signal);
  const deck=new Presentation();
  deck.defineLayout({name:'DENVER_PDF',width:size.width,height:size.height});deck.layout='DENVER_PDF';
  deck.title=String(title||'Denver 2027 Convention').slice(0,200);deck.subject='Selected convention planning PDFs';
  deck.author='Denver 2027';deck.company='Denver 2027';deck.lang='en-US';
  let slideCount=0,imageBytes=0;
  for (const source of selected) {
    throwIfAborted(signal);
    const prepared=await readSourcePdf(source.blob,{name:source.name,PDFLib:lib,signal});
    const flattened=flattenSourceForm(prepared);
    const bytes=flattened?await prepared.doc.save({updateFieldAppearances:false}):prepared.bytes;
    throwIfAborted(signal);
    let loadingTask,pdf,pageNumber=1,renderTask,destroyPromise;
    const destroy=()=>destroyPromise??=(loadingTask?loadingTask.destroy():Promise.resolve());
    const abort=()=>{renderTask?.cancel();destroy().catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try {
      loadingTask=renderer.getDocument({
        ...PDFJS_ASSETS,...pdfjsOptions,data:new Uint8Array(bytes),
        // Rendering data never executes document JavaScript or fetches a source URL.
        isEvalSupported:false,stopAtErrors:true,enableXfa:false,useSystemFonts:false
      });
      pdf=await awaitWithAbort(loadingTask.promise,signal);
      if (pdf.numPages!==prepared.doc.getPageCount()) throw Error('The PDF page count changed during rendering.');
      for (pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
        throwIfAborted(signal);progress(`Creating slide ${slideCount+1} of ${total}: ${source.name}, page ${pageNumber}`);
        throwIfAborted(signal);
        let canvas,page;
        try {
          page=await awaitWithAbort(pdf.getPage(pageNumber),signal);
          const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:IMAGE_EDGE/Math.max(base.width,base.height)});
          if (![viewport.width,viewport.height].every(value=>Number.isFinite(value)&&value>0)) throw Error('Invalid PDF page size.');
          canvas=createCanvas?createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)):d?.createElement('canvas');
          if (!canvas) throw Error('This browser cannot render PDF pages.');
          canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
          const context=canvas.getContext('2d');if (!context) throw Error('This browser cannot render PDF pages.');
          renderTask=page.render({canvas,canvasContext:context,viewport,intent:'print',annotationMode:renderer.AnnotationMode.ENABLE,background:'rgb(255,255,255)'});
          await awaitWithAbort(renderTask.promise,signal);renderTask=null;throwIfAborted(signal);
          // PDF.js 5.6.205 records font failures as error strings in commonObjs,
          // even with stopAtErrors. Reject them instead of exporting missing text
          // (including PDFs that require an optional predefined CMap).
          for (const [,object] of page.commonObjs||[]) if (typeof object==='string') throw Error('A PDF font could not be rendered.');
          const data=canvas.toDataURL('image/png');
          if (!data.startsWith('data:image/png;base64,') || data.length<80) throw Error('The rendered PDF page is empty.');
          imageBytes+=Math.ceil((data.length-data.indexOf(',')-1)*3/4);
          if (imageBytes>MAX_IMAGE_BYTES) throw Error('The rendered presentation is too large. Select fewer PDFs and try again.');
          const slide=deck.addSlide();slide.background={color:'FFFFFF'};
          slide.addImage({data,...fitPageToSlide(base.width,base.height,size.width,size.height),altText:`${source.name}, page ${pageNumber} of ${pdf.numPages}`});
          slide.addNotes(`Source PDF: ${source.name}\nSource page: ${pageNumber} of ${pdf.numPages}\nThe complete PDF page is included as an image. Original PDF text and forms are part of that image.`);
          slideCount++;
        } finally {
          if (canvas) {canvas.width=1;canvas.height=1;}
          page?.cleanup();
        }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    } catch(error) {
      throwIfAborted(signal);
      if (/rendered presentation is too large/i.test(error?.message||'')) throw error;
      throw pageFailure(error,source.name,pageNumber);
    } finally {
      signal?.removeEventListener('abort',abort);
      renderTask?.cancel();
      if (loadingTask) await destroy().catch(()=>{});
    }
  }
  throwIfAborted(signal);progress(`Saving ${slideCount} slides to PowerPoint…`);
  const result=await awaitWithAbort(deck.write({outputType:'blob',compression:true}),signal);throwIfAborted(signal);
  const blob=new Blob([result],{type:PPTX_MIME});
  if (!blob.size) throw Error('PowerPoint could not be created. Try again with fewer PDFs.');
  return {blob,filename:exportFilename(filename||title,'pptx'),pages:slideCount,slides:slideCount};
}

import {loadPdfLibrary,throwIfAborted,awaitWithAbort} from './libraries.mjs?v=packets-20261107-1';

export const PDF_LIMITS=Object.freeze({maxFiles:50,maxFileBytes:50*1024*1024,maxTotalBytes:200*1024*1024,maxPages:200});

export function exportFilename(value,extension) {
  const stem=String(value||'Denver 2027 Convention').replace(/\.(pdf|pptx)$/i,'').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9._ -]+/g,'-').replace(/^[ .-]+|[ .-]+$/g,'')
    .replace(/\s+/g,'-').slice(0,110)||'Denver-2027-Convention';
  return `${stem}.${extension}`;
}
export function documentName(value,index=0) {
  return String(value||`PDF ${index+1}`).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,200)||`PDF ${index+1}`;
}
function checkBlob(blob,name) {
  if (!blob || typeof blob.arrayBuffer!=='function' || !Number.isFinite(blob.size) || blob.size<=0) throw Error(`“${name}” is empty or is not a PDF file.`);
  if (blob.size>PDF_LIMITS.maxFileBytes) throw Error(`“${name}” is larger than 50 MB. Choose a smaller PDF.`);
}
export function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length) throw Error('Select at least one PDF.');
  if (sources.length>PDF_LIMITS.maxFiles) throw Error('Choose 50 PDFs or fewer for one export.');
  let size=0;
  const result=sources.map((source,index)=>{
    const name=documentName(source?.name,index),blob=source?.blob;checkBlob(blob,name);size+=blob.size;
    return {name,blob};
  });
  if (size>PDF_LIMITS.maxTotalBytes) throw Error('The selected PDFs total more than 200 MB. Select fewer files for this export.');
  return result;
}
function sourceFailure(error,name) {
  if (error?.name==='AbortError') return error;
  if (/encrypt|password/i.test(String(error?.name)+' '+String(error?.message))) return Error(`“${name}” is password-protected. Save an unlocked copy and add it again.`);
  return Error(`“${name}” could not be opened as a PDF. Save a new PDF from its original application and add it again.`);
}

// Read a fresh copy each time. Neither form flattening nor rendering alters the user's Blob/File.
export async function readSourcePdf(blob,{name='PDF',PDFLib,signal,document,window}={}) {
  name=documentName(name);checkBlob(blob,name);throwIfAborted(signal);
  const lib=PDFLib||await awaitWithAbort(loadPdfLibrary({document,window}),signal);
  const bytes=new Uint8Array(await awaitWithAbort(blob.arrayBuffer(),signal));throwIfAborted(signal);
  const header=String.fromCharCode(...bytes.subarray(0,1024));
  if (!/%PDF-\d\.\d/.test(header)) throw Error(`“${name}” is not a PDF file. Choose the downloaded .pdf file.`);
  let doc,pageCount,acro;
  try {
    doc=await awaitWithAbort(lib.PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true}),signal);
    pageCount=doc.getPageCount();
    acro=doc.catalog.lookupMaybe(lib.PDFName.of('AcroForm'),lib.PDFDict);
  }
  catch(error) {throw sourceFailure(error,name);}
  throwIfAborted(signal);
  if (!pageCount) throw Error(`“${name}” has no pages.`);
  if (pageCount>PDF_LIMITS.maxPages) throw Error(`“${name}” has more than 200 pages. Split it into smaller PDFs first.`);
  if (acro?.has(lib.PDFName.of('XFA'))) throw Error(`“${name}” uses an interactive XFA form. Print it to a PDF first, then add that copy.`);
  return {doc,bytes,lib,acro,name};
}
function pageInformation(page,lib) {
  const media=page.getMediaBox(),crop=page.getCropBox();
  let width=Math.min(media.x+media.width,crop.x+crop.width)-Math.max(media.x,crop.x);
  let height=Math.min(media.y+media.height,crop.y+crop.height)-Math.max(media.y,crop.y);
  if (width<=0 || height<=0) {width=media.width;height=media.height;}
  const unit=page.node.lookupMaybe(lib.PDFName.of('UserUnit'),lib.PDFNumber)?.asNumber()||1;
  const rotation=((page.getRotation().angle%360)+360)%360;
  if (rotation%90 || ![width,height,unit].every(value=>Number.isFinite(value)&&value>0)) throw Error('This PDF has an unsupported page size or rotation. Print it to a new PDF and try that copy.');
  width*=unit;height*=unit;
  return {width:rotation%180?height:width,height:rotation%180?width:height,rotation};
}
export async function inspectPdf(blob,options={}) {
  const source=await readSourcePdf(blob,options);
  return {pageCount:source.doc.getPageCount(),pages:source.doc.getPages().map(page=>pageInformation(page,source.lib))};
}
export function flattenSourceForm(source) {
  if (!source.acro) return false;
  try {
    const form=source.doc.getForm(),fields=form.getFields();
    if (!fields.length) return false;
    const needs=source.acro.lookupMaybe(source.lib.PDFName.of('NeedAppearances'),source.lib.PDFBool)?.asBoolean();
    if (needs) fields.forEach(field=>form.markFieldAsDirty(field.ref));
    if (fields.some(field=>field.needsAppearancesUpdate())) form.updateFieldAppearances();
    const widgets=new Set(fields.flatMap(field=>[
      field.ref,...field.acroField.getWidgets().flatMap(widget=>[widget.dict,source.doc.context.getObjectRef(widget.dict)])
    ]));
    form.flatten({updateFieldAppearances:false});
    // PDF-LIB 1.17.1 can retain a page's reference to a deleted widget after
    // flattening. Remove those exact references; leave other annotations intact.
    for (const page of source.doc.getPages()) {
      const annots=page.node.Annots();
      for (let i=(annots?.size()||0)-1;i>=0;i--) if (widgets.has(annots.get(i))) annots.remove(i);
    }
    return true;
  } catch {
    throw Error(`“${source.name}” contains form fields whose printed appearance could not be preserved. Print it to a PDF and add that copy.`);
  }
}

export async function mergePdfDocuments(sources,{filename,title='Denver 2027 Convention',progress=()=>{},signal,PDFLib,document,window}={}) {
  const selected=validateSources(sources);throwIfAborted(signal);
  const lib=PDFLib||await awaitWithAbort(loadPdfLibrary({document,window}),signal);
  const output=await lib.PDFDocument.create();let count=0,flattenedForms=false;
  output.setTitle(String(title||'Denver 2027 Convention').slice(0,200));output.setCreator('Denver 2027 PDF tools');
  for (let index=0;index<selected.length;index++) {
    const source=selected[index];throwIfAborted(signal);progress(`Combining PDF ${index+1} of ${selected.length}: ${source.name}`);
    const prepared=await readSourcePdf(source.blob,{name:source.name,PDFLib:lib,signal});
    count+=prepared.doc.getPageCount();
    if (count>PDF_LIMITS.maxPages) throw Error('The selected PDFs contain more than 200 pages. Select fewer files for this export.');
    flattenedForms=flattenSourceForm(prepared)||flattenedForms;
    throwIfAborted(signal);
    const pages=await output.copyPages(prepared.doc,prepared.doc.getPageIndices());
    for (const page of pages) output.addPage(page);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  throwIfAborted(signal);progress('Finishing the combined PDF…');
  const bytes=await awaitWithAbort(output.save({updateFieldAppearances:false}),signal);throwIfAborted(signal);
  return {blob:new Blob([bytes],{type:'application/pdf'}),filename:exportFilename(filename||title,'pdf'),pages:count,flattenedForms};
}

export const PDF_BUILDER_URL=new URL('../pdf-tools/',import.meta.url).href;
export const PDF_BUILDER_WINDOW='denver2027-pdf-builder';

export function isPdfBuilderWindow(target){
  if(!target||target.closed)return false;
  try{
    const current=new URL(target.location.href),wanted=new URL(PDF_BUILDER_URL);
    return current.origin===wanted.origin&&(current.pathname===wanted.pathname||current.pathname===wanted.pathname+'index.html');
  }catch{return false;}
}
export function openPdfBuilderWindow(w=globalThis.window){
  const destination=new URL(PDF_BUILDER_URL);
  if(!w||w.location.origin!==destination.origin)throw Error('Open the PDF tools from the convention website.');
  const target=w.open('',PDF_BUILDER_WINDOW);
  if(!target)throw Error('Allow a popup for this site, then open PDFs & PowerPoint again.');
  if(!isPdfBuilderWindow(target)){
    let blank=false;try{blank=target.location.href==='about:blank';}catch{}
    if(!blank)throw Error('The PDF tools tab is on another page. Close that tab, then open PDFs & PowerPoint again.');
    target.location.href=destination.href;
  }
  target.focus?.();return target;
}

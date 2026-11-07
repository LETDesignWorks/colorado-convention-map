import {PDF_LIMITS} from './pdf-merge.mjs?v=packets-20261107-1';
import {PDF_BUILDER_URL,PDF_BUILDER_WINDOW,openPdfBuilderWindow,isPdfBuilderWindow} from '../assets/pdf-tools-link.mjs?v=packets-20261107-1';

export {PDF_BUILDER_URL};
const PROTOCOL='denver2027-pdf-transfer-v1';
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(id);
const projectPath=new URL('../',import.meta.url).pathname;

function checkedDocuments(documents){
  if(!Array.isArray(documents)||!documents.length)throw Error('Choose at least one PDF to add.');
  if(documents.length>PDF_LIMITS.maxFiles)throw Error(`Add up to ${PDF_LIMITS.maxFiles} PDFs at a time.`);
  let bytes=0;
  const checked=documents.map(item=>{
    const blob=item?.blob;
    if(!blob||typeof blob.arrayBuffer!=='function'||!Number.isFinite(blob.size)||blob.size<=0)throw Error('A PDF is empty or unavailable. Create it again before adding it.');
    if(blob.size>PDF_LIMITS.maxFileBytes)throw Error('A PDF is too large. Choose a file smaller than 50 MB.');
    bytes+=blob.size;
    const name=String(item.name||item.filename||'Document.pdf').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,240)||'Document.pdf';
    return {name,blob};
  });
  if(bytes>PDF_LIMITS.maxTotalBytes)throw Error('This group is too large. Add PDFs totaling no more than 200 MB.');
  return checked;
}
// The named tab keeps its existing collection when several exports are added.
// File bytes move directly between same-origin tabs; nothing is uploaded or saved.
export function sendPdfsToBuilder(documents,{window:w=globalThis.window,isCurrent=()=>true,notify=()=>{},timeoutMs=20000}={}){
  let checked,target,destination,id;
  try{
    checked=checkedDocuments(documents);
    if(!isCurrent())throw Error('The location or sign-in changed. Create the PDF again.');
    destination=new URL(PDF_BUILDER_URL);
    id=w.crypto.randomUUID();
    target=openPdfBuilderWindow(w);notify('Opening PDFs & PowerPoint…');
  }catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
    let done=false,sent=false;
    const cleanup=()=>{w.removeEventListener('message',message);clearInterval(poll);clearTimeout(timer);};
    const finish=error=>{if(done)return;done=true;cleanup();error?reject(error):resolve({count:checked.length});};
    const current=()=>{
      if(target.closed){finish(Error('The PDF tools tab was closed. Choose Add to PowerPoint again.'));return false;}
      if(!sent&&!isCurrent()){finish(Error('The location or sign-in changed. Create the PDF again.'));return false;}
      return true;
    };
    const sendHello=()=>{
      if(done||!current()||sent)return;
      if(!isPdfBuilderWindow(target))return;
      target.postMessage({protocol:PROTOCOL,type:'hello',id},destination.origin);
    };
    const message=event=>{
      const data=event.data;
      if(event.origin!==destination.origin||event.source!==target||data?.protocol!==PROTOCOL||data.id!==id||done)return;
      if(data.type==='ready'&&!sent){
        if(!current()||!isPdfBuilderWindow(target))return;
        sent=true;target.postMessage({protocol:PROTOCOL,type:'documents',id,documents:checked},destination.origin);
      }else if(data.type==='accepted'&&sent){notify('Added to PDFs & PowerPoint.');finish();}
      else if(data.type==='error'){finish(Error(String(data.message||'The PDFs could not be added. Please retry.')));}
    };
    const timer=setTimeout(()=>finish(Error('The PDF tools did not respond. Keep that tab open and choose Add to PowerPoint again, or download the PDF and add it there.')),Math.max(100,timeoutMs));
    const poll=setInterval(sendHello,250);
    w.addEventListener('message',message);sendHello();
  });
}

export function receivePdfTransfers({window:w=globalThis.window,onDocuments}={}){
  if(!w||typeof onDocuments!=='function')throw Error('The PDF collection is not ready.');
  w.name=PDF_BUILDER_WINDOW;
  const origin=w.location.origin,offers=new Map(),received=new Map();
  const trusted=event=>{
    if(event.origin!==origin||!event.source||event.source===w)return false;
    try{const source=new URL(event.source.location.href);return source.origin===origin&&source.pathname.startsWith(projectPath);}catch{return false;}
  };
  const reply=(source,id,type,message)=>{
    try{source.postMessage({protocol:PROTOCOL,id,type,...(message?{message}: {})},origin);}catch{}
  };
  const message=event=>{
    const data=event.data;
    if(!trusted(event)||data?.protocol!==PROTOCOL||!validId(data.id))return;
    const now=Date.now();for(const [id,offer]of offers)if(offer.expires<now)offers.delete(id);
    if(data.type==='hello'){
      if(offers.size>100)return;
      offers.set(data.id,{source:event.source,expires:now+30000});reply(event.source,data.id,'ready');return;
    }
    if(data.type!=='documents')return;
    const offer=offers.get(data.id);
    if(!offer||offer.source!==event.source)return;
    offers.delete(data.id);
    if(received.has(data.id)){received.get(data.id).then(()=>reply(event.source,data.id,'accepted'),error=>reply(event.source,data.id,'error',error.message));return;}
    const accepted=Promise.resolve().then(()=>onDocuments(checkedDocuments(data.documents)));
    received.set(data.id,accepted);
    accepted.then(()=>reply(event.source,data.id,'accepted'),error=>reply(event.source,data.id,'error',String(error?.message||'The PDFs could not be added.')));
    if(received.size>200)received.delete(received.keys().next().value);
  };
  w.addEventListener('message',message);
  return()=>{w.removeEventListener('message',message);offers.clear();received.clear();};
}

import {validateAttachment} from './workbook.mjs?v=20261019-3';
export async function packAttachment(bytes,name){
  if(!(bytes instanceof Uint8Array)||bytes.length>10000000||bytes.length<5||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Choose a PDF smaller than 10 MB.');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const sha256=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  const chunks=[];
  for(let start=0;start<bytes.length;start+=210000){
    let binary='';for(const b of bytes.subarray(start,start+210000))binary+=String.fromCharCode(b);
    chunks.push(btoa(binary));
  }
  const meta=validateAttachment({id:`load-test-attachment-${crypto.randomUUID()}`,name,bytes:bytes.length,parts:chunks.length,sha256});
  return {meta,chunks};
}
export async function unpackAttachment(meta,chunks){
  validateAttachment(meta);
  if(chunks.length!==meta.parts||chunks.some(c=>typeof c!=='string'))throw new Error('Some pages of the saved sample could not be loaded. Try again.');
  const out=new Uint8Array(meta.bytes);let offset=0;
  for(const part of chunks){const binary=atob(part);for(let i=0;i<binary.length;i++)out[offset++]=binary.charCodeAt(i);}
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out)),b=>b.toString(16).padStart(2,'0')).join('');
  if(offset!==meta.bytes||sha256!==meta.sha256)throw new Error('The saved sample is incomplete. Attach the PDF again.');
  return out;
}

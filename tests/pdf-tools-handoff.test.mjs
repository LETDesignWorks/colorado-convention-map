import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sendPdfsToBuilder,receivePdfTransfers,PDF_BUILDER_URL} from '../pdf-tools/handoff.mjs';
import {openPdfBuilderWindow,PDF_BUILDER_WINDOW} from '../assets/pdf-tools-link.mjs';

const PROTOCOL='denver2027-pdf-transfer-v1';
const sourceUrl=new URL('../bus-access/',import.meta.url);
const sourcePdf=name=>({name,blob:new Blob(['%PDF-1.7\nfixture'],{type:'application/pdf'})});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function eventHost(location){
  const listeners=new Set();
  return {location,name:'',crypto:{randomUUID},addEventListener(type,handler){if(type==='message')listeners.add(handler);},
    removeEventListener(type,handler){if(type==='message')listeners.delete(handler);},
    emit(event){for(const listener of listeners)listener(event);},listenerCount(){return listeners.size;}};
}
function pair({blank=false}={}){
  const sender=eventHost(sourceUrl),receiver=eventHost(new URL(PDF_BUILDER_URL)),log=[],opens=[];
  const target={closed:false,location:{href:blank?'about:blank':PDF_BUILDER_URL},focus(){},postMessage(data,origin){
    log.push({direction:'to-builder',data,origin});queueMicrotask(()=>receiver.emit({data,origin:sender.location.origin,source:reply}));
  }};
  const reply={location:sender.location,postMessage(data,origin){log.push({direction:'to-sender',data,origin});queueMicrotask(()=>sender.emit({data,origin:receiver.location.origin,source:target}));}};
  sender.open=(url,name)=>{opens.push({url,name});return target;};
  return {sender,receiver,target,reply,log,opens};
}

test('exports reuse the existing collection and transfer each file only after the builder is ready',async()=>{
  const p=pair({blank:true}),received=[];
  const cleanup=receivePdfTransfers({window:p.receiver,onDocuments:documents=>received.push(...documents)});
  assert.equal(p.receiver.name,PDF_BUILDER_WINDOW);
  assert.deepEqual(await sendPdfsToBuilder([sourcePdf('Bus review.pdf')],{window:p.sender}),{count:1});
  await sendPdfsToBuilder([sourcePdf('Parking layout.pdf')],{window:p.sender});
  assert.deepEqual(received.map(x=>x.name),['Bus review.pdf','Parking layout.pdf']);
  assert.equal(p.target.location.href,PDF_BUILDER_URL);
  assert.ok(p.opens.every(x=>x.url===''&&x.name===PDF_BUILDER_WINDOW));
  assert.ok(p.log.every(x=>x.origin===sourceUrl.origin));
  assert.deepEqual(p.log.slice(0,4).map(x=>x.data.type),['hello','ready','documents','accepted']);
  assert.equal(p.sender.listenerCount(),0);cleanup();assert.equal(p.receiver.listenerCount(),0);
});

test('a sign-in or location change before handoff prevents file transfer',async()=>{
  const p=pair(),received=[];let current=true;
  const cleanup=receivePdfTransfers({window:p.receiver,onDocuments:documents=>received.push(...documents)});
  const pending=sendPdfsToBuilder([sourcePdf('Private draft.pdf')],{window:p.sender,isCurrent:()=>current});
  current=false;
  await assert.rejects(pending,/location or sign-in changed/i);
  assert.equal(received.length,0);assert.ok(!p.log.some(x=>x.data.type==='documents'));
  assert.equal(p.sender.listenerCount(),0);cleanup();
});

test('receiver rejects uninvited, foreign-origin and other-project messages',async()=>{
  const p=pair(),received=[];
  const cleanup=receivePdfTransfers({window:p.receiver,onDocuments:documents=>received.push(...documents)});
  const id=randomUUID(),data={protocol:PROTOCOL,type:'documents',id,documents:[sourcePdf('Uninvited.pdf')]};
  p.receiver.emit({data,origin:sourceUrl.origin,source:p.reply});
  for(const [origin,source]of [['https://untrusted.example',p.reply],[sourceUrl.origin,{...p.reply,location:new URL('/another-project/',sourceUrl)}]]){
    p.receiver.emit({data:{protocol:PROTOCOL,type:'hello',id},origin,source});
    p.receiver.emit({data,origin,source});
  }
  await tick();assert.equal(received.length,0);cleanup();
});

test('collection errors are returned to the export and a later attempt can succeed',async()=>{
  const p=pair();let full=true,accepted=0;
  const cleanup=receivePdfTransfers({window:p.receiver,onDocuments:()=>{if(full)throw Error('The collection has no room for another PDF.');accepted++;}});
  await assert.rejects(sendPdfsToBuilder([sourcePdf('Review.pdf')],{window:p.sender}),/no room/);
  full=false;await sendPdfsToBuilder([sourcePdf('Review.pdf')],{window:p.sender});
  assert.equal(accepted,1);assert.equal(p.sender.listenerCount(),0);cleanup();
});

test('replayed delivery IDs do not duplicate the collection',async()=>{
  const p=pair();let count=0;
  const cleanup=receivePdfTransfers({window:p.receiver,onDocuments:()=>count++});
  await sendPdfsToBuilder([sourcePdf('Review.pdf')],{window:p.sender});
  const sent=p.log.find(x=>x.data.type==='documents').data;
  p.receiver.emit({data:{protocol:PROTOCOL,type:'hello',id:sent.id},origin:sourceUrl.origin,source:p.reply});
  p.receiver.emit({data:sent,origin:sourceUrl.origin,source:p.reply});
  await tick();assert.equal(count,1);cleanup();
});

test('blocked popups, unavailable tabs, and invalid PDFs fail without replacing another page',async()=>{
  const p=pair();p.sender.open=()=>null;
  await assert.rejects(sendPdfsToBuilder([sourcePdf('Review.pdf')],{window:p.sender}),/popup/);
  await assert.rejects(sendPdfsToBuilder([{name:'Empty.pdf',blob:new Blob([])}],{window:p.sender}),/empty/);
  const unavailable=pair();
  await assert.rejects(sendPdfsToBuilder([sourcePdf('Review.pdf')],{window:unavailable.sender,timeoutMs:100}),/did not respond/);
  assert.equal(unavailable.sender.listenerCount(),0);
  const other=pair();other.target.location.href=new URL('../territories/',sourceUrl).href;
  const before=other.target.location.href;
  assert.throws(()=>openPdfBuilderWindow(other.sender),/another page/);assert.equal(other.target.location.href,before);
});

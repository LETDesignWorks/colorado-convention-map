import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {mountLocationPhotos} from '../bus-access/photos.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
async function harness(options={}){
  const dom=new JSDOM('<html><head></head><body><div id="detail"><form id="reviewForm"><input value="Unsaved review"></form></div></body></html>',{url:'http://localhost/bus-access/'}),w=dom.window,d=w.document;
  let admin=options.admin!==false,location={id:'1',name:'Example Hall',address:'Synthetic address'},seq=0;
  Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.URL.createObjectURL=()=>`blob:test-${++seq}`;const revoked=[];w.URL.revokeObjectURL=url=>revoked.push(url);w.confirm=()=>true;
  const saved=[],exports=[];
  const fakePhoto=file=>({id:file.name,category:'interior',caption:'',selected:true,createdAt:seq++,image:new Blob(['photo'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'})});
  const api=mountLocationPhotos({document:d,window:w,isAdmin:()=>admin,getOwner:()=> 'admin-uid',getLocation:()=>location,getSummary:()=>({status:'Approved'}),
    prepare:options.prepare||(async(file,category)=>({...fakePhoto(file),category})),
    createDeviceStore:options.createDeviceStore,
    exportPdf:options.exportPdf||(async data=>{exports.push(data);return{blob:new Blob(['pdf']),filename:'photos.pdf',pages:2};})});
  api.contextChanged();await tick();
  const q=selector=>d.querySelector(selector);
  const add=async(names)=>{Object.defineProperty(q('[data-photo-files]'),'files',{value:names.map(name=>({name})),configurable:true});q('[data-photo-files]').dispatchEvent(new w.Event('change'));await tick();};
  return{w,d,api,q,add,exports,revoked,set admin(value){admin=value;api.contextChanged();},set location(value){location=value;api.contextChanged();},close(){api.dispose();w.close();}};
}
test('multiple interior/exterior photos, captions and selection survive refresh without altering the review form',async()=>{
  const h=await harness();await h.add(['one','two']);
  h.q('[data-photo-category]').value='exterior';await h.add(['three']);assert.equal(h.d.querySelectorAll('.photo-item').length,3);
  const checkbox=h.q('[data-photo-select]');checkbox.checked=false;checkbox.dispatchEvent(new h.w.Event('change'));await tick();
  const caption=h.q('[data-photo-caption]');caption.value='Main entrance';h.q('[data-photo-pdf]').click();await tick();assert.equal(h.exports.length,0);assert.match(h.q('[data-photo-status]').textContent,/Save the edited captions/);h.q('[data-photo-save-caption]').click();await tick();
  h.q('[data-photo-refresh]').click();await tick();assert.equal(h.q('[data-photo-select]').checked,false);assert.equal(h.q('[data-photo-caption]').value,'Main entrance');
  assert.equal(h.q('#reviewForm input').value,'Unsaved review');h.q('[data-photo-pdf]').click();await tick();assert.equal(h.exports[0].photos.filter(p=>p.selected).length,2);
  assert.ok(h.q('a[download]'));h.close();
});
test('changing location never displays previous photos and sign-out hides device images',async()=>{
  const h=await harness();await h.add(['one']);h.location={id:'2',name:'Second'};await tick();assert.equal(h.d.querySelectorAll('.photo-item').length,0);
  h.location={id:'1',name:'Example Hall'};await tick();assert.equal(h.d.querySelectorAll('.photo-item').length,1);
  h.admin=false;assert.equal(h.q('[data-photo-files]'),null);assert.equal(h.q('img'),null);assert.ok(h.revoked.length);h.close();
});
test('late PDF after sign-out is discarded and public PDF contains no photos',async()=>{
  let finish;const h=await harness({exportPdf:()=>new Promise(resolve=>finish=resolve)});await h.add(['one']);h.q('[data-photo-pdf]').click();h.admin=false;
  finish({blob:new Blob(['private']),filename:'private.pdf',pages:2});await tick();assert.equal(h.q('a[download]'),null);h.close();
  const pub=await harness({admin:false});pub.q('[data-photo-pdf]').click();await tick();assert.equal(pub.exports[0].photos.length,0);pub.close();
});
test('partial file failures report actual saves and keep valid photos',async()=>{
  const h=await harness({prepare:async(file,category)=>{if(file.name==='bad')throw Error('Unreadable photo');return{id:file.name,category,caption:'',selected:true,createdAt:1,image:new Blob(['x'],{type:'image/jpeg'}),thumbnail:new Blob(['x'],{type:'image/jpeg'})};}});
  await h.add(['good','bad']);assert.equal(h.d.querySelectorAll('.photo-item').length,1);assert.match(h.q('[data-photo-status]').textContent,/1 photo saved.*Unreadable/);assert.equal(h.q('[data-photo-files]').disabled,false);h.close();
});
test('upload completing after navigation does not save to the newly selected location',async()=>{
  let finish;const h=await harness({prepare:()=>new Promise(resolve=>finish=resolve)});await h.add(['one']);h.location={id:'2',name:'Second'};
  finish({id:'one',category:'interior',image:new Blob(['x'],{type:'image/jpeg'}),thumbnail:new Blob(['x'],{type:'image/jpeg'})});await tick();assert.equal(h.d.querySelectorAll('.photo-item').length,0);h.close();
});

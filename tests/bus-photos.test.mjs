import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createDevicePhotoStore,validatePhoto,PHOTO_LIMIT} from '../bus-access/photos-model.mjs';
import {createCloudPhotoStore} from '../bus-access/photos-cloud.mjs';
import {publicPhotoReport,buildPhotoPdf} from '../bus-access/photos-pdf.mjs';
const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const ribbonAssets={header:readFileSync('assets/print-header-sky.png'),footer:readFileSync('assets/print-footer-hills.png')};
const jpeg=()=>new Blob([readFileSync('load-tests/assets/bible.jpg')],{type:'image/jpeg'});
const photo=(id='one')=>({id,category:'interior',caption:'Sample photo',selected:true,createdAt:123,image:jpeg(),thumbnail:jpeg()});
const smallPhoto=(id='one')=>({...photo(id),image:new Blob(['image'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'})});

test('device photos survive re-opening and are isolated by location and user',async()=>{
  const indexedDB=new IDBFactory(),a=createDevicePhotoStore({indexedDB,owner:'admin-a'});
  await a.add('1',smallPhoto());await a.add('2',smallPhoto());
  const reopened=createDevicePhotoStore({indexedDB,owner:'admin-a'}),other=createDevicePhotoStore({indexedDB,owner:'admin-b'});
  assert.equal((await reopened.list('1')).length,1);assert.equal((await other.list('1')).length,0);
  const record=(await reopened.list('1'))[0];await reopened.update('1',{...record,caption:'Updated',selected:false});
  assert.equal((await a.list('1'))[0].selected,false);assert.equal((await a.list('2'))[0].caption,'Sample photo');
  assert.equal(await (await a.list('1'))[0].image.text(),'image');
  await a.remove('1','one');assert.equal((await a.list('1')).length,0);assert.equal((await a.list('2')).length,1);
});
test('concurrent device saves enforce limits without replacing another photo',async()=>{
  const a=createDevicePhotoStore({indexedDB:new IDBFactory(),owner:'a'});
  const results=await Promise.allSettled(Array.from({length:PHOTO_LIMIT+2},(_,i)=>a.add('1',smallPhoto('p-'+i))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,PHOTO_LIMIT);assert.equal((await a.list('1')).length,PHOTO_LIMIT);
});
test('invalid photos cannot enter storage and deleted records cannot be resurrected by edits',async()=>{
  assert.throws(()=>validatePhoto({...smallPhoto(),category:'other'}));
  assert.throws(()=>validatePhoto({...smallPhoto(),id:'../bad'}));
  assert.throws(()=>validatePhoto({...smallPhoto(),image:new Blob(['x'],{type:'image/svg+xml'})}));
  const a=createDevicePhotoStore({indexedDB:new IDBFactory(),owner:'a'});await assert.rejects(a.update('1',smallPhoto()),/removed/);
});
function cloudHarness(){
  const records=new Map(),objects=new Map(),calls=[];let admin=true,failUpload=false,failDelete=false;
  const snapshot=key=>({exists:()=>records.has(key),data:()=>structuredClone(records.get(key))});
  const store=createCloudPhotoStore({db:{},storage:{},doc:(_,collection,id)=>collection+'/'+id,ref:(_,path)=>path,isAdmin:()=>admin,
    getDocFromServer:async key=>snapshot(key),runTransaction:async(_,fn)=>fn({get:async key=>snapshot(key),set:(key,data)=>{calls.push(['commit',key]);records.set(key,data);}}),
    uploadBytes:async(path,blob)=>{if(failUpload&&path.endsWith('thumb.jpg'))throw Error('network');objects.set(path,blob);calls.push(['upload',path]);},
    getBlob:async path=>objects.get(path),deleteObject:async path=>{if(failDelete)throw Error('network');objects.delete(path);}});
  return{store,records,objects,calls,set admin(v){admin=v;},set failUpload(v){failUpload=v;},set failDelete(v){failDelete=v;}};
}
test('cloud upload commits private metadata only after both files and never touches ordinary reviews',async()=>{
  const h=cloudHarness();await h.store.add('1',smallPhoto());
  assert.equal(h.calls[2][0],'commit');assert.equal(h.records.size,1);assert.ok(h.records.has('reviews/photo-library-1'));
  assert.equal((await h.store.list('1')).length,1);assert.equal((await h.store.list('2')).length,0);
  assert.equal(await (await h.store.image('1',smallPhoto())).text(),'image');
  h.failUpload=true;await assert.rejects(h.store.add('1',smallPhoto('two')),/network/);assert.equal((await h.store.list('1')).length,1);
});
test('cloud metadata edits preserve other photos and deletion reports incomplete object cleanup',async()=>{
  const h=cloudHarness();await h.store.add('1',smallPhoto());await h.store.add('1',smallPhoto('two'));
  await h.store.update('1',{...smallPhoto(),selected:false});assert.equal((await h.store.list('1')).length,2);
  h.failDelete=true;assert.match(await h.store.remove('1','one'),/cleanup/);assert.deepEqual((await h.store.list('1')).map(p=>p.id),['two']);
});
test('cloud methods fail before access when signed out',async()=>{
  const h=cloudHarness();h.admin=false;
  await assert.rejects(h.store.list('1'),/sign-in/);await assert.rejects(h.store.add('1',smallPhoto()),/sign-in/);
  await assert.rejects(h.store.image('1',smallPhoto()),/sign-in/);assert.equal(h.calls.length,0);
});
test('PDF report excludes private review fields and embeds only selected photos',async()=>{
  const report=publicPhotoReport({id:'1',name:'Example location',markerLabel:'1',address:'Synthetic test address',contact1:{name:'PRIVATE'}},{status:'Approved',publicSummary:'Saved summary',internalNotes:'PRIVATE'});
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  const read=[],photos=[photo(),{...photo('two'),category:'exterior'},{...photo('three'),selected:false}];
  const result=await buildPhotoPdf({report,photos,loadImage:async p=>{read.push(p.id);return p.image;}},{PDFLib,ribbonAssets});
  assert.deepEqual(read,['one','two']);const pdf=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(pdf.getPageCount(),2);
  for(const page of pdf.getPages())assert.deepEqual(page.getSize(),{width:612,height:792});
});
test('missing selected imagery stops PDF creation; zero selection still makes a summary',async()=>{
  const report=publicPhotoReport({id:'1',name:'Example'});
  await assert.rejects(buildPhotoPdf({report,photos:[photo()],loadImage:async()=>{throw Error('offline');}},{PDFLib,ribbonAssets}),/offline/);
  const result=await buildPhotoPdf({report,photos:[],loadImage:()=>assert.fail('no image expected')},{PDFLib,ribbonAssets});assert.equal(result.pages,1);
});

test('PDF embeds JPEG download bytes with generic or parameterized MIME types and rejects mislabeled data',async()=>{
  const report=publicPhotoReport({id:'1',name:'Shared download'}),bytes=await jpeg().arrayBuffer();
  const types=['','application/octet-stream','image/jpeg; charset=utf-8'];
  const photos=types.map((type,index)=>({...photo('download-'+index),image:new Blob([bytes],{type})}));
  const result=await buildPhotoPdf({report,photos,loadImage:async p=>p.image},{PDFLib,ribbonAssets});
  const pdf=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());assert.equal(pdf.getPageCount(),3);
  await assert.rejects(buildPhotoPdf({report,photos:[photo()],loadImage:async()=>new Blob(['not a JPEG'],{type:'image/jpeg'})},{PDFLib,ribbonAssets}),/not a valid JPEG/);
});

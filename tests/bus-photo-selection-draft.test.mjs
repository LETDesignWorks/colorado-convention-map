import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhotoReportDraftStore,photoReportScope,pdfPhotos,selectedOverviewPhotoId} from '../bus-access/photos-report-draft.mjs';

const scope=(locationId='1',owner='admin-a',admin=true)=>photoReportScope({locationId,owner,admin});
function browserStorage(){const data=new Map();return {data,getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value))};}
const photo=(id,category='exterior',selected=true)=>({id,category,selected});

test('new and existing version-1 drafts default to using selected photos without losing saved notes or overview choices',()=>{
  const storage=browserStorage(),drafts=createPhotoReportDraftStore({getStorage:()=>storage});
  assert.deepEqual(drafts.load(scope()).useOnlySelectedPhotos,{device:true,shared:true});
  storage.setItem('bus-access-pdf-report-v1:'+scope('legacy'),JSON.stringify({version:1,notes:'Use the west entrance.',overviewPhotoIds:{device:'inside-a',shared:'outside-a'}}));
  const legacy=drafts.load(scope('legacy'));
  assert.equal(legacy.notes,'Use the west entrance.');
  assert.deepEqual(legacy.overviewPhotoIds,{device:'inside-a',shared:'outside-a'});
  assert.deepEqual(legacy.useOnlySelectedPhotos,{device:true,shared:true});
  assert.equal(legacy.persistence,'saved');
});

test('photo inclusion preferences persist independently by library, location, and signed-in account',()=>{
  const storage=browserStorage(),drafts=createPhotoReportDraftStore({getStorage:()=>storage});
  drafts.update(scope(),{notes:'Keep the pedestrian path clear.',useOnlySelectedPhotos:{shared:false}});
  drafts.update(scope(),{overviewPhotoIds:{shared:'outside-a'},useOnlySelectedPhotos:{device:false}});
  drafts.update(scope(),{useOnlySelectedPhotos:{shared:true}});
  const reopened=createPhotoReportDraftStore({getStorage:()=>storage}),saved=reopened.load(scope());
  assert.deepEqual(saved.useOnlySelectedPhotos,{device:false,shared:true});
  assert.equal(saved.notes,'Keep the pedestrian path clear.');
  assert.equal(saved.overviewPhotoIds.shared,'outside-a');
  for(const other of [scope('2'),scope('1','admin-b'),scope('1','admin-a',false),scope('1','',false)]){
    assert.deepEqual(reopened.load(other).useOnlySelectedPhotos,{device:true,shared:true});
  }
  reopened.update(scope(),{notes:'Updated notes'});
  assert.deepEqual(createPhotoReportDraftStore({getStorage:()=>storage}).load(scope()).useOnlySelectedPhotos,{device:false,shared:true});
});

test('selection preferences remain isolated copies and survive location changes when browser saving fails',()=>{
  const drafts=createPhotoReportDraftStore({getStorage:()=>{throw Error('Saving blocked');}});
  const patch={useOnlySelectedPhotos:{shared:false}};
  const result=drafts.update(scope(),patch);
  assert.equal(result.persistence,'session');
  patch.useOnlySelectedPhotos.shared=true;result.useOnlySelectedPhotos.shared=true;
  const loaded=drafts.load(scope());
  assert.deepEqual(loaded.useOnlySelectedPhotos,{device:true,shared:false});
  loaded.useOnlySelectedPhotos.device=false;
  drafts.update(scope('2'),{useOnlySelectedPhotos:{device:false}});
  assert.deepEqual(drafts.load(scope()).useOnlySelectedPhotos,{device:true,shared:false});
  assert.deepEqual(drafts.load(scope('2')).useOnlySelectedPhotos,{device:false,shared:true});
});

test('PDF photo selection includes only checked photos by default and all saved photos when explicitly disabled',()=>{
  const photos=[photo('inside','interior'),photo('unchecked','exterior',false),{id:'legacy',category:'exterior'}],original=structuredClone(photos);
  assert.deepEqual(pdfPhotos(photos).map(p=>p.id),['inside','legacy']);
  assert.deepEqual(pdfPhotos(photos,true).map(p=>p.id),['inside','legacy']);
  assert.deepEqual(pdfPhotos(photos,false).map(p=>p.id),['inside','unchecked','legacy']);
  const all=pdfPhotos(photos,false);all.pop();
  assert.deepEqual(photos,original,'building the PDF list never changes the saved library or checkbox values');
  assert.deepEqual(pdfPhotos([photo('unchecked','exterior',false)]),[]);
  assert.deepEqual(pdfPhotos([]),[]);
});

test('overview selection uses exactly the photos included by the current PDF inclusion mode',()=>{
  const photos=[photo('inside','interior'),photo('unchecked-outside','exterior',false),photo('checked-outside')];
  assert.equal(selectedOverviewPhotoId(photos,'unchecked-outside'),'checked-outside');
  assert.equal(selectedOverviewPhotoId(photos,'unchecked-outside',false),'unchecked-outside');
  assert.equal(selectedOverviewPhotoId(photos,'',false),'unchecked-outside','all-photo mode can automatically use an unchecked exterior photo');
  assert.equal(selectedOverviewPhotoId(photos,'inside',false),'inside');
  assert.equal(selectedOverviewPhotoId([photo('unchecked','exterior',false)]),'');
  assert.equal(selectedOverviewPhotoId([photo('unchecked','exterior',false)],'',false),'unchecked');
  assert.equal(selectedOverviewPhotoId([],'missing',false),'');
});

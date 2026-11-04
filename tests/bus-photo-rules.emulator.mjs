// Run through Firebase emulators:exec; this suite never contacts production.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {ref,uploadBytes,getBytes,getMetadata,deleteObject} from 'firebase/storage';
import {doc,setDoc,getDoc,deleteDoc} from 'firebase/firestore';

const projectId='demo-bus-photos',adminUid='jPTl6zfkjaTbbCJMI7A7xXE2BN93';
let env;
before(async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8085$/);
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):9195$/);
  env=await initializeTestEnvironment({projectId,
    firestore:{host:'127.0.0.1',port:8085,rules:readFileSync(new URL('../bus-access/photo-storage/firestore.rules',import.meta.url),'utf8')},
    storage:{host:'127.0.0.1',port:9195,rules:readFileSync(new URL('../bus-access/photo-storage/storage.rules',import.meta.url),'utf8')}});
});
after(async()=>{await env?.cleanup();});
const admin=()=>env.authenticatedContext(adminUid,{email:'michaeltarin@hotmail.com'});
const stranger=()=>env.authenticatedContext('different-user',{email:'another@example.invalid'});
const impersonator=()=>env.authenticatedContext('different-uid',{email:'michaeltarin@hotmail.com'});
const photo=(context,name='photo.jpg')=>ref(context.storage(),`bus-location-photos/1/synthetic-test/${name}`);
const jpeg={contentType:'image/jpeg'};

test('only the existing admin can upload and read a photo across sessions',async()=>{
  await assertSucceeds(uploadBytes(photo(admin()),new Uint8Array([1,2,3]),jpeg));
  assert.equal((await assertSucceeds(getBytes(photo(admin())))).byteLength,3);
  for(const context of [env.unauthenticatedContext(),stranger(),impersonator()]){
    await assertFails(getBytes(photo(context)));
    await assertFails(getMetadata(photo(context)));
    await assertFails(uploadBytes(photo(context),new Uint8Array([4]),jpeg));
    await assertFails(deleteObject(photo(context)));
  }
});
test('content-type, file-name and size constraints are enforced by the server',async()=>{
  await assertFails(uploadBytes(photo(admin()),new Uint8Array([1]),{contentType:'image/svg+xml'}));
  await assertFails(uploadBytes(photo(admin(),'unknown.jpg'),new Uint8Array([1]),jpeg));
  await assertFails(uploadBytes(photo(admin()),new Uint8Array(2*1024*1024+1),jpeg));
  await assertFails(uploadBytes(photo(admin(),'thumb.jpg'),new Uint8Array(200*1024+1),jpeg));
  await assertSucceeds(uploadBytes(photo(admin(),'thumb.jpg'),new Uint8Array([1]),jpeg));
  await assertFails(uploadBytes(ref(admin().storage(),'unrelated/file.jpg'),new Uint8Array([1]),jpeg));
});
test('private photo metadata is UID-restricted and stays outside ordinary reviews',async()=>{
  const path='reviews/photo-library-1',data={type:'bus-location-photos',locationId:'1',photos:{}};
  await assertSucceeds(setDoc(doc(admin().firestore(),path),data));
  assert.equal((await assertSucceeds(getDoc(doc(admin().firestore(),path)))).data().type,'bus-location-photos');
  for(const context of [env.unauthenticatedContext(),stranger(),impersonator()]){
    await assertFails(getDoc(doc(context.firestore(),path)));
    await assertFails(setDoc(doc(context.firestore(),path),data));
    await assertFails(deleteDoc(doc(context.firestore(),path)));
  }
});
test('existing public map reads and administrator review writes still work',async()=>{
  await assertSucceeds(setDoc(doc(admin().firestore(),'halls/1'),{name:'Synthetic hall'}));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'halls/1')));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(),'halls/1'),{name:'Wrong'}));
  await assertSucceeds(setDoc(doc(admin().firestore(),'reviews/1'),{internalNotes:'Synthetic private note'}));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'reviews/1')));
  await assertFails(getDoc(doc(stranger().firestore(),'reviews/1')));
});
test('the administrator can delete a photo and its private metadata',async()=>{
  await assertSucceeds(deleteObject(photo(admin())));
  await assertSucceeds(deleteDoc(doc(admin().firestore(),'reviews/photo-library-1')));
});

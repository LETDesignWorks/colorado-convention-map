import { mount } from './ui.mjs?v=20261019-3';
import { validateTest } from './model.mjs?v=20261019-3';
import {packAttachment,unpackAttachment} from './attachments.mjs?v=20261019-3';

try {
  const [{initializeApp},{getAuth,setPersistence,browserLocalPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged},
    {getFirestore,collection,doc,query,where,onSnapshot,runTransaction,serverTimestamp,writeBatch,getDoc}] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js')]);
  const firebase=initializeApp({apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'});
  const auth=getAuth(firebase),db=getFirestore(firebase);
  const isEditor=user=>user?.email?.toLowerCase()==='michaeltarin@hotmail.com';
  await setPersistence(auth,browserLocalPersistence);
  mount({
    start(onSession,onRecords,onError) {
      let unsubscribe=()=>{};
      return onAuthStateChanged(auth,user=>{
        unsubscribe(); onSession(user ? {email:user.email,canEdit:isEditor(user)} : null);
        if(!isEditor(user))return;
        unsubscribe=onSnapshot(query(collection(db,'reviews'),where('recordType','==','field-service-load-test')),snapshot=>{
          const records=[];let invalid=0;
          for(const record of snapshot.docs){try{
            const data=record.data(),test=validateTest(JSON.parse(data.testJson));
            if(test.id!==record.id)throw new Error('Record ID mismatch');
            records.push({test,revision:data.revision||0,updatedAt:data.updatedAt?.toDate?.()?.toLocaleString()||'',updatedBy:data.updatedBy||''});
          }catch{invalid++;}}
          onRecords(records);
          if(invalid)onError(new Error(`${invalid} saved checklist could not be read. Existing records have not been changed.`));
        },onError);
      });
    },
    login:(email,password)=>signInWithEmailAndPassword(auth,email,password),
    logout:()=>signOut(auth),
    async saveAttachment(bytes,name){
      if(!isEditor(auth.currentUser))throw new Error('Sign in to attach a sample territory.');
      const {meta,chunks}=await packAttachment(bytes,name),batch=writeBatch(db);
      chunks.forEach((data,index)=>batch.set(doc(db,'reviews',`${meta.id}__${index}`),{recordType:'field-service-load-test-attachment',attachmentId:meta.id,index,data,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.email}));
      await batch.commit();return meta;
    },
    async readAttachment(meta){
      if(!isEditor(auth.currentUser))throw new Error('Sign in to open the sample territory.');
      const chunks=[];
      for(let start=0;start<meta.parts;start+=4){
        const result=await Promise.all(Array.from({length:Math.min(4,meta.parts-start)},(_,i)=>getDoc(doc(db,'reviews',`${meta.id}__${start+i}`))));
        for(const item of result){if(!item.exists()||item.data().recordType!=='field-service-load-test-attachment')throw new Error('The sample territory is unavailable. Attach the PDF again.');chunks.push(item.data().data);}
      }
      return unpackAttachment(meta,chunks);
    },
    async save(input,expectedRevision) {
      if(!isEditor(auth.currentUser))throw new Error('Sign in with the existing planning administrator account to save.');
      if(!navigator.onLine)throw new Error('You are offline. Keep this page open and save when the connection returns, or download a backup.');
      const test=validateTest(input),ref=doc(db,'reviews',test.id);
      const revision=await runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(ref);const previous=snapshot.exists()?snapshot.data():null;
        if(previous && previous.recordType!=='field-service-load-test')throw new Error('This record belongs to another planner. Create a new checklist.');
        if((previous?.revision||0)!==expectedRevision)throw new Error('Someone saved a newer version. Download a backup of your edits, then use Reload saved to review their changes before saving again.');
        const next=expectedRevision+1;
        transaction.set(ref,{recordType:'field-service-load-test',testJson:JSON.stringify(test),name:test.name,testDate:test.date,archived:test.archived,revision:next,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.email,...(!previous?{createdAt:serverTimestamp()}: {})},{merge:true});
        return next;
      });
      return revision;
    }
  });
} catch(error) {
  document.getElementById('app').innerHTML='<section class="panel login"><h1>Unable to connect</h1><p>Check your connection and reload this page to sign in and open shared checklists.</p><button onclick="location.reload()">Try again</button></section>';
  console.error('Load-test connection failed',error.code||error.message);
}

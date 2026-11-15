import {initializeApp,getApp,getApps} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {getAuth} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {getFirestore,collection,onSnapshot,doc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {canEdit,observeSiteAccess} from './site-access.mjs?v=access-20261114-1';
import {meetingLocations,STATUS_REVISION,suitabilityPayload} from './meeting-suitability-model.mjs';
import {createSuitabilityUI} from './meeting-suitability-ui.mjs';
const config={apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'};
function start(){
 if(window.__denverMeetingSuitabilityStarted)return;window.__denverMeetingSuitabilityStarted=true;
 let current=[],fresh=false,migrating=false;
 const app=getApps().length?getApp():initializeApp(config),db=getFirestore(app),auth=getAuth(app);
 async function save(location,status,{correction=false}={}){
  if(!canEdit('busAccess'))throw Error('Bus Access Review edit access is required.');
  if(!fresh)throw Error('Wait for current shared data and an online connection.');
  const ref=doc(db,'halls',String(location.id));
  return runTransaction(db,async transaction=>{const snapshot=await transaction.get(ref),data=snapshot.exists()?snapshot.data():{};
   if(data.recordType&&data.recordType!=='bus-access-location')throw Error('This record is not a meeting location.');
   if(correction&&Number(data.suitabilityRevision||0)>=STATUS_REVISION)return data;
   const payload={...suitabilityPayload(location,status,{create:!snapshot.exists()}),updatedAt:serverTimestamp()};transaction.set(ref,payload,{merge:true});return {...data,...payload};
  });
 }
 const ui=createSuitabilityUI(document,{canEdit:()=>canEdit('busAccess'),ready:()=>fresh,save,signInUrl:new URL('../access/',import.meta.url).href});
 async function correctCastleRock(){
  if(migrating||!fresh||!canEdit('busAccess'))return;const record=current.find(p=>p.id==='26');if(Number(record?.suitabilityRevision||0)>=STATUS_REVISION)return;
  migrating=true;try{await save(meetingLocations.get('26'),'not-suitable',{correction:true});}catch(error){console.warn('Castle Rock correction could not be saved yet.',error.message);}finally{migrating=false;}
 }
 observeSiteAccess(auth,()=>{ui.update();void correctCastleRock();});
 onSnapshot(collection(db,'halls'),{includeMetadataChanges:true},snapshot=>{fresh=!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites;current=snapshot.docs.map(d=>({...d.data(),id:d.id}));ui.update(current);window.dispatchEvent(new CustomEvent('denver-bus-status-updated'));void correctCastleRock();},error=>{fresh=false;ui.update();console.warn('Shared meeting suitability could not load.',error.message);});
}
function begin(){try{start();}catch(error){console.warn('Meeting suitability controls could not initialize.',error.message);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});else begin();

import {collection,query,where,onSnapshot,doc,setDoc,getDocFromServer,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {observeSiteAccess,canView,canEdit,isOwner} from '../assets/site-access.mjs?v=access-20261114-1';
import {HOSTING_TYPE,hostingPayload,readHostingRecord,hostingRevision,hostingSheets} from './hosting-model.mjs';
import {mountHostingPlanner} from './hosting-ui.mjs';
import {workbookBytes} from './excel-export.mjs?v=assigned-travel-20261115-1';
export function initHostingPlanner({root,auth,db,getData,showMeeting,showCongregation}){
 let generation=0,stop=null,fresh=false,supported=false;const storage=()=>{try{return localStorage;}catch{return null;}};
 const download=(bytes,name,type)=>{const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
 function check(token){if(token!==generation||!canEdit('assignments')||!supported||!fresh||!getData().ready)throw Error('Current shared data and Congregation Assignments edit access are required.');}
 const ui=mountHostingPlanner(root,{storage:storage(),showMeeting,showCongregation,
  exportExcel:(plan,data)=>download(workbookBytes(hostingSheets(plan,data)),'Denver-2027-Daily-Field-Service-Hosting.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  exportJson:plan=>download(JSON.stringify(plan,null,2),'Denver-2027-Daily-Hosting-Backup.json','application/json'),
  importJson:()=>new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);input.addEventListener('cancel',()=>{input.remove();resolve(null);},{once:true});input.addEventListener('change',async()=>{try{const file=input.files?.[0];if(!file){resolve(null);return;}if(file.size>900000)throw Error('Choose a hosting backup smaller than 900 KB.');resolve(JSON.parse(await file.text()));}catch(error){reject(Error('Could not import this hosting backup: '+error.message));}finally{input.remove();}},{once:true});input.click();}),
  async saveShared(plan,existing){const token=generation;check(token);const payload=hostingPayload(plan),ref=existing?doc(db,'reviews',existing.id):doc(collection(db,'reviews'));let revision=1;
   const audit=()=>({updatedAt:serverTimestamp(),updatedByEmail:auth.currentUser?.email||''});
   if(existing)await runTransaction(db,async tx=>{check(token);const snapshot=await tx.get(ref);check(token);revision=hostingRevision(snapshot.exists()?snapshot.data():null,existing.revision);tx.set(ref,{...payload,revision,...audit()});});
   else await setDoc(ref,{...payload,revision,...audit()});
   if(token!==generation||!canEdit('assignments'))throw Error('Your access changed. Sign in to see the saved plan.');return {id:ref.id,revision};
  },
  async deleteShared(existing){const token=generation;check(token);await runTransaction(db,async tx=>{check(token);const ref=doc(db,'reviews',existing.id),snapshot=await tx.get(ref);check(token);hostingRevision(snapshot.exists()?snapshot.data():null,existing.revision);tx.delete(ref);});}
 });
 ui.setData(getData());
 observeSiteAccess(auth,async()=>{
  const token=++generation;stop?.();stop=null;fresh=false;supported=isOwner();ui.setShared({reset:true,read:canView('assignments'),write:canEdit('assignments'),enabled:supported});if(!canView('assignments'))return;
  if(!supported){try{await getDocFromServer(doc(db,'siteAccessCapabilities','hostingPlansV1'));if(token!==generation)return;supported=true;}catch{if(token!==generation)return;ui.setShared({read:true,write:canEdit('assignments'),enabled:false,note:'You can plan and export locally. The administrator needs to enable shared hosting plans for other logins on the Access page.'});return;}}
  stop=onSnapshot(query(collection(db,'reviews'),where('recordType','==',HOSTING_TYPE)),{includeMetadataChanges:true},snapshot=>{
   if(token!==generation)return;fresh=!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites;
   const items=snapshot.docs.map(d=>readHostingRecord({...d.data(),id:d.id})).filter(Boolean).sort((a,b)=>a.plan.name.localeCompare(b.plan.name));ui.setShared({items,read:true,write:canEdit('assignments'),enabled:supported,current:fresh});
  },()=>{if(token!==generation)return;fresh=false;ui.setShared({reset:true,read:canView('assignments'),write:canEdit('assignments'),enabled:supported,note:'Shared hosting plans could not load. Your device draft and exports are available; reconnect or refresh to retry.'});});
 });
 return {update:()=>ui.setData(getData())};
}

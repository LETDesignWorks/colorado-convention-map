import {db,auth,canView,canEdit,observeSiteAccess,watchHalls} from '../assets/planning-cloud.mjs';
import {collection,query,where,onSnapshot,doc,setDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {catalog,CENTERS} from '../assets/planning-common.mjs?v=suitability-20261115-1';
import {loadRail} from '../assets/rail-network.mjs';
import {railMeetingPoints} from '../assets/rail-meeting-points.mjs';
import {findAddress} from '../assignments/location-model.mjs';
import {road} from '../travel-routes/providers.mjs?v=activity-reach-20261115-1';
import {createRoutingKeyStore} from '../travel-routes/key-store.mjs';
import {workbookBytes} from '../assignments/excel-export.mjs?v=assigned-travel-20261115-1';
import {GROUP_TYPE,encodeGroupPlan,readGroupPlan,nextGroupRevision,busGroupSheets} from './bus-groups-model.mjs';
import {mountBusGroups} from './bus-groups-ui.mjs';
const root=document.getElementById('busGroups');
if(root){
 const storage=name=>{try{return globalThis[name];}catch{return null;}};
 const keyStore=createRoutingKeyStore({session:storage('sessionStorage'),device:storage('localStorage')});
 let generation=0,stop=null,fresh=false,halls=[],rail=[];
 const assertWrite=token=>{if(token!==generation||!canEdit('activityPlanning')||!fresh)throw Error('Current shared data and Activity Planning edit access are required. Reconnect or sign in, then retry.');};
 const ui=mountBusGroups(root,{
  origins:CENTERS,route:road,findAddress,getKey:()=>keyStore.read().key,storage:storage('localStorage'),
  async saveShared(plan,existing){
   const token=generation;assertWrite(token);const payload=encodeGroupPlan(plan),ref=existing?doc(db,'reviews',existing.id):doc(collection(db,'reviews'));
   const audit=()=>({updatedByEmail:auth.currentUser?.email||'',updatedAt:serverTimestamp()});let revision=1;
   if(existing){await runTransaction(db,async transaction=>{
    assertWrite(token);const snapshot=await transaction.get(ref);assertWrite(token);
    revision=nextGroupRevision(snapshot.exists()?snapshot.data():null,existing.revision);
    transaction.set(ref,{...payload,revision,...audit()});
   });}
   else await setDoc(ref,{...payload,revision,...audit()});
   if(token!==generation||!canEdit('activityPlanning'))throw Error('Your access changed. Sign in to view the saved plan.');
   return {id:ref.id,revision};
  },
  async removeShared(existing){
   const token=generation;assertWrite(token);const ref=doc(db,'reviews',existing.id);
   await runTransaction(db,async transaction=>{assertWrite(token);const snapshot=await transaction.get(ref);assertWrite(token);nextGroupRevision(snapshot.exists()?snapshot.data():null,existing.revision);transaction.delete(ref);});
  },
  exportResult(result){
   const bytes=workbookBytes(busGroupSheets(result)),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');
   a.href=url;a.download='Denver-2027-Bus-Groups-and-Arrivals.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
 });
 const updateLocations=()=>ui.setLocations([...catalog(halls),...rail]);updateLocations();
 const notice=document.createElement('p');notice.className='hint';notice.setAttribute('role','status');root.append(notice);let hallNote='',railNote='';
 const showNotice=()=>{notice.textContent=[hallNote,railNote].filter(Boolean).join(' ');};
 watchHalls(rows=>{halls=rows;hallNote='';updateLocations();showNotice();},()=>{hallNote='Saved meeting-location updates could not load. The base location list is available.';showNotice();});
 loadRail().then(data=>{rail=railMeetingPoints(data);updateLocations();}).catch(()=>{railNote='Rail meeting locations could not load. Refresh to include them.';showNotice();});
 observeSiteAccess(auth,()=>{
  const token=++generation;stop?.();stop=null;fresh=false;
  ui.setShared({reset:true,canRead:canView('activityPlanning'),canWrite:canEdit('activityPlanning'),current:false});
  if(!canView('activityPlanning'))return;
  stop=onSnapshot(query(collection(db,'reviews'),where('recordType','==',GROUP_TYPE)),{includeMetadataChanges:true},snapshot=>{
   if(token!==generation)return;fresh=!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites;
   const items=snapshot.docs.map(d=>readGroupPlan({...d.data(),id:d.id})).filter(Boolean).sort((a,b)=>a.plan.name.localeCompare(b.plan.name));
   ui.setShared({items,canRead:true,canWrite:canEdit('activityPlanning'),current:fresh});
  },()=>{if(token!==generation)return;fresh=false;ui.setShared({reset:true,note:'Shared bus-group plans could not load. Your device draft and local calculations remain available; reconnect or sign in to retry.'});});
 });
 document.addEventListener('input',event=>{if(event.target.matches('[data-reach-key],#tomtomKey'))ui.invalidate();});
 document.addEventListener('click',event=>{if(event.target.closest('[data-reach-clear-key],#clearKey'))ui.invalidate();});
 window.addEventListener('storage',event=>{if(event.key==='denver2027.travel.tomtom-key')ui.invalidate();});
}

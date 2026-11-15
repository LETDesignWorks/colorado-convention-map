import {db,auth,canView,canEdit,observeSiteAccess,watchHalls} from '../assets/planning-cloud.mjs';
import {isOwner} from '../assets/site-access.mjs?v=access-20261114-1';
import {collection,query,where,onSnapshot,doc,getDocFromServer,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {catalog} from '../assets/planning-common.mjs?v=suitability-20261115-1';
import {loadRail} from '../assets/rail-network.mjs';
import {railMeetingPoints} from '../assets/rail-meeting-points.mjs';
import {RECORD_TYPE,countPayload,countId,nextRevision} from './model.mjs';
import {mountDelegateCounts} from './ui.mjs';
import {downloadCounts} from './export.mjs';
const root=document.getElementById('delegateCounts');
if(root){
 let generation=0,stop=null,fresh=false,supported=false,halls=[],rail=[],loaded=false;
 const canSave=()=>fresh&&canEdit('activityPlanning')&&(isOwner()||supported);
 const ui=mountDelegateCounts(root,{
  exportCounts:downloadCounts,
  async save(value,expectedRevision){
   if(!canSave())throw Error('Wait for current shared data and Activity Planning edit access.');
   const payload=countPayload(value),ref=doc(db,'reviews',countId(payload)),token=generation;
   await runTransaction(db,async transaction=>{
    if(token!==generation||!canSave())throw Error('Your access changed. Sign in again.');
    const snap=await transaction.get(ref),existing=snap.exists()?snap.data():null;
    if(token!==generation||!canSave())throw Error('Your access changed. Sign in again.');
    const revision=nextRevision(existing,expectedRevision);
    transaction.set(ref,{...payload,revision,updatedByEmail:auth.currentUser?.email||'',updatedAt:serverTimestamp()});
   });
  },
  async remove(record){
   if(!canSave())throw Error('Activity Planning edit access and current shared data are required.');
   if(countId(countPayload(record))!==record.id)throw Error('Choose a valid delegate count.');
   const ref=doc(db,'reviews',record.id),token=generation;
   await runTransaction(db,async transaction=>{
    if(token!==generation||!canSave())throw Error('Your access changed. Sign in again.');
    const snap=await transaction.get(ref);if(token!==generation||!canSave())throw Error('Your access changed. Sign in again.');nextRevision(snap.exists()?snap.data():null,record.revision);transaction.delete(ref);
   });
  }
 });
 const updatePoints=()=>ui.setData({points:[...catalog(halls),...rail]});
 updatePoints();watchHalls(rows=>{halls=rows;updatePoints();},()=>{});
 loadRail().then(data=>{rail=railMeetingPoints(data);updatePoints();}).catch(()=>{});
 observeSiteAccess(auth,async()=>{
  const token=++generation;stop?.();stop=null;fresh=false;supported=false;loaded=false;
  const access=canView('activityPlanning');
  ui.setData({reset:true,records:[],access:false,edit:false,loaded:false,fresh:false,needsRules:false,message:access?'Checking delegate-count access…':'Sign in with Activity Planning access to view delegate counts.'});
  if(!access)return;
  let nextSupported=false;
  try{await getDocFromServer(doc(db,'siteAccessCapabilities','delegateCountsV1'));nextSupported=true;}catch{}
  if(token!==generation)return;
  supported=nextSupported;
  if(!isOwner()&&!supported){ui.setData({needsRules:true,message:'The administrator must update the database rules before other logins can use delegate counts.'});return;}
  ui.setData({access:true,edit:canEdit('activityPlanning'),needsRules:!supported,message:''});
  stop=onSnapshot(query(collection(db,'reviews'),where('recordType','==',RECORD_TYPE)),{includeMetadataChanges:true},snapshot=>{
   if(token!==generation)return;
   fresh=!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites;
   loaded=loaded||fresh||!snapshot.empty;
   ui.setData({records:snapshot.docs.map(d=>({...d.data(),id:d.id})),loaded,fresh,access:true,edit:canEdit('activityPlanning'),message:''});
  },error=>{
   if(token!==generation)return;fresh=false;ui.setData({fresh:false,message:'Shared delegate counts could not load: '+error.message+'. Reconnect or refresh to try again.'});
  });
 });
}

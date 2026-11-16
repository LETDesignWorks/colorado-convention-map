import {mountCenter} from './ui.mjs?v=pickup-map-20261116-1';
import {TYPE,decode,encode,nextRevision,fromGroups,fromActivity} from './model.mjs?v=pickup-map-20261116-1';
import {calculateBusGroups,cleanGroupPlan,readGroupPlan} from '../activity-planning/bus-groups-model.mjs';
import {decodeRecord} from '../activity-planning/model.mjs';
import {workbookBytes} from '../assignments/excel-export.mjs';
import {reportSheets} from './export.mjs?v=pickup-map-20261116-1';
const root=document.getElementById('center');
const store=name=>{try{return globalThis[name];}catch{return null;}};
const storage=store('localStorage');
let cloudSources=[],sharedSaver=null,generation=0;
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
let pickup=null;
const ui=mountCenter(root,{
 onPlanChange:(plan,report,busy)=>pickup?.setPlan(plan,report,busy),
 storage,
 async importSource(source,signal){
  if(source.kind==='Activity route')return fromActivity(source.value,source.id);
  const [{road},{CENTERS},{createRoutingKeyStore}]=await Promise.all([import('../travel-routes/providers.mjs'),import('../assets/planning-common.mjs'),import('../travel-routes/key-store.mjs')]);
  signal.throwIfAborted();const key=createRoutingKeyStore({session:store('sessionStorage'),device:storage}).read().key;
  return fromGroups(await calculateBusGroups(source.value,{origins:CENTERS,route:road,key,signal}),source.id);
 },
 async saveShared(plan,ref){if(!sharedSaver)throw Error('Shared saving is not connected. Sign in or export a backup.');return sharedSaver(plan,ref);},
 download(kind,value){if(kind==='backup')download(JSON.stringify(value,null,2),'Denver-2027-Convention-Center.json','application/json');else download(workbookBytes(reportSheets(value)),'Denver-2027-Convention-Center.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
});
async function mountCandidates(){
 try{const [module,response]=await Promise.all([import('./pickup-map.mjs?v=pickup-map-20261116-1'),fetch('./pickup-walks.json?v=pickup-map-20261116-1')]);if(!response.ok)throw Error();const data=await response.json();pickup=module.mountPickupMap(root.querySelector('[data-pickup-browser]'),{data,addAlternate:value=>ui.addAlternate(value)});pickup.setPlan(ui.getPlan(),ui.getReport());}
 catch{root.querySelector('[data-pickup-browser]').textContent='Nearby pickup research could not load. Refresh to retry; manual alternate pickup entries remain available.';}
}
mountCandidates();
function sources(){
 const items=[],warnings=[];
 try{const saved=storage?.getItem('denver2027.busGroups.v1');if(saved){const value=cleanGroupPlan(JSON.parse(saved));items.push({id:'device-bus-groups',name:value.name,kind:'Bus groups',value});}}catch{warnings.push('The device bus-group plan could not be read.');}
 try{const saved=JSON.parse(storage?.getItem('denver2027.activityRoutes.v1')||'[]');if(!Array.isArray(saved))throw Error();for(const record of saved){const value=decodeRecord(record);if(value&&!value.legacy)items.push({id:'device-route-'+record.id,name:value.name,kind:'Activity route',value});}}catch{warnings.push('Device activity routes could not be read.');}
 ui.setSources([...items,...cloudSources],warnings.join(' ')||'Save your bus groups or activity routes in Activity Planning to include them here. Import only plans that operate together; alternative plans are not automatically combined.');
}
sources();root.addEventListener('center-refresh',sources);window.addEventListener('storage',e=>{if(['denver2027.busGroups.v1','denver2027.activityRoutes.v1'].includes(e.key))sources();});
async function connect(){
 try{
  const [{db,auth,canView,canEdit,observeSiteAccess},api]=await Promise.all([import('../assets/planning-cloud.mjs'),import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js')]);
  let stop=null,fresh=false;
  const assertWrite=token=>{if(token!==generation||!fresh||!canEdit('activityPlanning'))throw Error('Current shared data and Activity Planning edit access are required. Reconnect or sign in.');};
  sharedSaver=async(plan,existing)=>{
   const token=generation;assertWrite(token);const payload=encode(plan),ref=existing?api.doc(db,'reviews',existing.id):api.doc(api.collection(db,'reviews'));let revision=1;
   const audit=()=>({updatedByEmail:auth.currentUser?.email||'',updatedAt:api.serverTimestamp()});
   if(existing)await api.runTransaction(db,async transaction=>{assertWrite(token);const saved=await transaction.get(ref);assertWrite(token);revision=nextRevision(saved.exists()?saved.data():null,existing.revision);transaction.set(ref,{...payload,revision,...audit()});});
   else await api.setDoc(ref,{...payload,revision,...audit()});
   if(token!==generation||!canEdit('activityPlanning'))throw Error('Access changed. Sign in to view the saved plan.');return {id:ref.id,revision};
  };
  observeSiteAccess(auth,()=>{
   const token=++generation;stop?.();stop=null;fresh=false;cloudSources=[];ui.setShared({reset:true});sources();
   if(!canView('activityPlanning'))return;
   stop=api.onSnapshot(api.query(api.collection(db,'reviews'),api.where('recordType','==',TYPE)),{includeMetadataChanges:true},snapshot=>{
    if(token!==generation)return;fresh=!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites;
    const records=snapshot.docs.map(d=>({...d.data(),id:d.id}));cloudSources=[];
    for(const r of records){const group=readGroupPlan(r);if(group)cloudSources.push({id:'shared-'+r.id,name:group.plan.name,kind:'Bus groups',value:group.plan,private:true});else{const route=decodeRecord(r);if(route&&!route.legacy)cloudSources.push({id:'shared-'+r.id,name:route.name,kind:'Activity route',value:route,private:true});}}
    sources();ui.setShared({items:records.map(decode).filter(Boolean),edit:canEdit('activityPlanning'),current:fresh});
   },()=>{if(token!==generation)return;fresh=false;cloudSources=[];ui.setShared({reset:true,note:'Shared plans could not load. Reconnect or sign in. Device plans and backups remain available.'});sources();});
  });
 }catch{ui.setShared({note:'Shared service is unavailable. Device plans and backups remain available.'});}
}
connect();

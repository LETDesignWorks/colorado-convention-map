import {road} from '../travel-routes/providers.mjs?v=activity-reach-20261115-1';
import {createRoutingKeyStore} from '../travel-routes/key-store.mjs';
import {workbookBytes} from '../assignments/excel-export.mjs?v=assigned-travel-20261115-1';
import {mountStaggeredFleet} from './stagger-ui.mjs';
import {staggerSheets} from './stagger-model.mjs';
export function mountStaggerPlanner(root,options){
 const storage=name=>{try{return globalThis[name];}catch{return null;}};
 const keyStore=createRoutingKeyStore({session:storage('sessionStorage'),device:storage('localStorage')});
 const ui=mountStaggeredFleet(root,{...options,route:road,getKey:()=>keyStore.read().key,exportResult:result=>{
  const blob=new Blob([workbookBytes(staggerSheets(result))],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='Denver-2027-Staggered-Bus-Schedule.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }});
 root.ownerDocument.addEventListener('input',event=>{if(event.target.matches('[data-reach-key]'))ui.invalidate('Traffic key changed. Recalculate the staggered schedule.');});
 root.ownerDocument.addEventListener('click',event=>{if(event.target.closest('[data-reach-clear-key]'))ui.invalidate('Traffic key cleared. Recalculate for road baseline estimates.');});
 return ui;
}

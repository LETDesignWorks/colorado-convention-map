import {catalog} from '../assets/planning-common.mjs?v=suitability-20261115-1';
import {watchHalls} from '../assets/planning-cloud.mjs';
import {loadRail} from '../assets/rail-network.mjs';
import {railMeetingPoints} from '../assets/rail-meeting-points.mjs';
import {findAddress} from '../assignments/location-model.mjs';
import {road} from '../travel-routes/providers.mjs?v=activity-reach-20261115-1';
import {createRoutingKeyStore} from '../travel-routes/key-store.mjs';
import {workbookBytes} from '../assignments/excel-export.mjs?v=assigned-travel-20261115-1';
import {mountServiceReach} from './service-reach-ui.mjs';
import {reachSheets} from './service-reach-model.mjs';
const root=document.getElementById('activityServiceReach');
if(root){
 const storage=name=>{try{return globalThis[name];}catch{return null;}};
 const keyStore=createRoutingKeyStore({session:storage('sessionStorage'),device:storage('localStorage')});
 const ui=mountServiceReach(root,{route:road,findAddress,keyStore,exportResult:(result,keys)=>{
  const blob=new Blob([workbookBytes(reachSheets(result,keys))],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='Denver-2027-Activity-to-Service-Bus-Destinations.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }});
 let halls=[],rail=[],hallNote='',railNote='';const notice=document.createElement('p');notice.className='hint';notice.setAttribute('role','status');root.append(notice);
 const update=()=>{ui.setLocations([...catalog(halls),...rail]);notice.textContent=[hallNote,railNote].filter(Boolean).join(' ');};update();
 watchHalls(records=>{halls=records;hallNote='';update();},()=>{hallNote='Saved meeting-location updates could not load. The base location list is available.';update();});
 loadRail().then(data=>{rail=railMeetingPoints(data);railNote='';update();}).catch(()=>{railNote='Rail meeting locations could not load. Refresh if you want to include them.';update();});
}

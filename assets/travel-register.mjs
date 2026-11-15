import {isMeetingLocation} from './rail-meeting-points.mjs';
import {legacyPlan,MODES} from '../travel-routes/model.mjs';
import {denverInput} from '../routes/travel-plan.mjs';
export const locationKey=value=>String(value??'').replace(/^hall-/,'');
const unique=values=>[...new Set(values.filter(Boolean).map(String))];
export function readTravel(record){
  if(!['bus-route','route-plan'].includes(record?.recordType)||record.travelLocationOnly)return null;
  try{const plan=legacyPlan(record);if(!Array.isArray(plan.stops)||plan.stops.length<2)return null;let result=null;try{result=JSON.parse(record.resultJson||'null');}catch{}return {record,plan,result};}catch{return null;}
}
export function travelEntries(records,locations=[]){
  return records.flatMap(record=>{
    const data=readTravel(record);if(!data)return [];
    const {plan,result}=data;
    const stops=plan.stops.map(s=>{const found=locations.find(p=>(s.id!=='custom'&&locationKey(p.id)===locationKey(s.id))||p.name===s.name);return {...found,...s,id:s.id==='custom'&&found?found.id:s.id};});
    const hotelIds=unique([...(plan.assignedHotelIds||[]),...stops.filter(s=>s.group==='Hotels').map(s=>s.id)]);
    const congregationIds=unique([...(plan.assignedCongregationIds||[]),...stops.flatMap(s=>s.congregationIds||[])]);
    const meetingIds=unique(stops.filter(isMeetingLocation).map(s=>locationKey(s.id)));
    const dates=unique([plan.time?.slice(0,10),...(result?.legs||[]).flatMap(l=>[l.depart,l.arrive]).filter(Number.isFinite).map(t=>denverInput(new Date(t)).slice(0,10))]);
    return [{...data,id:record.id,name:plan.name||record.routeName||'Travel route',stops,hotelIds,congregationIds,meetingIds,dates,vehicle:plan.vehicle||'',passengers:Number(plan.passengers)||0,status:plan.planningStatus||'planned',draft:record.travelDraft===true,modes:unique(stops.slice(0,-1).map(s=>s.mode)).map(m=>MODES[m]?.name||m)}];
  }).sort((a,b)=>(a.plan.time||'').localeCompare(b.plan.time||'')||a.name.localeCompare(b.name));
}
export function filterTravelEntries(entries,{date='',hotel='',meeting='',congregation='',text=''}={}){
  const q=text.toLowerCase().trim();
  return entries.filter(e=>(!date||e.dates.includes(date))&&(!hotel||e.hotelIds.includes(hotel))&&(!meeting||e.meetingIds.includes(locationKey(meeting)))&&(!congregation||e.congregationIds.includes(congregation))&&(!q||[e.name,e.vehicle,...e.stops.map(s=>s.name)].join(' ').toLowerCase().includes(q)));
}

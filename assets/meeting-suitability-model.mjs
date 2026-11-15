import {HALLS} from '../bus-access/locations.mjs';
import {HALLS as TERRITORY_HALLS} from '../territories/halls.js';
export const STATUS_REVISION=1;
export const canonicalLocationId=value=>String(value??'').replace(/^hall-/,'');
export const MEETING_STATUSES={approved:{label:'Suitable',color:'#0e9453'},'not-suitable':{label:'Unsuitable',color:'#c9362b'},conditional:{label:'Conditional',color:'#bf9027'},'inspection-scheduled':{label:'Inspection scheduled',color:'#2866a0'},'not-reviewed':{label:'Not reviewed',color:'#667085'}};
export const meetingLocations=new Map([...HALLS,...TERRITORY_HALLS].map(p=>[String(p.id),{...p,id:String(p.id),locationType:p.locationType||'kingdom-hall'}]));
export function effectiveMeetingStatus(id,data={}){
  // Michael's correction remains visible until a new suitability decision is saved.
  if(canonicalLocationId(id)==='26'&&Number(data.suitabilityRevision||0)<STATUS_REVISION)return 'not-suitable';
  return Object.hasOwn(MEETING_STATUSES,data.busStatus)?data.busStatus:'not-reviewed';
}
export const withMeetingStatus=(id,data={})=>({...data,busStatus:effectiveMeetingStatus(id,data)});
export function registerMeetingLocation(point){
  const id=canonicalLocationId(point?.hallId||point?.id);
  if(!id||id==='custom'||['Hotels','Activities','Congregations','Convention centers','Centers'].includes(point?.group)||id.startsWith('congregation-'))return null;
  if(!meetingLocations.has(id)&&!['kingdom-hall','meeting-area','rail-station'].includes(point?.locationType)&&!['Field service / meeting places','Rail stations'].includes(point?.group))return null;
  const original=meetingLocations.get(id)||{},location={...original,id};
  for(const key of ['name','address','lat','lng','number','markerLabel','locationType','customLocation'])if(point[key]!==undefined)location[key]=point[key];
  if(point.group==='Rail stations')location.locationType='rail-station';
  meetingLocations.set(id,location);return location;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function tagMeetingIcon(icon,point){
  const location=registerMeetingLocation(point);if(!location||!icon?.options?.html||typeof icon.options.html!=='string')return icon;
  icon.options.html=icon.options.html.replace(/^(\s*<[a-z][\w-]*)\b/i,'$1 data-bus-location-id="'+escape(location.id)+'"');return icon;
}
export function suitabilityPayload(location,status,{create=false}={}){
  if(!['approved','not-suitable'].includes(status))throw Error('Choose Suitable or Unsuitable.');
  const id=canonicalLocationId(location?.id);if(!id||id.startsWith('congregation-'))throw Error('Choose a meeting location.');
  const payload={busStatus:status,suitabilityRevision:STATUS_REVISION,updatedBy:'Transportation review team'};
  if(create){for(const key of ['name','address','lat','lng','number','markerLabel','locationType','customLocation'])if(location[key]!==undefined)payload[key]=location[key];}
  return payload;
}

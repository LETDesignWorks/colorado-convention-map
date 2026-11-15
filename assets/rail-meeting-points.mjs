import {validPoint} from '../assignments/location-model.mjs';
export function railMeetingPoints(data){
  return (data?.stations||[]).filter(p=>p.id&&validPoint(p.lat,p.lng)).map(p=>({
    ...p,id:String(p.id),name:String(p.name||'RTD station'),address:String(p.address||''),
    lat:Number(p.lat),lng:Number(p.lng),markerLabel:'🚆',locationType:'rail-station',group:'Rail stations',
    customLocation:false,congregations:[],congregationCount:0,
    railNote:p.lines?.length?'Reference lines: '+p.lines.join(', '):'No scheduled service in this rail reference; confirm station service before using it.'
  })).sort((a,b)=>a.name.localeCompare(b.name));
}
export const isMeetingLocation=p=>p.group==='Field service / meeting places'||p.group==='Rail stations'||p.locationType==='rail-station';

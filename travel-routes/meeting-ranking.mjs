import {parseDenver,validPoint} from '../routes/travel-plan.mjs';
export const CONVENTION_CENTER={id:'ccc',name:'Colorado Convention Center',address:'700 14th St, Denver, CO 80202',lat:39.74248,lng:-104.99567,group:'Convention centers'};
export function rankingSettings({date,time,preset='custom',mode='bus',includeUnsuitable=false,includeRail=false}){
 if(!['car','bus'].includes(mode))throw Error('Choose car or bus.');
 const local=date+'T'+(preset==='am'?'08:00':preset==='pm'?'17:00':time),at=+parseDenver(local);
 return {local,at,mode,includeUnsuitable:!!includeUnsuitable,includeRail:!!includeRail};
}
export function meetingCandidates(locations,settings){
 const seen=new Set();return locations.filter(p=>{
  const rail=p.locationType==='rail-station'||p.group==='Rail stations';
  if(!(rail?settings.includeRail:p.group==='Field service / meeting places'))return false;
  if(!settings.includeUnsuitable&&p.busStatus==='not-suitable')return false;
  const key=(rail?'rail:':'hall:')+p.id;if(seen.has(key))return false;seen.add(key);return true;
 });
}
export const rankedResults=rows=>[...rows].sort((a,b)=>(a.error?1:0)-(b.error?1:0)||(a.minutes??Infinity)-(b.minutes??Infinity)||String(a.point.name).localeCompare(String(b.point.name)));
export async function rankMeetings(points,{settings,key='',route,signal,onProgress=()=>{},timeoutMs=30000}){
 const results=[];let index=0,completed=0;
 async function worker(){
  while(index<points.length){
   signal?.throwIfAborted();const point=points[index++];let row={point};
   if(!validPoint(point.lat,point.lng))row.error='Missing map pin — add coordinates for this location.';
   else {
    const abort=new AbortController(),cancel=()=>abort.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>abort.abort(),timeoutMs);
    try {
     const result=await route(CONVENTION_CENTER,point,settings.at,false,settings.mode,key,abort.signal);
     if(!Number.isFinite(result.minutes)||result.minutes<0||!Number.isFinite(result.miles)||result.miles<0)throw Error('Invalid route estimate.');
     row={point,minutes:Math.ceil(result.minutes),miles:result.miles,label:result.label};
    }catch{if(signal?.aborted)throw signal.reason;row.error=key?'Traffic estimate unavailable. Check the TomTom key, date, coverage and connection, then retry.':'Road estimate unavailable. Check your connection and try again.';}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
   }
   signal?.throwIfAborted();results.push(row);onProgress(++completed,points.length);
  }
 }
 await Promise.all(Array.from({length:Math.min(2,points.length)},worker));return rankedResults(results);
}

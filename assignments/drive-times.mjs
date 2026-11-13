import {validPoint} from './location-model.mjs?v=homes-20261113-1';
export const MAX_DRIVE_SECONDS=80*60;
const coord=p=>`${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`;
export const tripKey=(from,to)=>`${coord(from)}>${coord(to)}`;
export function driveResult(seconds){
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)return {status:'unknown',seconds:null,allowed:false,label:'Travel time unavailable — retry before assigning'};
  const minutes=Math.ceil(seconds/60),time=minutes>=60?`${Math.floor(minutes/60)} hr ${minutes%60} min`:`${minutes} min`,over=seconds>MAX_DRIVE_SECONDS;
  return {status:over?'over':'within',seconds,allowed:!over,label:`${time} estimated drive${over?' — over 1 hr 20 min; cannot assign':''}`};
}
// One shared result per distinct address pin and destination. No straight-line fallback.
export function createDriveTimes({fetcher=globalThis.fetch,onChange=()=>{},clock=()=>Date.now()}={}){
  const cache=new Map(),jobs=new Map();
  function state(home,to){
    if(!to||!validPoint(to.lat,to.lng))return {status:'no-destination',allowed:false,label:'Choose a meeting point to check travel time'};
    if(!home.point||home.status==='review')return {status:'missing',allowed:false,label:home.status==='review'?'Confirm address before checking travel time':'Add an address and map pin to check travel time'};
    const item=cache.get(tripKey(home.point,to));
    if(item&&item.until>clock())return item.result;
    return {status:'pending',allowed:false,label:'Checking drive time…'};
  }
  async function ensure(homes,to,{retry=false}={}){
    if(!to||!validPoint(to.lat,to.lng))return;
    const unique=new Map();
    for(const h of homes){if(!h.point||h.status==='review')continue;const key=tripKey(h.point,to),item=cache.get(key);if(retry&&item?.result.status==='unknown')cache.delete(key);if(state(h,to).status==='pending')unique.set(key,h.point);}
    if(!unique.size)return;
    const signature=coord(to)+'|'+[...unique.keys()].sort().join('|');if(jobs.has(signature))return jobs.get(signature);
    const work=(async()=>{
      const entries=[...unique];
      for(let offset=0;offset<entries.length;offset+=75){
        const batch=entries.slice(offset,offset+75),points=batch.map(([,p])=>p),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
        try{
          const url=`https://router.project-osrm.org/table/v1/driving/${[...points,to].map(coord).join(';')}?sources=${points.map((_,i)=>i).join(';')}&destinations=${points.length}&annotations=duration`;
          const response=await fetcher(url,{signal:controller.signal});if(!response.ok)throw Error('Road travel lookup unavailable');const data=await response.json();if(data.code!=='Ok'||!Array.isArray(data.durations)||data.durations.length!==points.length)throw Error('Incomplete drive times');
          batch.forEach(([key],i)=>{const snapDistance=data.sources?.[i]?.distance,destDistance=data.destinations?.[0]?.distance;const seconds=(snapDistance>1500||destDistance>1500)?null:data.durations[i]?.[0];cache.set(key,{result:driveResult(seconds),until:clock()+30*60*1000});});
        }catch(error){batch.forEach(([key])=>cache.set(key,{result:driveResult(null),until:clock()+30*1000}));}
        finally{clearTimeout(timer);}
      }
    })();jobs.set(signature,work);try{await work;}finally{jobs.delete(signature);onChange();}
  }
  return {state,ensure};
}

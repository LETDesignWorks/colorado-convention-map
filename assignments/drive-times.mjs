import {validPoint} from './location-model.mjs?v=homes-20261113-1';
export const MAX_DRIVE_SECONDS=80*60;
const coord=p=>`${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`;
export const tripKey=(from,to)=>`${coord(from)}>${coord(to)}`;
const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function driveResult(seconds,meters=null){
  if(!nonnegative(seconds))return {status:'unknown',seconds:null,meters:null,allowed:false,label:'Travel time unavailable — retry before assigning'};
  const minutes=Math.ceil(seconds/60),time=minutes>=60?`${Math.floor(minutes/60)} hr ${minutes%60} min`:`${minutes} min`,over=seconds>MAX_DRIVE_SECONDS;
  return {status:over?'over':'within',seconds,meters:nonnegative(meters)?meters:null,allowed:!over,label:`${time} estimated drive${over?' — over 1 hr 20 min':''}`};
}
// Results are keyed by origin/destination pins. Exports request road distance;
// ordinary assignment checks can continue using duration-only tables.
export function createDriveTimes({fetcher=globalThis.fetch,onChange=()=>{},clock=()=>Date.now()}={}){
  const cache=new Map(),jobs=new Map();
  function state(home,to){
    if(!to||!validPoint(to.lat,to.lng))return {status:'no-destination',allowed:false,label:'Choose a meeting point to check travel time'};
    if(!home?.point||!validPoint(home.point.lat,home.point.lng)||home.status==='review')return {status:'missing',allowed:false,label:home?.status==='review'?'Confirm address before checking travel time':'Add an address and map pin to check travel time'};
    const item=cache.get(tripKey(home.point,to));
    if(item&&item.until>clock())return item.result;
    return {status:'pending',allowed:false,label:'Checking drive time…'};
  }
  async function ensure(homes,to,{retry=false,includeDistance=false}={}){
    if(!to||!validPoint(to.lat,to.lng))return;
    const unique=new Map();
    for(const home of homes){
      if(!home?.point||!validPoint(home.point.lat,home.point.lng)||home.status==='review')continue;
      const key=tripKey(home.point,to),item=cache.get(key);
      if(retry&&item?.result.status==='unknown')cache.delete(key);
      if(state(home,to).status==='pending'||includeDistance&&!item?.distanceChecked)unique.set(key,home.point);
    }
    if(!unique.size)return;
    const signature=coord(to)+'|'+includeDistance+'|'+[...unique.keys()].sort().join('|');
    if(jobs.has(signature))return jobs.get(signature);
    function put(key,result){
      const existing=cache.get(key);
      if(!includeDistance&&existing?.distanceChecked&&existing.until>clock())return;
      const incomplete=result.seconds===null||includeDistance&&result.meters===null;
      cache.set(key,{result,distanceChecked:includeDistance,until:clock()+(incomplete?30*1000:30*60*1000)});
    }
    const work=(async()=>{
      const entries=[...unique];
      for(let offset=0;offset<entries.length;offset+=75){
        const batch=entries.slice(offset,offset+75),points=batch.map(([,p])=>p),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
        try{
          const url=`https://router.project-osrm.org/table/v1/driving/${[...points,to].map(coord).join(';')}?sources=${points.map((_,i)=>i).join(';')}&destinations=${points.length}&annotations=${includeDistance?'duration,distance':'duration'}`;
          const response=await fetcher(url,{signal:controller.signal}),data=await response.json();
          if(includeDistance&&data.code==='NotImplemented'){
            // Route fallback for OSRM servers without table distances.
            // Bound concurrency and the entire batch wait.
            let cursor=0;const completed=new Set();
            async function worker(){
              while(cursor<batch.length&&!controller.signal.aborted){
                const index=cursor++,[key,from]=batch[index];
                try{
                  const response=await fetcher(`https://router.project-osrm.org/route/v1/driving/${coord(from)};${coord(to)}?overview=false&steps=false`,{signal:controller.signal}),route=await response.json();
                  const valid=response.ok&&route.code==='Ok'&&!route.waypoints?.some(p=>p.distance>1500);
                  put(key,valid?driveResult(route.routes?.[0]?.duration,route.routes?.[0]?.distance):driveResult(null));
                }catch{put(key,driveResult(null));}
                completed.add(key);
              }
            }
            await Promise.all([worker(),worker()]);
            for(const [key] of batch)if(!completed.has(key))put(key,driveResult(null));
          }else{
            if(!response.ok||data.code!=='Ok'||!Array.isArray(data.durations)||data.durations.length!==points.length)throw Error('Incomplete drive times');
            batch.forEach(([key],i)=>{
              const invalid=data.sources?.[i]?.distance>1500||data.destinations?.[0]?.distance>1500||data.fallback_speed_cells?.some(([source,destination])=>source===i&&destination===0);
              put(key,invalid?driveResult(null):driveResult(data.durations[i]?.[0],data.distances?.[i]?.[0]));
            });
          }
        }catch{batch.forEach(([key])=>put(key,driveResult(null)));}
        finally{clearTimeout(timer);}
      }
    })();
    jobs.set(signature,work);try{await work;}finally{jobs.delete(signature);onChange();}
  }
  function stateAny(home,destinations){
    if(!destinations.length)return {status:'no-destination',allowed:false,label:'No available meeting locations to check'};
    const results=destinations.map(point=>state(home,point));
    if(results.some(result=>result.status==='within'))return {status:'within',allowed:true,label:'Within 1 hr 20 min of an available meeting location'};
    if(results.every(result=>result.status==='over'))return {status:'over',allowed:false,label:'Over 1 hr 20 min from every available meeting location'};
    const missing=results.find(result=>result.status==='missing');if(missing)return missing;
    return {status:results.some(result=>result.status==='pending')?'pending':'unknown',allowed:false,label:'Still needs a verified route to an available meeting location'};
  }
  async function ensureAny(homes,destinations,{retry=false}={}){
    const points=[...new Map(destinations.filter(p=>validPoint(p.lat,p.lng)).map(p=>[coord(p),p])).values()];
    const origins=[...new Map(homes.filter(h=>h?.point&&validPoint(h.point.lat,h.point.lng)&&h.status!=='review').map(h=>[coord(h.point),h])).values()];
    if(!points.length||!origins.length)return;
    if(retry)for(const home of origins)for(const point of points){const key=tripKey(home.point,point);if(cache.get(key)?.result.status==='unknown')cache.delete(key);}
    const signature='any|'+origins.map(h=>coord(h.point)).sort().join('|')+'>'+points.map(coord).sort().join('|');
    if(jobs.has(signature))return jobs.get(signature);
    const pending=home=>stateAny(home,destinations).status!=='within'&&points.some(p=>state(home,p).status==='pending');
    if(!origins.some(pending))return;
    function put(key,result){
      const old=cache.get(key);if(old&&old.until>clock()&&old.result.seconds!==null)return;
      cache.set(key,{result,distanceChecked:false,until:clock()+(result.seconds===null?30*1000:30*60*1000)});
    }
    const work=(async()=>{
      // At most 95 coordinates and 2,250 matrix cells per request.
      for(let start=0;start<origins.length;start+=50){
        const homeBatch=origins.slice(start,start+50);
        for(let offset=0;offset<points.length;offset+=45){
          const targets=points.slice(offset,offset+45),sources=homeBatch.filter(h=>stateAny(h,destinations).status!=='within'&&targets.some(p=>state(h,p).status==='pending'));
          if(!sources.length)continue;
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
          try{
            const all=[...sources.map(h=>h.point),...targets];
            const url=`https://router.project-osrm.org/table/v1/driving/${all.map(coord).join(';')}?sources=${sources.map((_,i)=>i).join(';')}&destinations=${targets.map((_,i)=>i+sources.length).join(';')}&annotations=duration`;
            const response=await fetcher(url,{signal:controller.signal}),data=await response.json();
            if(!response.ok||data.code!=='Ok'||!Array.isArray(data.durations)||data.durations.length!==sources.length)throw Error('Incomplete drive times');
            sources.forEach((home,i)=>targets.forEach((point,j)=>{
              const invalid=data.sources?.[i]?.distance>1500||data.destinations?.[j]?.distance>1500||data.fallback_speed_cells?.some(([a,b])=>a===i&&b===j);
              put(tripKey(home.point,point),driveResult(invalid?null:data.durations[i]?.[j]));
            }));
          }catch{for(const home of sources)for(const point of targets)put(tripKey(home.point,point),driveResult(null));}
          finally{clearTimeout(timer);}
          onChange();
        }
      }
    })();
    jobs.set(signature,work);try{await work;}finally{jobs.delete(signature);onChange();}
  }
  return {state,ensure,stateAny,ensureAny};
}
export async function prepareAssignmentDrives({congregations,locations,assignmentFor,resolveHome,drives,onProgress=()=>{}}){
  const points=new Map(locations.map(point=>[String(point.id),point])),groups=new Map(),seen=new Set();
  for(const congregation of congregations){
    const id=String(congregation.id??'').trim();if(!id||seen.has(id))continue;seen.add(id);
    const destination=String(assignmentFor(id)?.meetingPointId??'').trim(),point=points.get(destination);
    if(!point)continue;
    if(!groups.has(destination))groups.set(destination,{point,homes:[]});
    groups.get(destination).homes.push(resolveHome(congregation));
  }
  let done=0;
  for(const {point,homes} of groups.values()){
    onProgress(done,groups.size);
    await drives.ensure(homes,point,{retry:true,includeDistance:true});
    onProgress(++done,groups.size);
  }
}


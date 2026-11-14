import {parseDenver,denverInput} from '../routes/travel-plan.mjs';
import {createRailDirectory} from '../rush-hour/trip-rail.mjs';
export const minute=60000;
const key=d=>denverInput(d).slice(0,10).replaceAll('-','');
const dayString=k=>k.slice(0,4)+'-'+k.slice(4,6)+'-'+k.slice(6);
export function serviceActive(data,service,dateKey){
 const ex=data.exceptions.find(x=>x.service_id===service&&x.date===dateKey);
 if(ex)return ex.exception_type==='1';
 const c=data.calendar.find(x=>x.service_id===service);
 const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(dayString(dateKey)+'T12:00:00Z').getUTCDay()];
 return !!c&&c.start_date<=dateKey&&c.end_date>=dateKey&&c[weekday]==='1';
}
export function inCoverage(data,date){const k=key(date);return k>=data.coverage.start&&k<=data.coverage.end;}
export function railGeometry(data,p,from,to){
 const coords=data.shapes[p.shapeId]||[];
 const a=data.stations.find(s=>s.id===p.stops[from]),b=data.stations.find(s=>s.id===p.stops[to]);
 if(!a||!b)return [];
 if(coords.length<2)return [[a.lat,a.lng],[b.lat,b.lng]];
 const score=(x,s)=>(x[0]-s.lat)**2+(x[1]-s.lng)**2;
 let ai=0;for(let i=1;i<coords.length;i++)if(score(coords[i],a)<score(coords[ai],a))ai=i;
 let bi=ai;for(let i=ai+1;i<coords.length;i++)if(score(coords[i],b)<score(coords[bi],b))bi=i;
 return bi>ai?coords.slice(ai,bi+1):[[a.lat,a.lng],[b.lat,b.lng]];
}
function segment(data,p,from,to,depart,arrive,headsign=''){
 const route=data.routes.find(r=>r.id===p.route);
 return {mode:'rail',route:route?.name||p.route,color:'#'+(route?.color||'4256A6'),from:p.stops[from],to:p.stops[to],depart,arrive,headsign,points:railGeometry(data,p,from,to)};
}
function instances(data,at){
 const day=key(new Date(at)),noon=parseDenver(dayString(day)+'T12:00'),result=[];
 for(let shift=-1;shift<=1;shift++){
  const k=key(new Date(+noon+shift*86400000)),epoch=+parseDenver(dayString(k)+'T12:00')-43200000;
  for(const p of data.patterns)for(const t of p.trips)if(serviceActive(data,t[0],k))result.push({p,a:t[1].map(n=>epoch+n*1000),d:t[2].map(n=>epoch+n*1000),headsign:t[3]});
 }
 return result;
}
export function scheduledRail(data,from,to,at,{arriveBy=false,transferMinutes=10}={}){
 if(from===to)return {depart:+at,arrive:+at,segments:[],scheduled:true,label:'Same station'};
 const trips=instances(data,at),start=arriveBy?to:from,goal=arriveBy?from:to;
 let labels=new Map([[start,{time:+at,path:[]}]]);
 const better=(x,y)=>!y||(arriveBy?x>y.time:x<y.time);
 for(let round=0;round<5;round++){
  const next=new Map(labels);
  for(const t of trips){
   const n=t.p.stops.length;
   for(let i=0;i<n;i++){
    const source=labels.get(t.p.stops[i]);if(!source)continue;
    const transfer=source.path.length?transferMinutes*minute:0;
    if(!arriveBy&&source.time+transfer<=t.d[i]){
     for(let j=i+1;j<n;j++)if(t.a[j]>=t.d[i]&&better(t.a[j],next.get(t.p.stops[j]))){
      next.set(t.p.stops[j],{time:t.a[j],path:[...source.path,segment(data,t.p,i,j,t.d[i],t.a[j],t.headsign)]});
     }
    }else if(arriveBy&&source.time-transfer>=t.a[i]){
     for(let j=0;j<i;j++)if(t.d[j]<=t.a[i]&&better(t.d[j],next.get(t.p.stops[j]))){
      next.set(t.p.stops[j],{time:t.d[j],path:[segment(data,t.p,j,i,t.d[j],t.a[i],t.headsign),...source.path]});
     }
    }
   }
  }
  labels=next;
 }
 const found=labels.get(goal);if(!found?.path.length)throw Error('No rail journey found for that time in the published timetable. Try another time or stations.');
 const segments=found.path;
 if(segments.at(-1).arrive-segments[0].depart>8*3600000)throw Error('No practical rail connection found within eight hours. Try another time or station.');
 return {depart:segments[0].depart,arrive:segments.at(-1).arrive,segments,scheduled:true,label:'Published RTD timetable — verify service alerts before travel'};
}
export function estimatedRail(data,from,to,at,{arriveBy=false,transferMinutes=10,waitMinutes=15}={}){
 if(from===to)return {depart:+at,arrive:+at,segments:[],scheduled:false,label:'Same station'};
 const edges=new Map();
 for(const p of data.patterns)for(let i=0;i<p.stops.length-1;i++){
  const a=p.stops[i],b=p.stops[i+1];if(a===b)continue;
  const values=p.trips.map(t=>(t[1][i+1]-t[2][i])/60).filter(x=>x>0&&x<120).sort((a,b)=>a-b);
  if(!values.length)continue;
  const duration=values[Math.floor(values.length/2)];
  const id=a+'|'+b+'|'+p.route;
  if(!edges.has(id)||duration<edges.get(id).duration)edges.set(id,{a,b,duration,p,i});
 }
 const queue=[{station:from,route:'',cost:waitMinutes,path:[]}],best=new Map();
 let found;
 while(queue.length){
  queue.sort((a,b)=>a.cost-b.cost);const item=queue.shift(),id=item.station+'|'+item.route;
  if(best.has(id)&&best.get(id)<item.cost)continue;
  if(item.station===to){found=item;break;}
  for(const e of edges.values())if(e.a===item.station){
   const cost=item.cost+e.duration+(item.route&&item.route!==e.p.route?transferMinutes:0),k=e.b+'|'+e.p.route;
   if(!best.has(k)||cost<best.get(k)){best.set(k,cost);queue.push({station:e.b,route:e.p.route,cost,path:[...item.path,e]});}
  }
 }
 if(!found)throw Error('These stations are not connected in the available RTD rail reference. Choose another station or transport.');
 let time=arriveBy?+at-found.cost*minute:+at;
 const depart=time;time+=waitMinutes*minute;const segments=[];
 for(const e of found.path){
  const last=segments.at(-1);if(last&&last.route!==(data.routes.find(r=>r.id===e.p.route)?.name||e.p.route))time+=transferMinutes*minute;
  const s=segment(data,e.p,e.i,e.i+1,time,time+e.duration*minute);time=s.arrive;
  if(last&&last.route===s.route&&last.to===s.from){last.to=s.to;last.arrive=s.arrive;last.points.push(...s.points);}else segments.push(s);
 }
 return {depart,arrive:time,segments,scheduled:false,label:'Planning estimate — chosen date is outside the published timetable; includes '+waitMinutes+' min estimated wait and '+transferMinutes+' min per transfer'};
}
export function planRail(data,from,to,at,options={}){
 if(!data?.patterns?.length)throw Error('Rail timetable has not loaded. Retry before calculating a rail journey.');
 return inCoverage(data,new Date(at))?scheduledRail(data,from,to,at,options):estimatedRail(data,from,to,at,options);
}
let promise;
export async function refreshStationLocations(data){
 const live=await createRailDirectory().refresh(),known=new Map(data.stations.map(s=>[s.id,s]));
 for(const station of live.stations){
  const old=known.get(station.id);
  known.set(station.id,{...station,lines:old?.lines||[]});
 }
 return {...data,stations:[...known.values()].sort((a,b)=>a.name.localeCompare(b.name)),stationsCheckedAt:live.checkedAt};
}
export function loadRail({refresh=false}={}){
 if(refresh)promise=null;
 return promise ||= fetch(new URL('../data/rtd-rail.json',import.meta.url),{cache:refresh?'reload':'default'}).then(r=>{if(!r.ok)throw Error('RTD rail reference unavailable.');return r.json();}).catch(e=>{promise=null;throw e;});
}

import {planRail,minute} from '../assets/rail-network.mjs';
import {distanceMiles} from '../assignments/location-model.mjs';
export function directions(a,b,mode='driving'){
 return 'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:a.lat+','+a.lng,destination:b.lat+','+b.lng,travelmode:mode});
}
async function json(url,signal){const r=await fetch(url,{signal:signal||AbortSignal.timeout(25000)});if(!r.ok)throw Error('Route provider could not complete this request ('+r.status+'). Check the key or try again.');return r.json();}
export async function road(a,b,at,arriveBy,mode,key,signal){
 const walking=mode==='walk';
 if(distanceMiles(a,b)<.015)return {depart:at,arrive:at,minutes:0,miles:0,points:[[a.lat,a.lng],[b.lat,b.lng]],mode,label:'Same location',directions:directions(a,b,walking?'walking':'driving'),instructions:[]};
 if(key){
  const u=new URL('https://api.tomtom.com/routing/1/calculateRoute/'+a.lat+','+a.lng+':'+b.lat+','+b.lng+'/json');
  const args={key,travelMode:walking?'pedestrian':mode,routeType:'fastest',traffic:'true',routeRepresentation:'polyline',instructionsType:'text',language:'en-US'};
  if(!walking)args[arriveBy?'arriveAt':'departAt']=new Date(at).toISOString();
  u.search=new URLSearchParams(args);
  let data;try{data=await json(u,signal);}catch(e){if(e.name==='AbortError')throw e;throw Error('TomTom could not calculate this leg. Check the key, allowed domain, date and routing access. Clear the key to use road planning estimates.');}
  const r=data.routes?.[0];if(!r)throw Error('TomTom returned no route for this leg.');
  const duration=Math.ceil(r.summary.travelTimeInSeconds/60)*minute;
  const points=r.legs.flatMap(l=>l.points.map(p=>[p.latitude,p.longitude]));
  return {depart:arriveBy?at-duration:at,arrive:arriveBy?at:at+duration,minutes:duration/minute,points,mode,miles:r.summary.lengthInMeters/1609.344,label:walking?'TomTom walking route':'TomTom time-dependent '+mode+' estimate'+(mode==='bus'?' — confirm coach access and restrictions':''),directions:directions(a,b,walking?'walking':'driving'),instructions:(r.guidance?.instructions||[]).map(i=>i.message).filter(Boolean)};
 }
 if(walking){
  const miles=distanceMiles(a,b)*1.3,duration=Math.ceil(miles/2.5*60)*minute;
  return {depart:arriveBy?at-duration:at,arrive:arriveBy?at:at+duration,minutes:duration/minute,miles,points:[[a.lat,a.lng],[b.lat,b.lng]],mode,estimated:true,label:'Walking allowance only: distance × 1.3 at 2.5 mph. Dashed connector is not a verified walking path; open walking directions.',directions:directions(a,b,'walking'),instructions:[]};
 }
 const data=await json('https://router.project-osrm.org/route/v1/driving/'+a.lng+','+a.lat+';'+b.lng+','+b.lat+'?overview=full&geometries=geojson',signal),r=data.routes?.[0];
 if(!r)throw Error('No road route found. Confirm both address pins.');
 const duration=Math.ceil(r.duration/60)*minute;
 return {depart:arriveBy?at-duration:at,arrive:arriveBy?at:at+duration,minutes:duration/minute,miles:r.distance/1609.344,points:r.geometry.coordinates.map(p=>[p[1],p[0]]),mode,label:'Road baseline — no time-of-day traffic'+(mode==='bus'?'; car-road geometry, coach access must be checked':''),directions:directions(a,b),instructions:[]};
}
export function nearestStation(data,point){return [...data.stations].filter(s=>s.lines.length).sort((a,b)=>distanceMiles(a,point)-distanceMiles(b,point))[0];}
export function createRouter({data,key='',signal}){
 return async(a,b,at,arriveBy,plan)=>{
  if(a.mode!=='rail'){
   const allowance=a.mode==='walk'?0:plan.allowance*minute;
   const route=await road(a,b,arriveBy?at-allowance:at,arriveBy,a.mode,key,signal);
   return {...route,arrive:route.arrive+allowance,segments:[route],allowanceMinutes:allowance/minute};
  }
  if(!data)throw Error('Rail reference is unavailable. Reload the rail stations before planning.');
  const origin=data.stations.find(s=>s.id===a.railFrom)||data.stations.find(s=>s.id===a.id)||nearestStation(data,a);
  const end=data.stations.find(s=>s.id===a.railTo)||data.stations.find(s=>s.id===b.id)||nearestStation(data,b);
  if(!origin||!end)throw Error('Select the boarding and destination rail stations.');
  // Walking duration is independent of departure time. Re-time these walks around the actual train.
  const first=await road(a,origin,at,false,'walk',key,signal),last=await road(end,b,at,false,'walk',key,signal);
  const board=plan.boarding*minute,allowance=plan.allowance*minute;
  const railAt=arriveBy?at-last.minutes*minute-allowance:at+first.minutes*minute+board;
  const train=planRail(data,origin.id,end.id,railAt,{arriveBy,waitMinutes:plan.wait,transferMinutes:plan.transfer});
  const depart=arriveBy?train.depart-board-first.minutes*minute:at;
  const arrival=train.arrive+last.minutes*minute+allowance;
  const walk1={...first,depart,arrive:depart+first.minutes*minute};
  const walk2={...last,depart:train.arrive,arrive:train.arrive+last.minutes*minute};
  if(arrival-depart>8*3600000)throw Error('This rail journey takes more than eight hours including waiting. Choose another time or station.');
  return {mode:'rail',depart,arrive:arrival,minutes:Math.ceil((arrival-depart)/minute),label:train.label,scheduled:train.scheduled,originStation:origin,endStation:end,segments:[walk1,...train.segments,walk2],platformReady:(train.segments[0]?.depart||train.depart)-board,trainDeparture:train.segments[0]?.depart||train.depart,allowanceMinutes:plan.allowance};
 };
}


// Nearby car parking is a planning reference, not a reservation or permission to park.
export const PARKING_ENDPOINT='https://overpass.private.coffee/api/interpreter';
export const PARKING_BACKUP='https://photon.komoot.io/reverse';
export const RTD_PARKING_URL='https://www.rtd-denver.com/how-to-ride/parking';
export const PARKING_RADII=[402,805,1609];
const CACHE_KEY='denver2027.nearby-parking.v1',TTL=60*60*1000;
const text=value=>typeof value==='string'?value.trim().slice(0,600):'';
const coordinate=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
export const validParkingPoint=p=>Boolean(p)&&coordinate(p.lat)&&coordinate(p.lng)&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lng))<=180;
export const isRailStation=p=>p?.locationType==='rail-station'||p?.kind==='rail'||p?.group==='Rail stations';
export function metersBetween(a,b){
 const rad=Math.PI/180,lat=(b.lat-a.lat)*rad,lng=(b.lng-a.lng)*rad;
 const h=Math.sin(lat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lng/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function parkingQuery(station,radius=805){
 if(!validParkingPoint(station)||!PARKING_RADII.includes(Number(radius)))throw Error('Choose a rail station with a valid map pin and a search radius.');
 return `[out:json][timeout:20];nwr["amenity"="parking"](around:${Number(radius)},${Number(station.lat)},${Number(station.lng)});out center tags;`;
}
export function safeParkingUrl(value){
 try{const url=new URL(text(value));return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
export function parkingFee(tags={}){
 const fee=text(tags.fee).toLowerCase(),charge=text(tags.charge||tags['fee:amount']||tags['fee:price']);
 const conditions=[text(tags['fee:conditional']),text(tags['charge:conditional'])].filter(Boolean);
 if(conditions.length)return {kind:'conditional',label:'Conditional fees — check rules',detail:[charge&&'Mapped rate: '+charge,fee&&'Default fee tag: '+fee,...conditions].filter(Boolean).join(' · ')};
 if(charge)return {kind:'paid',label:'Mapped rate: '+charge,detail:'Confirm the current rate and time limits with the operator.'};
 if(fee==='no')return {kind:'free',label:'Mapped as free — confirm',detail:'No fee is recorded in OpenStreetMap. Check posted rules before parking.'};
 if(fee==='yes')return {kind:'paid',label:'Paid parking · amount unknown',detail:'A fee is recorded, but no price is available.'};
 if(fee==='donation')return {kind:'conditional',label:'Donation indicated',detail:'Check the operator’s terms.'};
 return {kind:'unknown',label:'Cost unknown',detail:'No usable fee information is available.'};
}
function accessInfo(tags){
 const values=['access','vehicle','motor_vehicle','motorcar'].map(k=>text(tags[k]).toLowerCase()).filter(Boolean);
 const blocked=values.some(v=>!['yes','public','permissive','designated','unknown'].includes(v));
 const conditions=['access:conditional','vehicle:conditional','motor_vehicle:conditional','motorcar:conditional'].map(k=>text(tags[k])).filter(Boolean);
 const publicAccess=values.some(v=>['yes','public','permissive','designated'].includes(v));
 return {blocked,label:conditions.length?'Access conditions: '+conditions.join(' · '):publicAccess?'Mapped for public access · confirm posted rules':'Access not recorded · confirm permission',confirmed:publicAccess&&!conditions.length};
}
export function parkingRecords(data,station,radius=805){
 parkingQuery(station,radius);
 if(data?.remark||!Array.isArray(data?.elements))throw Error('The parking search did not return complete results. Please retry.');
 const places=new Map();let restricted=0;
 for(const item of data.elements){
  const tags=item.tags||{},point={lat:item.lat??item.center?.lat,lng:item.lon??item.center?.lon};
  if(tags.amenity!=='parking'||!['node','way','relation'].includes(item.type)||!/^\d+$/.test(String(item.id))||!validParkingPoint(point))continue;
  if(['yes','true'].includes(tags.disused)||['yes','true'].includes(tags.abandoned)||tags.construction||tags['parking:lane']==='no')continue;
  const distanceMeters=metersBetween(station,point);if(distanceMeters>Number(radius))continue;
  const access=accessInfo(tags);if(access.blocked){restricted++;continue;}
  const street=[text(tags['addr:housenumber']),text(tags['addr:street'])].filter(Boolean).join(' ');
  const address=text(tags['addr:full'])||[street,text(tags['addr:city']),text(tags['addr:state']),text(tags['addr:postcode'])].filter(Boolean).join(', ');
  const type=tags.parking==='multi-storey'?'Parking garage':tags.parking==='underground'?'Underground parking':'Parking lot';
  const capacity=/^\d+$/.test(text(tags.capacity))?Number(tags.capacity):null;
  const id=item.type+'/'+item.id;
  places.set(id,{id,lat:Number(point.lat),lng:Number(point.lng),distanceMeters,name:text(tags.name)||[type,text(tags.ref)||street].filter(Boolean).join(' · '),address,type,
   operator:text(tags.operator),fee:parkingFee(tags),access:access.label,publicAccess:access.confirmed,
   capacity:capacity>0?capacity:null,hours:text(tags.opening_hours),maxstay:text(tags.maxstay),
   parkRide:Boolean(tags.park_ride&&tags.park_ride!=='no'),
   website:safeParkingUrl(tags.website||tags['contact:website']),source:'https://www.openstreetmap.org/'+id});
 }
 return {places:[...places.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.name.localeCompare(b.name)),restricted};
}
export function walkingUrl(parking,station){
 const url=new URL('https://www.google.com/maps/dir/');
 url.search=new URLSearchParams({api:'1',origin:`${parking.lat},${parking.lng}`,destination:`${station.lat},${station.lng}`,travelmode:'walking'}).toString();return url.href;
}
export function parkingSearchUrl(station){
 const url=new URL('https://www.google.com/maps/search/');
 url.search=new URLSearchParams({api:'1',query:`car parking near ${station.name||'RTD station'} ${station.lat},${station.lng}`}).toString();return url.href;
}
export function photonParkingData(data){
 if(!Array.isArray(data?.features))throw Error('The backup parking search did not return complete results.');
 return {elements:data.features.filter(f=>f.geometry?.type==='Point'&&f.properties?.osm_key==='amenity'&&f.properties?.osm_value==='parking').map(f=>{
  const p=f.properties,c=f.geometry.coordinates||[];
  return {id:p.osm_id,type:({N:'node',W:'way',R:'relation'})[p.osm_type],lat:c[1],lon:c[0],tags:{...p.extra,amenity:'parking',name:p.name,'addr:housenumber':p.housenumber,'addr:street':p.street,'addr:city':p.city,'addr:state':p.state,'addr:postcode':p.postcode}};
 })};
}
export function createParkingSearch({fetcher=globalThis.fetch,storage,now=()=>Date.now(),timeoutMs=8000}={}){
 let cache={};try{cache=JSON.parse(storage?.getItem(CACHE_KEY)||'{}')||{};}catch{}
 let primaryRetryAt=0;
 async function request(url,options,signal){
  const controller=new AbortController(),cancel=()=>controller.abort();let timedOut=false;
  if(signal?.aborted)throw new DOMException('Parking search cancelled.','AbortError');
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
   const response=await fetcher(url,{...options,signal:controller.signal,cache:'no-store',credentials:'omit'});
   if(!response.ok){
    if(url===PARKING_ENDPOINT&&[429,406].includes(response.status))primaryRetryAt=now()+30000;
    throw Error([429,406].includes(response.status)?'The parking search is busy. Wait 30 seconds, then retry.':'Parking search is unavailable. Retry or use the Google Maps search below.');
   }
   const data=await response.json();
   if(controller.signal.aborted)throw new DOMException('Parking search cancelled.','AbortError');
   return data;
  }catch(error){
   if(signal?.aborted)throw new DOMException('Parking search cancelled.','AbortError');
   if(timedOut)throw Error('The parking search timed out. Retry or use the Google Maps search below.');
   throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
 async function search(station,radius=805,{signal,refresh=false}={}){
  const query=parkingQuery(station,radius),key=[Number(station.lat).toFixed(6),Number(station.lng).toFixed(6),Number(radius)].join('|');
  if(signal?.aborted)throw new DOMException('Parking search cancelled.','AbortError');
  const saved=cache[key];
  if(!refresh&&saved&&Number.isFinite(saved.checkedAt)&&saved.checkedAt<=now()&&now()-saved.checkedAt<TTL){
   try{return {...parkingRecords(saved.data,station,radius),checkedAt:saved.checkedAt,cached:true,limited:Boolean(saved.limited)};}catch{delete cache[key];}
  }
  let data,result,limited=false;
  try{
   if(now()<primaryRetryAt)throw Error('The parking search is busy. Wait 30 seconds, then retry.');
   data=await request(PARKING_ENDPOINT,{method:'POST',body:new URLSearchParams({data:query})},signal);
   result=parkingRecords(data,station,radius);
  }catch(error){
   if(signal?.aborted)throw new DOMException('Parking search cancelled.','AbortError');
   // A second OSM index can still provide names and pins if the detailed service is busy.
   // It may lack fees and access tags, so the UI explicitly marks this as a limited lookup.
   try{
    const url=new URL(PARKING_BACKUP);url.search=new URLSearchParams({lat:String(station.lat),lon:String(station.lng),radius:String(radius/1000),limit:'20',osm_tag:'amenity:parking',lang:'en'}).toString();
    data=photonParkingData(await request(url.href,{},signal));result=parkingRecords(data,station,radius);limited=true;
   }catch{
    if(signal?.aborted)throw new DOMException('Parking search cancelled.','AbortError');
    throw error;
   }
  }
  const checkedAt=now();cache[key]={data,checkedAt,limited};
  cache=Object.fromEntries(Object.entries(cache).filter(([,v])=>v&&Number.isFinite(v.checkedAt)&&v.checkedAt<=checkedAt&&checkedAt-v.checkedAt<TTL).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,12));
  try{storage?.setItem(CACHE_KEY,JSON.stringify(cache));}catch{}
  return {...result,checkedAt,cached:false,limited};
 }
 return {search};
}

import {validPoint} from './trip-model.mjs?v=hotel-trips-20261109-1';
const addressCache=new Map(),roadCache=new Map();
export async function fetchJson(url,{signal,fetcher=globalThis.fetch,timeout=18000}={}){
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeout);
  try{const response=await fetcher(url,{signal:controller.signal,headers:{Accept:'application/json'}});if(!response.ok)throw Error('The map service could not complete the request ('+response.status+').');return await response.json();}
  catch(error){if(error.name==='AbortError')throw Error('The lookup was cancelled or timed out. Please try again.');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function addressCandidates(data){return (data?.features||[]).flatMap((f,index)=>{
  const [lng,lat]=f.geometry?.coordinates||[],p=f.properties||{};
  if(!validPoint(lat,lng))return[];
  const street=[p.housenumber,p.street].filter(Boolean).join(' '),address=[street,p.city||p.town||p.village,p.state,p.postcode,p.country].filter(Boolean).join(', ');
  if(!address)return[];
  return[{id:'address-'+index,kind:'address',name:p.name||street||address,address,lat:Number(lat),lng:Number(lng)}];
});}
export async function findAddresses(query,options={}){
  const clean=String(query).trim();if(clean.length<5)throw Error('Enter a street address with its city and state.');
  const key=clean.toLowerCase();if(addressCache.has(key))return addressCache.get(key);
  const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:clean,limit:'5',lang:'en',lat:'39.7392',lon:'-104.9903'}).toString();
  const results=addressCandidates(await fetchJson(url,options));if(!results.length)throw Error('No matching address was found. Add the city, state and ZIP, then search again.');
  addressCache.set(key,results);return results;
}
export function roadResult(data){
  const r=data?.routes?.[0];
  if(data?.code!=='Ok'||!r||!Number.isFinite(r.duration)||r.duration<=0||!Number.isFinite(r.distance)||r.distance<0||r.geometry?.type!=='LineString'||!Array.isArray(r.geometry.coordinates)||r.geometry.coordinates.length<2||r.geometry.coordinates.some(c=>!Array.isArray(c)||!validPoint(c[1],c[0])))throw Error('No usable road route was found. You can still check this trip in Google Maps and enter the traffic time.');
  return{minutes:r.duration/60,miles:r.distance/1609.344,geometry:r.geometry};
}
export async function findRoad(from,to,options={}){
  const points=[from,to].map(p=>p.lng+','+p.lat).join(';');
  if(roadCache.has(points))return roadCache.get(points);
  const result=roadResult(await fetchJson('https://router.project-osrm.org/route/v1/driving/'+points+'?overview=full&geometries=geojson&steps=false',options));
  roadCache.set(points,result);return result;
}

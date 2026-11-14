export const clean = value => String(value ?? '').trim();
export const addressKey = value => clean(value).toLowerCase().replace(/\b(avenue|street|road|drive|boulevard|circle|trail|court|north|south|east|west)\b/g, s => ({avenue:'ave',street:'st',road:'rd',drive:'dr',boulevard:'blvd',circle:'cir',trail:'trl',court:'ct',north:'n',south:'s',east:'e',west:'w'}[s])).replace(/[.,#]/g,'').replace(/\s+/g,' ').trim();
export function validPoint(lat,lng){return lat!==null&&lng!==null&&clean(lat)!==''&&clean(lng)!==''&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180;}
export function homeFor(congregation,profile,knownPoints=[]){
  const address=clean(profile ? profile.homeAddress : congregation.homeAddress);
  if(!address)return {address:'',status:'missing',point:null};
  let point=null;
  if(profile&&validPoint(profile.lat,profile.lng))point={lat:Number(profile.lat),lng:Number(profile.lng),source:'Administrator-confirmed address pin'};
  if(!profile){const known=knownPoints.find(p=>addressKey(p.address)===addressKey(address)&&validPoint(p.lat,p.lng));if(known)point={lat:Number(known.lat),lng:Number(known.lng),source:known.source||'Existing meeting-point address'};}
  const review=profile?profile.addressNeedsReview===true:congregation.addressNeedsReview===true;
  return {address,point,status:review?'review':point?'mapped':'pin-needed'};
}
export function distanceMiles(a,b){const rad=x=>x*Math.PI/180,dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng);const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,h)));}
export function suggestionsFor(home,locations,statuses,limit=3){
  if(!home.point||home.status==='review')return [];
  return locations.filter(p=>validPoint(p.lat,p.lng)&&['approved','conditional'].includes(statuses.get(String(p.id))?.busStatus)).map(p=>({...p,miles:distanceMiles(home.point,p),busStatus:statuses.get(String(p.id)).busStatus})).sort((a,b)=>a.miles-b.miles||String(a.id).localeCompare(String(b.id))).slice(0,limit);
}
export function groupHomes(congregations,resolve){
  const groups=new Map();for(const congregation of congregations){const home=resolve(congregation);if(!home.point)continue;const key=[home.point.lat.toFixed(6),home.point.lng.toFixed(6)].join(',');if(!groups.has(key))groups.set(key,{...home.point,address:home.address,congregations:[]});groups.get(key).congregations.push(congregation);}return [...groups.values()];
}
export function addressPayload(congregation,address,lat,lng){
  const homeAddress=clean(address);if(homeAddress.length>250)throw Error('Keep the address under 250 characters.');
  const hasLat=clean(lat)!=='',hasLng=clean(lng)!=='';
  if(hasLat!==hasLng||((hasLat||hasLng)&&!validPoint(lat,lng)))throw Error('Enter both a valid latitude and longitude, or leave both blank.');
  return {recordType:'congregation-address',congregationId:congregation.id,congregationName:congregation.name,homeAddress,lat:homeAddress&&hasLat?Number(lat):null,lng:homeAddress&&hasLng?Number(lng):null,addressNeedsReview:false};
}
export function addressCandidates(data){
  const seen=new Set();
  return (data?.features||[]).flatMap(f=>{
    const p=f.properties||{},[lng,lat]=f.geometry?.coordinates||[];
    if(!validPoint(lat,lng)||clean(p.countrycode).toUpperCase()!=='US')return [];
    const full=Boolean(p.housenumber&&p.street);
    const street=p.street||((p.type==='street'||p.osm_key==='highway')?p.name:'');
    const kind=full?'address':street?'street':'area';
    const first=full?p.housenumber+' '+p.street:p.name||street;
    const address=[...new Set([first,street&&street!==first&&!full?street:'',p.city||p.town||p.village||p.locality||p.district||p.county,p.state,p.postcode].filter(Boolean))].join(', ');
    if(!address)return [];
    const key=addressKey(address)+':'+Number(lat).toFixed(5)+':'+Number(lng).toFixed(5);
    if(seen.has(key))return [];seen.add(key);
    return [{address,lat:Number(lat),lng:Number(lng),kind,name:clean(p.name),approximate:!full}];
  });
}
export async function findAddress(query,{signal,fetcher=globalThis.fetch}={}){
  const text=clean(query);
  if(text.length<5)throw Error('Enter an address, street and city, or nearby place.');
  const search=async q=>{
    const u=new URL('https://photon.komoot.io/api/');
    u.search=new URLSearchParams({q,limit:'8',lang:'en',countrycode:'US',lat:'39.7392',lon:'-104.9903'}).toString();
    const response=await fetcher(u,{signal});
    if(!response.ok)throw Error('The address lookup is unavailable.');
    return addressCandidates(await response.json());
  };
  let candidates=await search(text);
  // A missing house number in the source should still let someone locate the street.
  const streetQuery=text.replace(/^\d+[a-z]?(?:-\d+)?\s+/i,'');
  if(!candidates.length&&streetQuery!==text&&streetQuery.length>=5)candidates=await search(streetQuery);
  if(!candidates.length)throw Error('No matching location found. Try the street and city, or a nearby landmark.');
  return candidates;
}
export async function nearbyAddresses(point,{signal,fetcher=globalThis.fetch}={}){
  if(!validPoint(point.lat,point.lng))throw Error('Place a map pin first.');
  const u=new URL('https://photon.komoot.io/reverse');
  u.search=new URLSearchParams({lat:String(point.lat),lon:String(point.lng),radius:'0.15',limit:'4',lang:'en'}).toString();
  const response=await fetcher(u,{signal});
  if(!response.ok)throw Error('Nearby address suggestions are unavailable.');
  return addressCandidates(await response.json())
    .map(p=>({...p,miles:distanceMiles(point,p)}))
    .filter(p=>p.miles<=.15/1.609344)
    .sort((a,b)=>a.miles-b.miles);
}

export function rankCongregations(congregations,point,resolve){
  return [...congregations].sort((a,b)=>{
    const ah=resolve(a),bh=resolve(b),ad=point&&ah.point?distanceMiles(ah.point,point):Infinity,bd=point&&bh.point?distanceMiles(bh.point,point):Infinity;
    return (ad===bd?0:ad-bd)||a.name.localeCompare(b.name,'en',{numeric:true});
  });
}

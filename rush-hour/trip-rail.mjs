import {fetchJson} from './trip-service.mjs?v=hotel-trips-20261109-1';

// Public station layer used by RTD's own facilities map (rtdgis).
export const RTD_DIRECTORY='https://app.rtd-denver.com/facilities';
export const RTD_RAIL='https://www.rtd-denver.com/routes-services/rail';
export const RTD_LAYER='https://services5.arcgis.com/1fZoXlzLW6FCIUcE/arcgis/rest/services/RTD_GIS_Current_Runboard/FeatureServer/1';
const CACHE_KEY='denver2027.rtd-stations.v1';
const text=value=>typeof value==='string'?value.trim():'';

export function stationRecords(data){
  if(data?.error||data?.exceededTransferLimit||!Array.isArray(data?.features)||!data.features.length)throw Error('RTD did not return a complete station list.');
  const stations=new Map();
  for(const feature of data.features){
    const p=feature.attributes||{},name=text(p.NAME),street=text(p.ADDRESS),city=text(p.CITY),lat=feature.geometry?.y,lng=feature.geometry?.x;
    // Reject empty coordinates and points outside Colorado; keep stations whose rail lines are not listed.
    if(!Number.isInteger(p.PID)||!name||!street||!city||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<36.99||lat>41.01||lng< -109.06||lng> -102.03)continue;
    const lines=[...new Set(text(p.RAIL_LINE).split(/[^A-Za-z0-9]+/).filter(Boolean).map(v=>v.toUpperCase()))].sort();
    const id='rtd-'+p.PID,address=[street,city,'CO '+text(p.ZIPCODE)].join(', ');
    stations.set(id,{id,kind:'rail',name,address,city,lat,lng,lines,label:lines.join(' / '),
      note:(lines.length?'RTD rail lines: '+lines.join(' / ')+'.':'No rail line is listed in the current RTD directory. Check RTD service before planning a rail connection.')+' Station reference point; confirm the bus pickup entrance.'});
  }
  if(!stations.size)throw Error('RTD returned no usable station locations.');
  return [...stations.values()].sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));
}

export function filterStations(stations,query){
  const q=String(query).trim().toLowerCase();
  if(/^[a-z]$/.test(q))return stations.filter(p=>p.lines.includes(q.toUpperCase()));
  const terms=q.split(/[^a-z0-9]+/).filter(Boolean);
  return stations.filter(p=>{const hay=[p.name,p.address,p.city,...p.lines].join(' ').toLowerCase().replace(/[^a-z0-9]+/g,' ');return terms.every(term=>hay.includes(term));});
}

export function createRailDirectory({storage,fetcher=globalThis.fetch,now=()=>Date.now()}={}){
  let snapshot=null,inflight=null;
  try{
    const saved=JSON.parse(storage?.getItem(CACHE_KEY)||'null');
    if(saved&&Number.isFinite(saved.checkedAt)&&saved.checkedAt>0&&saved.checkedAt<=now()+60000)snapshot={stations:stationRecords(saved.data),checkedAt:saved.checkedAt,cached:true};
  }catch{}
  return{
    snapshot:()=>snapshot,
    refresh(){
      if(inflight)return inflight;
      inflight=(async()=>{
        const url=new URL(RTD_LAYER+'/query');
        url.search=new URLSearchParams({where:'1=1',outFields:'PID,NAME,ADDRESS,CITY,ZIPCODE,RAIL_LINE',returnGeometry:'true',outSR:'4326',f:'json',resultRecordCount:'2000'}).toString();
        const data=await fetchJson(url,{fetcher:(input,options)=>fetcher(input,{...options,cache:'no-store'})});
        const next={stations:stationRecords(data),checkedAt:now(),cached:false};
        snapshot=next;
        try{storage?.setItem(CACHE_KEY,JSON.stringify({data,checkedAt:next.checkedAt}));}catch{}
        return next;
      })().finally(()=>{inflight=null;});
      return inflight;
    }
  };
}

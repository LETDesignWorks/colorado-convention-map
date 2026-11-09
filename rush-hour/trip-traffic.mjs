import {parseDenver,tripKey,validPoint} from './trip-model.mjs?v=hotel-trips-20261109-1';
export function trafficRequest(from,to,departure,key){
  if(!key)throw Error('Connect a TomTom routing key under Automatic traffic tests first.');
  if(![from,to].every(p=>p&&validPoint(p.lat,p.lng)))throw Error('Choose both route locations first.');
  const url=new URL('https://api.tomtom.com/routing/1/calculateRoute/'+[from,to].map(p=>p.lat+','+p.lng).join(':')+'/json');
  url.search=new URLSearchParams({key,traffic:'true',departAt:parseDenver(departure).toISOString(),routeType:'fastest',travelMode:'car',computeTravelTimeFor:'all',routeRepresentation:'summaryOnly'}).toString();return url;
}
export function trafficResult(data,key,now=new Date()){
  const s=data?.routes?.[0]?.summary;
  if(!s||!Number.isFinite(s.travelTimeInSeconds)||s.travelTimeInSeconds<=0)throw Error('The traffic service did not return a travel-time estimate.');
  const minutes=Math.ceil(s.travelTimeInSeconds/60);
  return{provider:'TomTom',low:minutes,high:minutes,key,via:'Fastest traffic-aware car route',checkedAt:now.toISOString(),noTrafficMinutes:Number.isFinite(s.noTrafficTravelTimeInSeconds)?Math.ceil(s.noTrafficTravelTimeInSeconds/60):null,miles:Number.isFinite(s.lengthInMeters)?s.lengthInMeters/1609.344:null};
}
export function createTrafficClient({fetcher=globalThis.fetch,storage,now=()=>new Date()}={}){
  const storageKey='denver-rush-hour-tomtom-session';let apiKey='';const cache=new Map();
  try{apiKey=storage?.getItem(storageKey)||'';}catch{}
  return{
    ready:()=>!!apiKey,
    connect(value){const key=String(value).trim();if(!/^[A-Za-z0-9_-]{10,200}$/.test(key))throw Error('Enter a valid TomTom API key.');apiKey=key;cache.clear();try{storage?.setItem(storageKey,key);}catch{}},
    disconnect(){apiKey='';cache.clear();try{storage?.removeItem(storageKey);}catch{}},
    async request(from,to,departure,{signal}={}){
      const at=now();if(+parseDenver(departure)<=+at)throw Error('Automatic forecasts need a future departure date and time.');
      const request=trafficRequest(from,to,departure,apiKey),key=tripKey(from,to,departure),old=cache.get(key);if(old&&+at-old.at<300000)return old.traffic;
      const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,20000);
      try{const response=await fetcher(request,{signal:controller.signal,headers:{Accept:'application/json'}});
        if(!response.ok)throw Error(response.status===401||response.status===403?'Traffic access was denied. Check the routing key, product access and allowed website domain.':response.status===429?'The traffic account has reached its request limit. Retry later or enter a Google traffic check.':'The traffic service is unavailable ('+response.status+').');
        const traffic=trafficResult(await response.json(),key,at);cache.set(key,{at:+at,traffic});return traffic;
      }catch(error){if(error.name==='AbortError')throw Error('Traffic test cancelled or timed out.');throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
  };
}

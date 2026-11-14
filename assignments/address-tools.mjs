import {validPoint} from './location-model.mjs?v=address-help-20261114-1';

export function formatCoordinates(lat,lng){
  return validPoint(lat,lng)?Number(lat).toFixed(6)+', '+Number(lng).toFixed(6):'';
}
export function parseCoordinatePair(value){
  let text=String(value||'').trim().replaceAll('−','-');
  if(text.startsWith('(')&&text.endsWith(')'))text=text.slice(1,-1).trim();
  const match=/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s*[,;]\s*|\s+)([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/.exec(text);
  if(!match||!validPoint(match[1],match[2]))return null;
  return {lat:Number(match[1]),lng:Number(match[2])};
}
export function googleSearchUrl(query){
  if(!String(query||'').trim())return '';
  const url=new URL('https://www.google.com/maps/search/');
  url.search=new URLSearchParams({api:'1',query:String(query).trim()}).toString();
  return url.href;
}
export function censusCandidates(data){
  const seen=new Set();
  return (data?.result?.addressMatches||[]).flatMap(match=>{
    const address=String(match.matchedAddress||'').trim(),lat=match.coordinates?.y,lng=match.coordinates?.x;
    if(!address||!validPoint(lat,lng))return [];
    const key=address+':'+lat+':'+lng;if(seen.has(key))return [];seen.add(key);
    return [{address,lat:Number(lat),lng:Number(lng),kind:'address',approximate:false,precision:'street-estimate',source:'Administrator-selected US Census street estimate'}];
  });
}
let requestId=0;
// The Census API documents JSONP for browser clients because it does not support CORS.
export function findCensusAddress(query,{signal,document:page=globalThis.document,scope=globalThis,timeoutMs=10000}={}){
  const address=String(query||'').trim();
  if(address.length<8||!/^\d/.test(address))return Promise.reject(Error('Enter a street number, street, city and state for the U.S. address lookup.'));
  if(signal?.aborted)return Promise.reject(new DOMException('Lookup cancelled','AbortError'));
  if(!page?.head)return Promise.reject(Error('The U.S. address lookup is unavailable.'));
  return new Promise((resolve,reject)=>{
    const callback='__denverCensus_'+Date.now()+'_'+(++requestId),script=page.createElement('script');
    let settled=false,timer;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      script.remove();delete scope[callback];
      if(error)reject(error);else resolve(value);
    };
    const abort=()=>finish(new DOMException('Lookup cancelled','AbortError'));
    scope[callback]=data=>{
      try{finish(null,censusCandidates(data));}catch{finish(Error('The U.S. address lookup returned an unreadable result.'));}
    };
    const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.search=new URLSearchParams({address,benchmark:'Public_AR_Current',format:'jsonp',callback}).toString();
    script.async=true;script.src=url.href;
    script.onerror=()=>finish(Error('The U.S. address lookup is unavailable. Try Google Maps or place a pin manually.'));
    script.onload=()=>{if(!settled)finish(Error('The U.S. address lookup did not return coordinates.'));};
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(Error('The U.S. address lookup timed out. Try Google Maps or place a pin manually.')),timeoutMs);
    try{page.head.appendChild(script);}catch(error){finish(error);}
  });
}

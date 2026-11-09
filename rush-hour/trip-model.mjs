import {parseDenver,formatDenver,denverInput,validPoint} from '../routes/travel-plan.mjs';
export {parseDenver,formatDenver,denverInput,validPoint};
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function nextWeekday(now=new Date()){
  const date=denverInput(now).slice(0,10),day=new Date(date+'T12:00:00Z');
  do{day.setUTCDate(day.getUTCDate()+1);}while([0,6].includes(day.getUTCDay()));
  return day.toISOString().slice(0,10);
}
export function endpointKey(point){return [point.kind,point.id,point.address,point.lat,point.lng].join('|');}
export function tripKey(from,to,departure){return [endpointKey(from),endpointKey(to),departure].join(' → ');}
export function shiftDeparture(value,minutes){if(!Number.isFinite(minutes))throw Error('Invalid departure adjustment.');return denverInput(new Date(+parseDenver(value)+minutes*60000));}
export function departureCandidates(value,step=15){if(![5,15,30,60].includes(Number(step)))throw Error('Choose a comparison interval of 5, 15, 30 or 60 minutes.');return [-2,-1,0,1,2].map(n=>shiftDeparture(value,n*Number(step)));}
export function googleDirections(from,to){
  const url=new URL('https://www.google.com/maps/dir/');url.search=new URLSearchParams({api:'1',origin:from.address,destination:to.address,travelmode:'driving'}).toString();return url.href;
}
export function validateTrip(from,to,departure,allowance){
  if(!from?.address||!to?.address)throw Error('Choose a starting point and destination.');
  if(!validPoint(from.lat,from.lng)||!validPoint(to.lat,to.lng))throw Error('Find the independent address and select a matching result before showing the route.');
  if(Math.abs(Number(from.lat)-Number(to.lat))<.00001&&Math.abs(Number(from.lng)-Number(to.lng))<.00001)throw Error('Choose different starting and ending points.');
  parseDenver(departure);
  if(String(allowance).trim()===''||!Number.isFinite(Number(allowance))||Number(allowance)<0||Number(allowance)>90)throw Error('Enter a bus allowance from 0 to 90 minutes.');
}
export function checkedTraffic(low,high,via,key,now=new Date()){
  if([low,high].some(n=>String(n).trim()===''||!Number.isFinite(Number(n))||Number(n)<=0||Number(n)>1440)||Number(low)>Number(high))throw Error('Enter a valid rush-hour range in minutes: lower time first, up to 1,440 minutes. For one time, enter it in both boxes.');
  return{low:Number(low),high:Number(high),via:String(via||'').trim(),key,checkedAt:now.toISOString()};
}
export const trafficSource=traffic=>traffic?.provider==='TomTom'?'TomTom traffic estimate':'Entered from Google Maps';
export const trafficMinutes=traffic=>!traffic?'Pending':traffic.low===traffic.high?traffic.high+' min':traffic.low+'–'+traffic.high+' min';
export function tripSummary({from,to,departure,allowance,road,traffic}){
  validateTrip(from,to,departure,allowance);
  const key=tripKey(from,to,departure),checked=traffic?.key===key?traffic:null;
  const baseline=Number.isFinite(road?.minutes)&&road.minutes>0?Math.ceil(road.minutes):null;
  const minutes=checked?Math.ceil(checked.high+Number(allowance)):null;
  return JSON.parse(JSON.stringify({from,to,departure,allowance:Number(allowance),road,baseline,traffic:checked,minutes,arrival:minutes?new Date(+parseDenver(departure)+minutes*60000).toISOString():null,googleUrl:googleDirections(from,to),key}));
}
export function tripLines(result){
  const s=result;
  return[
    ['Starting point',s.from.name+'\n'+s.from.address],['Destination',s.to.name+'\n'+s.to.address],
    ['Departure (Denver time)',formatDenver(s.departure)],
    ['Basic driving estimate',s.baseline?s.baseline+' min'+(Number.isFinite(s.road?.miles)?' · '+s.road.miles.toFixed(1)+' miles':'')+' — excludes traffic':'Unavailable'],
    ['Rush-hour driving time',s.traffic?trafficMinutes(s.traffic)+' · '+trafficSource(s.traffic):'Not checked. Run an automatic traffic test or enter a Google traffic time.'],
    ...(s.traffic?.via?[['Forecast route',s.traffic.via]]:[]),
    ['Extra bus allowance',s.allowance+' min'],
    ['Bus planning time',s.minutes?s.minutes+' min (upper rush-hour time + bus allowance)':'Pending rush-hour check'],
    ...(s.arrival?[['Planned arrival (Denver time)',formatDenver(s.arrival)]]:[]),
    ...(s.traffic?[['Traffic checked',formatDenver(s.traffic.checkedAt)]]:[]),
    ...(s.from.note?[['Starting-point note',s.from.note]]:[]),...(s.to.note?[['Destination note',s.to.note]]:[]),
    ...(s.comparisons?.length?[['Departure comparisons','Only completed traffic checks are compared; pending departures have no traffic prediction.'],...s.comparisons.map(c=>[formatDenver(c.departure),c.traffic?`${trafficSource(c.traffic)}: ${trafficMinutes(c.traffic)} · Bus plan: ${c.minutes} min · Arrival: ${formatDenver(c.arrival)}`:'Pending Google traffic check / automatic test'])]:[])
  ];
}
export const TRIP_NOTE='Traffic estimates are for cars and can change. Confirm coach access, loading and unloading time with the operator. The map shows an OSRM road overview, which may differ from the traffic provider’s route. Each direction and departure time needs its own traffic check. TomTom predictions and Google ranges use different methods; compare results from the same source where possible.';
export function tripHtml(result){return '<header><h1>Denver 2027 · Hotel & address trip</h1></header>'+tripLines(result).map(([label,value])=>'<section><h2>'+escapeHtml(label)+'</h2><p>'+escapeHtml(value).replace(/\n/g,'<br>')+'</p></section>').join('')+'<p>'+escapeHtml(TRIP_NOTE)+'</p><p><a href="'+escapeHtml(result.googleUrl)+'">Open this route in Google Maps</a></p>';}

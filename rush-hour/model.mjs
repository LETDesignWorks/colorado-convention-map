export function minutes(value){
  const text=String(value).trim();
  const hours=Number(text.match(/(\d+)\s*hr/)?.[1]||0),mins=Number(text.match(/(\d+)\s*min/)?.[1]||0);
  if(!/\d/.test(text)||(!/hr|min/.test(text)&&!/^\d+$/.test(text)))throw new Error('Invalid duration: '+text);
  return /hr|min/.test(text)?hours*60+mins:Number(text);
}
export function parseRange(text){
  const parts=text.split(/\s+to\s+|[––−-]/).map(x=>x.trim());
  if(parts.length===1){const value=minutes(parts[0]);return{low:value,high:value};}
  if(parts.length!==2)throw new Error('Invalid duration range: '+text);
  if(/^\d+$/.test(parts[0])&&/^\d+\s*hr$/.test(parts[1]))parts[0]+=' hr';
  const low=minutes(parts[0]),high=minutes(parts[1]);
  if(low>high||low<=0)throw new Error('Invalid duration order: '+text);
  return{low,high};
}
export function parseForecast(evidence){
  const lines=evidence.split('\n').filter(l=>/link "Driving typically|button "Driving typically/.test(l));
  return lines.map(line=>{
    const match=line.match(/Driving typically (.+?)(?: Arrive around .+?)? ([\d.]+) miles via (.+?)(?: Details Preview)?":$/);
    if(!match)throw new Error('Unrecognized forecast: '+line);
    return{rangeText:match[1],...parseRange(match[1]),miles:Number(match[2]),via:match[3]};
  });
}
const normalizedAddress=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function sameLocation(current,snapshot){
  if(normalizedAddress(current.address)!==normalizedAddress(snapshot.address))return false;
  const dy=(current.lat-snapshot.lat)*111320,dx=(current.lng-snapshot.lng)*111320*Math.cos(current.lat*Math.PI/180);
  return Number.isFinite(dx)&&Number.isFinite(dy)&&Math.hypot(dx,dy)<=30;
}
export function rankedLocations(locations,period,allowance){
  const buffer=Number(allowance);
  if(!Number.isFinite(buffer)||buffer<0||buffer>90)throw new Error('Use a bus allowance from 0 to 90 minutes.');
  return locations.map(location=>{
    const forecast=location.forecasts?.[period];
    return{...location,forecast,planningMinutes:forecast?forecast.routes[0].high+buffer:null};
  }).sort((a,b)=>(a.planningMinutes??Infinity)-(b.planningMinutes??Infinity)||(a.forecast?.routes[0].low??Infinity)-(b.forecast?.routes[0].low??Infinity)||(a.forecast?.routes[0].miles??Infinity)-(b.forecast?.routes[0].miles??Infinity)||a.name.localeCompare(b.name))
    .map((location,index)=>({...location,rank:location.forecast?index+1:null}));
}
export const timeColor=minutes=>minutes==null?'#7b8794':minutes<=45?'#167b63':minutes<=60?'#2166a5':minutes<=90?'#aa680a':'#ae3b50';

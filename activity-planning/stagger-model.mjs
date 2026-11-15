import {parseDenver,validPoint,formatDenver} from '../routes/travel-plan.mjs';
const minute=60000;
function integer(value,label,min=0,max=2880){if(value===null||value===undefined||String(value).trim()==='')throw Error('Enter '+label+'.');const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+' must be a whole number from '+min+' to '+max+'.');return n;}
export const stopKey=(point,index)=>index+'|'+point.id+'|'+point.lat+'|'+point.lng;
export function staggerStops(route){
 const points=(route.stops||[]).map(p=>({...p}));
 if(route.roundTrip&&points.length>1&&(Number(points[0].lat)!==Number(points.at(-1).lat)||Number(points[0].lng)!==Number(points.at(-1).lng)))points.push({...points[0],dwell:0,boarding:0,role:'Return to start',automaticReturn:true});
 return points;
}
export function staggerPlan({route,buses,gap,departure,autoAdjust=true,constraints={}}){
 if(!Array.isArray(route?.stops)||route.stops.length<2||route.stops.length>20)throw Error('Arrange 2 to 20 stops in the Activity Planning route first.');
 const points=staggerStops(route).map((p,i)=>{
  if(!p.name||!validPoint(p.lat,p.lng))throw Error('Add a map pin for '+(p.name||'stop '+(i+1))+'.');
  const dwell=integer(p.dwell,'Stop minutes at '+p.name),boarding=integer(p.boarding??0,'Loading minutes at '+p.name,0,240);
  if(boarding>dwell)throw Error('Loading at '+p.name+' must fit inside its stop minutes.');
  const rule=constraints[stopKey(p,i)]||{};
  return {...p,lat:Number(p.lat),lng:Number(p.lng),dwell,boarding,deadline:i&&rule.deadline?+parseDenver(rule.deadline):null,notBefore:i&&rule.notBefore?+parseDenver(rule.notBefore):null};
 });
 const preferred=+parseDenver(departure),count=integer(buses,'Bus count',1,1000),interval=integer(gap,'Departure gap',0,240),buffer=integer(route.buffer,'Travel allowance',0,240);
 if(autoAdjust&&!points.some(p=>p.deadline!==null))throw Error('Set an “All buses arrive by” time, or turn off moving the first departure earlier.');
 const overrides={};for(let i=0;i<points.length-1;i++){const value=route.overrides?.[i];if(value!==undefined&&value!==null&&value!=='')overrides[i]=integer(value,'Manual driving minutes',0,10000);}
 return {name:route.name||'Staggered bus route',points,buses:count,gap:interval,preferred,autoAdjust:!!autoAdjust,buffer,overrides};
}
async function mapBuses(count,work,signal){const values=new Array(count);let index=0;async function worker(){while(index<count){signal.throwIfAborted();const bus=index++;values[bus]=await work(bus);}}await Promise.all(Array.from({length:Math.min(2,count)},worker));return values;}
export async function scheduleFleet(plan,{route,key='',signal,onProgress=()=>{},maxAttempts=4,timeoutMs=30000}={}){
 const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const cache=new Map();let calls=0;
 async function drive(from,to,at,leg,bus){
  if(Object.hasOwn(plan.overrides,leg))return {minutes:plan.overrides[leg],miles:null,label:'Manual driving time — traffic not recalculated'};
  const signature=[from.lat,from.lng,to.lat,to.lng,key?at:'baseline'].join('|');if(cache.has(signature))return cache.get(signature);
  const task=(async()=>{const abort=new AbortController(),stop=()=>abort.abort(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});const timer=setTimeout(()=>abort.abort(),timeoutMs);
   try{controller.signal.throwIfAborted();calls++;const value=await route(from,to,at,false,'bus',key,abort.signal);if(!Number.isFinite(value.minutes)||value.minutes<0)throw Error('Invalid duration');return {minutes:Math.ceil(value.minutes),miles:Number.isFinite(value.miles)?value.miles:null,label:value.label||'Road estimate'};}
   catch{controller.signal.throwIfAborted();throw Error('Could not calculate Bus '+(bus+1)+' from '+from.name+' to '+to.name+'. Check the pins, connection, and traffic key, then retry.');}
   finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
  })();cache.set(signature,task);return task;
 }
 async function forward(firstDeparture,attempt){
  const rows=[],violations=[],departures=Array.from({length:plan.buses},(_,bus)=>firstDeparture+bus*plan.gap*minute);let currentDepartures=departures,done=0;
  for(let bus=0;bus<plan.buses;bus++){const p=plan.points[0],depart=departures[bus];rows.push({bus:bus+1,stop:1,name:p.name,address:p.address||'',role:p.role||'',arrive:depart-p.dwell*minute,ready:p.boarding?depart-p.boarding*minute:null,depart,wait:0,deadline:null,lateMinutes:0,final:false,driveMinutes:0,miles:0,label:'Starting point'});}
  for(let leg=0;leg<plan.points.length-1;leg++){
   controller.signal.throwIfAborted();const from=plan.points[leg],to=plan.points[leg+1],last=leg===plan.points.length-2;
   const trips=await mapBuses(plan.buses,async bus=>{const estimate=await drive(from,to,currentDepartures[bus],leg,bus);onProgress({attempt,done:++done,total:plan.buses*(plan.points.length-1)});return {...estimate,arrive:currentDepartures[bus]+(estimate.minutes+plan.buffer)*minute};},controller.signal);
   const base=Math.max(to.notBefore??-Infinity,...trips.map((trip,bus)=>trip.arrive+to.dwell*minute-bus*plan.gap*minute));
   const next=[];
   for(let bus=0;bus<plan.buses;bus++){
    const trip=trips[bus],depart=last?Math.max(trip.arrive+to.dwell*minute,(to.notBefore??-Infinity)+bus*plan.gap*minute):base+bus*plan.gap*minute;
    const lateMinutes=to.deadline===null?0:Math.max(0,Math.ceil((trip.arrive-to.deadline)/minute));
    const row={bus:bus+1,stop:leg+2,name:to.name,address:to.address||'',role:to.role||'',arrive:trip.arrive,ready:!last&&to.boarding?depart-to.boarding*minute:null,depart,wait:Math.max(0,(depart-trip.arrive)/minute-to.dwell),deadline:to.deadline,lateMinutes,final:last,driveMinutes:trip.minutes,miles:trip.miles,label:trip.label};rows.push(row);if(lateMinutes)violations.push(row);next.push(depart);
   }
   currentDepartures=next;
  }
  return {plan,rows,violations,firstDeparture,lastDeparture:departures.at(-1),maxLate:Math.max(0,...violations.map(r=>r.lateMinutes)),attempts:attempt,traffic:!!key,routeCalls:calls,hasDeadlines:plan.points.some(p=>p.deadline!==null)};
 }
 try{
  let departure=plan.preferred,previousLate=Infinity,result;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   result=await forward(departure,attempt);controller.signal.throwIfAborted();
   if(!plan.autoAdjust||!result.maxLate||attempt===maxAttempts||result.maxLate>=previousLate)break;
   previousLate=result.maxLate;departure-=result.maxLate*minute;
  }
  return {...result,allMet:result.violations.length===0,shiftMinutes:(plan.preferred-result.firstDeparture)/minute};
 }finally{controller.abort();signal?.removeEventListener('abort',cancel);}
}
export function staggerSheets(result){
 const {plan,rows}=result,headers=['Bus','Stop','Location','Address','Arrival / at start - Denver','Ready / loading - Denver','Departure / finish - Denver','Waiting minutes','All buses arrive by - Denver','Deadline result','Driving minutes','Road miles','Estimate source'];
 const values=row=>[row.bus,row.stop,row.name,row.address,formatDenver(row.arrive),row.ready===null?'No boarding planned':formatDenver(row.ready),formatDenver(row.depart)+(row.final?' (finish)':''),row.wait,row.deadline===null?'Not set':formatDenver(row.deadline),row.deadline===null?'Not set':row.lateMinutes?row.lateMinutes+' min late':'Meets deadline',row.driveMinutes,row.miles??'',row.label];
 return [{name:'Schedule by stop',headers,widths:[10,10,38,48,45,45,45,18,45,24,18,15,65],rows:rows.map(values)},{name:'Schedule by bus',headers,widths:[10,10,38,48,45,45,45,18,45,24,18,15,65],rows:[...rows].sort((a,b)=>a.bus-b.bus||a.stop-b.stop).map(values)},
 {name:'Planning assumptions',headers:['Item','Value'],widths:[35,110],rows:[['Route',plan.name],['Buses',plan.buses],['Minutes between departures',plan.gap],['Preferred first departure',formatDenver(plan.preferred)],['Planned first departure',formatDenver(result.firstDeparture)],['Last bus leaves origin',formatDenver(result.lastDeparture)],['Moved earlier - minutes',result.shiftMinutes],['Deadline outcome',!result.hasDeadlines?'No deadlines set':result.allMet?'All entered arrival deadlines met in this estimate':'DEADLINES NOT MET — review late rows before using'],['Late bus arrivals',result.violations.length],['Traffic',result.traffic?'Time-dependent bus estimates, except manual overrides':'Road baselines without time-of-day traffic'],['Travel allowance per leg - min',plan.buffer],['Spacing','Every intermediate departure retains the selected bus order and departure gap. Earlier buses may wait so all buses receive their minimum stop time. Traffic can change arrival spacing.'],['Stop time','Loading is included in stop minutes. Final-stop departure values indicate the route finish, not another journey.'],['Scope','This is one fleet run along the route, including its return stop if enabled. Repeated runs and actual vehicle reservations are not included.'],['Review','Times are planning estimates. Confirm access, traffic, loading space and operator arrangements. Recalculate after changes.']]}];
}

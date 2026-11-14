import {parseDenver,denverInput} from '../routes/travel-plan.mjs';
export const MODES={car:{name:'Car',icon:'🚗',color:'#2563eb'},bus:{name:'Bus / motorcoach',icon:'🚌',color:'#087f8c'},rail:{name:'Rail + walking',icon:'🚆',color:'#7c3aed'},walk:{name:'Walk',icon:'🚶',color:'#546274'}};
export const minute=60000;
export function number(value,label,max=1440){const n=Number(value);if(!Number.isFinite(n)||n<0||n>max)throw Error(label+' must be between 0 and '+max+'.');return n;}
export function validatePlan(plan){
 if(!Array.isArray(plan.stops)||plan.stops.length<2||plan.stops.length>4)throw Error('Choose two to four locations.');
 parseDenver(plan.time);
 for(const [i,s] of plan.stops.entries()){
  if(s.lat==null||s.lng==null||String(s.lat).trim()===''||String(s.lng).trim()===''||!Number.isFinite(Number(s.lat))||!Number.isFinite(Number(s.lng))||Math.abs(Number(s.lat))>90||Math.abs(Number(s.lng))>180)throw Error('Confirm the address pin for location '+(i+1)+'.');
  if(s.startTime)parseDenver(s.startTime);
  number(s.dwell,'Activity / stop duration');
  if(i<plan.stops.length-1&&!MODES[s.mode])throw Error('Choose a transport mode for each leg.');
 }
 for(const k of ['boarding','allowance','arrivalBuffer','transfer','wait','reminder'])number(plan[k],k);
 return plan;
}
export async function calculateSchedule(plan,router){
 validatePlan(plan);const legs=[],conflicts=[],n=plan.stops.length;
 const critical=s=>s.startTime?+parseDenver(s.startTime):null;
 const arriveBy=plan.timing==='arrive';
 let cursor=+parseDenver(plan.time);
 if(arriveBy){
  cursor-=plan.arrivalBuffer*minute;
  for(let i=n-2;i>=0;i--){
   const a=plan.stops[i],b=plan.stops[i+1],event=critical(b);
   if(event!==null)cursor=Math.min(cursor,event-plan.arrivalBuffer*minute);
   const leg=await router(a,b,cursor,true,plan);
   leg.ready=leg.depart-plan.boarding*minute;leg.reminder=leg.ready-plan.reminder*minute;leg.index=i;legs.unshift(leg);
   const start=critical(a);
   if(start!==null&&start+a.dwell*minute>leg.ready)conflicts.push(a.name+': the activity ends after volunteers must be ready to leave. Shorten the activity, move its start time, or change transport.');
   cursor=Math.min(leg.ready-a.dwell*minute,start===null?Infinity:start-plan.arrivalBuffer*minute);
  }
 }else{
  for(let i=0;i<n-1;i++){
   const a=plan.stops[i],b=plan.stops[i+1],start=critical(a);
   if(i>0)cursor=Math.max(cursor,start??-Infinity)+a.dwell*minute+plan.boarding*minute;
   else if(start!==null&&start+a.dwell*minute>cursor-plan.boarding*minute)conflicts.push(a.name+': the activity duration overlaps the chosen departure.');
   const leg=await router(a,b,cursor,false,plan);
   leg.ready=leg.depart-plan.boarding*minute;leg.reminder=leg.ready-plan.reminder*minute;leg.index=i;legs.push(leg);cursor=leg.arrive;
   const target=critical(b);
   if(target!==null&&cursor>target-plan.arrivalBuffer*minute)conflicts.push(b.name+': arrive '+Math.ceil((cursor-(target-plan.arrivalBuffer*minute))/minute)+' min too late for the start time and arrival buffer. Choose “Arrive by” to work backward.');
  }
 }
 return {legs,conflicts,depart:legs[0].depart,ready:legs[0].ready,arrive:legs.at(-1).arrive,minutes:Math.ceil((legs.at(-1).arrive-legs[0].depart)/minute)};
}
export function legacyPlan(record){
 if(record.travelSchemaVersion===1&&record.plan)return structuredClone(record.plan);
 const point=(p,fallback)=>({id:'custom',name:fallback.name||fallback.label||'Location',address:fallback.address||'',lat:p?.lat,lng:p?.lng,mode:'bus',dwell:0,startTime:''});
 const a=point(record.origin,{name:record.hotelName||record.originName,address:record.hotelAddress||record.originAddress});
 const b=point(record.destination,{name:record.destinationName||record.destinationLabel,address:record.destinationAddress});
 return {name:record.routeName||'Saved Field Service route',stops:[a,b],timing:record.meetingLocal?'arrive':'depart',time:record.meetingLocal||record.departureLocal||denverInput(new Date()),boarding:record.boardingBuffer??15,allowance:record.travelAllowance??15,arrivalBuffer:record.arrivalBuffer??15,transfer:10,wait:15,reminder:record.reminderLeadMinutes??30,notes:record.notes||'',parking:record.parkingNotes||'',tickets:record.ticketMethod||'mobile',extraReminders:record.extraReminders||''};
}
export function serializePlan(plan,result){
 const keys=['name','timing','time','boarding','allowance','arrivalBuffer','transfer','wait','reminder','notes','parking','tickets','extraReminders'];
 const cleanPlan=Object.fromEntries(keys.filter(k=>plan[k]!==undefined).map(k=>[k,plan[k]]));
 const stopKeys=['id','name','address','lat','lng','mode','dwell','startTime','showRail','railFrom','railTo'];
 cleanPlan.stops=plan.stops.map(s=>Object.fromEntries(stopKeys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])));
 const first=plan.stops[0],last=plan.stops.at(-1);
 // Explicit fields only: session credentials can never enter a shared document.
 return {recordType:'bus-route',travelSchemaVersion:1,routeName:plan.name||'Travel route',plan:cleanPlan,resultJson:JSON.stringify(result),origin:{lat:first.lat,lng:first.lng},hotelName:first.name,hotelAddress:first.address,destination:{lat:last.lat,lng:last.lng},destinationName:last.name,destinationAddress:last.address,destinationId:last.id||'custom',meetingLocal:plan.timing==='arrive'?plan.time:last.startTime||'',departureLocal:denverInput(new Date(result.depart)),arrivalLocal:denverInput(new Date(result.arrive)),reportLocal:denverInput(new Date(result.ready)),plannedTravelMinutes:result.minutes,boardingBuffer:plan.boarding,arrivalBuffer:plan.arrivalBuffer,travelAllowance:plan.allowance,timeZone:'America/Denver',notes:plan.notes||''};
}


import {parseDenver,validPoint,formatDenver} from '../routes/travel-plan.mjs';
export const GROUP_TYPE='activity-multistop-route',GROUP_SUBTYPE='bus-group-plan';
const minute=60000;
const text=(value,max)=>String(value??'').trim().slice(0,max);
const id=value=>{const key=String(value||'');if(!/^[-\w]{1,120}$/.test(key))throw Error('Invalid group or bus identifier.');return key;};
const coordinate=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);if(!Number.isFinite(n))throw Error('Enter valid map coordinates.');return n;};
export function cleanPoint(point){if(!point)return null;return {id:text(point.id,120)||'custom',name:text(point.name,140),address:text(point.address,300),lat:coordinate(point.lat),lng:coordinate(point.lng),group:text(point.group,80),customAddress:!!point.customAddress};}
export function cleanGroupPlan(value){
 if(!Array.isArray(value.groups)||value.groups.length>100)throw Error('Use up to 100 groups in one plan.');const groupIds=new Set(),busIds=new Set();let count=0;
 const groups=value.groups.map(group=>{const groupId=id(group.id);if(groupIds.has(groupId))throw Error('Group identifiers must be unique.');groupIds.add(groupId);if(!['ccc','dtc'].includes(group.originId))throw Error('Choose Convention Center or Tech Center for each group.');if(!Array.isArray(group.buses))throw Error('Invalid bus list.');
  return {id:groupId,name:text(group.name,100)||'Bus group',originId:group.originId,buses:group.buses.map(bus=>{const busId=id(bus.id);if(busIds.has(busId)||++count>1000)throw Error('Use distinct buses, up to 1,000 in one plan.');busIds.add(busId);return {id:busId,name:text(bus.name,100)||'Bus',departure:text(bus.departure,16),destination:cleanPoint(bus.destination),arriveBy:text(bus.arriveBy,16),secondEnabled:!!bus.secondEnabled,secondDestination:cleanPoint(bus.secondDestination),secondMode:bus.secondMode==='time'?'time':'duration',secondDeparture:text(bus.secondDeparture,16),duration:text(bus.duration??'60',12),durationUnit:bus.durationUnit==='hours'?'hours':'minutes',secondArriveBy:text(bus.secondArriveBy,16)};})};
 });
 return {version:1,name:text(value.name,140)||'Bus groups and departures',allowance:text(value.allowance??'15',6),boarding:text(value.boarding??'15',6),groups};
}
function number(value,label,max=240){if(value===null||value===undefined||String(value).trim()==='')throw Error('Enter '+label+'.');const n=Number(value);if(!Number.isFinite(n)||n<0||n>max)throw Error(label+' must be between 0 and '+max+'.');return n;}
export function encodeGroupPlan(value){const plan=cleanGroupPlan(value),groupsJson=JSON.stringify(plan);if(groupsJson.length>750000)throw Error('This plan is too large to share. Split it into smaller plans.');return {recordType:GROUP_TYPE,planningSubtype:GROUP_SUBTYPE,busGroupsVersion:1,planName:plan.name,groupsJson};}
export function readGroupPlan(record){try{if(record.recordType!==GROUP_TYPE||record.planningSubtype!==GROUP_SUBTYPE||record.busGroupsVersion!==1||!Number.isInteger(record.revision)||record.revision<1)return null;return {id:record.id,revision:record.revision,plan:cleanGroupPlan(JSON.parse(record.groupsJson))};}catch{return null;}}
export function nextGroupRevision(record,expected){if(!readGroupPlan(record)||record.revision!==expected)throw Error('This shared plan changed elsewhere. Load its latest version, or save your changes as a new plan.');return expected+1;}
export async function calculateBusGroups(value,{origins,route,key='',signal,onProgress=()=>{},timeoutMs=30000}={}){
 const plan=cleanGroupPlan(value),allowance=number(plan.allowance,'Extra travel allowance'),boarding=number(plan.boarding,'Boarding minutes'),items=plan.groups.flatMap(group=>group.buses.map(bus=>({group,bus})));if(!items.length)throw Error('Add at least one bus.');
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const cache=new Map(),rows=new Array(items.length);let index=0,done=0;
 async function driving(from,to,depart){
  const signature=[from.lat,from.lng,to.lat,to.lng,key?depart:'baseline'].join('|');if(cache.has(signature))return cache.get(signature);
  const pending=(async()=>{const request=new AbortController(),stop=()=>request.abort(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});const timer=setTimeout(()=>request.abort(),timeoutMs);
   try{controller.signal.throwIfAborted();const result=await route(from,to,depart,false,'bus',key,request.signal);if(!Number.isFinite(result.minutes)||result.minutes<0)throw Error('No travel estimate');return {minutes:Math.ceil(result.minutes),miles:Number.isFinite(result.miles)?result.miles:null,source:result.label||'Road estimate'};}
   catch{controller.signal.throwIfAborted();throw Error('Travel time unavailable. Check the location pins, connection and traffic key, then retry.');}
   finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
  })();cache.set(signature,pending);return pending;
 }
 function target(point,label){if(!point?.name||!validPoint(point.lat,point.lng))throw Error('Choose '+label+' with a valid address pin.');return point;}
 async function busSchedule(group,bus){
  const row={groupId:group.id,groupName:group.name,busId:bus.id,busName:bus.name,origin:origins.find(p=>p.id===group.originId),departure:null,legs:[],secondEnabled:bus.secondEnabled,secondDeparture:null,issues:[]};
  try{
   const origin=target(row.origin,'a starting location'),first=target(bus.destination,'destination 1');row.departure=+parseDenver(bus.departure);const firstDeadline=bus.arriveBy?+parseDenver(bus.arriveBy):null;
   const firstDrive=await driving(origin,first,row.departure),arrival=row.departure+(firstDrive.minutes+allowance)*minute;
   const firstLeg={from:origin,to:first,depart:row.departure,ready:row.departure-boarding*minute,arrive:arrival,deadline:firstDeadline,lateMinutes:firstDeadline===null?0:Math.max(0,Math.ceil((arrival-firstDeadline)/minute)),...firstDrive};row.legs.push(firstLeg);
   if(firstLeg.lateMinutes)row.issues.push('Destination 1 arrival is '+firstLeg.lateMinutes+' min after its required arrival time.');
   if(bus.secondEnabled){
    const second=target(bus.secondDestination,'destination 2'),deadline=bus.secondArriveBy?+parseDenver(bus.secondArriveBy):null;
    const duration=bus.secondMode==='duration'?number(bus.duration,'Stop duration',bus.durationUnit==='hours'?24:1440)*(bus.durationUnit==='hours'?60:1):0;
    const depart=bus.secondMode==='time'?+parseDenver(bus.secondDeparture):arrival+(duration+boarding)*minute;row.secondDeparture=depart;
    if(depart<arrival+boarding*minute)throw Error('Destination 2 departure is too early. Allow the bus to arrive at destination 1 and board for '+boarding+' minutes before leaving.');
    const estimate=await driving(first,second,depart),arrive=depart+(estimate.minutes+allowance)*minute,lateMinutes=deadline===null?0:Math.max(0,Math.ceil((arrive-deadline)/minute));
    row.legs.push({from:first,to:second,depart,ready:depart-boarding*minute,arrive,deadline,lateMinutes,...estimate});if(lateMinutes)row.issues.push('Destination 2 arrival is '+lateMinutes+' min after its required arrival time.');
   }
  }catch(error){controller.signal.throwIfAborted();row.issues.push(error.message);}
  row.status=row.issues.length?(row.legs.length?'needs-attention':'error'):'ready';return row;
 }
 async function worker(){while(index<items.length){controller.signal.throwIfAborted();const i=index++,{group,bus}=items[i];rows[i]=await busSchedule(group,bus);onProgress(++done,items.length);}}
 try{await Promise.all(Array.from({length:Math.min(2,items.length)},worker));controller.signal.throwIfAborted();return {plan,rows,traffic:!!key,computedAt:new Date().toISOString(),ready:rows.filter(r=>r.status==='ready').length,attention:rows.filter(r=>r.status!=='ready').length};}
 finally{controller.abort();signal?.removeEventListener('abort',abort);}
}
export function busGroupSheets(result){
 const when=value=>Number.isFinite(value)?formatDenver(value):'Not calculated';
 return [{name:'Bus arrivals by group',headers:['Group','Bus','Starts at','Ready / boarding - Denver','Leaves origin - Denver','Destination 1','Destination 1 address','Arrives 1 - Denver','Leaves 1 - Denver','Destination 2','Destination 2 address','Arrives 2 - Denver','Status / issues'],widths:[25,20,35,43,43,40,48,43,43,40,48,43,90],rows:result.rows.map(r=>{const first=r.legs[0],second=r.legs[1],bus=result.plan.groups.find(g=>g.id===r.groupId).buses.find(b=>b.id===r.busId);return [r.groupName,r.busName,r.origin?.name||'',when(first?.ready),when(r.departure),bus.destination?.name||'',bus.destination?.address||'',when(first?.arrive),r.secondEnabled?when(r.secondDeparture):'No second destination',r.secondEnabled?bus.secondDestination?.name||'':'',r.secondEnabled?bus.secondDestination?.address||'':'',r.secondEnabled?when(second?.arrive):'',r.issues.join(' ')||'Estimated schedule ready'];})},
 {name:'Individual bus legs',headers:['Group','Bus','Leg','From','To','Ready / boarding - Denver','Departs - Denver','Arrives - Denver','Required arrival - Denver','Minutes late','Drive minutes','Miles','Estimate source'],widths:[25,20,10,40,40,43,43,43,43,18,18,15,75],rows:result.rows.flatMap(r=>r.legs.map((l,i)=>[r.groupName,r.busName,i+1,l.from.name,l.to.name,when(l.ready),when(l.depart),when(l.arrive),l.deadline===null?'Not set':when(l.deadline),l.lateMinutes,l.minutes,l.miles??'',l.source]))},
 {name:'Planning assumptions',headers:['Item','Value'],widths:[34,115],rows:[['Plan',result.plan.name],['Calculated',result.computedAt],['Time zone','America/Denver'],['Groups',result.plan.groups.length],['Buses',result.rows.length],['Need attention',result.attention],['Traffic',result.traffic?'TomTom time-dependent bus estimates':'Road baselines without time-of-day traffic'],['Extra travel minutes per leg',Number(result.plan.allowance)],['Boarding minutes before each departure',Number(result.plan.boarding)],['Second stop timing','A stop duration is followed by boarding. An exact onward departure must allow the bus to arrive and board first.'],['Planning notes','Times are estimates. Confirm coach access, pickup entrances and activity or service arrangements. Recalculate after changes.'],['Saved plans','Saved plans retain group, destination and departure inputs. Recalculate arrival estimates after loading a plan.'],['DTC origin','Uses the same DTC Center Point reference as the planning maps. Confirm the final pickup address.']]}];
}

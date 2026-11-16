import {parseDenver,denverInput} from '../routes/travel-plan.mjs';
import {calculate,routePoints} from '../activity-planning/model.mjs';

export const STORAGE_KEY='denver2027.conventionCenter.v1';
export const TYPE='activity-multistop-route', SUBTYPE='convention-center-plan';
const MIN=60000;
const str=(v,n=200)=>String(v??'').trim().slice(0,n);
const num=(v,label,min=0,max=1000)=>{const n=Number(v);if(v===''||v==null||!Number.isInteger(n)||n<min||n>max)throw Error(`${label} must be a whole number from ${min} to ${max}.`);return n;};
const time=v=>+parseDenver(v);
export const local=t=>denverInput(new Date(t));
export const isCenter=p=>p?.id==='ccc'||/\b(colorado )?convention center\b/i.test(str(p?.name))||/\b700\s+(?:w\.?\s+)?14th\s+(?:st|street)\b/i.test(str(p?.address));
export const isGathering=p=>p?.id==='encouraging-gathering'||/encouraging gathering/i.test(str(p?.name));
export const emptyPlan=()=>({version:1,name:'Convention Center bus plan',date:local(Date.now()).slice(0,10),capacity:12,gatherings:[],visits:[],alternates:[]});
export const gathering=(start,id=crypto.randomUUID(),source='')=>({id,source,name:'Encouraging Gathering',start,end:local(time(start)+240*MIN),mode:'edges',first:60,last:60,before:0,after:0,reason:''});
function list(value,label,max){if(!Array.isArray(value)||value.length>max)throw Error(`Invalid ${label} list (maximum ${max}).`);const ids=new Set();return value.map(v=>{if(!v||typeof v.id!=='string'||!v.id||v.id.length>250||ids.has(v.id))throw Error(`Invalid or duplicate ${label} identifier.`);ids.add(v.id);return v;});}
export function cleanPlan(raw){
 if(raw?.version!==1)throw Error('Choose a Convention Center plan export.');
 const plan={version:1,name:str(raw.name,140)||'Convention Center bus plan',date:str(raw.date,10),capacity:num(raw.capacity,'Center bus limit',1,1000)};
 time(plan.date+'T00:00');
 plan.alternates=list(raw.alternates,'alternate location',100).map(a=>({id:a.id,name:str(a.name,140),address:str(a.address,400),capacity:a.capacity==null||a.capacity===''?null:num(a.capacity,'Alternate bus capacity',1,1000),notes:str(a.notes,1000),approval:['confirmed','unavailable'].includes(a.approval)?a.approval:'candidate',candidateId:str(a.candidateId,100),walkingMeters:a.walkingMeters==null?null:num(a.walkingMeters,'Walking meters',0,10000),walkingChecked:str(a.walkingChecked,10)}));
 plan.gatherings=list(raw.gatherings,'gathering',500).map(g=>{
  if(time(g.end)<=time(g.start))throw Error('A gathering must end after it starts.');
  if(time(g.end)-time(g.start)>7*86400000)throw Error('A gathering cannot exceed seven days.');
  if(!['edges','full','off'].includes(g.mode))throw Error('Choose a gathering restriction mode.');
  if(g.mode==='off'&&!str(g.reason))throw Error('Enter a reason to override a gathering’s no-bus time.');
  return {id:g.id,source:str(g.source,250),name:str(g.name,140)||'Encouraging Gathering',start:g.start,end:g.end,mode:g.mode,first:num(g.first,'First no-bus minutes',0,10080),last:num(g.last,'Last no-bus minutes',0,10080),before:num(g.before,'Minutes before gathering',0,1440),after:num(g.after,'Minutes after gathering',0,1440),reason:str(g.reason,1000)};
 });
 plan.visits=list(raw.visits,'bus visit',3000).map(v=>{
  if(!str(v.name))throw Error('Enter a bus or group name.');
  if(time(v.departure)<=time(v.arrival))throw Error(`${str(v.name)}: departure must be after arrival. Include loading or unloading time.`);
  const count=num(v.count,'Bus count',1,1000),diverted=num(v.diverted??0,'Buses at alternate pickup',0,count);
  if(diverted&&!plan.alternates.some(a=>a.id===v.alternateId&&a.name&&a.address))throw Error(`${str(v.name)}: select an alternate with a name and pickup address.`);
  if(v.override&&!str(v.reason))throw Error(`${str(v.name)}: enter a reason for the no-bus exception.`);
  return {id:v.id,source:str(v.source,250),name:str(v.name,140),arrival:v.arrival,departure:v.departure,count,diverted,alternateId:str(v.alternateId,250),override:!!v.override,reason:str(v.reason,1000),note:str(v.note,1000)};
 });
 return plan;
}
export function windows(gatherings){
 return gatherings.flatMap(g=>{
  const start=time(g.start),end=time(g.end),before=g.before*MIN,after=g.after*MIN;
  const pairs=g.mode==='off'?[]:g.mode==='full'?[[start-before,end+after]]:[[start-before,Math.min(end,start+g.first*MIN)],[Math.max(start,end-g.last*MIN),end+after]];
  return pairs.filter(([a,b])=>b>a).map(([start,end])=>({start,end,name:g.name,id:g.id}));
 });
}
export function analyze(raw){
 const plan=cleanPlan(raw),blocks=windows(plan.gatherings),start=time(plan.date+'T00:00');
 const next=new Date(plan.date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);const end=time(next.toISOString().slice(0,10)+'T00:00');
 const visits=plan.visits.map(v=>({...v,start:time(v.arrival),end:time(v.departure),center:v.count-v.diverted}));
 const cuts=[...new Set([start,end,...visits.flatMap(v=>[v.start,v.end]),...blocks.flatMap(b=>[b.start,b.end])].filter(t=>t>=start&&t<=end))].sort((a,b)=>a-b);
 const intervals=cuts.slice(0,-1).map((from,i)=>{
  const to=cuts[i+1],active=visits.filter(v=>v.start<to&&v.end>from),count=active.reduce((n,v)=>n+v.center,0),noBus=blocks.filter(b=>b.start<to&&b.end>from);
  const alternates=plan.alternates.map(a=>({...a,count:active.filter(v=>v.alternateId===a.id).reduce((n,v)=>n+v.diverted,0)}));
  return {from,to,count,free:Math.max(0,plan.capacity-count),excess:Math.max(0,count-plan.capacity),noBus,active:active.filter(v=>v.center),alternates};
 });
 const rows=visits.filter(v=>v.start<end&&v.end>=start).map(v=>{
  const conflicts=v.center?['arrival','departure'].flatMap(event=>{const at=event==='arrival'?v.start:v.end;if(at<start||at>=end)return [];return blocks.filter(b=>at>=b.start&&at<b.end).map(b=>`${event==='arrival'?'Arrival':'Departure'} during ${b.name}`);}):[];
  const over=intervals.filter(s=>s.from<v.end&&s.to>v.start&&s.excess&&v.center);
  const alternate=plan.alternates.find(a=>a.id===v.alternateId);
  const alternateOver=intervals.some(s=>s.from<v.end&&s.to>v.start&&s.alternates.some(a=>a.id===v.alternateId&&Number.isFinite(a.capacity)&&a.count>a.capacity)&&v.diverted);
  const alternatePending=!!v.diverted&&(alternate?.approval!=='confirmed'||!Number.isFinite(alternate?.capacity));
  return {...v,conflicts:[...new Set(conflicts)],over:over.length>0,alternate,alternateOver,alternatePending};
 });
 return {plan,blocks,intervals,rows,peak:Math.max(0,...intervals.map(s=>s.count)),maxExcess:Math.max(0,...intervals.map(s=>s.excess)),restricted:rows.filter(v=>v.conflicts.length&&!v.override).length,exceptions:rows.filter(v=>v.conflicts.length&&v.override).length};
}
const visit=(id,source,name,arrival,departure,count,note='')=>({id,source,name,arrival:local(arrival),departure:local(departure),count,diverted:0,alternateId:'',override:false,reason:'',note});
export function fromGroups(result,source){
 const visits=[],gatherings=[],warnings=[];
 for(const row of result.rows){
  const bus=result.plan.groups.find(g=>g.id===row.groupId)?.buses.find(b=>b.id===row.busId),name=row.groupName+' · '+row.busName;
  if(row.issues.length)warnings.push(name+': '+row.issues.join(' '));
  if(isCenter(row.origin)&&Number.isFinite(row.departure)){
   const boarding=Math.max(1,Number(result.plan.boarding)||15);
   visits.push(visit(`${source}:${row.busId}:origin`,source,name,row.departure-boarding*MIN,row.departure,1,`Origin arrival assumes ${boarding} minutes for staging / boarding. Adjust if the bus arrives earlier.`));
  }
  row.legs.forEach((leg,i)=>{
   if(isCenter(leg.to)){const next=row.legs[i+1],departure=next?.depart>leg.arrive?next.depart:leg.arrive+15*MIN;visits.push(visit(`${source}:${row.busId}:leg${i}`,source,name,leg.arrive,departure,1,next?'Includes the full stop before the onward departure.':'Final stop assumes 15 minutes to unload, then the bus leaves. Adjust as needed.'));}
   const point=i===0?bus?.destination:bus?.secondDestination;
   if(isGathering(point))gatherings.push(gathering(local(leg.arrive),`${source}:gathering:${row.busId}:${i}`,source));
  });
 }
 return {visits,gatherings,warnings};
}
export function fromActivity(route,source){
 const summary=calculate(route,route.legs),points=routePoints(route),visits=[],gatherings=[];
 for(const row of summary.timeline){const point=points[row.stop-1],start=time(row.arrival),end=time(row.departure);
  if(isCenter(point))visits.push(visit(`${source}:${row.run}:${row.stop}`,source,`${route.name}${route.coachId?' · '+route.coachId:''} · run ${row.run}`,start,end>start?end:start+15*MIN,summary.buses,end>start?'Includes the saved stop duration.':'Zero-duration stop assumes 15 minutes on site. Adjust as needed.'));
  if(isGathering(point))gatherings.push(gathering(row.arrival,`${source}:gathering:${row.run}:${row.stop}`,source));
 }
 return {visits,gatherings,warnings:[]};
}
export function mergeSource(raw,incoming,source){
 const plan=structuredClone(raw),old=new Map(plan.visits.map(v=>[v.id,v]));
 plan.visits=plan.visits.filter(v=>v.source!==source).concat(incoming.visits.map(v=>{const prior=old.get(v.id);return prior?{...v,diverted:Math.min(v.count,prior.diverted),alternateId:prior.alternateId,override:prior.override,reason:prior.reason}:v;}));
 // Same start time represents one gathering, even when several buses attend.
 const byId=new Map(plan.gatherings.map(g=>[g.id,g]));
 for(const g of incoming.gatherings){const prior=byId.get(g.id);if(prior)continue;if(!plan.gatherings.some(p=>p.start===g.start))plan.gatherings.push(g);}
 if(incoming.visits.length)plan.date=incoming.visits[0].arrival.slice(0,10);else if(incoming.gatherings.length)plan.date=incoming.gatherings[0].start.slice(0,10);
 return plan;
}
export function encode(raw){const plan=cleanPlan(raw),centerJson=JSON.stringify(plan);if(centerJson.length>750000)throw Error('Split this plan into smaller plans before sharing.');return {recordType:TYPE,planningSubtype:SUBTYPE,centerVersion:1,planName:plan.name,centerJson};}
export function decode(record){try{if(record.recordType!==TYPE||record.planningSubtype!==SUBTYPE||record.centerVersion!==1||!Number.isInteger(record.revision)||record.revision<1)return null;return {id:record.id,revision:record.revision,plan:cleanPlan(JSON.parse(record.centerJson))};}catch{return null;}}
export function nextRevision(record,expected){if(!decode(record)||record.revision!==expected)throw Error('This shared plan changed elsewhere. Reopen its latest version or save as a new shared plan.');return expected+1;}

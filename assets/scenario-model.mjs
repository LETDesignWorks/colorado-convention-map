import {calculateSchedule,validatePlan} from '../travel-routes/model.mjs';
import {parseDenver,denverInput} from '../routes/travel-plan.mjs';
import {validPoint} from '../assignments/location-model.mjs';
import {SERVICE_DATES,cleanHostingPlan,suggestHosting,hostingReport,isApprovedMeeting} from '../assignments/hosting-model.mjs?v=scenarios-20261126-1';
export const pointKey=p=>String(p.group||p.locationType||'')+'|'+String(p.id);
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const integer=(n,label,min=0,max=10000)=>{n=Number(n);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+' must be a whole number from '+min+' to '+max+'.');return n;};
function mentions(text,items,aliasFor=()=>[]){
 const hay=' '+norm(text)+' ',found=[];
 for(const p of items){for(const alias of new Set([p.name,...aliasFor(p)].map(norm).filter(a=>a.length>2))){
  const needle=' '+alias+' ';let at=hay.indexOf(needle);
  while(at>=0){found.push({point:p,start:at,end:at+needle.length-1,alias});at=hay.indexOf(needle,at+1);}
 }}
 const selected=[];for(const m of found.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start)){if(!selected.some(x=>m.start<x.end&&m.end>x.start))selected.push(m);}
 return selected.sort((a,b)=>a.start-b.start);
}
export function parseScenario(text,{locations=[],congregations=[]}={}){
 text=String(text||'').trim();if(!text||text.length>6000)throw Error('Enter a scenario, up to 6,000 characters.');
 const warnings=[],locationMentions=mentions(text,locations,p=>p.id==='ccc'?['CCC','convention center','Colorado Convention Center']:p.id==='dtc'?['DTC','tech center','Denver Tech Center']:[]);
 const hay=' '+norm(text)+' ',from=locationMentions.findIndex(m=>/\b(from|starting at|start at)\s*$/.test(hay.slice(0,m.start+1)));
 if(from>0)locationMentions.unshift(...locationMentions.splice(from,1));
 const congs=mentions(text,congregations),dates=[];
 for(const m of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g))dates.push(m[1]);
 for(const m of text.matchAll(/\b(May|June)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|through|to)\s*(\d{1,2}))?(?:\s*,?\s*(2027))?\b/gi)){
  const month=m[1].toLowerCase()==='may'?'05':'06',first=Number(m[2]),last=Number(m[3]||m[2]);
  if(last<first||last-first>10){warnings.push('Choose the intended date range below.');continue;}
  for(let day=first;day<=last;day++)dates.push(`2027-${month}-${String(day).padStart(2,'0')}`);
 }
 const uniqueDates=[...new Set(dates)];for(const date of uniqueDates){try{parseDenver(date+'T12:00');}catch{warnings.push('Invalid date: '+date);}}
 const times=[...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi)].map(m=>{
  let hour=Number(m[1]??m[4]),minutes=Number(m[2]??m[5]??0);if(m[3]){if(hour<1||hour>12)return null;hour=hour%12+(/^p/i.test(m[3])?12:0);}if(hour>23||minutes>59)return null;
  return {value:String(hour).padStart(2,'0')+':'+String(minutes).padStart(2,'0'),before:text.slice(Math.max(0,m.index-55),m.index),index:m.index};
 }).filter(Boolean);
 const arrival=times.find(t=>/\b(arrive|arrival|there|reach|ready|start)(?:\s+\w+){0,4}\s*(?:by|at)?\s*$/i.test(t.before));
 const time=(arrival||times[0])?.value||'',timing=arrival?'arrive':'depart';
 if(times.length>1)warnings.push('Multiple times were mentioned. Check the main time and set each stop’s critical start time below.');
 if(!uniqueDates.length)warnings.push('No calendar date recognized. Choose the date below.');
 if(/\b(not|except|avoid|exclude|without|wheelchair|accessible|capacity|cheapest|cost|tolls|highway)\b/i.test(text))warnings.push('Special restrictions or exclusions need manual review. Only the fields below are enforced; check these requirements before using a suggestion.');
 const count=(pattern)=>{const m=text.match(pattern);return m?Number(m[1]):null;};
 const total=count(/\b(\d+)\s*(?:total\s+)?(?:delegates|passengers|people)\b/i);
 const dtc=count(/\b(\d+)\s*(?:delegates\s*)?(?:from\s+|in\s+|at\s+|near\s+)?(?:the\s+)?DTC\b/i)??count(/\bDTC\s*[:=]\s*(\d+)/i);
 const buses=count(/\b(\d+)\s*bus(?:es|ses)?\b/i)??1;
 const stagger=count(/\b(?:stagger(?:ed)?(?:\s+(?:by|every))?|every)\s+(\d+)\s*(?:min|minute)/i)??0;
 const stay=text.match(/\b(?:stay|spend|duration(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)/i);
 const policy=/local\s+only|only\s+local/i.test(text)?'local-only':/visiting\s+first|farther.{0,20}first/i.test(text)?'visiting-first':'local-first';
 const mode=/\b(train|rail|light rail)\b/i.test(text)?'rail':/\b(car|cars|drive)\b/i.test(text)&&!/\bbus/i.test(text)?'car':/\bwalk(?:ing)?\b/i.test(text)&&!/\bbus/i.test(text)?'walk':'bus';
 if(locationMentions.length>4)warnings.push('More than four location mentions were found. This comparison handles up to four stops; review the stops below.');
 return {text,pointKeys:locationMentions.map(m=>pointKey(m.point)),congregationIds:[...new Set(congs.map(m=>String(m.point.id)))],dates:uniqueDates,time,timing,total,dtc,buses,stagger,policy,mode,dwell:stay?Number(stay[1])*(/^h/i.test(stay[2])?60:1):0,capacity:count(/\b(\d+)\s*(?:delegates\s*)?per\s*(?:host|congregation)/i),warnings};
}
function permutations(items){return items.length<2?[items]:items.flatMap((p,i)=>permutations(items.filter((_,j)=>i!==j)).map(rest=>[p,...rest]));}
export async function compareTravelScenarios(plan,{router,reorder=false,windowMinutes=0,traffic=false,buses=1,stagger=0,signal,onProgress=()=>{}}={}){
 validatePlan(plan);buses=integer(buses,'Buses',1,20);stagger=integer(stagger,'Departure spacing',0,180);windowMinutes=integer(windowMinutes,'Time window',0,60);
 if(!['arrive','depart'].includes(plan.timing))throw Error('Choose departure or arrival timing.');
 const alternatives=reorder?permutations(plan.stops.slice(1,-1)).map(middle=>[plan.stops[0],...middle,plan.stops.at(-1)]):[plan.stops];
 const offsets=[0];if(traffic||plan.stops.some(p=>p.mode==='rail'))for(let n=15;n<=windowMinutes;n+=15){offsets.push(-n);if(plan.timing==='depart')offsets.push(n);}
 const candidates=[];for(const stops of alternatives)for(const offset of offsets)candidates.push({...structuredClone(plan),stops:structuredClone(stops),time:denverInput(new Date(+parseDenver(plan.time)+offset*60000))});
 const results=[];let done=0;
 for(const candidate of candidates){signal?.throwIfAborted();try{
  const schedule=await calculateSchedule(candidate,router);signal?.throwIfAborted();results.push({plan:candidate,schedule,error:''});
 }catch(e){signal?.throwIfAborted();results.push({plan:candidate,schedule:null,error:e.message});}onProgress(++done,candidates.length);}
 const feasible=results.filter(r=>r.schedule&&!r.schedule.conflicts.length).sort((a,b)=>a.schedule.minutes-b.schedule.minutes||Math.abs(+parseDenver(a.plan.time)-+parseDenver(plan.time))-Math.abs(+parseDenver(b.plan.time)-+parseDenver(plan.time)));
 const best=feasible[0]||null,fleet=[];
 if(best){for(let i=0;i<buses;i++){
  signal?.throwIfAborted();const candidate=structuredClone(best.plan);
  // For an arrival deadline, stagger earlier so no bus is deliberately scheduled after it.
  const delta=plan.timing==='arrive'?-(buses-1-i)*stagger:i*stagger;
  candidate.time=denverInput(new Date(+parseDenver(best.plan.time)+delta*60000));candidate.vehicle=buses>1?(candidate.stops[0].mode==='bus'?'Bus ':'Group ')+(i+1):candidate.vehicle;
  try{const schedule=delta===0?best.schedule:await calculateSchedule(candidate,router);signal?.throwIfAborted();fleet.push({plan:candidate,schedule,error:''});}catch(e){signal?.throwIfAborted();fleet.push({plan:candidate,schedule:null,error:e.message});}
  onProgress(candidates.length+i+1,candidates.length+buses);
 }}
 return {best,results,fleet,traffic,scope:`Compared ${candidates.length} itinerary/time combinations for one vehicle/group. ${buses>1?'The chosen itinerary is then checked for each bus; this is not a fleet-wide optimization. ':''}${!traffic?'Road baselines do not reflect rush-hour traffic. ':''}Coach access and pickup entrances still need confirmation.`};
}
export async function compareCongregationScenarios({data,congregationIds,meetingIds=[],limitMinutes=80,together=false},{driveTo,signal,onProgress=()=>{}}){
 if(!data.ready)throw Error('Wait for current congregation addresses and meeting approvals.');limitMinutes=integer(limitMinutes,'Maximum driving minutes',1,480);
 const requested=new Set(congregationIds),selected=data.congregations.filter(c=>requested.has(String(c.id)));
 if(!selected.length)throw Error('Choose at least one congregation.');
 const missing=selected.filter(c=>!validPoint(c.home?.point?.lat,c.home?.point?.lng)||c.home?.status==='review'),valid=selected.filter(c=>!missing.includes(c));
 const points=data.locations.filter(p=>isApprovedMeeting(p)&&(!meetingIds.length||meetingIds.includes(String(p.id))));
 if(!points.length)throw Error('Choose a currently approved meeting location with a map pin.');
 if(!valid.length)throw Error('The selected congregations need confirmed address pins.');
 const rows=[];let done=0,cursor=0;
 async function worker(){while(cursor<points.length){signal?.throwIfAborted();const point=points[cursor++];let values;
  try{values=await driveTo(valid,point);}catch{signal?.throwIfAborted();values=valid.map(()=>({seconds:null}));}
  signal?.throwIfAborted();rows.push({point,drives:valid.map((c,i)=>({congregation:c,seconds:Number.isFinite(values[i]?.seconds)?values[i].seconds:null}))});onProgress(++done,points.length);
 }}
 await Promise.all(Array.from({length:Math.min(2,points.length)},worker));
 const assignments=[],unmatched=missing.map(c=>({congregation:c,reason:'Add or confirm the congregation address pin.'}));
 if(together){
  const choices=rows.filter(r=>r.drives.every(d=>d.seconds!==null&&d.seconds<=limitMinutes*60)).sort((a,b)=>Math.max(...a.drives.map(d=>d.seconds))-Math.max(...b.drives.map(d=>d.seconds))||a.drives.reduce((n,d)=>n+d.seconds,0)-b.drives.reduce((n,d)=>n+d.seconds,0)||a.point.name.localeCompare(b.point.name));
  if(missing.length||!choices.length)valid.forEach(c=>unmatched.push({congregation:c,reason:missing.length?'A congregation in this group still needs an address.':'No evaluated meeting point has a known drive within the limit for the whole group.'}));
  else choices[0].drives.forEach(d=>assignments.push({...d,point:choices[0].point}));
 }else for(const c of valid){
  const choices=rows.map(r=>({point:r.point,...r.drives.find(d=>d.congregation.id===c.id)})).filter(d=>d.seconds!==null&&d.seconds<=limitMinutes*60).sort((a,b)=>a.seconds-b.seconds||a.point.name.localeCompare(b.point.name));
  if(choices.length)assignments.push(choices[0]);else unmatched.push({congregation:c,reason:'No known drive within the limit; check unavailable routes or adjust the limit.'});
 }
 return {assignments,unmatched,limitMinutes,unknown:rows.reduce((n,r)=>n+r.drives.filter(d=>d.seconds===null).length,0),meetings:points.length,scope:together?'Best evaluated group meeting minimizes the longest congregation drive.':'Each congregation gets its quickest evaluated road-baseline drive. These are car-road baselines without time-of-day traffic.'};
}
export function draftHostingScenario({plan,data,dates,total,dtc=0,policy='local-first',capacity,congregationIds=[],meetingIds=[]}){
 if(!data.ready)throw Error('Wait for current congregation addresses and meeting approvals.');
 total=integer(total,'Daily delegates');dtc=integer(dtc,'DTC delegates');if(dtc>total)throw Error('DTC delegates are part of the total, so they cannot exceed it.');
 if(!dates.length||dates.some(d=>!SERVICE_DATES.includes(d)))throw Error('Choose service dates May 23–27, May 31 or June 1, 2027.');
 if(!['local-first','local-only','visiting-first'].includes(policy))throw Error('Choose a hosting preference.');
 const next=cleanHostingPlan(structuredClone(plan));if(capacity!==''&&capacity!=null)next.hostCapacity=integer(capacity,'Delegates per host',1);
 const additions=[],remaining=[];
 for(const date of [...new Set(dates)]){Object.assign(next.days.find(d=>d.date===date),{total,dtc,policy});
  const suggestion=suggestHosting(next,data,date,{congregationIds:congregationIds.length?congregationIds:null,meetingPointIds:meetingIds.length?meetingIds:null});
  const slots=suggestion.slots.map(s=>({...s,id:'scenario-'+s.date+'-'+s.congregationId}));next.slots.push(...slots);additions.push(...slots);remaining.push({date,...suggestion.remaining});
 }
 return {plan:cleanHostingPlan(next),additions,remaining,report:hostingReport(next,data)};
}

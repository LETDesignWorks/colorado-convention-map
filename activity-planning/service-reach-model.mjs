import {parseDenver,validPoint,formatDenver} from '../routes/travel-plan.mjs';
import {meetingCandidates,rankMeetings} from '../travel-routes/meeting-ranking.mjs?v=activity-reach-20261115-1';
const minute=60000;
function number(value,label,max=1440){if(value===null||value===undefined||String(value).trim()==='')throw Error('Enter '+label+'.');const n=Number(value);if(!Number.isFinite(n)||n<0||n>max)throw Error(label+' must be between 0 and '+max+'.');return n;}
export const durationLabel=value=>value<60?value+' min':Math.floor(value/60)+' hr'+(value%60?' '+value%60+' min':'');
export const destinationKey=point=>(point.group==='Rail stations'||point.locationType==='rail-station'?'rail:':'meeting:')+point.id;
export function reachPlan(value){
 if(!value.origin?.name?.trim()||!validPoint(value.origin.lat,value.origin.lng))throw Error('Choose an activity with a map pin, or find its address.');
 if(!['minutes','hours'].includes(value.durationUnit))throw Error('Choose minutes or hours for the activity.');
 const duration=number(value.duration,'Activity duration',value.durationUnit==='hours'?24:1440)*(value.durationUnit==='hours'?60:1),boarding=number(value.boarding,'Boarding minutes'),allowance=number(value.allowance,'Extra travel minutes'),early=number(value.early,'Early-arrival minutes');
 const buses=number(value.buses,'Number of buses',1000);if(!Number.isInteger(buses)||buses<1)throw Error('Enter a whole number of buses from 1 to 1,000.');
 const start=+parseDenver(value.startLocal),service=+parseDenver(value.serviceLocal);if(service<=start)throw Error('The meeting for service must start after the activity starts.');
 const end=start+duration*minute,depart=end+boarding*minute,target=service-early*minute;
 return {origin:{...value.origin,lat:Number(value.origin.lat),lng:Number(value.origin.lng)},buses,start,service,end,depart,target,duration,boarding,allowance,early,driveBudget:(target-depart)/minute-allowance,includeRail:!!value.includeRail,includeUnsuitable:!!value.includeUnsuitable};
}
export async function compareServiceLocations(plan,points,{route,key='',signal,onProgress}={}){
 if(plan.driveBudget<0)throw Error('Activity time, boarding and buffers leave no time to drive before the service meeting. Start earlier, shorten the activity or choose a later meeting time.');
 const candidates=meetingCandidates(points,plan),settings={at:plan.depart,mode:'bus'};
 const ranked=await rankMeetings(candidates,{origin:plan.origin,settings,key,route,signal,onProgress});
 const rows=ranked.map(row=>{if(row.error)return {...row,status:'unknown'};const arrive=plan.depart+(row.minutes+plan.allowance)*minute,margin=(plan.target-arrive)/minute;return {...row,arrive,margin,status:margin>=0?'reachable':'late'};});
 return {plan,rows,total:rows.length,reachable:rows.filter(r=>r.status==='reachable').length,late:rows.filter(r=>r.status==='late').length,unknown:rows.filter(r=>r.status==='unknown').length,traffic:!!key};
}
export function fleetSelection(result,keys=null){
 const available=result.rows.filter(r=>r.status==='reachable'),chosen=keys===null?available.slice(0,result.plan.buses).map(r=>destinationKey(r.point)):[...keys];
 if(new Set(chosen).size!==chosen.length||chosen.length>result.plan.buses||chosen.some(key=>!available.some(r=>destinationKey(r.point)===key)))throw Error('Choose at most one reachable meeting location per bus.');
 const selected=available.filter(r=>chosen.includes(destinationKey(r.point)));return {selected,keys:selected.map(r=>destinationKey(r.point)),capacity:Math.min(result.plan.buses,available.length),unused:result.plan.buses-selected.length};
}
export function reachSheets(result,keys=null){const {plan,rows}=result,fleet=fleetSelection(result,keys);return [
 {name:'Bus destinations',headers:['Bus','Meeting for service','Address','Drive minutes','Estimated arrival - Denver','Service meeting starts - Denver'],widths:[12,44,50,20,45,45],rows:fleet.selected.map((r,i)=>[i+1,r.point.name,r.point.address||'',r.minutes,formatDenver(r.arrive),formatDenver(plan.service)])},
 {name:'Meeting options',headers:['Result','Meeting for service','Address','Bus drive minutes','Road miles','Estimated bus arrival - Denver','Minutes before arrival target','Suitability','Estimate / issue'],widths:[22,42,48,20,15,45,30,24,75],rows:rows.map(r=>[r.status==='reachable'?'Can arrive in time':r.status==='late'?'Past arrival target':'Not checked',r.point.name,r.point.address||'',r.error?'':r.minutes,r.error?'':Math.round(r.miles*10)/10,r.error?'':formatDenver(r.arrive),r.error?'':Math.round(r.margin),r.point.busStatus||'not-reviewed',r.error||r.label||''])},
 {name:'Timing assumptions',headers:['Item','Value'],widths:[36,100],rows:[['Activity',plan.origin.name],['Activity address',plan.origin.address||''],['Activity starts',formatDenver(plan.start)],['Activity minutes',plan.duration],['Activity ends',formatDenver(plan.end)],['Boarding minutes',plan.boarding],['Bus departs',formatDenver(plan.depart)],['Extra travel minutes per trip',plan.allowance],['Meeting for service starts',formatDenver(plan.service)],['Early-arrival minutes',plan.early],['Arrival target',formatDenver(plan.target)],['Buses available',plan.buses],['Locations selected',fleet.selected.length],['Buses without a selected destination',fleet.unused],['Maximum locations that can be served',fleet.capacity],['Can arrive in time',result.reachable],['Past arrival target',result.late],['Could not be checked',result.unknown],['Traffic',result.traffic?'TomTom time-dependent bus estimates':'Road baselines without time-of-day traffic'],['Meaning','One bus per selected meeting location, all leaving the same activity. Each row is a separate direct bus trip, not consecutive stops on one route. Bus numbers identify planning choices, not reserved vehicles.'],['Review','Confirm bus access, loading arrangements and traffic before travel. Recalculate after changing activity or meeting times.']]}
 ];}

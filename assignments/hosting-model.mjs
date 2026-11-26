import {distanceMiles,validPoint} from './location-model.mjs';
export const HOSTING_TYPE='congregation-hosting-plan';
export const CONVENTION={start:'2027-05-28',end:'2027-05-30'};
export const SERVICE_DATES=['2027-05-23','2027-05-24','2027-05-25','2027-05-26','2027-05-27','2027-05-31','2027-06-01'];
export const POLICIES={'local-first':'Local congregations first','visiting-first':'Available visiting congregations first','local-only':'Local congregations only'};
export const dateLabel=date=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'));
const text=(v,max)=>String(v??'').trim().slice(0,max);
const identifier=v=>{const id=text(v,120);if(!/^[-\w]{1,120}$/.test(id))throw Error('Invalid planning identifier.');return id;};
const count=(v,label,max=100000)=>{if(v===null||String(v??'').trim()==='')throw Error('Enter '+label+'.');const n=Number(v);if(!Number.isInteger(n)||n<0||n>max)throw Error(label+' must be a whole number from 0 to '+max+'.');return n;};
const numeric=(v,label,max)=>{const n=Number(v);if(v===null||String(v??'').trim()===''||!Number.isFinite(n)||n<=0||n>max)throw Error(label+' must be greater than 0 and no more than '+max+'.');return n;};
export const isApprovedMeeting=point=>point?.busStatus==='approved'&&validPoint(point.lat,point.lng);
export function defaultHostingPlan(){return {version:1,name:'2027 Field service hosting',localMiles:25,hostCapacity:50,meetingCapacity:50,days:SERVICE_DATES.map((date,i)=>({date,total:null,dtc:0,policy:i>=5?'local-only':i>=2?'visiting-first':'local-first'})),profiles:[],meetingLimits:[],slots:[]};}
export function cleanHostingPlan(value){
 if(!value||value.version!==1)throw Error('This is not a supported daily hosting plan.');
 const seen=new Set(),days=SERVICE_DATES.map(date=>{const d=value.days?.find(d=>d.date===date)||{};return {date,total:d.total==null||d.total===''?null:count(d.total,'Daily delegates'),dtc:count(d.dtc??0,'DTC delegates'),policy:POLICIES[d.policy]?d.policy:defaultHostingPlan().days.find(d=>d.date===date).policy};});
 const profiles=(value.profiles||[]).map(p=>{const id=identifier(p.id);if(seen.has(id))throw Error('Each congregation needs only one availability profile.');seen.add(id);if(p.dates!==null&&(!Array.isArray(p.dates)||p.dates.some(d=>!SERVICE_DATES.includes(d))))throw Error('Choose service dates outside the convention.');return {id,kind:['local','visiting'].includes(p.kind)?p.kind:'auto',dates:p.dates===null?null:SERVICE_DATES.filter(d=>p.dates.includes(d)),capacity:p.capacity==null||p.capacity===''?null:count(p.capacity,'Congregation host capacity'),notes:text(p.notes,500)};});
 seen.clear();const meetingLimits=(value.meetingLimits||[]).map(p=>{const id=identifier(p.id);if(seen.has(id))throw Error('Each meeting point needs only one capacity.');seen.add(id);return {id,capacity:count(p.capacity,'Meeting point capacity')};});
 seen.clear();const slots=(value.slots||[]).map(s=>{const id=identifier(s.id);if(seen.has(id))throw Error('Each hosting slot needs its own identifier.');seen.add(id);if(!SERVICE_DATES.includes(s.date))throw Error('Choose one of the seven service dates.');if(!['ccc','dtc'].includes(s.hub))throw Error('Choose the Convention Center or DTC area.');const delegates=count(s.delegates,'Delegates in a hosting slot');if(!delegates)throw Error('A hosting slot must have at least one delegate.');return {id,date:s.date,hub:s.hub,congregationId:identifier(s.congregationId),meetingPointId:identifier(s.meetingPointId),delegates};});
 if(profiles.length>2000||meetingLimits.length>1000||slots.length>5000)throw Error('Split this into a smaller hosting plan.');
 return {version:1,name:text(value.name,140)||'2027 Field service hosting',localMiles:numeric(value.localMiles,'Local radius',200),hostCapacity:count(value.hostCapacity,'Default host capacity'),meetingCapacity:count(value.meetingCapacity,'Default meeting-point capacity'),days,profiles,meetingLimits,slots};
}
const miles=(a,b)=>a&&b&&validPoint(a.lat,a.lng)&&validPoint(b.lat,b.lng)?distanceMiles(a,b):null;
export function congregationProfile(plan,c,centers){
 const p=plan.profiles.find(p=>p.id===c.id)||{id:c.id,kind:'auto',dates:null,capacity:null,notes:''};const home=c.home?.status==='review'?null:c.home?.point,fromCenter=miles(home,centers.find(p=>p.id==='ccc'));
 const kind=p.kind==='auto'?(fromCenter===null?'unknown':fromCenter<=Number(plan.localMiles)?'local':'visiting'):p.kind;
 return {...p,kind,setting:p.kind,capacity:p.capacity??Number(plan.hostCapacity),fromCenter,available:p.dates===null?(kind==='local'?[...SERVICE_DATES]:[]):p.dates,assumed:p.dates===null};
}
export const meetingCapacity=(plan,id)=>plan.meetingLimits.find(p=>p.id===id)?.capacity??Number(plan.meetingCapacity);
export function hostingReport(input,data){
 const plan=cleanHostingPlan(input),congregations=data.congregations||[],locations=data.locations||[],centers=data.centers||[];
 const profiles=new Map(congregations.map(c=>[c.id,congregationProfile(plan,c,centers)]));
 const dayIssues=new Map(plan.days.map(d=>[d.date,d.total!==null&&d.dtc>d.total?['DTC delegates cannot exceed the daily total.']:[]]));
 const rows=plan.slots.map(slot=>{
  const c=congregations.find(c=>c.id===slot.congregationId),point=locations.find(p=>String(p.id)===slot.meetingPointId),profile=profiles.get(slot.congregationId),day=plan.days.find(d=>d.date===slot.date),issues=[];
  if(!c)issues.push('Congregation is missing from the directory.');
  if(!isApprovedMeeting(point))issues.push('Meeting point is not currently approved or needs a map pin.');
  if(profile&&!profile.available.includes(slot.date))issues.push('Congregation is not available on this date.');
  if(profile&&day.policy==='local-only'&&profile.kind!=='local')issues.push('This day is set to local congregations only.');
  if(profile&&slot.delegates>profile.capacity)issues.push('Exceeds this congregation’s host capacity.');
  if(plan.slots.filter(s=>s.date===slot.date&&s.congregationId===slot.congregationId).length>1)issues.push('Congregation has more than one hosting slot this day.');
  const atMeeting=plan.slots.filter(s=>s.date===slot.date&&s.meetingPointId===slot.meetingPointId).reduce((n,s)=>n+s.delegates,0);
  if(atMeeting>meetingCapacity(plan,slot.meetingPointId))issues.push('Total delegates exceed this meeting point’s daily capacity.');
  return {...slot,congregation:c,point,profile,issues,valid:issues.length===0,hubMiles:miles(centers.find(p=>p.id===slot.hub),point)};
 });
 const days=plan.days.map(day=>{
  const dayRows=rows.filter(s=>s.date===day.date),good=dayRows.filter(s=>s.valid),planned={ccc:0,dtc:0};for(const row of good)planned[row.hub]+=row.delegates;
  const demand=day.total===null||day.dtc>day.total?{ccc:null,dtc:null}:{ccc:day.total-day.dtc,dtc:day.dtc};
  return {...day,rows:dayRows,planned,demand,shortfall:{ccc:demand.ccc===null?null:Math.max(0,demand.ccc-planned.ccc),dtc:demand.dtc===null?null:Math.max(0,demand.dtc-planned.dtc)},excess:{ccc:demand.ccc===null?null:Math.max(0,planned.ccc-demand.ccc),dtc:demand.dtc===null?null:Math.max(0,planned.dtc-demand.dtc)},issues:dayIssues.get(day.date),hosts:new Set(good.map(r=>r.congregationId)).size};
 });
 const hosted=new Set(rows.filter(r=>r.valid).map(r=>r.congregationId));
 return {plan,rows,days,profiles,totalCongregations:congregations.length,hostedCount:hosted.size,unplanned:congregations.filter(c=>!hosted.has(c.id)),approvalProblems:rows.filter(r=>!isApprovedMeeting(r.point)).length,approved:locations.filter(isApprovedMeeting)};
}
export function suggestHosting(input,data,date,{congregationIds=null,meetingPointIds=null}={}){
 const report=hostingReport(input,data),plan=report.plan,day=report.days.find(d=>d.date===date);if(!day)throw Error('Choose a service date.');if(day.total===null)throw Error('Enter the expected delegates for this day first.');if(day.issues.length)throw Error(day.issues.join(' '));if(day.rows.some(r=>!r.valid))throw Error('Resolve or remove the flagged hosting slots before adding suggestions.');
 const taken=new Set(day.rows.map(r=>r.congregationId)),used=new Map(),previous=new Map();for(const s of plan.slots){previous.set(s.congregationId,(previous.get(s.congregationId)||0)+1);if(s.date===date)used.set(s.meetingPointId,(used.get(s.meetingPointId)||0)+s.delegates);}
 const suggested=[];const remaining={...day.shortfall};
 // Reserve nearby places for DTC demand first; both areas share venue capacity.
 for(const hub of ['dtc','ccc']){
  const center=data.centers.find(p=>p.id===hub);if(!center)throw Error('Starting center could not load.');
  while(remaining[hub]>0){
   const candidates=[];
   for(const c of data.congregations){const p=report.profiles.get(c.id);if(congregationIds&&!congregationIds.includes(String(c.id)))continue;if(taken.has(c.id)||!p.available.includes(date)||!p.capacity||p.kind==='unknown'||(day.policy==='local-only'&&p.kind!=='local'))continue;
    for(const point of report.approved){if(meetingPointIds&&!meetingPointIds.includes(String(point.id)))continue;const room=meetingCapacity(plan,String(point.id))-(used.get(String(point.id))||0);if(room<=0)continue;
     const hubMiles=miles(center,point),homeMiles=p.kind==='local'?miles(c.home?.point,point):0;if(hubMiles===null||homeMiles===null)continue;
     const preferred=day.policy==='visiting-first'?p.kind==='visiting':p.kind==='local';
     const current=data.assignments?.find(a=>a.congregationId===c.id)?.meetingPointId;
     const score=(preferred?0:1000)+(previous.get(c.id)||0)*100+hubMiles*3+homeMiles+(String(current)===String(point.id)?-3:0);
     candidates.push({c,point,p,room,hubMiles,score});
    }
   }
   candidates.sort((a,b)=>a.score-b.score||a.c.name.localeCompare(b.c.name)||String(a.point.id).localeCompare(String(b.point.id)));const best=candidates[0];if(!best)break;
   const delegates=Math.min(remaining[hub],best.p.capacity,best.room),meetingPointId=String(best.point.id);suggested.push({id:'suggested-'+date+'-'+best.c.id,date,hub,congregationId:best.c.id,meetingPointId,delegates,reason:(best.p.kind==='local'?'Local host':'Visiting host available in Denver')+' · '+(previous.has(best.c.id)?'already has another hosting day':'not yet scheduled to host')+' · '+best.hubMiles.toFixed(1)+' straight-line miles from '+(hub==='dtc'?'DTC':'Convention Center')});
   taken.add(best.c.id);used.set(meetingPointId,(used.get(meetingPointId)||0)+delegates);remaining[hub]-=delegates;
  }
 }
 return {slots:suggested,remaining};
}
export function hostingPayload(input){const plan=cleanHostingPlan(input),planJson=JSON.stringify(plan);if(new TextEncoder().encode(planJson).length>850000)throw Error('This plan is too large to share. Export it and make a smaller plan.');return {recordType:HOSTING_TYPE,schemaVersion:1,planName:plan.name,planJson};}
export function readHostingRecord(record){try{if(record?.recordType!==HOSTING_TYPE||record.schemaVersion!==1||!Number.isInteger(record.revision)||record.revision<1)return null;return {id:record.id,revision:record.revision,plan:cleanHostingPlan(JSON.parse(record.planJson))};}catch{return null;}}
export function hostingRevision(record,expected){if(!readHostingRecord(record)||record.revision!==expected)throw Error('This shared plan changed elsewhere. Load its latest version or save your draft as a new plan.');return expected+1;}
export function hostingSheets(input,data){const report=hostingReport(input,data),dash=v=>v??'Not entered';return [
 {name:'Daily delegate coverage',headers:['Date','Day','Hosting preference','Expected delegates','DTC delegates','Other Denver delegates','DTC planned','Denver planned','DTC still needed','Denver still needed','DTC excess','Denver excess','Host congregations','Issues'],widths:[18,24,38,24,22,25,22,22,25,25,22,22,24,70],rows:report.days.map(d=>[d.date,dateLabel(d.date),POLICIES[d.policy],dash(d.total),d.dtc,dash(d.demand.ccc),d.planned.dtc,d.planned.ccc,dash(d.shortfall.dtc),dash(d.shortfall.ccc),d.excess.dtc??'',d.excess.ccc??'',d.hosts,[...d.issues,...d.rows.flatMap(r=>r.issues)].join(' ')])},
 {name:'By meeting and day',headers:['Date','Meeting for service','Meeting address','Congregation','Delegate pickup area','Delegates','Host type','Approx miles from pickup area','Status'],widths:[18,40,50,44,30,18,20,30,95],rows:[...report.rows].sort((a,b)=>a.date.localeCompare(b.date)||(a.point?.name||'').localeCompare(b.point?.name||'')).map(r=>[r.date,r.point?.name||r.meetingPointId,r.point?.address||'',r.congregation?.name||r.congregationId,r.hub==='dtc'?'DTC hotels / center':'Convention Center / Denver',r.delegates,r.profile?.kind||'',r.hubMiles===null?'Unknown':Math.round(r.hubMiles*10)/10,r.issues.join(' ')||'Planned'])},
 {name:'Congregation availability',headers:['Congregation','Home address','Host type','Local classification','Available service dates','Availability basis','Host capacity','Valid hosting days','Notes'],widths:[44,55,20,25,85,50,20,50,70],rows:data.congregations.map(c=>{const p=report.profiles.get(c.id);return [c.name,c.home?.address||'',p.kind,p.setting,p.available.join(', '),p.assumed?(p.kind==='local'?'Assumed local availability — confirm':'Dates needed'):'Dates entered by planner',p.capacity,report.rows.filter(r=>r.valid&&r.congregationId===c.id).map(r=>r.date).join(', '),p.notes];})},
 {name:'Planning assumptions',headers:['Item','Value'],widths:[40,120],rows:[['Convention','May 28–30, 2027'],['Service dates',SERVICE_DATES.join(', ')],['Daily delegate counts','DTC delegates are part of the daily total; other Denver demand is the remainder. Blank totals mean not entered.'],['Default delegates per congregation',report.plan.hostCapacity],['Default delegates per meeting point / day',report.plan.meetingCapacity],['Local radius',report.plan.localMiles+' straight-line miles from the Colorado Convention Center; individual classification can be changed.'],['Locations','Only locations currently marked approved with a usable map pin count toward coverage.'],['Distance','Straight-line miles are used for suggestions, not driving times. Check actual routes in Travel Routes.'],['Participation','All congregations remain involved in ministry. This plan tracks hosting delegates on specific dates. Existing map assignments and weekday records are separate.'],['Availability','Local dates are assumed until edited; visiting congregations need their dates in Denver entered. Confirm dates with each congregation.'],['Suggestions','DTC demand is matched first, then other Denver demand. Preferences, host rotation and proximity affect suggestions. Review before adding them.'],['Meeting capacities','Capacity is shared across both delegate pickup areas and all congregations at the same meeting point on the same day.']]}];}

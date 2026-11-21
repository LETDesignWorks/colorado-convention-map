import {mergeContactUpdates} from './contact-tools.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
const time=x=>Date.parse(x)||0;
const norm=x=>String(x).trim().toLowerCase().replace(/\s+/g,' ');
const append=(a,b)=>!b||a?.includes(b)?a||'':[a,b].filter(Boolean).join('\n\n');
export function mergePlanUpdates(target,source){
 if(target.id!==source.id)throw Error('These updates belong to another tracker.');
 const result={...mergeContactUpdates(target,source),participants:0,arrangements:0,meeting:0};
 for(const incoming of source.people){
  if(!time(incoming.updatedAt)||!target.congregations.some(c=>c.id===incoming.congregationId))continue;
  const sameId=target.people.find(p=>p.id===incoming.id);
  if(sameId&&sameId.congregationId!==incoming.congregationId)throw Error('A participant ID belongs to another congregation.');
  const p=sameId||target.people.find(p=>p.congregationId===incoming.congregationId&&norm(p.name)===norm(incoming.name));
  if(!p){target.people.push(copy(incoming));result.participants++;}
  else if(time(incoming.updatedAt)>time(p.updatedAt)){
   if(!time(p.updatedAt)){let changed=false;for(const k of ['phone','email','notes'])if(!p[k]&&incoming[k]){p[k]=incoming[k];changed=true;}if(changed)result.participants++;}
   else {const id=p.id;Object.assign(p,copy(incoming),{id});result.participants++;}
  }
 }
 for(const incoming of source.congregations){
  const c=target.congregations.find(c=>c.id===incoming.id);if(!c)continue;
  if(incoming.submittedPlan&&time(incoming.contactUpdatedAt)>=time(c.contactUpdatedAt))c.submittedPlan=copy(incoming.submittedPlan);
  if(time(incoming.rosterUpdatedAt)>time(c.rosterUpdatedAt)){
   if(c.confirmed===null||(time(c.confirmedUpdatedAt)&&time(incoming.confirmedUpdatedAt)>time(c.confirmedUpdatedAt))){c.confirmed=incoming.confirmed;c.confirmedUpdatedAt=incoming.confirmedUpdatedAt;}
   c.rosterUpdatedAt=incoming.rosterUpdatedAt;
  }
 }
 for(const incoming of source.pairs){
  const p=target.pairs.find(p=>p.id===incoming.id);if(!p||time(incoming.arrangementsUpdatedAt)<=time(p.arrangementsUpdatedAt))continue;
  const changes=incoming.arrangementUpdates;if(!changes)continue;
  for(const k of ['meetingEndTime','serviceEndTime','hospitality','hospitalityAddress'])if(typeof changes[k]==='string')p[k]=changes[k];
  p.notes=append(p.notes,changes.notes);p.arrangementUpdates=copy(changes);p.arrangementsUpdatedAt=incoming.arrangementsUpdatedAt;result.arrangements++;
 }
 if(source.reviewMeeting&&time(source.reviewMeeting.updatedAt)>time(target.reviewMeeting?.updatedAt)){
  target.reviewMeeting=copy(source.reviewMeeting);result.meeting++;
  const incoming=source.tasks.find(t=>t.id===source.reviewMeeting.taskId),t=target.tasks.find(t=>t.id===source.reviewMeeting.taskId);
  if(t&&incoming){t.title=incoming.title;t.notes=append(t.notes,incoming.notes);t.sourceUpdatedAt=incoming.sourceUpdatedAt;}
  target.notices=target.notices.map(n=>n.replace('The feedback meeting on December 7 has no confirmed time.','The December 7 post-test meeting details are confirmed in Deadlines and Messages.'));
 }
 for(const d of source.documents)if(!target.documents.some(x=>x.url===d.url))target.documents.push(copy(d));
 return result;
}


import {syncLegacyAssistant} from './contact-tools.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
const norm=x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' ');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const labels={name:'Name',contact:'Main contact',phone:'Phone',email:'Email',alternateEmail:'Alternate email',contactRole:'Contact responsibility',contactLanguages:'Languages',contactNotes:'Contact notes',confirmed:'Confirmed volunteers',homeAddress:'Departure address',rally:'Rally location',rallyAddress:'Rally address',rallyTime:'Rally time',notes:'Notes',lc:'Lead contact',role:'Role',target:'Assigned volunteer goal',date:'Test day',hostId:'Host congregation',delegateId:'Delegate congregation',territoryId:'Territory congregation',hostCount:'Host allocation',delegateCount:'Delegate allocation',meeting:'Meeting place',meetingAddress:'Meeting address',hostArrival:'Host arrival',delegateArrival:'Delegate arrival',meetingTime:'Service meeting',meetingEndTime:'Meeting ends',departureTime:'Depart for territory',serviceEndTime:'Service ends',lunchTime:'Lunch time',hospitality:'Hospitality plan',hospitalityAddress:'Hospitality address',transport:'Transport',counts:'Counts toward volunteers',languages:'Languages',title:'Task',due:'Due date',owner:'Responsible lead contact',time:'Time',timeZone:'Time zone',url:'Link',audience:'Who attends'};
const fields={
 congregations:['name','contact','phone','email','alternateEmail','contactRole','contactLanguages','contactNotes','confirmed','homeAddress','rally','rallyAddress','rallyTime','notes','lc','role','target','date'],
 pairs:['date','hostId','delegateId','territoryId','hostCount','delegateCount','meeting','meetingAddress','hostArrival','delegateArrival','meetingTime','meetingEndTime','departureTime','serviceEndTime','lunchTime','hospitality','hospitalityAddress','transport','notes'],
 people:['name','phone','email','counts','notes'],assistants:['name','role','phone','email','alternateEmail','languages','notes'],
 territories:['contact','phone','email'],tasks:['title','owner','due'],reviewMeeting:['date','time','timeZone','url','audience'],documents:['name']
};
const removalKeys=(kind,cid,p)=>[JSON.stringify([kind,cid,p.id]),JSON.stringify([kind+'-name',cid,norm(p.name)])];
export function rememberRemovedRecords(before,after){
 const removed=new Set(after.uploadProtection?.deleted||[]);
 for(const p of before.people)if(!after.people.some(x=>x.id===p.id))removalKeys('person',p.congregationId,p).forEach(k=>removed.add(k));
 for(const c of before.congregations)for(const a of c.assistants||[])if(!after.congregations.find(x=>x.id===c.id)?.assistants.some(x=>x.id===a.id))removalKeys('assistant',c.id,a).forEach(k=>removed.add(k));
 if(removed.size)after.uploadProtection={deleted:[...removed]};
}
export function previewPlanUpdates(target,source){
 if(target.id!==source.id)throw Error('This file belongs to another tracker.');
 const changes=[],skipped=[],deleted=new Set(target.uploadProtection?.deleted||[]);
 const congregationName=id=>target.congregations.find(c=>c.id===id)?.name||source.congregations.find(c=>c.id===id)?.name||'Congregation';
 const display=(value,field)=>['hostId','delegateId','territoryId'].includes(field)?congregationName(value):value===undefined?'Not provided':value===null||value===''?'Blank':typeof value==='boolean'?(value?'Yes':'No'):String(value);
 const add=(collection,id,parentId,label,value)=>{const parts=collection==='people'||collection==='assistants'?[value.name,value.phone,value.email,value.alternateEmail,value.notes]:collection==='congregations'?[value.name,value.role,value.lc,value.contact,value.phone,value.email]:collection==='pairs'?[congregationName(value.hostId)+' + '+congregationName(value.delegateId),value.date,value.meeting,value.meetingAddress]:collection==='territories'?[value.contact,value.phone,value.email]:collection==='tasks'?[value.title,value.due,value.owner]:collection==='documents'?[value.name,value.url]:[value.date,value.time,value.audience,value.url];changes.push({key:'update-'+changes.length,type:'addition',collection,id,parentId,label,field:'New record',after:copy(value),afterText:parts.filter(x=>x!==undefined&&x!=='').join('\n'),beforeText:'Not in current tracker',selected:true});};
 const diff=(collection,id,parentId,label,current,incoming)=>{for(const field of fields[collection])if(Object.hasOwn(incoming,field)&&incoming[field]!==undefined&&!same(current[field],incoming[field]))changes.push({key:'update-'+changes.length,type:'change',collection,id,parentId,label,field,fieldLabel:labels[field]||field,before:current[field],after:copy(incoming[field]),beforeText:display(current[field],field),afterText:display(incoming[field],field),selected:false});};
 for(const c of source.congregations){const current=target.congregations.find(x=>x.id===c.id);if(!current){add('congregations',c.id,'','Congregation: '+c.name,c);continue;}diff('congregations',c.id,'','Congregation: '+current.name,current,c);
  for(const a of c.assistants){const existing=current.assistants.find(x=>x.id===a.id||norm(x.name)===norm(a.name));if(existing)diff('assistants',existing.id,c.id,c.name+' - '+existing.name,existing,a);else if(removalKeys('assistant',c.id,a).some(k=>deleted.has(k)))skipped.push(c.name+' - '+a.name);else add('assistants',a.id,c.id,c.name+' - additional contact',a);}
 }
 for(const p of source.pairs){const current=target.pairs.find(x=>x.id===p.id),label=congregationName(p.hostId)+' + '+congregationName(p.delegateId);if(current)diff('pairs',p.id,'',label,current,p);else add('pairs',p.id,'',label,p);}
 for(const [id,t] of Object.entries(source.territories)){const current=target.territories[id],label=congregationName(id.split('__')[1])+' - territory preparation';if(current)diff('territories',id,'',label,current,t);else add('territories',id,'',label,t);}
 for(const p of source.people){const sameId=target.people.find(x=>x.id===p.id);if(sameId&&sameId.congregationId!==p.congregationId)throw Error('A participant ID belongs to another congregation.');const current=sameId||target.people.find(x=>x.congregationId===p.congregationId&&norm(x.name)===norm(p.name));const label=congregationName(p.congregationId)+' - '+p.name;if(current)diff('people',current.id,'',label,current,p);else if(removalKeys('person',p.congregationId,p).some(k=>deleted.has(k)))skipped.push(label);else add('people',p.id,'',label,p);}
 for(const t of source.tasks){const current=target.tasks.find(x=>x.id===t.id);if(current)diff('tasks',t.id,'',t.title,current,t);else add('tasks',t.id,'',t.title,t);}
 for(const d of source.documents){const current=target.documents.find(x=>x.url===d.url);if(current)diff('documents',d.url,'','Reference document',current,d);else add('documents',d.url,'','Reference document',d);}
 if(source.reviewMeeting){if(target.reviewMeeting)diff('reviewMeeting','review','','Post-test meeting',target.reviewMeeting,source.reviewMeeting);else add('reviewMeeting','review','','Post-test meeting',source.reviewMeeting);}
 return {changes,skipped};
}
export function applyPlanUpdates(target,source,selectedKeys){
 const preview=previewPlanUpdates(target,source),selected=new Set(selectedKeys),validKeys=new Set(preview.changes.map(c=>c.key));
 if([...selected].some(k=>!validKeys.has(k)))throw Error('The upload preview changed. Review the file again.');
 const result={added:0,changed:0,kept:0,skipped:preview.skipped.length};
 for(const c of preview.changes){if(!selected.has(c.key)){if(c.type==='change')result.kept++;continue;}
  if(c.type==='addition'){
   if(c.collection==='territories')target.territories[c.id]=copy(c.after);
   else if(c.collection==='reviewMeeting')target.reviewMeeting=copy(c.after);
   else if(c.collection==='assistants'){const parent=target.congregations.find(x=>x.id===c.parentId);if(!parent)throw Error('Select the new congregation before adding its contacts.');parent.assistants.push(copy(c.after));}
   else target[c.collection].push(copy(c.after));
   result.added++;
  }else{
   const record=c.collection==='territories'?target.territories[c.id]:c.collection==='reviewMeeting'?target.reviewMeeting:c.collection==='assistants'?target.congregations.find(x=>x.id===c.parentId)?.assistants.find(x=>x.id===c.id):c.collection==='documents'?target.documents.find(x=>x.url===c.id):target[c.collection].find(x=>x.id===c.id);
   if(!record)throw Error('The current record is missing. Review the file again.');record[c.field]=copy(c.after);result.changed++;
  }
 }
 for(const c of target.congregations)syncLegacyAssistant(c);
 return result;
}

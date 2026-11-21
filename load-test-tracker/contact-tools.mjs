export function normalizeContacts(c) {
  for(const k of ['alternateEmail','contactRole','contactLanguages','contactNotes','contactSource','contactUpdatedAt'])c[k]??='';
  c.contactLocked??=false;
  c.assistants??=c.assistant?[{id:'primary',name:c.assistant,role:'Assistant contact',phone:c.assistantPhone||'',email:c.assistantEmail||'',alternateEmail:'',languages:'',notes:''}]:[];
  return c;
}
export function syncLegacyAssistant(c){const a=c.assistants?.[0];c.assistant=a?.name||'';c.assistantPhone=a?.phone||'';c.assistantEmail=a?.email||'';}
const contactKeys=['contact','phone','email','alternateEmail','contactRole','contactLanguages','contactNotes','contactSource','contactUpdatedAt','contactLocked','contactConfirmed'];
export function mergeContactUpdates(target,source){let main=0,assistants=0;for(const incoming of source.congregations){const c=target.congregations.find(c=>c.id===incoming.id);if(!c)continue;const sourceTime=Date.parse(incoming.contactUpdatedAt)||0,targetTime=Date.parse(c.contactUpdatedAt)||0;if(sourceTime>targetTime&&(!c.contactLocked||incoming.contactLocked)){const old={name:c.contact,phone:c.phone,email:c.email};for(const k of contactKeys)c[k]=incoming[k];main++;for(const [key,t] of Object.entries(target.territories))if(key.endsWith('__'+c.id)&&!t.confirmed&&t.contact===old.name&&t.phone===old.phone){t.contact=c.contact;t.phone=c.phone;t.email=c.email;}}
 for(const a of incoming.assistants||[]){const sourceTime=Date.parse(a.updatedAt)||0;if(!sourceTime)continue;const index=c.assistants.findIndex(x=>x.id===a.id||x.name.trim().toLowerCase()===a.name.trim().toLowerCase());if(index<0){c.assistants.push(JSON.parse(JSON.stringify(a)));assistants++;}else if(sourceTime>(Date.parse(c.assistants[index].updatedAt)||0)){c.assistants[index]={...JSON.parse(JSON.stringify(a)),id:c.assistants[index].id};assistants++;}}
 syncLegacyAssistant(c);
 }return {main,assistants};}
export function contactRecords(c){return [{name:c.contact,role:c.contactRole||'Main contact',phone:c.phone,email:c.email,alternateEmail:c.alternateEmail,languages:c.contactLanguages,notes:c.contactNotes},...(c.assistants||[])];}
export function contactVcards(congregations){const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r/g,'');return congregations.flatMap(c=>contactRecords(c).filter(p=>p.name&&(p.phone||p.email||p.alternateEmail)).map(p=>[
 'BEGIN:VCARD','VERSION:3.0','FN:'+esc(p.name),'ORG:'+esc(c.name),'TITLE:'+esc(p.role+' — December load test'),
 ...(p.phone?['TEL;TYPE=CELL:'+p.phone.replace(/[^\d+]/g,'')]:[]),
 ...[...new Set([p.email,p.alternateEmail].filter(Boolean))].map(mail=>'EMAIL;TYPE=INTERNET:'+esc(mail)),
 'NOTE:'+esc(['LC: '+c.lc,c.role,c.date,p.languages,p.notes].filter(Boolean).join('; ')),'END:VCARD'
 ].join('\r\n'))).join('\r\n')+'\r\n';}

import {normalizeContacts} from './contact-tools.mjs';
export const SCHEMA = 'denver-load-test-v2';
export const STATUS = ['To confirm', 'In progress', 'Needs help', 'Complete'];
export const clone = value => JSON.parse(JSON.stringify(value));
export const key = text => String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const packets = pair => Math.ceil((pair.hostCount + pair.delegateCount) / 4);
export const congregation = (plan,id) => plan.congregations.find(c=>c.id===id);
export const isExternal = (plan,p) => ![p.hostId,p.delegateId].includes(p.territoryId);
export const territoryKey = p => `${p.date}__${p.territoryId}`;
export function filteredPairs(plan,{lc='',day='',search=''}={}) {
  const q=search.trim().toLowerCase();
  return plan.pairs.filter(p=>{
    const h=congregation(plan,p.hostId), d=congregation(plan,p.delegateId),t=congregation(plan,p.territoryId);
    return (!day||p.date===day)&&(!lc||h.lc===lc||d.lc===lc)&&(!q||[h.name,d.name,t.name,p.meeting].join(' ').toLowerCase().includes(q));
  });
}
export function rollups(plan,visiblePairs=plan.pairs) {
  const visibleKeys=new Set(visiblePairs.map(territoryKey));
  const all=new Map();
  for(const p of plan.pairs) {
    const id=territoryKey(p);
    if(!all.has(id))all.set(id,{id,date:p.date,territoryId:p.territoryId,participants:0,packets:0,pairs:[],external:[]});
    const r=all.get(id);r.participants+=p.hostCount+p.delegateCount;r.packets+=packets(p);r.pairs.push(p);
    if(isExternal(plan,p))r.external.push(p);
  }
  return [...all.values()].filter(r=>visibleKeys.has(r.id)).sort((a,b)=>a.date.localeCompare(b.date)||congregation(plan,a.territoryId).name.localeCompare(congregation(plan,b.territoryId).name));
}
export function allocated(plan,c) {
  return plan.pairs.reduce((n,p)=>n+(p.hostId===c.id?p.hostCount:0)+(p.delegateId===c.id?p.delegateCount:0),0);
}
export function rosterCount(plan,cId) {return plan.people.filter(p=>p.congregationId===cId&&p.counts).length;}
export function slotIds(plan,pairId) {return Object.values(plan.groups[pairId]||{}).flatMap(g=>[g.host1,g.host2,g.delegate1,g.delegate2]).filter(Boolean);}
export function validate(value) {
  if(!value||value.schema!==SCHEMA)throw new Error('Choose a December load-test tracker JSON backup.');
  const plan=clone(value);
  const arr=(v,max,label)=>{if(!Array.isArray(v)||v.length>max)throw new Error(`Invalid ${label}.`);return v;};
  const str=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)throw new Error('A text field is missing or too long.');return v;};
  const count=v=>{if(!Number.isInteger(v)||v<0||v>10000)throw new Error('Counts must be whole numbers from 0 to 10,000.');};
  const id=v=>{str(v,160);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v))throw new Error('Invalid record ID.');};
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const unique=(items,label)=>{if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error(`Duplicate ${label} IDs.`);};
  str(plan.name,200);str(plan.id,100);if(!/^[a-z0-9-]+$/.test(plan.id))throw new Error('Invalid plan ID.');
  arr(plan.congregations,300,'congregations');arr(plan.pairs,300,'pairings');arr(plan.people,5000,'participants');arr(plan.tasks,3000,'tasks');arr(plan.documents,100,'references');
  for(const c of plan.congregations){normalizeContacts(c);for(const k of ['alternateEmail','contactRole','contactLanguages','contactNotes','contactSource','contactUpdatedAt'])str(c[k],4000);if(c.contactUpdatedAt&&!Number.isFinite(Date.parse(c.contactUpdatedAt)))throw new Error('Invalid contact update date.');if(typeof c.contactLocked!=='boolean')throw new Error('Invalid contact override choice.');arr(c.assistants,50,'assistant contacts');unique(c.assistants,'assistant');for(const a of c.assistants){id(a.id);for(const k of ['name','role','phone','email','alternateEmail','languages','notes'])str(a[k],4000);if(a.updatedAt&&!Number.isFinite(Date.parse(a.updatedAt)))throw new Error('Invalid assistant update date.');if(!a.name.trim())throw new Error('Enter a name for each assistant.');}}
  for(const c of plan.congregations){str(c.id,100);str(c.name,150);str(c.lc,100);if(!['Host','Delegate','Territory'].includes(c.role))throw new Error('Invalid congregation role.');count(c.target);if(c.confirmed!==null)count(c.confirmed);for(const f of ['contact','phone','email','assistant','assistantPhone','assistantEmail','homeAddress','rally','rallyAddress','notes'])str(c[f],4000);}
  unique(plan.congregations,'congregation');unique(plan.pairs,'pairing');unique(plan.people,'participant');unique(plan.tasks,'task');
  for(const record of [...plan.congregations,...plan.pairs,...plan.people,...plan.tasks])id(record.id);
  arr(plan.notices,100,'planning notes').forEach(n=>str(n,5000));
  for(const c of plan.congregations){if(!/^2026-12-0[56]$/.test(c.date))throw new Error('Invalid congregation test day.');str(c.rallyTime??'',10);}
  const ids=new Set(plan.congregations.map(c=>c.id));
  for(const p of plan.pairs){str(p.id,100);if(!/^2026-12-0[56]$/.test(p.date))throw new Error('Pairings must use December 5 or 6, 2026.');for(const f of ['hostId','delegateId','territoryId'])if(!ids.has(p[f]))throw new Error('Pairing references a missing congregation.');if(congregation(plan,p.hostId).role!=='Host'||congregation(plan,p.delegateId).role!=='Delegate')throw new Error('Pairing roles do not match.');count(p.hostCount);count(p.delegateCount);for(const f of ['meeting','meetingAddress','hostArrival','delegateArrival','meetingTime','departureTime','lunchTime','hospitality','hospitalityAddress','transport','notes'])str(p[f],4000);}
  for(const p of plan.people){str(p.id,100);if(!ids.has(p.congregationId))throw new Error('Participant congregation is missing.');str(p.name,150);str(p.phone,100);str(p.notes,2000);if(typeof p.counts!=='boolean')throw new Error('Invalid participant counting choice.');}
  for(const t of plan.tasks){str(t.id,160);str(t.title,500);str(t.owner,150);str(t.notes,4000);if(t.congregationId&&!ids.has(t.congregationId))throw new Error('Task congregation is missing.');if(!/^2026-\d{2}-\d{2}$/.test(t.due)||!STATUS.includes(t.status))throw new Error('Invalid task date or status.');}
  if(!object(plan.groups)||!object(plan.territories))throw new Error('Missing groups or territory records.');
  for(const [k,t] of Object.entries(plan.territories)){if(!/^2026-12-0[56]__[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(k)||!object(t))throw new Error('Invalid territory preparation record.');count(t.ready);for(const f of ['contact','phone','email','owner','due','handoff','notes'])str(t[f],4000);for(const f of ['confirmed','dncChecked'])if(typeof t[f]!=='boolean')throw new Error('Invalid territory confirmation.');}
  const people=new Map(plan.people.map(p=>[p.id,p])), assigned=new Set();
  for(const [pairId,groups] of Object.entries(plan.groups)) {
    const pair=plan.pairs.find(p=>p.id===pairId);if(!pair)throw new Error('Unknown pairing in car groups.');
    if(!object(groups))throw new Error('Invalid car groups.');
    for(const [number,g] of Object.entries(groups)){
      if(!/^\d+$/.test(number)||Number(number)<1||Number(number)>1000)throw new Error('Invalid group number.');
      if(!object(g))throw new Error('Invalid car group record.');
      for(const slot of ['host1','host2','delegate1','delegate2'])if(g[slot]){
        const person=people.get(g[slot]);if(!person||person.congregationId!==(slot.startsWith('host')?pair.hostId:pair.delegateId))throw new Error('A participant is assigned to the wrong congregation group.');
        if(!person.counts)throw new Error('Remove this participant from a volunteer slot before marking them as an accompanying child.');
        if(assigned.has(person.id))throw new Error(`${person.name} is assigned to more than one car group.`);assigned.add(person.id);
      }
      for(const f of ['territoryNumber','phone','out','returned','notes'])str(g[f]??'',2000);
      if(g.doors!==''&&g.doors!==undefined)count(g.doors);
    }
  }
  for(const d of plan.documents){str(d.name,200);if(d.url&&!/^https:\/\/chatgpt\.com\/library\?file_id=/.test(d.url))throw new Error('Only private source-document links are allowed.');}
  if(new TextEncoder().encode(JSON.stringify(plan)).length>800000)throw new Error('This plan exceeds the save limit. Download a backup and shorten long notes.');
  return plan;
}
export function alerts(plan,filter={}) {
  const visible=filteredPairs(plan,filter),output=[];
  for(const r of rollups(plan,visible)){
    const c=congregation(plan,r.territoryId),prep=plan.territories[r.id]||{};
    if(r.pairs.length>1)output.push({kind:'shared',text:`${c.name}: ${r.pairs.length} pairings, ${r.participants} people, ${r.packets} territories total.`,date:r.date});
    if(r.external.length)output.push({kind:'outside',text:`${c.name}: ${r.external.length} pairing(s) use another congregation's territory. Confirm preparation with ${prep.contact||c.contact||'the territory congregation'}.`,date:r.date});
    if(!prep.confirmed)output.push({kind:'pending',text:`${c.name}: territory preparation contact / handoff not confirmed.`,date:r.date});
    if(Number(prep.ready||0)<r.packets)output.push({kind:'shortfall',text:`${c.name}: ${r.packets-Number(prep.ready||0)} territories still to prepare.`,date:r.date});
  }
  for(const c of plan.congregations.filter(c=>(!filter.lc||c.lc===filter.lc)&&(!filter.day||c.date===filter.day))){
    if(c.confirmed!==null&&c.confirmed!==allocated(plan,c))output.push({kind:'allocation',text:`${c.name}: confirmed ${c.confirmed}, allocated ${allocated(plan,c)}. Adjust pairing counts before finalizing.`,date:c.date});
    if(c.confirmed!==null&&rosterCount(plan,c.id)>c.confirmed)output.push({kind:'roster',text:`${c.name}: counted names exceed the confirmed total.`,date:c.date});
  }
  for(const p of visible){
    if(p.hostCount!==p.delegateCount||p.hostCount%2||p.delegateCount%2)output.push({kind:'balance',text:`${congregation(plan,p.hostId).name} / ${congregation(plan,p.delegateId).name}: review the 2-host / 2-delegate car-group balance.`,date:p.date});
    const extra=Object.keys(plan.groups[p.id]||{}).some(k=>Number(k)>packets(p));
    if(extra)output.push({kind:'groups',text:`${p.meeting}: existing car groups exceed the revised count. They are preserved for review.`,date:p.date});
  }
  return output;
}
export function directions(origin,destination,mode='driving') {
  if(!String(origin).trim()||!String(destination).trim())return '';
  const url=new URL('https://www.google.com/maps/dir/');url.search=new URLSearchParams({api:'1',origin,destination,travelmode:mode}).toString();return url.href;
}
export function csv(rows) {return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
export function briefing(plan,filter={}) {
  const pairs=filteredPairs(plan,filter),areas=rollups(plan,pairs),tasks=plan.tasks.filter(t=>t.status!=='Complete'&&(!filter.lc||t.owner===filter.lc||(!t.congregationId)));
  return [`Nell — December 5–6 field-service load test`,`Status exported ${new Date().toLocaleString('en-US',{timeZone:'America/Denver'})} Denver time. This is a snapshot, not a live connection.`,`Lead-contact view: ${filter.lc||'All'}. ${pairs.length} pairings shown. Territory totals below include every pairing sharing each territory.`,...areas.map(r=>`${r.date} | ${congregation(plan,r.territoryId).name}: ${r.participants} people / ${r.packets} territories; ${plan.territories[r.id]?.ready||0} ready; contact ${plan.territories[r.id]?.contact||congregation(plan,r.territoryId).contact}; ${plan.territories[r.id]?.confirmed?'handoff confirmed':'handoff to confirm'}`),'Outstanding follow-up:',...tasks.sort((a,b)=>a.due.localeCompare(b.due)).map(t=>`${t.due} | ${t.owner} | ${t.congregationId?congregation(plan,t.congregationId).name+': ':''}${t.title} — ${t.status}${t.notes?' — '+t.notes:''}`),'Source / planning notes:',...plan.notices,'Please use this snapshot to remind Michael about approaching deadlines and ask for updates. Do not assume unfinished items are complete, access the private tracker automatically, or send messages to congregation contacts.'].join('\n');
}

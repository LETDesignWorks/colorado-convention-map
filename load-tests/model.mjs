export const STATUSES = ['To confirm', 'In progress', 'Needs help', 'Complete', 'Not applicable'];
export const ROLES = ['Host', 'Delegate', 'Kingdom Hall', 'Territory', 'Coordination', 'Literature', 'Feedback'];
export const uid = () => crypto.randomUUID();
export const copy = value => JSON.parse(JSON.stringify(value));
export const dateText = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'To confirm';
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function shiftDate(value, days) {
  if (!validDate(value)) return '';
  const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
export function moveDate(test, next) {
  if (!validDate(next)) throw new Error('Choose a valid test date.');
  const days = Math.round((Date.parse(next)-Date.parse(test.date))/86400000);
  for (const place of [test.overall, ...test.sites]) for (const task of place.tasks) if(task.due) task.due=shiftDate(task.due,days);
  test.date=next; return test;
}
export const blankContact = (role='Host') => ({id:uid(),role,congregation:'',name:'',phone:'',email:'',notes:''});
export const blankTask = (date,role='Host') => ({id:uid(),role,title:'New checklist item',owner:'',due:date,status:'To confirm',notes:'',evidence:'',source:''});
export function blankSite(date, templates=[]) {
  return {id:uid(),name:'New location',address:'',hosts:'',delegates:'',territory:'',language:'',
    openTime:'08:00',delegateTime:'09:00',meetingTime:'09:30',departTime:'10:00',lunchTime:'12:00',closeTime:'',
    hostTarget:'50',delegateTarget:'50',vehicleTarget:'25',packetTarget:'25',doorsPerPacket:'40',tractsPerPacket:'40',notes:'',
    contacts:['Host','Delegate','Kingdom Hall','Territory'].map(blankContact),
    tasks:templates.map(t=>({...copy(t),id:uid(),due:shiftDate(date,t.offset),status:'To confirm',owner:'',notes:''}))};
}
export function newTest(date, templates=[]) {
  return {schemaVersion:1,id:`load-test-${uid()}`,name:'Field service load test',date,archived:false,notes:'',overall:{id:'overall',contacts:[],tasks:[]},sites:[blankSite(date,templates)]};
}
export function duplicateTest(original, name, date, keepContacts) {
  const test=moveDate(copy(original),date); test.id=`load-test-${uid()}`;test.name=name;test.archived=false;test.notes='';
  for(const place of [test.overall,...test.sites]) {
    if(place.id!=='overall') place.id=uid();
    place.notes='';
    place.contacts=keepContacts ? place.contacts.map(c=>({...c,id:uid(),notes:''})) : [];
    for(const task of place.tasks) {task.id=uid();task.status='To confirm';task.notes='';if(!keepContacts) task.owner='';}
  }
  return test;
}
export function progress(test, siteId) {
  const groups=siteId ? [siteId==='overall'?test.overall:test.sites.find(s=>s.id===siteId)] : [test.overall,...test.sites];
  const tasks=groups.filter(Boolean).flatMap(s=>s.tasks);const applicable=tasks.filter(t=>t.status!=='Not applicable');
  return {done:applicable.filter(t=>t.status==='Complete').length,total:applicable.length,help:tasks.filter(t=>t.status==='Needs help').length};
}
// Validate and rebuild only known fields before rendering or sending a record to shared storage.
export function validateTest(value) {
  if(!value || value.schemaVersion!==1) throw new Error('This file is not a supported load-test checklist.');
  const str=(v,max=2000)=>{if(typeof v!=='string'||v.length>max) throw new Error('A checklist field is missing or too long.');return v;};
  const optional=(v,max=2000)=>v===undefined?'':str(v,max);
  const list=(v,max)=>{if(!Array.isArray(v)||v.length>max) throw new Error('The checklist has too many items or an invalid list.');return v;};
  const id=v=>{const result=str(v,100);if(!/^[\w-]+$/.test(result))throw new Error('Invalid checklist ID.');return result;};
  const contact=c=>({id:id(c.id),role:str(c.role,100),congregation:str(c.congregation,300),name:str(c.name,300),phone:str(c.phone,100),email:str(c.email,300),notes:str(c.notes,4000)});
  const task=t=>{if(!STATUSES.includes(t.status)|| (t.due && !validDate(t.due))) throw new Error('Invalid task status or due date.');return {id:id(t.id),role:str(t.role,100),title:str(t.title,4000),owner:str(t.owner,300),due:str(t.due,10),status:t.status,notes:str(t.notes,8000),evidence:str(t.evidence,4000),source:str(t.source,2000)};};
  const group=g=>({id:id(g.id),contacts:list(g.contacts,60).map(contact),tasks:list(g.tasks,150).map(task)});
  const test={schemaVersion:1,id:id(value.id),name:str(value.name,300),date:value.date,archived:value.archived===true,notes:str(value.notes,8000),overall:group(value.overall),sites:list(value.sites,20).map(s=>{
    const result=group(s);
    for(const k of ['name','address','hosts','delegates','territory','language','openTime','delegateTime','meetingTime','departTime','lunchTime','closeTime','hostTarget','delegateTarget','vehicleTarget','packetTarget','doorsPerPacket','tractsPerPacket','notes'])result[k]=optional(s[k],k==='notes'?8000:1000);
    return result;
  })};
  if(!test.id.startsWith('load-test-') || !test.name.trim() || !validDate(test.date)||!test.sites.length||test.overall.id!=='overall')throw new Error('Give the test a name, a date, and at least one location.');
  const ids=[test.overall.id,...test.sites.map(s=>s.id)];
  for(const g of [test.overall,...test.sites])ids.push(...g.tasks.map(t=>t.id),...g.contacts.map(c=>c.id));
  if(new Set(ids).size!==ids.length)throw new Error('Checklist item IDs must be unique.');
  if(new TextEncoder().encode(JSON.stringify(test)).length>700000)throw new Error('This checklist is too large. Split it into separate tests.');
  return test;
}

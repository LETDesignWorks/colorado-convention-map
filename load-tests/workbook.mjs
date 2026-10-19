// Shared field definitions for the on-screen checklist and interactive PDF.
export const DETAIL_SECTIONS = [
  ['Host confirmation & auditorium access', [
    ['day_of_coordinator_1','Brother 1 - name / phone'],['day_of_coordinator_2','Brother 2 - name / phone'],
    ['auditorium_access_contact','Auditorium access contact'],['auditorium_access_phone','Access phone'],
    ['opening_closing_shared_date','Opening / closing details shared on'],
    ['auditorium_access_arrangements','Entry, key / door, opening and closing arrangements',true]
  ]],
  ['Territory readiness & delivery', [
    ['territory_contact_name','Territory contact'],['territory_contact_phone','Territory contact phone'],
    ['territory_status_date','Territory status as of'],['territories_completed','Territories completed'],
    ['territories_remaining','Territories remaining'],['packets_ready','Packets ready'],
    ['territory_status_notes','Readiness notes / boundaries to confirm',true],
    ['delivery_contact_name','Delivery contact'],['delivery_contact_phone','Delivery contact phone'],
    ['delivery_date_time','Delivery date / time'],['delivery_receiving_contact','Receiving host - name / phone'],
    ['delivery_instructions','Delivery / meeting-point instructions',true],
    ['needs_concerns_handoff','Needs, concerns or outstanding handoff details',true]
  ]],
  ['Literature & packet details', [
    ['literature_title','Selected literature title / item'],['literature_language','Literature language / edition'],
    ['literature_quantity_needed','Literature quantity needed'],['literature_quantity_ready','Literature quantity ready'],
    ['literature_confirmed_date','Literature confirmed on'],['literature_contact','Literature contact - name / phone'],
    ['literature_delivery_time','Literature delivery date / time'],['literature_notes','Literature / packet needs or instructions',true]
  ]],
  ['Packet check-out / check-in', [
    ['checkout_brother','Check-out brother - name / phone'],['checkin_brother','Check-in brother - name / phone'],
    ['packets_total_out','Total packets out'],['packets_total_returned','Total returned'],
    ['packets_still_out','Packets still out'],['packet_log_checked_by','Packet log checked by']
  ]],
  ['Volunteer list handoff', [
    ['volunteer_lists_shared_date','Volunteer lists shared on'],['volunteer_lists_shared_by','Volunteer lists shared by']
  ]]
];
export const CHECKS = [
  ['welcome_ready','Friends are ready to greet delegates; a welcome sign is optional.'],
  ['presentation_language_confirmed','Meeting for service / presentation language confirmed.'],
  ['literature_ready','Literature title, language and quantities confirmed.'],
  ['two_day_of_coordinators_assigned','Two brothers assigned for day-of details, checkout and return.'],
  ['opening_closing_shared','Hosts have received opening / closing arrangements.'],
  ['territory_reviewed','Territory boundaries, addresses and access details reviewed.'],
  ['packets_complete','Packets include the maps, address list and avoid list.'],
  ['delivery_arrangements_shared','Delivery arrangements shared with the receiving host.'],
  ['packet_envelope_ready','Use a large envelope with a clear sleeve on the front.'],
  ['packet_overview_visible','Display the overview map and keep the territory ID visible.'],
  ['packet_documents_together','Keep all maps, address lists and avoid information together.'],
  ['packet_date_instructions','Add the assigned day label and confirm special instructions.'],
  ['volunteer_lists_shared','Volunteer lists shared with the day-of coordinators.']
];
export const LITERATURE = [
  {image:'invitation.jpg',title:'Invitation to Congregation Meetings',url:'https://www.jw.org/en/library/tracts/Invitation-to-Congregation-Meetings/'},
  {image:'bible.jpg',title:'How Do You View the Bible?',url:'https://www.jw.org/en/library/tracts/view-bible-tract/'},
  {image:'future.jpg',title:'How Do You View the Future?',url:'https://www.jw.org/en/library/tracts/view-future-tract/'},
  {image:'suffering.jpg',title:'Will Suffering Ever End?',url:'https://www.jw.org/en/library/tracts/suffering-end-tract/'}
];
export function defaultWorkbook(site){
  const contact=pattern=>site.contacts.find(c=>pattern.test(c.role))||{};
  const access=contact(/opener|auditorium access/i),territory=contact(/territory provider/i),checkout=contact(/checkout|check-out/i);
  const joined=c=>[c.name,c.phone].filter(Boolean).join(' | ');
  const fields=Object.fromEntries(DETAIL_SECTIONS.flatMap(([,defs])=>defs.map(([key])=>[key,''])));
  Object.assign(fields,{auditorium_access_contact:access.name||'',auditorium_access_phone:access.phone||'',
    auditorium_access_arrangements:access.notes||'',territory_contact_name:territory.name||'',territory_contact_phone:territory.phone||'',
    checkout_brother:joined(checkout),checkin_brother:joined(checkout)});
  const volunteers=[];
  for(const role of ['Host','Delegate']){
    let congregations=[...new Set(site.contacts.filter(c=>c.role.toLowerCase().startsWith(role.toLowerCase())&&c.congregation).map(c=>c.congregation))];
    if(!congregations.length)congregations=[site[role==='Host'?'hosts':'delegates']||''];
    for(let i=0;i<50;i++)volunteers.push({role,congregation:congregations[Math.min(congregations.length-1,Math.floor(i*congregations.length/50))],name:'',phone:'',responsibility:''});
  }
  return {fields,checks:Object.fromEntries(CHECKS.map(([key])=>[key,false])),
    packets:Array.from({length:25},()=>({territory:'',leader:'',out:'',in:'',returned:false,notes:''})),volunteers};
}
export function workbookFor(site){
  const defaults=defaultWorkbook(site),saved=site.workbook||{};
  return {fields:{...defaults.fields,...saved.fields},checks:{...defaults.checks,...saved.checks},
    packets:saved.packets||defaults.packets,volunteers:saved.volunteers||defaults.volunteers};
}
export function validateWorkbook(value){
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object')throw new Error('Invalid checklist details.');
  const fields={},checks={};
  const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw new Error('A checklist detail is too long or invalid.');return v;};
  for(const [key,,long] of DETAIL_SECTIONS.flatMap(([,defs])=>defs))if(value.fields?.[key]!==undefined)fields[key]=text(value.fields[key],long?8000:1000);
  for(const [key] of CHECKS)if(value.checks?.[key]!==undefined){if(typeof value.checks[key]!=='boolean')throw new Error('Invalid checkbox value.');checks[key]=value.checks[key];}
  const result={fields,checks};
  for(const [name,keys,max] of [['packets',['territory','leader','out','in','notes'],100],['volunteers',['role','congregation','name','phone','responsibility'],300]]){
    if(value[name]===undefined)continue;
    if(!Array.isArray(value[name])||value[name].length>max)throw new Error('Too many checklist rows.');
    result[name]=value[name].map(row=>{
      const out=Object.fromEntries(keys.map(key=>[key,text(row[key]??'',1000)]));
      if(name==='packets')out.returned=row.returned===true;
      else if(!['Host','Delegate'].includes(out.role))throw new Error('Invalid volunteer role.');
      return out;
    });
  }
  return result;
}
export function validateAttachment(value){
  if(value==null)return null;
  if(!/^load-test-attachment-[\w-]+$/.test(value.id)||typeof value.name!=='string'||value.name.length>300||!Number.isInteger(value.parts)||value.parts<1||value.parts>50||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>10000000||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Invalid sample territory attachment.');
  return {id:value.id,name:value.name,parts:value.parts,bytes:value.bytes,sha256:value.sha256};
}

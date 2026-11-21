import {congregation,rollups,packets,directions} from './model.mjs';
export const MESSAGE_TYPES=[['counts','Counts and names — Nov 25'],['travel','Travel reminder — Nov 30'],['final','Final details — Dec 2 / day before'],['territory','Territory preparation request'],['feedback','After-test feedback — Dec 7']];
const day=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
const time=t=>t?new Date('2000-01-01T'+t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'[time to confirm]';
export function messageFor(plan,id,type) {
 const c=congregation(plan,id);if(!c)return '';
 const pairs=plan.pairs.filter(p=>p.hostId===id||p.delegateId===id),areas=rollups(plan).filter(r=>r.territoryId===id);
 const first=pairs[0];
 const greeting=`Hello ${c.contact||'Brothers'},\n\n`;
 const sign=`\n\nThank you for your help and all the effort your congregation is putting into the test!\n\n${c.lc||'Michael Tarin'}`;
 if(type==='territory') {
  if(!areas.length)return greeting+`${c.name} is not currently listed as a territory provider in this tracker. Please confirm the correct territory congregation before sending a territory request.`;
  return greeting+`We are preparing for the December 5–6 field-service load test. Could you please help coordinate the territories for ${c.name}?\n\n`+areas.map(r=>{
   const prep=plan.territories[r.id]||{};
   return `${day(r.date)}: ${r.participants} participants across ${r.pairs.length} host/delegate pairing(s), requiring ${r.packets} territories in total (4 people per group).\n`+r.pairs.map(p=>`• ${congregation(plan,p.hostId).name} (host, ${p.hostCount}) with ${congregation(plan,p.delegateId).name} (delegate, ${p.delegateCount}): ${packets(p)} territories; meeting at ${p.meeting}.`).join('\n')+`\nPreparation contact: ${prep.contact||'[please confirm]'}${prep.phone?' — '+prep.phone:''}.\nPacket handoff: ${prep.handoff||'[time and place to confirm]'}.`;
  }).join('\n\n')+`\n\nPlease confirm the preparation contact and packet count by November 25. Each packet should include a territory map, a working copy, current do-not-call information, and approximately 40 congregation meeting invitations. Please coordinate distinct territories across the pairings so two groups are not assigned the same area. Final maps and do-not-call information need to be ready by December 2.`+sign;
 }
 if(type==='feedback')return greeting+`Thank you for helping with the field-service load test on ${day(c.date)}! Could you please send ${c.lc} your actual participant count, arrival/departure and return times, doors attempted, and any difficulties with parking, transportation, territory, group organization, or hospitality?\n\nPlease also let us know whether 40 doors/invitations per group felt too few, about right, or too many. We plan to review the findings with the main congregation contacts on Monday, December 7; the meeting time is still to be confirmed.`+sign;
 const paired=[...new Set(pairs.map(p=>congregation(plan,c.role==='Host'?p.delegateId:p.hostId).name))].join(', ');
 const lines=[`${c.name} is assigned as a ${c.role.toLowerCase()} congregation for ${day(c.date)}.`,`Paired ${c.role==='Host'?'delegate':'host'} congregation(s): ${paired}.`,`Assigned volunteers: ${c.target}${c.confirmed!==null?`; currently confirmed: ${c.confirmed}`:''}. Children accompanying parents do not count toward this volunteer total.`];
 if(type==='counts'){
  lines.push(`By November 25, please send ${c.lc} your final adult count and participant names, and confirm your congregation contact and assistant.`);
  if(c.role==='Host')lines.push(`Please also confirm your available drivers/vehicles or walking arrangement, territory-preparation contact, and hospitality plan. We will pass along delegate names so you can organize the groups.`);
  else lines.push(`Please send your participant list to ${c.lc} so it can be passed to the host congregation for pairing. Please share the travel and hospitality instructions with your volunteers.`);
  lines.push(`If your congregation operating plan has not yet been returned, please include it with your update.`);
 } else {
  lines.push(`Please remind everyone of these arrangements:`,...pairs.map(p=>`• Meet at ${p.meeting}${p.meetingAddress?' — '+p.meetingAddress:' — [address to confirm]'}. ${c.role==='Host'?'Hosts arrive by '+time(p.hostArrival)+' and should be ready to welcome delegates by 8:45 AM.':'Delegates should arrive together at '+time(p.delegateArrival)+'.'}`));
  if(c.role==='Delegate'&&c.rally)lines.push(`Your group will first gather at ${c.rally}${c.rallyAddress?' — '+c.rallyAddress:''}; rally time: ${c.rallyTime?time(c.rallyTime):'[please confirm]'}. Confirm the train/service plan and allow enough time to reach the host meeting location.`);
  if(first){lines.push(`Meeting for service: ${time(first.meetingTime)}. Target departure for the territory: ${time(first.departureTime)}. Target lunch: ${time(first.lunchTime)}.`,`Hospitality: ${first.hospitality||'[please confirm]'}${first.hospitalityAddress?' — '+first.hospitalityAddress:''}.`);}
  if(c.role==='Host')lines.push(`Please confirm the conductor, territory checkout coordinator, 2 attendants and 2 helpers. Have the group presentation cards and territory packets ready. Each group should normally include 2 hosts and 2 delegates.`);
  else lines.push(`You will be paired with hosts and will either use host vehicles or walk, according to the local arrangement. A simple presentation will be provided. Please confirm whether everyone should bring a sack lunch.`);
 }
 if(c.role==='Host')for(const p of pairs){const r=rollups(plan).find(r=>r.id===`${p.date}__${p.territoryId}`);lines.push(`Territory: ${congregation(plan,p.territoryId).name}. Your pairing needs ${packets(p)} packets. The full territory area needs ${r.packets} packets across all its pairings; coordinate with the territory congregation.`);}
 if(type!=='counts'&&first){
  const destination=c.role==='Delegate'&&c.rally?(c.rallyAddress||c.rally):(first.meetingAddress||first.meeting);
  const driving=directions(c.homeAddress,destination);if(driving)lines.push(`Driving map: ${driving}`);else lines.push(`Driving map: [confirm the congregation departure address first].`);
  if(c.role==='Delegate'&&c.rally)lines.push(`Transit planning map: ${directions(c.rallyAddress||c.rally,first.meetingAddress||first.meeting,'transit')}`);
  if(!c.homeAddressConfirmed||!first.meetingConfirmed)lines.push(`[Before sending: confirm departure address, meeting entrance, rally time and current travel arrangements.]`);
 }
 return greeting+lines.join('\n\n')+sign;
}

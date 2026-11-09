export const METHOD='Ranked by the upper end of Google Maps’ car-driving range plus the entered bus allowance. Saved forecast comparison, not live traffic. Loading, unloading, parking, vehicle restrictions and actual departure-day conditions require separate review.';
export const BUS_LABELS={'45-foot-motorcoach':'45-foot motorcoach','40-foot-motorcoach':'40-foot motorcoach','school-bus':'School bus',shuttle:'Shuttle bus','passenger-van':'Passenger van'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sourceUrl(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}}
export function makeReport({rows,group,period,allowance,query='',selectedId,origin,reference,approvalStatus,checkedDate,now=new Date()}){
  if(!Array.isArray(rows))throw Error('Wait for the results to finish loading.');
  if(allowance===''||!Number.isFinite(Number(allowance))||Number(allowance)<0||Number(allowance)>90)throw Error('Use a bus allowance from 0 to 90 minutes before exporting.');
  const filter=query.trim().toLowerCase(),activities=group==='activities';
  const label=row=>activities?(row.activityLabel||row.label):row.label;
  const filtered=rows.filter(row=>(row.name+' '+row.address+' '+label(row)).toLowerCase().includes(filter));
  if(!filtered.length)throw Error('No matching results to export. Clear or change the location search.');
  const report={title:'Rush-Hour Planning Results',group,groupTitle:activities?'Activity destinations':'Approved meeting locations',period,allowance:Number(allowance),query:query.trim(),origin:{...origin},reference,approvalStatus,checkedDate,total:rows.length,rows:filtered.map(row=>({...row,displayLabel:label(row)})),selectedId,created:new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}).format(now)+' MT',method:METHOD};
  // Detach the report from live approval updates and filter changes during export.
  return JSON.parse(JSON.stringify(report));
}
export function details(report){const row=report.rows.find(row=>row.id===report.selectedId);if(!row)return null;const f=row.forecast;
  const lines=[row.address];
  if(f?.routes?.length){lines.push('Departure: '+(f.departureLocal||'See reference time')+' · America/Denver');for(const [i,route] of f.routes.entries())lines.push(`${i?'Alternative':'Forecast route'}: ${route.via} · ${route.rangeText} · ${route.miles} miles`);lines.push(`Bus planning time: ${row.planningMinutes} min (upper forecast + ${report.allowance} min allowance).`);}
  else lines.push('Needs a new traffic forecast before ranking. This location may be newly approved or its address / pin may have changed.');
  if(report.group==='meetings')lines.push('Largest bus reviewed: '+(BUS_LABELS[row.busSize]||row.busSize||'Not specified'));
  if(row.note)lines.push(row.note);if(row.publicSummary)lines.push(row.publicSummary);
  return{title:(row.rank?'Rank '+row.rank:'Traffic check needed')+' · '+row.name,lines,url:sourceUrl(f?.sourceUrl)};
}
export function reportHtml(report){const detail=details(report);return `<header><h1>Denver 2027 · ${escape(report.title)}</h1><h2>${escape(report.groupTitle)}</h2><p><strong>Outbound from ${escape(report.origin.name)}</strong><br>${escape(report.origin.address)}</p><p>${escape(report.reference)}<br>Forecasts checked: ${escape(report.checkedDate)} · Prepared: ${escape(report.created)}</p></header><p>${escape(report.approvalStatus)}</p><p><strong>${report.rows.length} of ${report.total} destinations</strong>${report.query?' · Search: '+escape(report.query):' · No search filter'}. Extra bus driving allowance: ${report.allowance} minutes.</p><p>${escape(report.method)}</p><table><thead><tr><th>Rank / destination</th><th>Google car range</th><th>Bus plan</th></tr></thead><tbody>${report.rows.map(row=>`<tr><td><strong>${row.rank??'—'}. ${escape(row.displayLabel)} · ${escape(row.name)}</strong><br>${escape(row.address)}</td><td>${escape(row.forecast?.routes?.[0]?.rangeText||'Needs traffic check')}</td><td>${row.planningMinutes==null?'Not ranked':row.planningMinutes+' min'}</td></tr>`).join('')}</tbody></table>${detail?`<section class="rush-print-detail"><h2>Selected route · ${escape(detail.title)}</h2>${detail.lines.map(line=>'<p>'+escape(line)+'</p>').join('')}${detail.url?`<p><a href="${escape(detail.url)}">Open Google forecast / change date</a></p>`:''}</section>`:''}<p>All trips are outbound from the convention center. Pickup-point timings are not return trips. Road overviews on the website can differ from the Google forecast route.</p>`;}

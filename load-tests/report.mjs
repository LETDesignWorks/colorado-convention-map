import { dateText,progress } from './model.mjs';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const known=v=>v||'To confirm';
export function timeText(value){if(!/^\d{2}:\d{2}$/.test(value))return known(value);const[h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;}
function selected(test,scope){return scope==='all'?[test.overall,...test.sites]:[scope==='overall'?test.overall:test.sites.find(s=>s.id===scope)].filter(Boolean);}
function placeLines(site){if(site.id==='overall')return [];
  return [site.address,`Host congregation(s): ${known(site.hosts)}`,`Delegate congregation(s): ${known(site.delegates)}`,`Territory provided by: ${known(site.territory)}`,`Presentation language: ${known(site.language)}`,
    `Hall opens ${timeText(site.openTime)} | Delegates ${timeText(site.delegateTime)} | Meeting ${timeText(site.meetingTime)}`,
    `Departure ${timeText(site.departTime)} | Lunch ${timeText(site.lunchTime)} | Closing ${timeText(site.closeTime)}`,
    `Targets: ${known(site.hostTarget)} hosts / ${known(site.delegateTarget)} delegates / ${known(site.vehicleTarget)} vehicles`,
    `Packets: ${known(site.packetTarget)} / Doors per packet: ${known(site.doorsPerPacket)} / Tracts per packet: ${known(site.tractsPerPacket)}`].filter(Boolean);}
function contactLines(c){return [`${c.role}: ${known(c.name)}${c.congregation?' — '+c.congregation:''}`,[c.phone,c.email].filter(Boolean).join(' | ')||'Contact details: To confirm',c.notes].filter(Boolean);}
function taskLines(t){return [`${t.status==='Complete'?'[x]':'[ ]'} ${t.title}`,`${t.role} | ${t.status} | Due ${dateText(t.due)} | Owner: ${known(t.owner)}`,t.evidence?`Completion check: ${t.evidence}`:'',t.notes?`Notes: ${t.notes}`:'',t.source?`Reference: ${t.source}`:''].filter(Boolean);}
export function reportHtml(test,scope,dirty){return `<div class="print-report">${selected(test,scope).map(site=>{
  const p=progress(test,site.id);return `<section class="print-site"><header class="print-header"><p>DENVER 2027 · FIELD SERVICE</p><h1>${e(test.name)}</h1><p>${e(dateText(test.date))} · ${e(site.name||'Test coordination')} · ${p.done}/${p.total} complete</p><p class="print-meta">${dirty?'UNSAVED DRAFT · ':''}Prepared ${e(new Date().toLocaleString())}</p></header>${placeLines(site).map(l=>`<p>${e(l)}</p>`).join('')}${test.notes?`<p class="print-note">${e(test.notes)}</p>`:''}${site.notes?`<p class="print-note">${e(site.notes)}</p>`:''}<h2>Contacts & responsibilities</h2>${site.contacts.length?site.contacts.map(c=>`<div class="print-contact">${contactLines(c).map((l,i)=>`<p${i?' class="print-meta"':''}>${e(l)}</p>`).join('')}</div>`).join(''):'<p>Contacts to confirm.</p>'}<h2>Checklist</h2>${site.tasks.length?site.tasks.map(t=>`<div class="print-task">${taskLines(t).map((l,i)=>`<p${i?' class="print-meta"':''}>${e(l)}</p>`).join('')}</div>`).join(''):'<p>No checklist items.</p>'}</section>`;}).join('')}</div>`;}
// Render selectable text with line wrapping and page breaks, including long notes.
export function makePdf(test,scope,dirty,JsPDF=globalThis.jspdf?.jsPDF){
  if(!JsPDF)throw new Error('PDF download is unavailable. Use Print / Save PDF, or reload and try again.');
  const pdf=new JsPDF({unit:'pt',format:'letter'});const margin=42,width=528,bottom=744;let y=42;
  const clean=s=>String(s).replace(/[–—]/g,' - ').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/→/g,' > ');
  function nextPage(){pdf.addPage();y=42;}
  function text(value,size=10,bold=false,color='#23394b'){
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);
    const lines=pdf.splitTextToSize(clean(value),width);for(const line of lines){if(y+size*1.4>bottom)nextPage();pdf.text(line,margin,y);y+=size*1.4;}y+=3;
  }
  function block(lines){const height=lines.reduce((n,l,i)=>n+pdf.splitTextToSize(clean(l),width).length*(i?12.6:14)+3,0);if(y+Math.min(height,180)>bottom)nextPage();lines.forEach((l,i)=>text(l,i?9:10,!i,i?'#526372':'#23394b'));y+=5;}
  selected(test,scope).forEach((site,index)=>{
    if(index)nextPage();text('DENVER 2027  /  FIELD SERVICE',10,true,'#0b5b9f');text(test.name,21,true,'#123d62');text(`${dateText(test.date)}  |  ${site.name||'Test coordination'}`,12,true);const p=progress(test,site.id);text(`${p.done}/${p.total} complete${dirty?'  |  UNSAVED DRAFT':''}`,9);y+=8;
    placeLines(site).forEach(l=>text(l));if(test.notes)text(`Test notes: ${test.notes}`);if(site.notes)text(`Location notes: ${site.notes}`);
    if(y+120>bottom)nextPage();text('Contacts & responsibilities',14,true,'#0b5b9f');if(!site.contacts.length)text('Contacts to confirm.');site.contacts.forEach(c=>block(contactLines(c)));
    if(y+150>bottom)nextPage();text('Checklist',14,true,'#0b5b9f');site.tasks.forEach(t=>block(taskLines(t)));
  });
  const pages=pdf.getNumberOfPages();for(let n=1;n<=pages;n++){pdf.setPage(n);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor('#647583');pdf.text(`Prepared ${new Date().toLocaleDateString()}  |  ${test.date}  |  Private planning checklist`,margin,768);pdf.text(`${n} / ${pages}`,570,768,{align:'right'});}
  return pdf;
}

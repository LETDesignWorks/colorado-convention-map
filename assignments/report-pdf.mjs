import {printRibbonMarkup,waitForPrintRibbons} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';

const WEEKDAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const COLORS={assigned:'#0b447e',pending:'#e2a236',delegates:'#167e78',track:'#eef2f6',grid:'#d9e1e8',ink:'#18344d',muted:'#536879'};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value))):0;
const number=value=>count(value).toLocaleString('en-US');

function prepared(report){
  if(!report||!Array.isArray(report.days))throw Error('The assignment report is not ready. Wait for the summary to load, then try again.');
  return {...report,total:count(report.total),assigned:count(report.assigned),unassigned:count(report.unassigned),delegatesPerCongregation:count(report.delegatesPerCongregation),
    days:WEEKDAYS.map(day=>{const row=report.days.find(item=>item.day===day)||{};return {day,totalCongregations:count(row.totalCongregations),assignedCongregations:count(row.assignedCongregations),unassignedCongregations:count(row.unassignedCongregations),estimatedDelegates:count(row.estimatedDelegates)};})};
}
function denverTimestamp(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
}
function chartScale(maximum){
  if(maximum<=1)return {maximum:1,ticks:[0,1]};
  const base=10**Math.floor(Math.log10(maximum/4));
  const step=Math.max(1,([1,2,5,10].find(value=>value*base>=maximum/4)||10)*base);
  const maximumAxis=Math.ceil(maximum/step)*step;
  return {maximum:maximumAxis,ticks:Array.from({length:Math.round(maximumAxis/step)+1},(_,index)=>Math.round(index*step))};
}
function weekdayChart(rows,{delegates=false}={}){
  const id=delegates?'delegate-chart':'congregation-chart',width=720,left=104,plotWidth=532,top=31,rowHeight=27;
  const chartBottom=top+rows.length*rowHeight,scale=chartScale(Math.max(0,...rows.map(row=>delegates?row.estimatedDelegates:row.totalCongregations)));
  const title=delegates?'Estimated delegates by weekday':'Congregations by service weekday';
  const description=rows.map(row=>delegates?`${row.day}: ${number(row.estimatedDelegates)} estimated delegates`:`${row.day}: ${number(row.totalCongregations)} scheduled congregations, ${number(row.assignedCongregations)} assigned to a meeting location, ${number(row.unassignedCongregations)} still needing a location`).join('. ')+'.';
  const grid=scale.ticks.map(tick=>{const x=left+tick/scale.maximum*plotWidth;return `<line x1="${x}" y1="${top-13}" x2="${x}" y2="${chartBottom-9}" stroke="${COLORS.grid}"/><text x="${x}" y="${chartBottom+15}" text-anchor="middle" class="axis-label">${number(tick)}</text>`;}).join('');
  const bars=rows.map((row,index)=>{
    const y=top+index*rowHeight,value=delegates?row.estimatedDelegates:row.totalCongregations;
    const assigned=delegates?value:row.assignedCongregations,assignedWidth=Math.min(plotWidth,assigned/scale.maximum*plotWidth),pendingWidth=delegates?0:Math.min(plotWidth-assignedWidth,row.unassignedCongregations/scale.maximum*plotWidth);
    return `<g><text x="0" y="${y+15}" class="day-label">${row.day}</text><rect x="${left}" y="${y}" width="${plotWidth}" height="19" rx="3" fill="${COLORS.track}"/>${assignedWidth>0?`<rect x="${left}" y="${y}" width="${assignedWidth}" height="19" fill="${delegates?COLORS.delegates:COLORS.assigned}"/>`:''}${pendingWidth>0?`<rect x="${left+assignedWidth}" y="${y}" width="${pendingWidth}" height="19" fill="${COLORS.pending}"/>`:''}<text x="712" y="${y+15}" text-anchor="end" class="value-label">${number(value)}</text></g>`;
  }).join('');
  return `<svg class="weekday-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${chartBottom+40}" role="img" aria-labelledby="${id}-title ${id}-description"><title id="${id}-title">${title}</title><desc id="${id}-description">${escapeHtml(description)}</desc><style>.day-label{font:14px Arial,sans-serif;fill:${COLORS.ink}}.value-label{font-family:Arial,sans-serif;font-size:14px;font-weight:700;fill:${COLORS.ink}}.axis-label{font:12px Arial,sans-serif;fill:${COLORS.muted}}.axis-heading{font:12px Arial,sans-serif;fill:${COLORS.muted}}</style><text x="${left}" y="14" class="axis-heading">${delegates?'Estimated delegates':'Scheduled congregations'}</text>${grid}${bars}</svg>`;
}
function progressChart(report){
  const width=720,assignedWidth=report.total?Math.max(0,Math.min(width,report.assigned/report.total*width)):0;
  return `<svg class="progress-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 30" role="img" aria-label="${number(report.assigned)} of ${number(report.total)} congregations assigned; ${number(report.unassigned)} unassigned"><rect width="720" height="30" rx="5" fill="#e3e9ef"/>${assignedWidth?`<rect width="${assignedWidth}" height="30" rx="5" fill="${COLORS.assigned}"/>`:''}</svg>`;
}
const swatch=color=>`<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="${color}"/></svg>`;
const statusNote=report=>report.sharedReady?'Saved assignments and service days. Full congregation roster; directory filters do not change these totals.':'Cached snapshot. Shared updates could not be confirmed. Full roster totals may be out of date. Reconnect, then create a new report.';

export function renderAssignmentReportHtml(input){
  const report=prepared(input),percentage=report.total?(report.assigned/report.total*100).toLocaleString('en-US',{maximumFractionDigits:1}):'0';
  const date=denverTimestamp(report.generatedAt),estimate=number(report.delegatesPerCongregation);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Denver 2027 Congregation Assignments</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eaf0f5;color:${COLORS.ink};font:14px/1.45 Arial,Helvetica,sans-serif}.print-controls{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:12px 22px;background:#fff;border-bottom:1px solid #cad6e1}.print-controls button{padding:10px 15px;border-radius:7px;border:1px solid #0b447e;background:#0b447e;color:white;font:700 14px Arial,sans-serif;cursor:pointer}.print-controls button.secondary{background:#fff;color:#0b447e}.print-controls button:disabled{opacity:.6;cursor:wait}#printReportStatus{margin:0;font-size:13px;max-width:680px}main{max-width:8.5in;margin:22px auto}.report-page{position:relative;background:#fff;padding:.3in .35in .25in;margin:0 0 24px;box-shadow:0 3px 20px #23425b18;break-after:page;page-break-after:always}.report-page:last-child{break-after:auto;page-break-after:auto}.eyebrow{margin:0 0 6px;color:#537184;font-weight:700;letter-spacing:1.6px;font-size:11px}.report-header{border-bottom:2px solid #0b447e;padding-bottom:14px;margin-bottom:20px}h1{margin:0 0 5px;font-size:29px;line-height:1.15;color:#0b447e}h2{margin:0 0 7px;font-size:19px;line-height:1.25;color:#0b447e}p{margin:0 0 9px}.meta{margin:0;font-size:12px;color:${COLORS.muted}}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 20px}.stat{border:1px solid #d9e3ed;border-radius:9px;padding:12px 16px}.stat strong{display:block;font-size:31px;line-height:1.25;color:#0b447e}.stat span{display:block;font-size:12px;color:#536879}.progress-section{margin-bottom:23px}.progress-heading{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px}.progress-heading p{margin:0;color:#537184;font-size:13px}.progress-chart,.weekday-chart{display:block;width:100%;height:auto}.legend{display:flex;flex-wrap:wrap;gap:18px;margin:10px 0 0;font-size:12px;color:#405b70}.legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.assumption{border-left:4px solid #167e78;background:#eff8f7;padding:11px 14px;margin:0 0 21px;font-size:13px}.assumption strong{color:#0c655f}.section-copy{color:#536879;font-size:12px;margin-bottom:7px}.chart-section{break-inside:avoid}.summary-notes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:19px}.summary-notes p{border-top:1px solid #d8e2ea;padding-top:9px;font-size:12px;color:#536879}.summary-notes strong{color:#18344d}.freshness{padding:9px 12px;background:#f1f5f8;border-radius:6px;margin-top:16px;font-size:11px;color:#536879}.freshness.stale{background:#fff4d9;color:#754e0c;border:1px solid #ebd49c}.page-footer{display:flex;justify-content:space-between;gap:14px;margin-top:19px;padding-top:10px;border-top:1px solid #d8e2ea;font-size:10px;color:#607485}.daily-table{width:100%;border-collapse:collapse;margin-top:15px;font-size:12px;table-layout:fixed}.daily-table th{background:#0b447e;color:#fff;text-align:right;font-weight:700;padding:9px 10px;line-height:1.25}.daily-table th:first-child,.daily-table td:first-child{text-align:left}.daily-table td{border-bottom:1px solid #e0e7ed;padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums}.daily-table tbody tr:nth-child(even){background:#f4f7fa}.daily-table td:last-child{color:#126d68;font-weight:700}.method-note{font-size:11px;line-height:1.45;color:#536879;margin-top:12px}.screen-note{font-size:12px;color:#52677b;text-align:center;margin:8px 0 20px}
  @media(max-width:700px){.print-controls{position:static;flex-wrap:wrap;padding:12px}.report-page{padding:18px}.stats{gap:8px}.stat{padding:10px}.stat strong{font-size:27px}.summary-notes{grid-template-columns:1fr}.daily-table{font-size:10px}.daily-table th,.daily-table td{padding:7px 5px}h1{font-size:25px}}
  @media print{@page{size:letter portrait;margin:.65in .35in .8in}html,body{background:#fff;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-controls,.screen-note{display:none!important}main{max-width:none;margin:0}.report-page{margin:0;padding:0;box-shadow:none;max-width:none}.report-header{margin-bottom:15px;padding-bottom:11px}.stats{margin-bottom:16px;gap:12px}.stat{padding:9px 14px}.stat strong{font-size:28px}.progress-section{margin-bottom:17px}.assumption{padding:9px 12px;margin-bottom:16px}.summary-notes{margin-top:12px}.summary-notes p{margin-bottom:3px;padding-top:7px}.freshness{margin:12px 0 0;padding:7px 10px}.chart-section,.stats,.assumption,.daily-table,.freshness,.summary-notes{break-inside:avoid}.report-page:last-child .report-header{margin-bottom:10px}.report-page:last-child .weekday-chart{width:100%}h1{font-size:25px}.daily-table{margin-top:8px}.page-footer{margin-top:10px}.daily-table td,.daily-table tbody th{padding-top:7px!important;padding-bottom:7px!important}}
  </style></head><body>${printRibbonMarkup()}<div class="print-controls"><button id="printAssignmentReport" type="button">Print / Save PDF</button><button id="closeAssignmentReport" type="button" class="secondary">Close</button><p id="printReportStatus" role="status">Preparing the report. In the print dialog, choose Save as PDF.</p></div><main>
  <section class="report-page" aria-label="Assignment overview, page 1 of 2"><header class="report-header"><p class="eyebrow">DENVER 2027 · FIELD SERVICE PLANNING</p><h1>Congregation assignments</h1><p class="meta">Full roster overview · ${escapeHtml(date)}</p></header>
  <div class="stats"><div class="stat"><strong>${number(report.total)}</strong><span>Total congregations</span></div><div class="stat"><strong>${number(report.assigned)}</strong><span>Assigned to a meeting location</span></div><div class="stat"><strong>${number(report.unassigned)}</strong><span>Still needing a meeting location</span></div></div>
  <section class="progress-section"><div class="progress-heading"><h2>Assignment progress</h2><p>${percentage}% assigned</p></div>${progressChart(report)}<div class="legend"><span>${swatch(COLORS.assigned)}${number(report.assigned)} assigned</span><span>${swatch('#e3e9ef')}${number(report.unassigned)} unassigned</span></div></section>
  <div class="assumption"><strong>Planning assumption: ${estimate} delegates per assigned congregation.</strong><br>Each congregation paired with a meeting location contributes ${estimate} delegates on each of its saved service days.</div>
  <section class="chart-section"><h2>Congregations by service day</h2><p class="section-copy">Every saved weekday is included. A day can be selected before a meeting location is assigned.</p>${weekdayChart(report.days)}<div class="legend"><span>${swatch(COLORS.assigned)}Assigned to a meeting location</span><span>${swatch(COLORS.pending)}Day set; meeting location still needed</span></div></section>
  <div class="summary-notes"><p><strong>${number(report.assignedWithoutDay)} assigned congregations</strong><br>still need a service day before their delegates appear in the daily estimate.</p><p><strong>${number(report.unassignedWithDay)} congregations with a day set</strong><br>still need a meeting location before their delegates are counted.</p></div>
  <p class="freshness${report.sharedReady?'':' stale'}">${statusNote(report)}</p><footer class="page-footer"><span>Denver 2027 · Congregation assignment planning</span><span>Assignment overview · 1 of 2</span></footer></section>
  <section class="report-page" aria-label="Daily delegate estimates, page 2 of 2"><header class="report-header"><p class="eyebrow">DENVER 2027 · FIELD SERVICE PLANNING</p><h1>Daily delegate estimates</h1><p class="meta">${estimate} delegates per assigned congregation · ${escapeHtml(date)}</p></header>
  <section class="chart-section"><h2>Estimated delegates by service day</h2><p class="section-copy">Assigned congregations scheduled for the day × ${estimate} delegates.</p>${weekdayChart(report.days,{delegates:true})}</section>
  <table class="daily-table"><caption style="text-align:left;font-weight:700;font-size:16px;color:#0b447e;margin:2px 0 8px">Daily planning totals</caption><colgroup><col style="width:18%"><col style="width:19%"><col style="width:22%"><col style="width:21%"><col style="width:20%"></colgroup><thead><tr><th scope="col">Service day</th><th scope="col">Scheduled<br>congregations</th><th scope="col">Assigned to<br>a meeting location</th><th scope="col">Meeting location<br>still needed</th><th scope="col">Estimated<br>delegates</th></tr></thead><tbody>${report.days.map(row=>`<tr><th scope="row" style="background:transparent;color:#18344d;text-align:left;font-weight:400;padding:8px 10px;border-bottom:1px solid #e0e7ed">${row.day}</th><td>${number(row.totalCongregations)}</td><td>${number(row.assignedCongregations)}</td><td>${number(row.unassignedCongregations)}</td><td>${number(row.estimatedDelegates)}</td></tr>`).join('')}</tbody></table>
  <p class="method-note"><strong>Counting rule:</strong> Each assigned congregation counts separately, including congregations sharing the same meeting location. A congregation scheduled on several weekdays appears on each of those days. Daily estimates should not be added together as a count of unique delegates.</p><p class="method-note">Congregations with service days but no meeting location are included in the scheduled-congregation column and excluded from the delegate estimate. Change the delegates-per-congregation setting on the assignments page, then create a new report to use another estimate.</p>
  <p class="freshness${report.sharedReady?'':' stale'}">${statusNote(report)}</p><footer class="page-footer"><span>Denver 2027 · Congregation assignment planning</span><span>Daily estimates · 2 of 2</span></footer></section></main><p class="screen-note">Use Letter paper and 100% scale. Turn off browser headers and footers for a clean PDF.</p></body></html>`;
}

// Open before the first await so the export remains an immediate user action.
export function printAssignmentReport(report,{windowApi=globalThis.window,waitForRibbons=waitForPrintRibbons}={}){
  const html=renderAssignmentReportHtml(report);
  const popup=windowApi?.open?.('','_blank');
  if(!popup)throw Error('Your browser blocked the report window. Allow pop-ups for this site, then choose Print / Save PDF again.');
  try{popup.opener=null;popup.document.open();popup.document.write(html);popup.document.close();}
  catch(error){try{popup.close();}catch{}throw Error('The PDF report window could not open. Please try again.');}
  const document=popup.document,button=document.getElementById('printAssignmentReport'),status=document.getElementById('printReportStatus');
  document.getElementById('closeAssignmentReport')?.addEventListener('click',()=>popup.close());
  let pending=null;
  function print(){
    if(pending)return pending;
    if(popup.closed)return Promise.resolve({window:popup,printed:false});
    if(button)button.disabled=true;
    if(status)status.textContent='Loading the convention artwork. The print dialog will open when the report is ready.';
    pending=(async()=>{
      await waitForRibbons(document,{timeoutMs:8000});
      if(document.fonts?.ready)await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,1000))]);
      if(popup.closed)return {window:popup,printed:false};
      if(status)status.textContent='Choose Save as PDF in the print dialog. This report contains two pages.';
      popup.focus();popup.print();
      return {window:popup,printed:true};
    })().catch(error=>{
      if(!popup.closed&&status)status.textContent=error.message+' The report is still open; use Print / Save PDF to retry.';
      if(popup.closed)return {window:popup,printed:false};
      throw error;
    }).finally(()=>{pending=null;if(button)button.disabled=false;});
    return pending;
  }
  button?.addEventListener('click',()=>{void print().catch(()=>{});});
  return print();
}

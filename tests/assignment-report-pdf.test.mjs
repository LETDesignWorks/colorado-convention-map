import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssignmentReport} from '../assignments/report-model.mjs';
import {renderAssignmentReportHtml,printAssignmentReport} from '../assignments/report-pdf.mjs';

function report({factor=50,ready=true}={}){
  const congregations=['A','B','C','D'].map(id=>({id,name:id}));
  return buildAssignmentReport({congregations,locations:[{id:'one',name:'Shared meeting'}],
    assignmentFor:id=>id!=='D'?{meetingPointId:'one'}:null,
    serviceDaysFor:id=>id==='C'?[]:id==='A'?['Monday','Friday']:['Monday'],
    delegatesPerCongregation:factor,sharedReady:ready,now:new Date('2026-11-15T18:30:00Z')});
}
function popupFixture(){
  const calls=[],elements=new Map();
  const node=id=>{if(!elements.has(id))elements.set(id,{events:{},disabled:false,textContent:'',addEventListener(name,fn){this.events[name]=fn;}});return elements.get(id);};
  const popup={closed:false,opener:{},document:{fonts:{ready:Promise.resolve()},open(){calls.push('document-open');},write(html){calls.push('write');this.html=html;},close(){calls.push('document-close');},getElementById:node},
    focus(){calls.push('focus');},print(){calls.push('print');},close(){this.closed=true;calls.push('close');}};
  const windowApi={open(...args){calls.push(['open',...args]);return popup;}};
  return {calls,popup,node,windowApi};
}

test('PDF report contains all three vector graphs, seven weekdays, exact saved totals and the delegate assumption',()=>{
  const html=renderAssignmentReportHtml(report());
  assert.equal((html.match(/class="report-page"/g)||[]).length,2);
  assert.equal((html.match(/class="weekday-chart"/g)||[]).length,2);
  assert.equal((html.match(/class="progress-chart"/g)||[]).length,1);
  assert.match(html,/3 of 4 congregations assigned; 1 unassigned/);
  assert.match(html,/75% assigned/);
  assert.match(html,/Monday: 3 scheduled congregations, 2 assigned to a meeting location, 1 still needing a location/);
  assert.match(html,/Monday: 100 estimated delegates/);
  assert.match(html,/Friday: 50 estimated delegates/);
  assert.match(html,/Sunday: 0 estimated delegates/);
  assert.match(html,/50 delegates per assigned congregation/);
  assert.match(html,/Nov 15, 2026, 11:30 AM MST/);
  assert.match(html,/directory filters do not change these totals/);
  assert.match(html,/data-print-ribbon="header"/);assert.match(html,/data-print-ribbon="footer"/);
  assert.doesNotMatch(html,/<head>[\s\S]*?<img[\s\S]*?<\/head>/);
});
test('changing the factor changes daily estimates, including zero, and cached reports are clearly labeled',()=>{
  assert.match(renderAssignmentReportHtml(report({factor:65})),/Monday: 130 estimated delegates/);
  const html=renderAssignmentReportHtml(report({factor:0,ready:false}));
  assert.match(html,/Monday: 0 estimated delegates/);assert.match(html,/0 delegates per assigned congregation/);
  assert.equal((html.match(/Cached snapshot/g)||[]).length,2);
  assert.doesNotMatch(html,/>NaN<|>Infinity</);
});
test('an empty roster produces printable zero values without division or invalid SVG dimensions',()=>{
  const html=renderAssignmentReportHtml(buildAssignmentReport({sharedReady:true}));
  assert.match(html,/0 of 0 congregations assigned/);assert.match(html,/0% assigned/);
  assert.doesNotMatch(html,/NaN|Infinity|width="-/);
});
test('opens the popup synchronously, then waits for artwork before printing',async()=>{
  const f=popupFixture();let finish;
  const ready=printAssignmentReport(report(),{windowApi:f.windowApi,waitForRibbons:(_doc,options)=>{assert.equal(options.timeoutMs,8000);return new Promise(resolve=>{finish=resolve;});}});
  assert.deepEqual(f.calls[0],['open','','_blank']);assert(f.calls.includes('write'));
  assert.equal(f.popup.opener,null);assert.equal(f.calls.includes('print'),false);assert.equal(f.node('printAssignmentReport').disabled,true);
  finish();assert.equal((await ready).printed,true);assert.equal(f.calls.filter(call=>call==='print').length,1);
  assert.equal(f.node('printAssignmentReport').disabled,false);
});
test('popup blocking returns a clear error and leaves the original page alone',()=>{
  assert.throws(()=>printAssignmentReport(report(),{windowApi:{open:()=>null}}),/browser blocked the report window/);
});
test('failed artwork leaves the report open with a working retry control',async()=>{
  const f=popupFixture();let attempts=0;
  const readiness=()=>++attempts===1?Promise.reject(Error('Artwork unavailable.')):Promise.resolve();
  await assert.rejects(printAssignmentReport(report(),{windowApi:f.windowApi,waitForRibbons:readiness}),/Artwork unavailable/);
  assert.equal(f.popup.closed,false);assert.match(f.node('printReportStatus').textContent,/use Print \/ Save PDF to retry/);
  assert.equal(f.node('printAssignmentReport').disabled,false);
  f.node('printAssignmentReport').events.click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,2);assert.equal(f.calls.filter(call=>call==='print').length,1);
});
test('closing the report during preparation prevents a late print dialog',async()=>{
  const f=popupFixture();let finish;
  const ready=printAssignmentReport(report(),{windowApi:f.windowApi,waitForRibbons:()=>new Promise(resolve=>{finish=resolve;})});
  f.node('closeAssignmentReport').events.click();finish();
  assert.equal((await ready).printed,false);assert.equal(f.calls.includes('print'),false);
});

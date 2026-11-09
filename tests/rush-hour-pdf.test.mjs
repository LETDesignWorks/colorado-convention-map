import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {rankedLocations} from '../rush-hour/model.mjs';
import {makeReport,reportHtml,details,sourceUrl} from '../rush-hour/results-report.mjs';
import {buildResultsPdf,wrap} from '../rush-hour/results-pdf.mjs';
const PDFLib=createRequire(import.meta.url)('../load-tests/vendor/pdf-lib.min.js');
const data=JSON.parse(readFileSync('rush-hour/data.json','utf8'));
const options={PDFLib,ribbonAssets:{header:readFileSync('assets/print-header-sky.png'),footer:readFileSync('assets/print-footer-hills.png')},logoBytes:readFileSync('assets/denver-2027-territory-logo.png'),now:new Date('2026-11-09T20:00:00Z')};
function input(group='meetings',period='pm',allowance=15){return {rows:rankedLocations(data.locations.filter(l=>l.groups.includes(group)),period,allowance),group,period,allowance,query:'',selectedId:'19',origin:data.origin,reference:`Reference: Tuesday, Nov 10, 2026 · ${period==='am'?'8:00 AM':'5:00 PM'} MST · bus allowance ${allowance} min`,approvalStatus:'Saved approval snapshot from Nov 8, 2026. Current approval status is unavailable.',checkedDate:data.checkedDate,now:options.now};}
test('report preserves current filters, period and allowance without mutating live data',()=>{
  const source=input('meetings','am',25);source.query='Yale';const report=makeReport(source);assert.equal(report.rows.length,1);assert.equal(report.rows[0].planningMinutes,80);assert.equal(report.period,'am');assert.equal(report.allowance,25);assert.equal(report.total,26);
  source.rows.find(r=>r.id==='19').name='CHANGED AFTER CLICK';assert.notEqual(report.rows[0].name,'CHANGED AFTER CLICK');assert.ok(details(report).lines.some(l=>l.includes('80 min')));assert.match(report.created,/MT$/);
});
test('invalid and empty results cannot export an old or misleading ranking',()=>{
  for(const allowance of ['',NaN,-1,91])assert.throws(()=>makeReport({...input(),allowance}));
  assert.throws(()=>makeReport({...input(),query:'no-such-destination-xyz'}),/No matching results/);
});
test('print HTML escapes names and search text and keeps unranked locations',()=>{
  const row={id:'x',name:'<script>alert(1)</script>',address:'New address',label:'X',planningMinutes:null,rank:null};const report=makeReport({...input(),rows:[row],selectedId:'x'});const html=reportHtml(report);
  assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Needs traffic check'));assert.ok(html.includes('Not ranked'));assert.match(details(report).lines.join(' '),/new traffic forecast/);assert.equal(sourceUrl('javascript:alert(1)'),'');
});
test('selected location details do not leak into an unrelated filtered report',()=>{const source=input();source.query=source.rows.find(r=>r.id!=='19').address;const report=makeReport(source);assert.equal(details(report),null);});
test('real PDF output paginates rankings and wraps long descriptions without losing characters',async()=>{
  mkdirSync('tmp',{recursive:true});
  const report=makeReport(input()),before=JSON.stringify(report);
  const result=await buildResultsPdf(report,options);assert.equal(JSON.stringify(report),before);assert.equal(result.blob.type,'application/pdf');
  const bytes=Buffer.from(await result.blob.arrayBuffer());const doc=await PDFLib.PDFDocument.load(bytes);assert.ok(doc.getPageCount()>=2);assert.ok(doc.getPageCount()<=4);assert.equal(result.pages,doc.getPageCount());writeFileSync('tmp/rush-hour-results.pdf',bytes);
  const activity=makeReport({...input('activities','am',20),selectedId:'activity-confluence'});const act=await buildResultsPdf(activity,options);writeFileSync('tmp/rush-hour-activities.pdf',Buffer.from(await act.blob.arrayBuffer()));
  const long=makeReport(input());long.rows[0].name='Long location '.repeat(100);long.rows[0].address='W'.repeat(700);long.selectedId=long.rows[0].id;long.rows[0].publicSummary='A long property note with loading instructions. '.repeat(100);const out=await buildResultsPdf(long,options);assert.ok(out.pages>result.pages);writeFileSync('tmp/rush-hour-long.pdf',Buffer.from(await out.blob.arrayBuffer()));
  const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica),wrapped=wrap('W'.repeat(800),font,9,318);assert.equal(wrapped.join(''),'W'.repeat(800));assert.ok(wrapped.every(l=>font.widthOfTextAtSize(l,9)<=318));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {assignmentSheets,workbookBytes} from '../assignments/excel-export.mjs';

// The browser exporter writes ordinary stored ZIP entries; inspect the actual
// downloadable package rather than relying only on intermediate sheet objects.
function unzip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};
 const decoder=new TextDecoder();let offset=0;
 while(view.getUint32(offset,true)===0x04034b50){
  const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
  const name=decoder.decode(bytes.subarray(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extra;
  files[name]=decoder.decode(bytes.subarray(start,start+size));offset=start+size;
 }
 return files;
}
function cell(sheet,ref){
 const match=sheet.match(new RegExp(`<c r="${ref}"[^>]*>([\\s\\S]*?)</c>`));assert.ok(match,`Missing ${ref}`);
 return {value:Number(match[1].match(/<v>(.*?)<\/v>/)?.[1]),formula:match[1].match(/<f>(.*?)<\/f>/)?.[1]};
}
function sample(overrides={}){
 const congregations=Array.from({length:5},(_,i)=>({id:`c${i+1}`,name:`Congregation ${i+1}`}));
 const assignments={c1:{meetingPointId:'p1'},c2:{meetingPointId:'p1'},c4:{meetingPointId:'temporarily-missing',meetingPointName:'Saved location'}};
 const days={c1:['Monday','Tuesday'],c2:['Monday','Thursday'],c3:['Monday']};
 return {congregations,visible:[congregations[2]],selected:new Set(['c5']),locations:[{id:'p1',name:'Meeting location'}],resolveHome:()=>({address:'',status:'missing',point:null}),assignmentFor:id=>assignments[id],serviceDaysFor:id=>days[id]||[],driveState:()=>({}),point:null,sharedReady:true,now:new Date('2026-11-15T12:00:00Z'),...overrides};
}

test('Excel summary uses the complete unique roster, saved IDs and every selected weekday',()=>{
 const context=sample();context.congregations.push({...context.congregations[1]});
 const sheets=assignmentSheets(context),overview=sheets[0],all=sheets.find(sheet=>sheet.name==='All congregations');
 assert.equal(overview.name,'Overview');assert.equal(all.rows.length,5);
 assert.deepEqual(all.headers.slice(-2),['Saved meeting point ID','Congregation ID']);
 assert.equal(sheets.find(sheet=>sheet.name==='Current directory').rows.length,1);
 assert.equal(sheets.find(sheet=>sheet.name==='Selected congregations').rows[0][1],'Congregation 5');
 const files=unzip(workbookBytes(sheets)),xml=files['xl/worksheets/sheet1.xml'];
 assert.equal(cell(xml,'B8').value,3);assert.equal(cell(xml,'B9').value,2);assert.equal(cell(xml,'B10').value,5);
 assert.equal(cell(xml,'B11').value,0.6);assert.equal(cell(xml,'E13').value,1);assert.equal(cell(xml,'E14').value,1);
 assert.deepEqual(['B19','C19','D19','E19'].map(ref=>cell(xml,ref).value),[3,2,1,100]);
 assert.deepEqual(['E20','E21','E22'].map(ref=>cell(xml,ref).value),[50,0,50]);
 assert.match(cell(xml,'B8').formula,/All congregations.*\$P\$2:\$P\$6/);
 assert.match(cell(xml,'B10').formula,/All congregations.*\$Q\$2:\$Q\$6/);
 assert.match(cell(xml,'C19').formula,/COUNTIFS.*\$O\$2:\$O\$6.*\$P\$2:\$P\$6/);
 assert.equal(cell(xml,'E19').formula,'C19*$C$5');
 assert.equal(all.rows[3][6],'Saved location');assert.equal(all.rows[3][15],'temporarily-missing');
});

test('Excel contains three editable, worksheet-linked bar charts with accurate caches',()=>{
 const bytes=workbookBytes(assignmentSheets(sample())),files=unzip(bytes);
 writeFileSync('/tmp/convention-assignment-report.xlsx',bytes);
 for(const [number,range,expected] of [[1,'$B$8:$B$9',[3,2]],[2,'$B$19:$B$25',[3,1,0,1,0,0,0]],[3,'$E$19:$E$25',[100,50,0,50,0,0,0]]]){
  const chart=files[`xl/drawings/charts/chart${number}.xml`];assert.ok(chart);
  assert.match(chart,/<c:barChart>/);assert.ok(chart.includes(`'Overview'!${range}`));
  const cache=chart.match(/<c:numCache>([\s\S]*?)<\/c:numCache>/)[1];
  assert.deepEqual([...cache.matchAll(/<c:v>(.*?)<\/c:v>/g)].map(match=>Number(match[1])),expected);
  assert.match(chart,/<c:min val="0"\/>/);
  assert.match(files['xl/drawings/_rels/drawing1.xml.rels'],new RegExp(`chart${number}\\.xml`));
 }
 assert.match(files['xl/worksheets/sheet1.xml'],/<drawing r:id="rIdCharts"\/>/);
 assert.match(files['xl/worksheets/sheet1.xml'],/type="whole"[^>]*sqref="C5"/);
 assert.match(files['xl/worksheets/sheet1.xml'],/orientation="landscape" fitToWidth="1" fitToHeight="1"/);
 assert.match(files['xl/workbook.xml'],/calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/);
 assert.match(files['xl/workbook.xml'],/_xlnm.Print_Area/);
});

test('adjusted, zero and invalid delegate assumptions are consistent with the shared report model',()=>{
 for(const factor of [65,0,10000]){
  const files=unzip(workbookBytes(assignmentSheets(sample({delegatesPerCongregation:factor}))));
  assert.equal(cell(files['xl/worksheets/sheet1.xml'],'C5').value,factor);
  assert.equal(cell(files['xl/worksheets/sheet1.xml'],'E19').value,2*factor);
  assert.ok(files['xl/drawings/charts/chart3.xml'].includes(`<c:v>${2*factor}</c:v>`));
 }
 for(const invalid of [-1,1.5,'',10001])assert.throws(()=>assignmentSheets(sample({delegatesPerCongregation:invalid})));
});

test('empty and cached-data exports remain honest and contain valid ranges',()=>{
 const context=sample({congregations:[],visible:[],selected:new Set(),sharedReady:false});
 const files=unzip(workbookBytes(assignmentSheets(context))),xml=files['xl/worksheets/sheet1.xml'];
 for(const ref of ['B8','B9','B10','B11','B19','C19','D19','E19'])assert.equal(cell(xml,ref).value,0);
 assert.match(xml,/incomplete or cached/);assert.match(xml,/\$Q\$2:\$Q\$2/);
 assert.doesNotMatch(xml,/NaN|Infinity|#DIV\/0!/);
});

test('exported congregation text cannot turn into an Excel formula',()=>{
 const context=sample();context.congregations[0].name='=HYPERLINK("https://example.invalid")';
 const files=unzip(workbookBytes(assignmentSheets(context))),all=files['xl/worksheets/sheet3.xml'];
 assert.match(all,/<c r="B2" s="0" t="inlineStr">/);assert.match(all,/=HYPERLINK\(&quot;/);
 assert.doesNotMatch(all,/<f>/);
});

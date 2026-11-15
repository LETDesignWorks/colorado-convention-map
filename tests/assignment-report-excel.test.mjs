import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
function worksheet(files,name){
 const match=files['xl/workbook.xml'].match(new RegExp(`<sheet name="${name}" sheetId="([0-9]+)"`));
 assert.ok(match,`Missing worksheet ${name}`);return files[`xl/worksheets/sheet${match[1]}.xml`];
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
 const sheets=assignmentSheets(context),overview=sheets.find(sheet=>sheet.name==='Overview'),all=sheets.find(sheet=>sheet.name==='All congregations');
 assert.equal(sheets[0].name,'By meeting location');assert.equal(overview.name,'Overview');assert.equal(all.rows.length,5);
 assert.deepEqual(all.headers.slice(15,17),['Saved meeting point ID','Congregation ID']);
 assert.equal(sheets.find(sheet=>sheet.name==='Current directory').rows.length,1);
 assert.equal(sheets.find(sheet=>sheet.name==='Selected congregations').rows[0][1],'Congregation 5');
 const files=unzip(workbookBytes(sheets)),xml=worksheet(files,'Overview');
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
 writeFileSync(join(tmpdir(),'convention-assignment-report.xlsx'),bytes);
 for(const [number,range,expected] of [[1,'$B$8:$B$9',[3,2]],[2,'$B$19:$B$25',[3,1,0,1,0,0,0]],[3,'$E$19:$E$25',[100,50,0,50,0,0,0]]]){
  const chart=files[`xl/drawings/charts/chart${number}.xml`];assert.ok(chart);
  assert.match(chart,/<c:barChart>/);assert.ok(chart.includes(`'Overview'!${range}`));
  const cache=chart.match(/<c:numCache>([\s\S]*?)<\/c:numCache>/)[1];
  assert.deepEqual([...cache.matchAll(/<c:v>(.*?)<\/c:v>/g)].map(match=>Number(match[1])),expected);
  assert.match(chart,/<c:min val="0"\/>/);
  assert.match(files['xl/drawings/_rels/drawing1.xml.rels'],new RegExp(`chart${number}\\.xml`));
 }
 assert.match(worksheet(files,'Overview'),/<drawing r:id="rIdCharts"\/>/);
 assert.match(worksheet(files,'Overview'),/type="whole"[^>]*sqref="C5"/);
 assert.match(worksheet(files,'Overview'),/orientation="landscape" fitToWidth="1" fitToHeight="1"/);
 assert.match(files['xl/workbook.xml'],/calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/);
 assert.match(files['xl/workbook.xml'],/_xlnm.Print_Area/);
});

test('adjusted, zero and invalid delegate assumptions are consistent with the shared report model',()=>{
 for(const factor of [65,0,10000]){
  const files=unzip(workbookBytes(assignmentSheets(sample({delegatesPerCongregation:factor}))));
  assert.equal(cell(worksheet(files,'Overview'),'C5').value,factor);
  assert.equal(cell(worksheet(files,'Overview'),'E19').value,2*factor);
  assert.ok(files['xl/drawings/charts/chart3.xml'].includes(`<c:v>${2*factor}</c:v>`));
 }
 for(const invalid of [-1,1.5,'',10001])assert.throws(()=>assignmentSheets(sample({delegatesPerCongregation:invalid})));
});

test('empty and cached-data exports remain honest and contain valid ranges',()=>{
 const context=sample({congregations:[],visible:[],selected:new Set(),sharedReady:false});
 const files=unzip(workbookBytes(assignmentSheets(context))),xml=worksheet(files,'Overview');
 for(const ref of ['B8','B9','B10','B11','B19','C19','D19','E19'])assert.equal(cell(xml,ref).value,0);
 assert.match(xml,/incomplete or cached/);assert.match(xml,/\$Q\$2:\$Q\$2/);
 assert.doesNotMatch(xml,/NaN|Infinity|#DIV\/0!/);
});

test('exported congregation text cannot turn into an Excel formula',()=>{
 const context=sample();context.congregations[0].name='=HYPERLINK("https://example.invalid")';
 const files=unzip(workbookBytes(assignmentSheets(context))),all=worksheet(files,'All congregations');
 assert.match(all,/<c r="B2" s="0" t="inlineStr">/);assert.match(all,/=HYPERLINK\(&quot;/);
 assert.doesNotMatch(all,/<f>/);
});

test('first worksheet lists each saved meeting location with all its congregations underneath',()=>{
 const context=sample();context.congregations.push({...context.congregations[1]});
 context.locations[0].address='123 Current Street';
 const saved=context.assignmentFor;
 context.assignmentFor=id=>id==='c4'?{...saved(id),meetingPointAddress:'456 Saved Street'}:saved(id);
 const sheets=assignmentSheets(context),grouped=sheets[0];
 assert.equal(grouped.name,'By meeting location');
 assert.deepEqual(grouped.groupRows,[0,3,5]);
 assert.deepEqual(grouped.rows[0].slice(0,6),['Meeting location','123 Current Street','2 assigned congregations','','','p1']);
 assert.deepEqual(grouped.rows[1].slice(0,6),['','','Congregation 1','','Monday, Tuesday','']);
 assert.deepEqual(grouped.rows[2].slice(0,6),['','','Congregation 2','','Monday, Thursday','']);
 assert.deepEqual(grouped.rows[3].slice(0,6),['Saved location','456 Saved Street','1 assigned congregation','','','temporarily-missing']);
 assert.equal(grouped.rows[4][2],'Congregation 4');
 assert.equal(grouped.rows[5][0],'Unassigned congregations');
 assert.deepEqual(grouped.rows.slice(6).map(row=>row[2]),['Congregation 3','Congregation 5']);
 const files=unzip(workbookBytes(sheets)),xml=worksheet(files,'By meeting location');
 assert.match(xml,/<c r="A2" s="1" t="inlineStr">/);
 assert.match(xml,/<c r="C3" s="0" t="inlineStr">/);
 assert.doesNotMatch(xml,/<autoFilter/);
 assert.match(xml,/orientation="landscape" fitToWidth="1" fitToHeight="0"/);
 assert.ok(files['xl/worksheets/_rels/sheet2.xml.rels'].includes('drawing1.xml'));
 assert.match(files['xl/workbook.xml'],/name="_xlnm.Print_Area" localSheetId="1"/);
});

test('locations with matching names remain separate by ID and unsafe text stays literal',()=>{
 const name='=HYPERLINK("https://example.invalid")',context=sample();
 context.locations=[{id:'p1',name,address:'One & First'},{id:'p2',name,address:'Two < Second'}];
 const saved=context.assignmentFor;context.assignmentFor=id=>id==='c4'?{meetingPointId:'p2'}:saved(id);
 context.congregations[0].name='=1+1';
 const sheets=assignmentSheets(context),grouped=sheets[0];
 assert.deepEqual(grouped.groupRows.slice(0,2).map(i=>grouped.rows[i][5]),['p1','p2']);
 const xml=worksheet(unzip(workbookBytes(sheets)),'By meeting location');
 assert.match(xml,/=HYPERLINK\(&quot;/);assert.match(xml,/One &amp; First/);assert.match(xml,/Two &lt; Second/);
 assert.match(xml,/=1\+1/);assert.doesNotMatch(xml,/<f>/);
});

test('grouped exports include wholly unassigned and empty rosters without inventing assignments',()=>{
 const unassigned=assignmentSheets(sample({assignmentFor:()=>null}))[0];
 assert.deepEqual(unassigned.groupRows,[0]);assert.equal(unassigned.rows[0][2],'5 unassigned congregations');assert.equal(unassigned.rows.length,6);
 const empty=assignmentSheets(sample({congregations:[],visible:[],selected:new Set()}))[0];
 assert.equal(empty.rows.length,1);assert.equal(empty.rows[0][2],'0 unassigned congregations');
});

test('assigned travel columns use each saved meeting location, with honest blanks and zeroes',()=>{
 const context=sample(),seen=[];
 context.point={id:'comparison',name:'Different comparison',lat:40,lng:-105};
 context.resolveHome=c=>({address:'Hall '+c.id,status:'mapped',point:{lat:39.7,lng:-105}});
 context.driveState=(c,id)=>{seen.push([c.id,id]);if(id==='comparison')return {status:'within',seconds:60,label:'Comparison only'};return c.id==='c1'?{status:'within',seconds:1800,meters:16093.44}:c.id==='c2'?{status:'over',seconds:4801,meters:32186.88}:{status:'no-destination'};};
 const sheets=assignmentSheets(context),grouped=sheets[0],all=sheets.find(s=>s.name==='All congregations');
 assert.deepEqual(grouped.rows[1].slice(6,9),['Hall c1','30 min',10]);
 assert.deepEqual(grouped.rows[2].slice(6,9),['Hall c2','1 hr 21 min',20]);assert(grouped.grayRows.includes(2));
 assert.deepEqual(grouped.rows[4].slice(7,9),['','']);assert.match(grouped.rows[4][9],/pin unavailable/);
 assert.deepEqual(grouped.rows[6].slice(7,9),['','']);assert.match(grouped.rows[6][9],/Not assigned/);
 assert.equal(all.rows[0][10],1);assert.equal(all.rows[0][17],30);assert.equal(all.rows[0][18],10);
 assert.equal(all.headers[15],'Saved meeting point ID');assert.equal(all.headers[16],'Congregation ID');
 assert(seen.some(([id,to])=>id==='c4'&&to==='temporarily-missing'));
 context.driveState=()=>({status:'within',seconds:0,meters:0});const zero=assignmentSheets(context)[0].rows[1];assert.equal(zero[7],'0 min');assert.equal(zero[8],0);
 context.driveState=()=>({status:'within',seconds:120,meters:null});const missing=assignmentSheets(context)[0].rows[1];assert.equal(missing[7],'2 min');assert.equal(missing[8],'');assert.match(missing[9],/distance unavailable/);
});

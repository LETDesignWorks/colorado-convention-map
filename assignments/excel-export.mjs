import {serviceDaysLabel} from './service-days-model.mjs';
import {distanceMiles} from './location-model.mjs?v=homes-20261113-1';
import {buildAssignmentReport,DEFAULT_DELEGATES_PER_CONGREGATION} from './report-model.mjs';
import {assignmentChartParts} from './excel-chart-template.mjs';
const xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const encoder=new TextEncoder();
function crc32(bytes){let crc=-1;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
function zip(files){
 const chunks=[],central=[];let offset=0;
 const header=(length,values)=>{const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);for(const [i,n,size] of values)size===4?view.setUint32(i,n,true):view.setUint16(i,n,true);return bytes;};
 for(const [name,text] of Object.entries(files)){const path=encoder.encode(name),body=encoder.encode(text),crc=crc32(body);const local=header(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[12,0x21,2],[14,crc,4],[18,body.length,4],[22,body.length,4],[26,path.length,2]]);chunks.push(local,path,body);central.push(header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[14,0x21,2],[16,crc,4],[20,body.length,4],[24,body.length,4],[28,path.length,2],[42,offset,4]]),path);offset+=local.length+path.length+body.length;}
 const centralSize=central.reduce((n,p)=>n+p.length,0);chunks.push(...central,header(22,[[0,0x06054b50,4],[8,Object.keys(files).length,2],[10,Object.keys(files).length,2],[12,centralSize,4],[16,offset,4]]));const output=new Uint8Array(chunks.reduce((n,p)=>n+p.length,0));let at=0;for(const p of chunks){output.set(p,at);at+=p.length;}return output;
}
const col=n=>{let name='';for(n++;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
const worksheetNamespace='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNamespace='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNamespace='http://schemas.openxmlformats.org/package/2006/relationships';
const prolog='<?xml version="1.0" encoding="UTF-8"?>';
const formula=(formula,value,style=6)=>({formula,value,style});
const styled=(value,style)=>({value,style});

// Formula cells are explicitly constructed objects. User-entered strings, including
// strings beginning with =, remain literal inline strings in all directory sheets.
function cellXml(value,row,column,defaultStyle=0){
 const typed=value!==null&&typeof value==='object';
 const style=typed?(value.style??defaultStyle):defaultStyle;
 const current=typed?value.value:value,ref=col(column)+row;
 if(typed&&typeof value.formula==='string')return `<c r="${ref}" s="${style}"${typeof current==='string'?' t="str"':''}><f>${xml(value.formula.replace(/^=/,''))}</f><v>${xml(current)}</v></c>`;
 return typeof current==='number'&&Number.isFinite(current)?`<c r="${ref}" s="${style}"><v>${current}</v></c>`:`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(current)}</t></is></c>`;
}

function workbookStyles(){
 const xf=(font,fill,number=0,alignment='vertical="center" wrapText="1"')=>`<xf numFmtId="${number}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment ${alignment}/></xf>`;
 return `${prolog}<styleSheet xmlns="${worksheetNamespace}"><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF0B447E"/><sz val="16"/><name val="Calibri"/></font><font><color rgb="FF526174"/><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FF0B447E"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B447E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10">${xf(0,0,0,'vertical="top" wrapText="1"')}${xf(1,2)}${xf(0,3,0,'vertical="top" wrapText="1"')}${xf(2,0)}${xf(4,4,3,'horizontal="right" vertical="center"')}${xf(0,0,10,'horizontal="right" vertical="center"')}${xf(0,0,3,'horizontal="right" vertical="center"')}${xf(3,0)}${xf(4,0)}${xf(0,4)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function overviewSheet(report){
 const grid=Array.from({length:45},()=>[]);
 const set=(row,column,value)=>{grid[row-1][column-1]=value;};
 const last=Math.max(2,report.total+1);
 const roster=`'All congregations'!$Q$2:$Q$${last}`;
 const assignments=`'All congregations'!$P$2:$P$${last}`;
 const days=`'All congregations'!$O$2:$O$${last}`;
 set(2,1,styled('Congregation assignments',3));
 set(3,1,styled(`Complete roster • Exported ${report.generatedAt} • ${report.sharedReady?'Current shared information':'Shared information may be incomplete or cached; reconnect and export again.'}`,report.sharedReady?7:9));
 set(5,1,'Delegates per paired congregation');set(5,3,styled(report.delegatesPerCongregation,4));set(5,4,styled('Edit yellow cell (0–10,000)',7));
 set(7,1,styled('Assignment coverage',8));
 set(8,1,'Assigned');set(8,2,formula(`COUNTIF(${assignments},"?*")`,report.assigned));
 set(9,1,'Unassigned');set(9,2,formula('B10-B8',report.unassigned));
 set(10,1,'Total roster');set(10,2,formula(`COUNTA(${roster})`,report.total));
 set(11,1,'Assigned share');set(11,2,formula('IF(B10=0,0,B8/B10)',report.assignmentPercent/100,5));
 set(13,1,'Assigned congregations without weekday');set(13,5,formula(`COUNTIFS(${assignments},"?*",${days},"Not set")`,report.assignedWithoutDay));
 set(14,1,'Scheduled congregations without meeting location');set(14,5,formula(`COUNTIF(${days},"*day*")-COUNTIFS(${days},"*day*",${assignments},"?*")`,report.unassignedWithDay));
 set(16,1,styled('Every congregation at a meeting location counts separately. Each selected weekday is counted once.',7));
 grid[17]=['Weekday','Scheduled\ncongregations','Assigned\ncongregations','Without meeting\nlocation','Estimated\ndelegates'].map(v=>styled(v,1));
 report.days.forEach((day,index)=>{
  const row=index+19;
  set(row,1,day.day);set(row,2,formula(`COUNTIF(${days},"*"&A${row}&"*")`,day.totalCongregations));
  set(row,3,formula(`COUNTIFS(${days},"*"&A${row}&"*",${assignments},"?*")`,day.assignedCongregations));
  set(row,4,formula(`B${row}-C${row}`,day.unassignedCongregations));
  set(row,5,formula(`C${row}*$C$5`,day.estimatedDelegates));
 });
 set(27,1,styled('Estimated delegates = assigned congregations × C5. A weekday without a saved meeting location contributes no delegates.',7));
 return {name:'Overview',kind:'overview',report,grid};
}

function overviewXml(sheet){
 const merges=['A2:N2','A3:N3','A5:B5','D5:E5','A7:E7','A13:D13','A14:D14','A16:N16','A27:N27'];
 return `${prolog}<worksheet xmlns="${worksheetNamespace}" xmlns:r="${relationshipNamespace}"><sheetPr><tabColor rgb="FF0B447E"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:N45"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="5" width="18" customWidth="1"/><col min="6" max="7" width="4" customWidth="1"/><col min="8" max="14" width="12" customWidth="1"/></cols><sheetData>${sheet.grid.map((row,index)=>`<row r="${index+1}" ht="${index===0?8:index===1?28:index===17?38:20}" customHeight="1">${Array.from(row,(value,column)=>value===undefined?'':cellXml(value,index+1,column)).join('')}</row>`).join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><dataValidations count="1"><dataValidation type="whole" operator="between" allowBlank="0" showInputMessage="1" showErrorMessage="1" errorStyle="stop" errorTitle="Whole number needed" error="Enter a whole number from 0 to 10,000." promptTitle="Delegate estimate" prompt="Delegates per congregation paired with a meeting location. Change this value to update every weekday estimate and chart." sqref="C5"><formula1>0</formula1><formula2>10000</formula2></dataValidation></dataValidations><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="1"/><drawing r:id="rIdCharts"/></worksheet>`;
}

function meetingLocationSheet(report,locations,assignmentFor,tripFor){
 const points=new Map(locations.map(point=>[String(point.id),point])),groups=new Map();
 for(const record of report.records){
  if(!record.assigned)continue;
  const saved=assignmentFor(record.id),point=points.get(record.meetingPointId);
  if(!groups.has(record.meetingPointId))groups.set(record.meetingPointId,{id:record.meetingPointId,name:record.meetingPointName,address:point?.address||saved?.meetingPointAddress||'',records:[]});
  const group=groups.get(record.meetingPointId);
  if(!group.address)group.address=point?.address||saved?.meetingPointAddress||'';
  group.records.push(record);
 }
 const compare=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||a.id.localeCompare(b.id);
 const sections=[...groups.values()].sort(compare);
 const unassigned=report.records.filter(record=>!record.assigned);
 if(unassigned.length||!sections.length)sections.push({id:'',name:'Unassigned congregations',address:'No meeting location assigned',records:unassigned});
 const rows=[],groupRows=[],grayRows=[];
 for(const group of sections){
  groupRows.push(rows.length);
  rows.push([group.name,group.address||'Address not provided',`${group.records.length} ${group.id?'assigned':'unassigned'} congregation${group.records.length===1?'':'s'}`,'','',group.id,'','','','']);
  for(const record of [...group.records].sort(compare)){
   const trip=tripFor(record.id);if(trip.over)grayRows.push(rows.length);
   rows.push(['','',record.name,record.number,serviceDaysLabel(record.days),'',trip.address,trip.time,trip.miles,trip.note]);
  }
 }
 return {name:'By meeting location',kind:'meeting-groups',headers:['Meeting for service location','Location address','Congregation / assigned count','Congregation number','Service participation days','Meeting location ID','Congregation hall address','Estimated drive time','Driving distance (miles)','Travel status'],widths:[34,42,38,20,30,24,42,22,24,42],rows,groupRows,grayRows};
}

function assignedTrip(home,record,travel){
 const base={address:home.address||'',minutes:'',time:'',miles:'',over:false,note:'Not assigned to a meeting location'};
 if(!record?.assigned)return base;
 const valid=['within','over'].includes(travel?.status)&&typeof travel.seconds==='number'&&Number.isFinite(travel.seconds)&&travel.seconds>=0;
 if(!valid)return {...base,note:travel?.status==='no-destination'?'Meeting location map pin unavailable':travel?.status==='pending'?'Travel estimate not ready — export again':travel?.label||'Travel estimate unavailable'};
 const minutes=Math.ceil(travel.seconds/60),hasDistance=typeof travel.meters==='number'&&Number.isFinite(travel.meters)&&travel.meters>=0;
 return {...base,minutes,time:minutes>=60?`${Math.floor(minutes/60)} hr ${minutes%60} min`:`${minutes} min`,miles:hasDistance?Number((travel.meters/1609.344).toFixed(1)):'',over:travel.status==='over',note:(travel.status==='over'?'Over 1 hr 20 min. ':'')+(hasDistance?'Estimated drive; no live traffic.':'Road distance unavailable; drive time only.')};
}

export function workbookBytes(sheets){
 const files={'_rels/.rels':`${prolog}<Relationships xmlns="${packageNamespace}"><Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="xl/workbook.xml"/></Relationships>`};
 const overviewIndex=sheets.findIndex(sheet=>sheet.kind==='overview');
 if(overviewIndex>=0){
  Object.assign(files,assignmentChartParts(sheets[overviewIndex].report));
  files[`xl/worksheets/_rels/sheet${overviewIndex+1}.xml.rels`]=`${prolog}<Relationships xmlns="${packageNamespace}"><Relationship Id="rIdCharts" Type="${relationshipNamespace}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
 }
 const chartTypes=overviewIndex<0?'':`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${[1,2,3].map(i=>`<Override PartName="/xl/drawings/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')}`;
 files['[Content_Types].xml']=`${prolog}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${chartTypes}</Types>`;
 files['xl/workbook.xml']=`${prolog}<workbook xmlns="${worksheetNamespace}" xmlns:r="${relationshipNamespace}"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets>${overviewIndex<0?'':`<definedNames><definedName name="_xlnm.Print_Area" localSheetId="${overviewIndex}">&apos;Overview&apos;!$A$1:$N$45</definedName></definedNames>`}<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
 files['xl/_rels/workbook.xml.rels']=`${prolog}<Relationships xmlns="${packageNamespace}">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${relationshipNamespace}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${relationshipNamespace}/styles" Target="styles.xml"/></Relationships>`;
 files['xl/styles.xml']=workbookStyles();
 sheets.forEach((s,i)=>{
  if(s.kind==='overview'){files[`xl/worksheets/sheet${i+1}.xml`]=overviewXml(s);return;}
  const rows=[s.headers,...s.rows],end=`${col(s.headers.length-1)}${rows.length}`;
  const grouped=s.kind==='meeting-groups';
  files[`xl/worksheets/sheet${i+1}.xml`]=`${prolog}<worksheet xmlns="${worksheetNamespace}">${grouped?'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>':''}<dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="32"/><cols>${s.headers.map((h,j)=>`<col min="${j+1}" max="${j+1}" width="${s.widths?.[j]||(/address|name|point|status|congregation|note/i.test(h)?32:19)}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,r)=>`<row r="${r+1}"${r===0?' ht="34" customHeight="1"':s.groupRows?.includes(r-1)?' ht="48" customHeight="1"':''}>${row.map((v,c)=>cellXml(v,r+1,c,r===0||s.groupRows?.includes(r-1)?1:s.grayRows?.includes(r-1)?2:0)).join('')}</row>`).join('')}</sheetData>${grouped?'<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>':`<autoFilter ref="A1:${end}"/>`}</worksheet>`;
 });
 return zip(files);
}
export function assignmentSheets({congregations,visible,selected,locations,resolveHome,assignmentFor,driveState,point,serviceDaysFor=()=>[],delegatesPerCongregation=DEFAULT_DELEGATES_PER_CONGREGATION,sharedReady,now=new Date()}){
 const report=buildAssignmentReport({congregations,locations,assignmentFor,serviceDaysFor,delegatesPerCongregation,sharedReady,now});
 const reportRecords=new Map(report.records.map(record=>[record.id,record]));
 const originals=new Map();for(const congregation of congregations){const id=String(congregation.id??'').trim();if(!originals.has(id))originals.set(id,congregation);}
 const roster=report.records.map(record=>originals.get(record.id));
 const trips=new Map(report.records.map(record=>{const c=originals.get(record.id);return [record.id,assignedTrip(resolveHome(c),record,record.assigned?driveState(c,record.meetingPointId):null)];}));
 const tripFor=id=>trips.get(String(id).trim())||{address:'',minutes:'',time:'',miles:'',over:false,note:'Not assigned to a meeting location'};
 function withAssignedTravel(sheet,cs){
  sheet.headers=[...sheet.headers,'Assigned meeting drive minutes','Assigned meeting road miles','Assigned meeting travel status'];
  sheet.rows=sheet.rows.map((values,index)=>{const trip=tripFor(cs[index].id);return [...values,trip.minutes,trip.miles,trip.note];});
  return sheet;
 }
 const labels={mapped:'Address mapped',missing:'Missing address','pin-needed':'Address needs map pin',review:'Address needs review'};
 const headers=['Congregation number','Congregation name','Language','Congregation address','Address status','Selected now (unsaved)','Saved meeting point','Saved meeting point address','Comparison meeting point','Straight-line miles','Estimated drive minutes','Travel status / assignment eligibility','Latitude','Longitude','Service participation days'];
 const row=c=>{const home=resolveHome(c),a=assignmentFor(c.id),record=reportRecords.get(String(c.id).trim()),saved=locations.find(p=>String(p.id)===record?.meetingPointId),travel=point?driveState(c,point.id):null;return [c.number||'',c.name,c.language||'',home.address,labels[home.status],selected.has(c.id)?'Yes':'No',record?.assigned?record.meetingPointName:'Unassigned',record?.assigned?saved?.address||a?.meetingPointAddress||'':'',point?.name||'',point&&home.point?Number(distanceMiles(home.point,point).toFixed(2)):'',travel?.seconds!=null?Math.ceil(travel.seconds/60):'',travel?.label||'No comparison meeting point selected',home.point?.lat??'',home.point?.lng??'',serviceDaysLabel(record?.days||[])];};
 const sheet=(name,cs)=>({name,headers,rows:cs.map(row),grayRows:cs.flatMap((c,i)=>point&&driveState(c,point.id).status==='over'?[i]:[])});
 const all=sheet('All congregations',roster);
 all.headers=[...headers,'Saved meeting point ID','Congregation ID'];
 all.rows=all.rows.map((values,index)=>[...values,report.records[index].meetingPointId,report.records[index].id]);
 return [meetingLocationSheet(report,locations,assignmentFor,tripFor),overviewSheet(report),withAssignedTravel(sheet('Current directory',visible),visible),withAssignedTravel(all,roster),withAssignedTravel(sheet('Selected congregations',roster.filter(c=>selected.has(c.id))),roster.filter(c=>selected.has(c.id))),{name:'Meeting points',headers:['ID','Meeting point','Address','Type','Saved congregation count','Latitude','Longitude'],rows:locations.map(p=>[p.id,p.name,p.address||'',p.locationType||'',report.records.filter(record=>record.meetingPointId===String(p.id)).length,p.lat,p.lng])},{name:'Read me',headers:['Item','Details'],widths:[34,100],rows:[['Exported at',now.toISOString()],['By meeting location','The first worksheet groups all saved assignments by meeting-for-service location, with its address, assigned congregation count, and each congregation and its service days underneath. Locations are kept separate by ID, even when names match. Unassigned congregations appear at the bottom. This sheet uses the complete roster regardless of filters or unsaved selections; the Meeting points sheet also lists locations with no assignments. Re-export after website changes.'],['Overview graphs','Native Excel bar charts show assigned versus unassigned congregations, scheduled congregations by weekday, and estimated delegates by weekday. The complete roster is used regardless of directory filters or checkbox selections.'],['Editable delegate estimate','Change the yellow Overview!C5 cell (whole number from 0 to 10,000). Daily delegate formulas and the native chart recalculate in Excel. Each congregation paired with a saved meeting location contributes this number on each selected weekday.'],['Weekday counting','A congregation with several weekdays counts once on each weekday. Congregations sharing a location count separately. Scheduled congregations without a saved meeting location count in the schedule but contribute no delegates.'],['Workbook data','This file is a snapshot at export time. Re-export to include later saved website changes. Overview formulas read the complete All congregations sheet; existing rows can be edited there. Saved meeting point ID and Congregation ID are source keys for counts.'],['Printing','The Overview tab is set to one landscape page. The website also provides a PDF report.'],['Comparison meeting point',point?.name||'None selected'],['Travel limit','Over 80 minutes is grayed out and blocked from new assignments. Unknown travel times must be checked before assigning. Existing assignments are preserved.'],['Travel estimates','OSRM road-driving estimates. No live traffic, stops or bus allowance. Confirm actual departure-day travel time. Assigned-trip columns use each congregation hall address and its saved meeting location, regardless of the currently selected comparison location. Missing pins or unavailable routes leave travel values blank and display a note. Comparison columns still describe the separately selected comparison point.'],['Distance','Driving distance is road mileage along the estimated driving route to the saved meeting location. Straight-line miles belong only to the separately labeled comparison columns and directory sorting.'],['Selection','Selected now is an unsaved checkbox selection; saved meeting point is the shared assignment.'],['Shared information',sharedReady?'Current shared assignments and address edits loaded.':'Shared data unavailable or cached. Assignments/address edits may be incomplete; reconnect and export again.'],['Missing addresses','Blank addresses or pins are flagged. No locations are guessed.'],['Scope','Current directory follows the current filters and order. All congregations includes the complete directory, once per congregation ID.'],['Source roster','211 congregations from Congregations.xlsx, plus 3 previously listed congregations retained.']]}];
}
export function downloadAssignmentWorkbook(context){const bytes=workbookBytes(assignmentSheets(context)),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Denver-2027-Congregation-Assignments-${new Date().toISOString().slice(0,10)}.xlsx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

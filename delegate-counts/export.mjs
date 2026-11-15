import {workbookBytes} from '../assignments/excel-export.mjs?v=assigned-travel-20261115-1';
import {CATEGORIES,dailyCounts} from './model.mjs';
export function countSheets(records,{date='',category='all',search='',fresh=false,now=new Date()}={}){
 return [
  {name:'Delegate counts',headers:['Planning date','Location type','Location','Address','Delegates','Notes'],widths:[18,26,38,46,15,60],rows:records.map(r=>[r.date,CATEGORIES[r.category],r.locationName,r.locationAddress,r.count,r.notes])},
  {name:'Daily totals',headers:['Date','Activities — attendance','Service meetings — attendance','Hotels — staying overnight'],widths:[18,30,32,32],rows:dailyCounts(records).map(day=>[day.date,day.activity??'Not entered',day.meeting??'Not entered',day.hotel??'Not entered'])},
  {name:'Read me',headers:['Item','Details'],widths:[30,110],rows:[['Exported',now.toISOString()],['Shared information',fresh?'Current shared data.':'Cached or incomplete data. Reconnect and export again.'],['Date filter',date||'All dates'],['Location type',CATEGORIES[category]||'All types'],['Search filter',search||'None'],['Meaning','Counts are entered planning totals for each location and date, not live check-ins. Hotel dates refer to the night delegates stay.'],['Avoid double counting','A person may visit a service meeting and an activity and stay at a hotel on the same date. Categories are kept separate. Activity/service totals are attendance across locations, not unique delegates. Never add the three columns together as a headcount.'],['Not entered versus zero','Not entered means no count has been saved in this view for that category/date. Zero means an explicit count of zero was saved.'],['Changes','Re-export after changes to the website. Editing this workbook does not change shared counts.']]}
 ];
}
export function downloadCounts(records,options){
 const blob=new Blob([workbookBytes(countSheets(records,options))],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='Denver-2027-Delegate-Counts'+(options.date?'-'+options.date:'')+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

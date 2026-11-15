export const RECORD_TYPE='delegate-count';
export const CATEGORIES={activity:'Activities',meeting:'Meetings for service',hotel:'Hotels'};
const text=(value,max,label,required=false)=>{if(typeof value!=='string'||value.trim().length>max||required&&!value.trim())throw Error('Enter a valid '+label+'.');return value.trim();};
export function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2100&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function countId(value){return 'delegate-count-'+value.date+'-'+value.category+'-'+value.locationId;}
export function nextRevision(existing,expectedRevision){
 if(expectedRevision===null){if(existing)throw Error('A count already exists for this location and date. Open its saved entry to edit it.');return 1;}
 if(!existing||existing.recordType!==RECORD_TYPE||!Number.isInteger(expectedRevision)||existing.revision!==expectedRevision)throw Error('This count changed elsewhere. Reopen its saved entry before trying again.');
 return expectedRevision+1;
}
export function countPayload(value){
 if(!validDate(value.date))throw Error('Choose a valid planning date.');
 if(!Object.hasOwn(CATEGORIES,value.category))throw Error('Choose an activity, meeting for service, or hotel.');
 if(typeof value.locationId!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(value.locationId))throw Error('Choose a valid location.');
 if(!['number','string'].includes(typeof value.count)||String(value.count).trim()==='')throw Error('Enter the number of delegates.');
 const count=Number(value.count);if(!Number.isInteger(count)||count<0||count>100000)throw Error('Delegate count must be a whole number from 0 to 100,000.');
 return {recordType:RECORD_TYPE,schemaVersion:1,date:value.date,category:value.category,locationId:value.locationId,locationName:text(value.locationName,140,'location name',true),locationAddress:text(value.locationAddress??'',300,'location address'),count,notes:text(value.notes??'',1000,'notes')};
}
export function readCounts(records){
 const counts=[],seen=new Set();let invalid=0;
 for(const record of records){try{const payload=countPayload(record);if(record.recordType!==RECORD_TYPE||record.schemaVersion!==1||record.id!==countId(payload)||!Number.isInteger(record.revision)||record.revision<1||seen.has(record.id))throw Error('Invalid saved count');seen.add(record.id);counts.push({...payload,id:record.id,revision:record.revision});}catch{invalid++;}}
 counts.sort((a,b)=>a.date.localeCompare(b.date)||a.category.localeCompare(b.category)||a.locationName.localeCompare(b.locationName));return {counts,invalid};
}
export function filterCounts(records,{date='',category='all',search=''}={}){const q=search.trim().toLowerCase();return records.filter(r=>(!date||r.date===date)&&(category==='all'||r.category===category)&&(!q||[r.locationName,r.locationAddress,r.notes].join(' ').toLowerCase().includes(q)));}
export function dailyCounts(records){
 const dates=new Map();for(const row of records){if(!dates.has(row.date))dates.set(row.date,{date:row.date,activity:null,meeting:null,hotel:null});const day=dates.get(row.date);day[row.category]=(day[row.category]??0)+row.count;}
 return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function locationCategory(point){
 if(point.group==='Hotels')return 'hotel';
 if(['Activities','Convention centers'].includes(point.group))return 'activity';
 if(['Field service / meeting places','Rail stations'].includes(point.group)||['kingdom-hall','meeting-area','rail-station'].includes(point.locationType))return 'meeting';
 return null;
}
export function countLocations(points,records=[]){
 const all=new Map();for(const point of points){const category=locationCategory(point),id=String(point.id??'');if(category&&/^[-A-Za-z0-9_]{1,120}$/.test(id))all.set(category+'|'+id,{id,category,name:point.name,address:point.address||''});}
 for(const record of records){const key=record.category+'|'+record.locationId;if(!all.has(key))all.set(key,{id:record.locationId,category:record.category,name:record.locationName,address:record.locationAddress});}
 return [...all.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

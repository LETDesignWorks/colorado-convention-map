import test from 'node:test';
import assert from 'node:assert/strict';
import {countPayload,countId,nextRevision,readCounts,dailyCounts,filterCounts,countLocations,validDate} from '../delegate-counts/model.mjs';
import {countSheets} from '../delegate-counts/export.mjs';
import {workbookBytes} from '../assignments/excel-export.mjs';
const payload=(overrides={})=>countPayload({date:'2027-07-16',category:'hotel',locationId:'H1',locationName:'Hotel One',locationAddress:'1 Main Street',count:50,notes:'',...overrides});
const saved=(overrides={})=>{const p=payload(overrides);return {...p,id:countId(p),revision:1};};
test('counts validate actual dates and whole numbers, retaining an intentional zero',()=>{
 assert.equal(payload({count:'0'}).count,0);assert.equal(payload({count:'75'}).count,75);
 for(const count of ['',null,undefined,false,{},-1,0.5,NaN,Infinity,100001])assert.throws(()=>payload({count}));
 for(const date of ['2027-02-29','2027-02-30','2027-13-01','27-01-01',''])assert(!validDate(date));
 assert(validDate('2028-02-29'));assert.throws(()=>payload({category:'bus'}));assert.throws(()=>payload({locationId:'../other'}));assert.throws(()=>payload({locationName:''}));
});
test('one record per location/date/category prevents duplicate totals and protects concurrent edits',()=>{
 const a=saved(),b=saved({category:'activity'});assert.notEqual(a.id,b.id);assert.notEqual(a.id,saved({date:'2027-07-17'}).id);
 assert.equal(nextRevision(null,null),1);assert.throws(()=>nextRevision(a,null));assert.equal(nextRevision(a,1),2);assert.throws(()=>nextRevision({...a,revision:2},1));assert.throws(()=>nextRevision(null,1));assert.throws(()=>nextRevision({recordType:'bus-route',revision:1},1));
 const read=readCounts([a,{...a,count:100},{...b,count:-10}]);assert.equal(read.counts.length,1);assert.equal(read.invalid,2);assert.equal(read.counts[0].count,50);
});
test('hotel, activity and service totals stay separate; missing counts differ from zero',()=>{
 const records=[saved(),saved({category:'meeting',locationId:'26',count:50}),saved({category:'activity',locationId:'park',count:50}),saved({category:'activity',locationId:'gathering',count:25}),saved({date:'2027-07-17',count:0})];
 assert.deepEqual(dailyCounts(records),[{date:'2027-07-16',hotel:50,activity:75,meeting:50},{date:'2027-07-17',hotel:0,activity:null,meeting:null}]);
 assert.equal(filterCounts(records,{date:'2027-07-16',category:'activity'}).length,2);assert.equal(filterCounts(records,{search:'Main Street'}).length,5);
});
test('location choices include saved custom locations and rail meeting points without conflating categories',()=>{
 const locations=countLocations([{id:'H1',name:'New hotel name',group:'Hotels'},{id:'rtd-66',name:'Rail station',locationType:'rail-station'},{id:'ccc',name:'Convention Center',group:'Convention centers'}],[saved(),saved({category:'activity',locationId:'custom-1',locationName:'Custom gathering'})]);
 assert.equal(locations.length,4);assert.equal(locations.find(p=>p.id==='H1').name,'New hotel name');assert.equal(locations.find(p=>p.id==='rtd-66').category,'meeting');assert.equal(locations.find(p=>p.id==='custom-1').category,'activity');
});
test('Excel export includes location details, dates, separate daily totals and cached-data disclosure',()=>{
 const records=[saved({count:0,notes:'=HYPERLINK("https://example.invalid")'}),saved({category:'meeting',locationId:'26',count:55})],sheets=countSheets(records,{fresh:false,date:'2027-07-16'});
 assert.equal(sheets[0].rows[0][4],0);assert.deepEqual(sheets[1].rows[0],['2027-07-16','Not entered',55,0]);assert.match(sheets[2].rows[1][1],/Cached/);
 const bytes=workbookBytes(sheets),xml=new TextDecoder().decode(bytes);assert.equal(bytes[0],80);assert.match(xml,/t="inlineStr"/);assert.match(xml,/=HYPERLINK\(&quot;/);assert.doesNotMatch(xml,/<f>/);
});

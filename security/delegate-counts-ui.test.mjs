import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountDelegateCounts} from '../delegate-counts/ui.mjs';
import {countPayload,countId} from '../delegate-counts/model.mjs';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function record(overrides={}){const p=countPayload({date:'2027-07-16',category:'hotel',locationId:'H1',locationName:'Hotel One',locationAddress:'1 Main Street',count:50,notes:'',...overrides});return {...p,id:countId(p),revision:1};}
function fixture(){
 const dom=new JSDOM('<section id="root"></section>',{url:'https://example.test/activity-planning/'}),root=dom.window.document.getElementById('root'),saves=[],removals=[],exports=[];
 let pending=null,fail=false;
 const ui=mountDelegateCounts(root,{save:async(p,revision)=>{saves.push({p,revision});if(pending)await pending;if(fail)throw Error('Changed elsewhere');},remove:async r=>removals.push(r),exportCounts:(r,o)=>exports.push({r,o}),makeId:()=> 'test-location'});
 const points=[{id:'H1',name:'Hotel One',address:'1 Main Street',group:'Hotels'},{id:'26',name:'Service Hall',group:'Field service / meeting places'},{id:'park',name:'Park',group:'Activities'}];
 ui.setData({points,access:true,edit:true,loaded:true,fresh:true,records:[],message:''});
 const $=selector=>root.querySelector(selector);
 const change=(selector,value)=>{const el=$(selector);el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 return {dom,root,ui,$,change,saves,removals,exports,setPending:p=>pending=p,setFail:v=>fail=v,submit:()=>$('[data-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))};
}
test('counts save by location/date, duplicate new entries are blocked and existing entries retain their revision',async()=>{
 const f=fixture();f.change('[data-category]','hotel');f.change('[data-location]','H1');f.change('[data-date]','2027-07-16');f.change('[data-count]','50');f.submit();await settle();assert.equal(f.saves.length,1);assert.equal(f.saves[0].revision,null);assert.equal(f.saves[0].p.count,50);
 f.ui.setData({records:[record()]});f.$('[data-new]').click();f.change('[data-category]','hotel');f.change('[data-location]','H1');f.change('[data-date]','2027-07-16');f.change('[data-count]','60');f.submit();await settle();assert.equal(f.saves.length,1);assert.match(f.$('[data-message]').textContent,/already has a count/);
 f.$('[data-edit]').click();assert.equal(f.$('[data-date]').disabled,true);f.change('[data-count]','65');f.submit();await settle();assert.equal(f.saves[1].revision,1);assert.equal(f.saves[1].p.count,65);f.dom.window.close();
});
test('custom addresses persist in payloads and failed writes keep the draft',async()=>{
 const f=fixture();f.change('[data-category]','activity');f.change('[data-location]','custom');f.change('[data-custom-name]','Encouraging Gathering');f.change('[data-custom-address]','123 Gather St');f.change('[data-date]','2027-07-16');f.change('[data-count]','75');f.setFail(true);f.submit();await settle();
 assert.equal(f.saves[0].p.locationId,'custom-test-location');assert.equal(f.saves[0].p.locationAddress,'123 Gather St');assert.equal(f.$('[data-count]').value,'75');assert.match(f.$('[data-message]').textContent,/Could not save/);f.dom.window.close();
});
test('daily category totals distinguish missing data, saved zeroes and unreadable data',()=>{
 const f=fixture();f.ui.setData({records:[record({count:0}),record({category:'activity',locationId:'park',count:40})]});f.change('[data-filter-date]','2027-07-16');
 const values=[...f.root.querySelectorAll('.dc-total strong')].map(el=>el.textContent);assert.deepEqual(values,['40','Not entered','0']);
 f.ui.setData({loaded:false,records:[]});assert([...f.root.querySelectorAll('.dc-total strong')].every(el=>el.textContent==='Loading…'));assert.equal(f.$('[data-export]').disabled,true);f.dom.window.close();
});
test('read-only and offline users cannot write; removing a count requires the specific confirmation',async()=>{
 const f=fixture();f.ui.setData({records:[record()],edit:false});assert.equal(f.$('[data-edit]').disabled,true);f.$('[data-remove]').click();assert.equal(f.$('[data-confirm-remove]'),null);
 f.ui.setData({edit:true,fresh:false});f.submit();await settle();assert.equal(f.saves.length,0);
 f.ui.setData({fresh:true});f.$('[data-remove]').click();assert.equal(f.removals.length,0);f.$('[data-confirm-remove]').click();await settle();assert.equal(f.removals[0].id,record().id);f.dom.window.close();
});
test('access revocation clears private content and ignores a late save result',async()=>{
 const f=fixture();f.ui.setData({records:[record({notes:'Private reservation'})]});f.$('[data-edit]').click();let finish;f.setPending(new Promise(resolve=>finish=resolve));f.submit();
 f.ui.setData({reset:true,access:false,edit:false,fresh:false,records:[]});finish();await settle();assert(!f.root.textContent.includes('Private reservation'));assert(!f.root.textContent.includes('Delegate count saved'));assert.equal(f.$('[data-table]').innerHTML,'');assert.equal(f.$('[data-count]').value,'');f.dom.window.close();
});
test('location names render as text and export respects date and category filters',()=>{
 const f=fixture();f.ui.setData({records:[record({locationName:'<img src=x onerror=alert(1)>'}),record({category:'meeting',locationId:'26',count:30})]});assert.equal(f.root.querySelector('img'),null);
 f.change('[data-filter-date]','2027-07-16');f.change('[data-filter-category]','meeting');f.$('[data-export]').click();assert.equal(f.exports[0].r.length,1);assert.equal(f.exports[0].r[0].count,30);f.dom.window.close();
});

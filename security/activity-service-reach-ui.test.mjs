import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountServiceReach} from '../activity-planning/service-reach-ui.mjs';
const settle=()=>new Promise(r=>setTimeout(r,5));
function fixture({route,findAddress}={}){
 const dom=new JSDOM('<section id="root"></section>'),root=dom.window.document.getElementById('root'),exports=[],calls=[];
 const ui=mountServiceReach(root,{now:()=>new Date('2027-07-15T15:00:00Z'),findAddress,route:route||(async(...args)=>{calls.push(args);return {minutes:{fast:10,mid:20,slow:40,late:90}[args[1].id],miles:12,label:'Road baseline'};}),exportResult:(r,keys)=>exports.push({r,keys})});
 const points=[{id:'activity',name:'Activity One',address:'1 Main St',lat:39.7,lng:-105,group:'Activities'},...['fast','mid','slow','late','missing'].map(id=>({id,name:id,address:'2 Hall St',lat:id==='missing'?null:39.8,lng:-105,group:'Field service / meeting places',busStatus:'approved'}))];ui.setLocations(points);
 const $=s=>root.querySelector(s),field=name=>$('[data-reach-'+name+']'),event=(el,name)=>el.dispatchEvent(new dom.window.Event(name,{bubbles:true,cancelable:true}));
 return {dom,root,ui,calls,exports,$,field,event,change:(name,value)=>{field(name).value=value;event(field(name),'change');},input:(name,value)=>{field(name).value=value;event(field(name),'input');},submit:()=>event(field('form'),'submit')};
}
test('fleet summary names one destination per bus, supports swaps and recalculates bus counts without new routes',async()=>{
 const f=fixture();f.input('buses','2');f.submit();await settle();assert.equal(f.root.querySelectorAll('.reach-names li').length,2);assert.match(f.field('status').textContent,/2 buses can serve up to 2/);assert.equal(f.root.querySelectorAll('tbody tr').length,3);
 const choose=key=>f.$('[data-reach-pick="meeting:'+key+'"]').click();choose('slow');assert.match(f.field('status').textContent,/Uncheck a location/);choose('mid');choose('slow');assert.match(f.$('.reach-names').textContent,/slow/);assert(!f.$('.reach-names').textContent.includes('mid'));
 f.field('export').click();assert.deepEqual(f.exports[0].keys,['meeting:fast','meeting:slow']);const count=f.calls.length;f.input('buses','10');assert.equal(f.calls.length,count);assert.equal(f.root.querySelectorAll('.reach-names li').length,3);assert.match(f.field('results').textContent,/7 buses without a destination/);
 f.field('show-all').click();assert.equal(f.root.querySelectorAll('tbody tr').length,5);f.dom.window.close();
});
test('unit switches preserve elapsed time and timing edits discard stale bus choices',async()=>{
 const f=fixture();f.change('unit','hours');assert.equal(f.field('duration').value,'1.5');f.submit();await settle();assert.equal(f.field('results').hidden,false);f.input('start','2027-07-16T08:00');assert.equal(f.field('results').hidden,true);assert.equal(f.field('export'),null);f.dom.window.close();
});
test('cancel suppresses late routing results',async()=>{
 const finish=[];const f=fixture({route:()=>new Promise(resolve=>finish.push(resolve))});f.submit();f.field('cancel').click();finish.forEach(resolve=>resolve({minutes:10,miles:2}));await settle();assert.equal(f.field('results').hidden,true);assert.match(f.field('status').textContent,/canceled/);f.dom.window.close();
});
test('custom address lookup requires choosing a building and does not use area-only matches',async()=>{
 const f=fixture({findAddress:async()=>[{address:'City area',lat:40,lng:-105,approximate:true},{address:'123 Building St',lat:39.7,lng:-104.9,name:'Gathering',approximate:false}]});f.change('origin','custom');f.input('address','123 Building St');f.field('find').click();await settle();assert.equal(f.$('[data-reach-match="0"]').disabled,true);f.$('[data-reach-match="1"]').click();assert.equal(f.field('lat').value,'39.7');assert.equal(f.field('name').value,'Gathering');f.input('address','Other address');assert.equal(f.field('lat').value,'');f.dom.window.close();
});

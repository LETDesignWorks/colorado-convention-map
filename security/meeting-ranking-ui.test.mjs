import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountMeetingRanking} from '../travel-routes/meeting-ranking-ui.mjs';
const settle=()=>new Promise(r=>setTimeout(r,5));
function fixture(route=async(_a,b)=>({minutes:b.id==='fast'?10:40,miles:12,label:'Example'})){
 const dom=new JSDOM('<section id="root"></section>'),root=dom.window.document.getElementById('root'),uses=[];let key='';
 const ui=mountMeetingRanking(root,{route,getKey:()=>key,onUse:trip=>uses.push(trip),now:()=>new Date('2027-07-15T15:00:00Z')});
 ui.updateLocations([{id:'slow',name:'Far hall',address:'2 Main St',lat:39.9,lng:-105,group:'Field service / meeting places',busStatus:'conditional'},{id:'fast',name:'Near hall',address:'1 Main St',lat:39.8,lng:-105,group:'Field service / meeting places',busStatus:'approved'}]);
 const $=s=>root.querySelector(s),event=(el,name)=>el.dispatchEvent(new dom.window.Event(name,{bubbles:true,cancelable:true}));
 return {dom,root,ui,uses,$,event,setKey:k=>key=k,submit:()=>event($('[data-rank-form]'),'submit')};
}
test('quickest meeting is first, source is explicit, and use trip retains departure and transport',async()=>{
 const f=fixture();f.$('[data-rank-time]').value='07:56';f.event(f.$('[data-rank-time]'),'input');assert.equal(f.$('[data-rank-preset]').value,'custom');f.submit();await settle();
 assert.match(f.$('tbody tr').textContent,/Near hall/);assert.match(f.$('caption').textContent,/no rush-hour traffic/);f.$('[data-rank-use]').click();assert.equal(f.uses[0].origin.id,'ccc');assert.equal(f.uses[0].destination.id,'fast');assert.equal(f.uses[0].time,'2027-07-16T07:56');assert.equal(f.uses[0].mode,'bus');f.dom.window.close();
});
test('changing time or key clears stale estimates and traffic data is labeled only with a key',async()=>{
 const f=fixture();f.submit();await settle();f.$('[data-rank-preset]').value='pm';f.event(f.$('[data-rank-preset]'),'change');assert.equal(f.$('[data-rank-time]').value,'17:00');assert.equal(f.$('table'),null);
 f.setKey('not-exported');f.submit();await settle();assert.match(f.$('caption').textContent,/TomTom/);assert(!f.root.textContent.includes('not-exported'));f.setKey('');f.ui.invalidate();assert.equal(f.$('table'),null);assert.match(f.$('[data-rank-source]').textContent,/No TomTom key/);f.dom.window.close();
});
test('cancel and changed settings suppress late results',async()=>{
 const finish=[];const f=fixture(()=>new Promise(resolve=>finish.push(resolve)));f.submit();assert.equal(f.$('[data-rank-start]').disabled,true);f.$('[data-rank-cancel]').click();finish.forEach(resolve=>resolve({minutes:12,miles:3}));await settle();assert.equal(f.$('table'),null);assert.equal(f.$('[data-rank-start]').disabled,false);assert.match(f.$('[data-rank-status]').textContent,/canceled/);f.dom.window.close();
});
test('invalid pins stay unranked and location names are escaped',async()=>{
 const f=fixture();f.ui.updateLocations([{id:'bad',name:'<img src=x onerror=alert(1)>',address:'Missing address',lat:null,lng:null,group:'Field service / meeting places'}]);f.submit();await settle();assert.match(f.$('tbody').textContent,/Missing map pin/);assert.equal(f.$('img'),null);assert.equal(f.$('[data-rank-use]'),null);assert.match(f.$('[data-rank-status]').textContent,/0 locations ranked/);f.dom.window.close();
});

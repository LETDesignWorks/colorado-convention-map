import test from 'node:test';
import assert from 'node:assert/strict';
import {CONVENTION_CENTER,rankingSettings,meetingCandidates,rankMeetings} from '../travel-routes/meeting-ranking.mjs';
const settings=rankingSettings({date:'2027-07-16',time:'07:56',mode:'bus'});
const point=(id,extra={})=>({id,name:id,lat:39.8,lng:-105,group:'Field service / meeting places',...extra});
test('ranking presets and arbitrary times resolve to Denver time, including winter and invalid DST gaps',()=>{
 assert.equal(new Date(settings.at).toISOString(),'2027-07-16T13:56:00.000Z');
 assert.equal(rankingSettings({date:'2027-01-04',preset:'am',mode:'car'}).local,'2027-01-04T08:00');
 assert.equal(new Date(rankingSettings({date:'2027-01-04',preset:'pm'}).at).toISOString(),'2027-01-05T00:00:00.000Z');
 assert.throws(()=>rankingSettings({date:'2027-03-14',time:'02:30'}));assert.throws(()=>rankingSettings({date:'2027-02-30',time:'08:00'}));
});
test('meeting selection excludes unsuitable places and optional rail while retaining missing pins for review',()=>{
 const locations=[point('one'),point('one'),point('bad',{busStatus:'not-suitable'}),point('missing',{lat:null}),point('rail',{group:'Rail stations'}),point('hotel',{group:'Hotels'})];
 assert.deepEqual(meetingCandidates(locations,settings).map(p=>p.id),['one','missing']);
 assert.equal(meetingCandidates(locations,{...settings,includeRail:true,includeUnsuitable:true}).length,4);
});
test('ranking uses CCC origin, time and mode, limits concurrency, and puts failures after valid results',async()=>{
 let active=0,max=0;const calls=[];
 const route=async(...args)=>{calls.push(args);max=Math.max(max,++active);await new Promise(r=>setTimeout(r,2));active--;if(args[1].id==='fail')throw Error('secret key');return {minutes:args[1].id==='fast'?10:55,miles:20,label:'Provider'};};
 const rows=await rankMeetings([point('slow'),point('fail'),point('fast'),point('missing',{lat:null})],{settings,key:'private-key',route});
 assert.equal(max,2);assert.deepEqual(rows.map(r=>r.point.id),['fast','slow','fail','missing']);assert.equal(rows[3].minutes,undefined);
 for(const args of calls){assert.equal(args[0],CONVENTION_CENTER);assert.equal(args[2],settings.at);assert.equal(args[3],false);assert.equal(args[4],'bus');assert.equal(args[5],'private-key');}
 assert(!JSON.stringify(rows).includes('secret key'));assert(!JSON.stringify(rows).includes('private-key'));
});
test('cancel stops routing and provider timeouts produce an unavailable row',async()=>{
 const controller=new AbortController();let calls=0;
 const route=async(_a,_b,_t,_rev,_mode,_key,signal)=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Abort')),{once:true}));};
 const pending=rankMeetings([point('1'),point('2'),point('3')],{settings,route,signal:controller.signal});controller.abort();await assert.rejects(pending);assert.equal(calls,2);
 const rows=await rankMeetings([point('1')],{settings,route,timeoutMs:5});assert.match(rows[0].error,/unavailable/);
});

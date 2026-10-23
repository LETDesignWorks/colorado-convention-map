import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {arrowheads} from '../bus-access/traffic-model.mjs';
const p = (x,y=0) => ({x,y});
const near = (a,b,t=1e-7) => assert.ok(Math.abs(a-b)<t, `${a} should equal ${b}`);
const same = (a,b) => { assert.equal(a.length,b.length);a.forEach((v,i)=>{near(v.x,b[i].x);near(v.y,b[i].y);near(v.angle,b[i].angle);}); };
test('whole straight route has equal spacing and balanced end gaps',()=>{
 const a=arrowheads([p(0),p(25),p(26),p(55),p(350)]);
 assert.equal(a.length,4);near(a[0].x,43.75);near(350-a.at(-1).x,43.75);
 a.slice(1).forEach((v,i)=>near(v.x-a[i].x,87.5));
});
test('inserting uneven collinear editing points cannot change arrows',()=>{
 same(arrowheads([p(0),p(600)]),arrowheads([0,1,8,15,29,30,77,101,410,411,599,600].map(x=>p(x))));
});
test('many short segments still share one full-route arrow pattern',()=>{
 const a=arrowheads(Array.from({length:151},(_,i)=>p(i)));
 assert.deepEqual(a,[{x:37.5,y:0,angle:0},{x:112.5,y:0,angle:0}]);
});
test('even arc-length spacing continues around a right-angle bend',()=>{
 const a=arrowheads([p(0),p(100),p(100,200)]);
 assert.equal(a.length,4);
 const distances=a.map(v=>v.y===0?v.x:100+v.y);
 distances.forEach((d,i)=>near(d,37.5+75*i));
});
test('subdividing both sides of a bend does not alter placement or headings',()=>{
 same(arrowheads([p(0),p(100),p(100,200)]),arrowheads([p(0),p(4),p(40),p(100),p(100,3),p(100,89),p(100,200)]));
});
test('an arrow centered at a turn has a blended heading, without leaving the path',()=>{
 const a=arrowheads([p(0),p(50),p(50,50)]);
 assert.equal(a.length,1);near(a[0].x,50);near(a[0].y,0);near(a[0].angle,45);
});
test('short neighboring segments no longer create a cluster of arrows',()=>{
 const a=arrowheads([p(0),p(15),p(30),p(45),p(60),p(75),p(90),p(450)]);
 assert.equal(a.length,6);a.forEach((v,i)=>near(v.x,37.5+i*75));
});
test('reversing a route preserves locations and reverses the arrow directions',()=>{
 const path=[p(0),p(125),p(125,200),p(300,200)],forward=arrowheads(path),back=arrowheads([...path].reverse()).reverse();
 assert.equal(forward.length,back.length);
 forward.forEach((a,i)=>{near(a.x,back[i].x);near(a.y,back[i].y);near(Math.abs(((a.angle-back[i].angle+540)%360)-180),180);});
});
test('duplicate points are ignored without changing the source path',()=>{
 const path=[p(0),p(0),p(200),p(200),p(200,200)],copy=JSON.stringify(path);
 same(arrowheads(path),arrowheads([p(0),p(200),p(200,200)]));assert.equal(JSON.stringify(path),copy);
});
test('all invalid, empty, collapsed and tiny routes return no arrows',()=>{
 for(const path of [null,[],[p(1)],[p(0),p(0)],[p(0),p(11.99)],[p(0),p(NaN)],[p(0),null],[p(0),p(Infinity)]]) assert.deepEqual(arrowheads(path),[]);
});
test('a short but readable path receives one centered arrow',()=>{
 assert.deepEqual(arrowheads([p(0),p(12)]),[{x:6,y:0,angle:0}]);
});
test('very long routes have a bounded arrow count and equal spacing',()=>{
 const a=arrowheads([p(0),p(1e8)]);assert.equal(a.length,400);a.slice(1).forEach((v,i)=>near(v.x-a[i].x,250000));
});
test('translated and reflected coordinates work for Leaflet and PDF projections',()=>{
 const a=arrowheads([p(0),p(100),p(100,200)]),b=arrowheads([p(1e7,1e7),p(1e7+100,1e7),p(1e7+100,1e7-200)]);
 a.forEach((v,i)=>{near(b[i].x-1e7,v.x);near(1e7-b[i].y,v.y);near(b[i].angle,-v.angle);});
});
test('a tight return bend produces finite arrows instead of a broken heading',()=>{
 for(const a of arrowheads([p(0),p(100),p(0)]))assert.ok(Object.values(a).every(Number.isFinite));
});
test('a closed loop has one global pattern and no duplicated end arrow',()=>{
 const a=arrowheads([p(0),p(150),p(150,150),p(0,150),p(0)]);
 assert.equal(a.length,8);assert.equal(new Set(a.map(v=>`${v.x},${v.y}`)).size,8);
});
test('arrow spacing adjusts to the full rendered scale rather than segment count',()=>{
 for(const scale of [.2,1,2,4]){
  const a=arrowheads([p(0),p(100*scale),p(450*scale)]),b=arrowheads([p(0),p(450*scale)]);
  same(a,b);assert.equal(a.length,Math.max(1,Math.floor(450*scale/75)));
 }
});
test('the map and PDF both call the same versioned arrow placement',()=>{
 for(const name of ['traffic-planner.mjs','traffic-pdf.mjs']){
  const source=readFileSync(new URL('../bus-access/'+name,import.meta.url),'utf8');
  assert.match(source,/import \{[^}]*arrowheads[^}]*\} from '\.\/traffic-model\.mjs\?v=traffic-20261023-48'/);
  assert.match(source,/arrowheads\(/);
 }
});

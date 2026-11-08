import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTrafficPlanner} from '../bus-access/traffic-planner.mjs';
import {parkingSummary} from '../bus-access/traffic-model.mjs';

// Exercise real planner event handlers and captured exports without cloud or map requests.
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element {
  constructor(tag,document){
    this.tagName=tag.toLowerCase();this.ownerDocument=document;this.children=[];this.parentElement=null;this.attributes=new Map();this.events=new Map();this._text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;
    this.dataset=new Proxy({}, {set:(target,key,value)=>{target[key]=String(value);this.attributes.set('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),String(value));return true;}});
    this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!classes.has(name))classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');},add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false),contains:name=>this.className.split(/\s+/).includes(name)};
  }
  get className(){return this.attributes.get('class')||'';}set className(value){this.attributes.set('class',value);}
  get value(){return this._value??'';}set value(value){this._value=String(value);}
  get id(){return this.attributes.get('id')||'';}set id(value){this.attributes.set('id',value);}
  get isConnected(){let node=this;while(node.parentElement)node=node.parentElement;return node===this.ownerDocument.root;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='value')this.value=decode(String(value));if(name==='checked')this.checked=true;if(name==='disabled')this.disabled=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  after(node){const parent=this.parentElement,index=parent.children.indexOf(this);node.remove();node.parentElement=parent;parent.children.splice(index+1,0,node);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(x=>x!==this);this.parentElement=null;}}
  set textContent(value){this.replaceChildren();this._text=String(value);}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(html){
    this.replaceChildren();const stack=[this],voids=new Set(['input','img','link','br','meta','hr']);
    for(const match of html.matchAll(/<\/?[^>]+>|[^<]+/g)){
      const token=match[0];if(!token.startsWith('<')){stack.at(-1)._text+=decode(token);continue;}
      if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
      const [,tag,attrs]=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/)||[];if(!tag)continue;
      const node=this.ownerDocument.createElement(tag);
      for(const [,name,a,b,c]of attrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))node.setAttribute(name,decode(a??b??c??''));
      stack.at(-1).append(node);if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node);
    }
  }
  querySelectorAll(selector){
    const descendants=[];const visit=node=>node.children.forEach(child=>{descendants.push(child);visit(child);});visit(this);
    const match=(node,part)=>{if(part.startsWith('#'))return node.id===part.slice(1);const a=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return a?node.attributes.has(a[1])&&(a[2]===undefined||node.getAttribute(a[1])===a[2]):node.tagName===part;};
    return descendants.filter(node=>selector.split(',').some(group=>{const parts=group.trim().split(/\s+/);if(!match(node,parts.pop()))return false;let ancestor=node.parentElement;while(parts.length){const part=parts.pop();while(ancestor&&!match(ancestor,part))ancestor=ancestor.parentElement;if(!ancestor)return false;ancestor=ancestor.parentElement;}return true;}));
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,callback){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(callback);}
  async trigger(type){const event={target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const fn of this.events.get(type)||[])await fn(event);return event;}
}
function documentStub(){
  const d={createElement:tag=>new Element(tag,d)};d.root=d.createElement('html');d.head=d.createElement('head');d.body=d.createElement('body');d.root.append(d.head,d.body);d.getElementById=id=>d.root.querySelector('#'+id);
  const detail=d.createElement('div');detail.id='detail';d.body.append(detail);return d;
}
async function settle(){for(let i=0;i<15;i++)await Promise.resolve();}

Element.prototype.before=function(node){const parent=this.parentElement,index=parent.children.indexOf(this);node.remove();node.parentElement=parent;parent.children.splice(index,0,node);};
Element.prototype.focus=function(){};
Element.prototype.showModal=function(){this.open=true;};
Element.prototype.close=function(){this.open=false;};
Element.prototype.setCustomValidity=function(value){this.customValidity=value;};
Element.prototype.checkValidity=function(){return !this.badInput&&!this.customValidity;};
Element.prototype.reportValidity=Element.prototype.checkValidity;
Object.defineProperty(Element.prototype,'validity',{get(){return {badInput:Boolean(this.badInput),valid:this.checkValidity()};}});
Object.defineProperty(Element.prototype,'selectedOptions',{get(){return this.children.filter(child=>child.tagName==='option'&&(child.value===this.value||(!this.value&&child===this.children[0])));}});

function leafletStub(){
  let map;
  class Layer{
    constructor(type,geometry,options={}){this.type=type;this.geometry=structuredClone(geometry);this.options=options;this.events=new Map();}
    addTo(target){target.addLayer(this);return this;}
    on(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn);return this;}
    fire(type,event={}){for(const fn of this.events.get(type)||[])fn(event);return this;}
    bindTooltip(value){this.tooltip=value;return this;}
    getLatLng(){return Array.isArray(this.geometry)?{lat:this.geometry[0],lng:this.geometry[1]}:this.geometry;}
    setLatLng(value){this.geometry=Array.isArray(value)?value:[value.lat,value.lng];return this;}
  }
  class Group extends Layer{
    constructor(){super('group',null);this.children=new Set();}
    addLayer(layer){this.children.add(layer);this._map?.addLayer(layer);return this;}
    clearLayers(){for(const layer of this.children)this._map?.removeLayer(layer);this.children.clear();return this;}
  }
  class FakeMap extends Layer{
    constructor(){super('map',null);this.layers=new Set();this.center={lat:0,lng:0};this.zoom=19;}
    setView(p,z){this.center={lat:p[0],lng:p[1]};this.zoom=z;this.fire('moveend');this.fire('zoomend');return this;}
    getCenter(){return {...this.center};}getZoom(){return this.zoom;}
    addLayer(layer){this.layers.add(layer);layer._map=this;if(layer.children)for(const child of layer.children)this.addLayer(child);return this;}
    removeLayer(layer){if(layer.children)for(const child of layer.children)this.removeLayer(child);this.layers.delete(layer);layer._map=null;return this;}
    eachLayer(fn){for(const layer of this.layers)fn(layer);}
    latLngToLayerPoint(p){return {x:p[1]*100000,y:-p[0]*100000};}
    layerPointToLatLng(p){return {lat:-p.y/100000,lng:p.x/100000};}
    invalidateSize(){}remove(){this.layers.clear();}
  }
  const L={map:()=>map=new FakeMap(),featureGroup:()=>new Group(),layerGroup:()=>new Group(),tileLayer:(url,options)=>new Layer('tile',url,options),
    polyline:(points,options)=>new Layer('polyline',points,options),marker:(point,options)=>new Layer('marker',point,options),circleMarker:(point,options)=>new Layer('circle',point,options),
    divIcon:options=>options,point:(x,y)=>({x,y}),control:{scale:()=>({addTo(){}})}};
  return {L,get map(){return map;}};
}
const location={id:'parking-test',name:'Sample parking lot',address:'Synthetic test only',lat:39.6,lng:-105};
const pointNorth=feet=>[location.lat+feet*.3048/6371008.8*180/Math.PI,location.lng];
const pdfResult=()=>({filename:'parking.pdf',blob:new Blob(['%PDF-parking-test']),pages:2});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function plannerHarness(options={}){
  const d=documentStub(),maps=leafletStub(),records=options.records||[],writes=[],exports=[],sent=[],revoked=[],notifications=[];let serial=0,admin=true;
  const w={confirm:()=>true,crypto:{randomUUID:()=>`item-${++serial}`},URL:{createObjectURL:()=>`blob:parking-${++serial}`,revokeObjectURL:value=>revoked.push(value)},addEventListener(){},removeEventListener(){},setTimeout:()=>0};
  const storage={list:async()=>structuredClone(records),save:async source=>{const record={id:`saved-${++serial}`,savedAt:Date.now(),plan:structuredClone(source)};writes.push(record);records.unshift(record);return record;},remove:async()=>{}};
  const planner=mountTrafficPlanner({L:maps.L,getLocation:()=>location,isAdmin:()=>admin,storage,document:d,window:w,notify:message=>notifications.push(message),
    getLocationPdf:async()=>({...pdfResult(),isCurrent:()=>true}),mergePdfs:async()=>pdfResult(),
    exportPdf:async source=>{exports.push(structuredClone(source));return options.exportPdf?options.exportPdf(source):pdfResult();},
    sendToBuilder:async(documents,config)=>{if(config.isCurrent())sent.push(...documents);}});
  planner.open();await settle();
  const query=selector=>d.root.querySelector(selector);
  const click=async selector=>{const node=query(selector);assert.ok(node,selector);assert.equal(node.disabled,false,selector+' should be enabled');await node.trigger('click');await settle();};
  const input=async(selector,value,event='input')=>{const node=query(selector);assert.ok(node,selector);node.value=String(value);await node.trigger(event);await settle();};
  return{d,w,maps,planner,records,writes,exports,sent,revoked,notifications,query,click,input,
    point(feet){const p=pointNorth(feet);maps.map.fire('click',{latlng:{lat:p[0],lng:p[1]}});},
    dispose(){planner.dispose();},signOut(){admin=false;planner.contextChanged();}};
}
async function addParkingRow(h,feet=90){await h.click('[data-tool="parking-row"]');h.point(0);h.point(feet);await h.click('[data-finish]');}
const parkingLabels=h=>[...h.maps.map.layers].filter(layer=>layer.type==='marker'&&layer.options.icon?.html?.includes('traffic-parking-label'));
const parkingDots=h=>[...h.maps.map.layers].filter(layer=>layer.type==='circle'&&layer.options.fillColor==='#36d7b7');
async function selectParkingRow(h,index=0){const label=parkingLabels(h)[index];assert.ok(label,'parking count marker remains selectable');label.fire('click');await settle();}

async function edit(h,selector,value){await h.input(selector,value);await h.query(selector).trigger('change');await settle();}

test('finishing a parking row shows individual dots and a numeric count that survive saving and reopening',async()=>{
  const h=await plannerHarness();
  assert.deepEqual(h.notifications,[]);assert.match(h.query('[data-parking-summary]').textContent,/not counted/i);
  await addParkingRow(h);
  assert.match(h.query('[data-parking-summary]').textContent,/10/);
  assert.doesNotMatch(h.query('[data-parking-summary]').textContent,/estimated|adjusted/i);
  assert.equal(parkingDots(h).length,10);
  assert.equal([...h.maps.map.layers].filter(layer=>layer.type==='polyline').length,0,'completed spaces have no connecting row line');
  assert.equal([...h.maps.map.layers].filter(layer=>layer.options.icon?.html?.includes('traffic-handle')).length,0,'finishing a row leaves its edit handles hidden');
  assert.match(parkingLabels(h)[0].options.icon.html,/>10<\/span>$/);
  assert.equal(h.query('[data-parking-row-count]'),null,'click a dot or count to edit a finished row');
  await h.click('[data-save]');assert.equal(h.writes.length,1);
  assert.equal(parkingSummary(h.writes[0].plan).total,10);
  assert.equal(h.writes[0].plan.items[0].kind,'parking-row');
  assert.equal(h.writes[0].plan.items[0].spaceWidthFeet,9);
  await h.click('[data-new]');assert.match(h.query('[data-parking-summary]').textContent,/not counted/i);
  await h.click('[data-load]');await h.click('[data-export-pdf]');
  assert.equal(parkingSummary(h.exports.at(-1)).total,10);
  assert.equal(parkingDots(h).length,10);
  assert.equal(h.writes.length,1,'exporting the reopened layout does not save another copy');h.dispose();
});

test('row corrections and an overall adjustment follow undo, redo, and the use-row-count control',async()=>{
  const h=await plannerHarness();await addParkingRow(h);await selectParkingRow(h);
  await edit(h,'[data-parking-row-count]','8');
  await h.click('[data-parking-row-apply]');
  assert.equal(parkingDots(h).length,8);
  assert.equal([...h.maps.map.layers].filter(layer=>layer.type==='polyline').length,0,'editing finished spaces does not restore a connecting line');
  assert.match(parkingLabels(h)[0].options.icon.html,/>8<\/span>$/);
  await edit(h,'[data-parking-total]','14');
  await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,14);
  await h.click('[data-undo]');await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,8);
  await h.click('[data-undo]');await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,10);
  await h.click('[data-redo]');await h.click('[data-redo]');await h.click('[data-export-pdf]');
  assert.equal(parkingSummary(h.exports.at(-1)).total,14);
  await h.click('[data-parking-reset]');await h.click('[data-export-pdf]');
  const summary=parkingSummary(h.exports.at(-1));assert.equal(summary.total,8);assert.equal(summary.totalOverride,null);assert.equal(summary.adjusted,true);
  h.dispose();
});

test('zero is an intentional total, latest input reaches exports, and invalid numeric input cannot become an automatic count',async()=>{
  const h=await plannerHarness();await h.input('[data-parking-total]','0');
  await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,0);assert.equal(parkingSummary(h.exports.at(-1)).adjusted,true);
  const links=h.query('[data-pdf-links]');assert.ok(links.children.length);
  await h.input('[data-parking-total]','12');assert.equal(links.children.length,0,'editing the count revokes the old download');
  await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,12);
  const before=h.exports.length,field=h.query('[data-parking-total]');
  field.value='';field.badInput=true;await field.trigger('input');
  await h.query('[data-export-pdf]').trigger('click');await h.query('[data-save]').trigger('click');await settle();
  assert.equal(h.exports.length,before);assert.equal(h.writes.length,0);
  field.badInput=false;await edit(h,'[data-parking-total]','');
  await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,null);
  h.dispose();
});

test('unfinished parking rows cannot be omitted from exports and invalid row corrections block saved output',async()=>{
  const h=await plannerHarness();await h.click('[data-tool="parking-row"]');h.point(0);
  await h.click('[data-export-pdf]');await h.click('[data-save]');
  assert.equal(h.exports.length,0);assert.equal(h.writes.length,0);
  h.point(90);await h.click('[data-finish]');await selectParkingRow(h);await h.input('[data-parking-row-count]','3.5');
  await h.query('[data-export-pdf]').trigger('click');await h.query('[data-save]').trigger('click');await settle();
  assert.equal(h.exports.length,0);assert.equal(h.writes.length,0);
  await edit(h,'[data-parking-row-count]','0');await h.click('[data-export-combined]');
  assert.equal(parkingSummary(h.exports.at(-1)).total,0);assert.equal(parkingSummary(h.exports.at(-1)).adjusted,true);
  assert.equal(parkingDots(h).length,0);
  assert.match(parkingLabels(h)[0].options.icon.html,/>0<\/span>$/);
  h.dispose();
});

test('changing a count while a PDF is rendering prevents an outdated result or presentation handoff',async()=>{
  const gate=deferred(),h=await plannerHarness({exportPdf:()=>gate.promise});
  await h.input('[data-parking-total]','20');
  const pending=h.query('[data-export-pdf]').trigger('click');await settle();
  assert.equal(parkingSummary(h.exports[0]).total,20);
  h.query('[data-parking-total]').value='22';
  gate.resolve(pdfResult());await pending;await settle();
  assert.equal(h.query('[data-pdf-links]').children.length,0);assert.equal(h.sent.length,0);
  assert.match(h.query('[data-status]').textContent,/changed|new PDF/i);h.dispose();
});

test('a newly entered total can be undone before saving or exporting',async()=>{
  const h=await plannerHarness();await h.input('[data-parking-total]','24');
  await h.click('[data-undo]');
  assert.equal(h.query('[data-parking-total]').value,'');
  assert.match(h.query('[data-parking-summary]').textContent,/not counted/i);
  await h.click('[data-redo]');
  assert.equal(h.query('[data-parking-total]').value,'24');
  await h.click('[data-export-pdf]');assert.equal(parkingSummary(h.exports.at(-1)).total,24);
  h.dispose();
});

test('zooming retains an unfinished number in the selected-row editor until it is corrected',async()=>{
  const h=await plannerHarness();await addParkingRow(h);parkingDots(h)[0].fire('click');await settle();
  const field=h.query('[data-parking-row-count]');field.value='';field.badInput=true;
  await field.trigger('input');h.maps.map.fire('zoomend');await settle();
  assert.equal(h.query('[data-parking-row-count]'),field,'redrawing the map retains the live numeric input');
  assert.equal(field.validity.badInput,true);
  await h.click('[data-export-pdf]');assert.equal(h.exports.length,0);
  field.badInput=false;await h.input('[data-parking-row-count]','6');
  await h.click('[data-parking-row-apply]');await h.click('[data-export-pdf]');
  assert.equal(parkingSummary(h.exports.at(-1)).total,6);h.dispose();
});

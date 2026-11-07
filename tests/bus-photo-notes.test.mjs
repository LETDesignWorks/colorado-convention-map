import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLocationPhotos} from '../bus-access/photos.mjs';
import {createPhotoReportDraftStore,photoReportScope,reportNotes,selectedOverviewPhotoId,PDF_NOTES_LIMIT} from '../bus-access/photos-report-draft.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const pdfResult=()=>({blob:new Blob(['%PDF-site-visit']),filename:'site-visit.pdf',pages:1});
const picture=(id,category='exterior',selected=true)=>({id,category,selected,caption:id+' caption',createdAt:123});
function browserStorage(){const data=new Map();return {data,getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value))};}
const scope=(locationId='1',owner='admin-a',admin=true)=>photoReportScope({locationId,owner,admin});

// Minimal DOM is sufficient to exercise actual event handlers, snapshot guards,
// local draft persistence, and photo selection without browser-only dependencies.
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element {
  constructor(tag,document){
    this.tagName=tag.toLowerCase();this.ownerDocument=document;this.children=[];this.parentElement=null;this.attributes=new Map();this.events=new Map();this._text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;
    this.dataset=new Proxy({}, {set:(target,key,value)=>{target[key]=String(value);this.attributes.set('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),String(value));return true;}});
    this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!classes.has(name))classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');},add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false),contains:name=>this.className.split(/\s+/).includes(name)};
  }
  get className(){return this.attributes.get('class')||'';}set className(value){this.attributes.set('class',value);}
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

function harness(options={}){
  const d=documentStub(),state={location:{id:'1',name:'Example location',congregations:[]},summary:{status:'Approved',publicSummary:'Saved summary',internalNotes:'PRIVATE INSPECTION'},owner:'admin-a',admin:true,...options.state};
  const saved=options.storage||browserStorage(),exports=[],photoWrites=[],sent=[],revoked=[];
  let url=0;
  const w={URL:{createObjectURL:()=>`blob:notes-${++url}`,revokeObjectURL:value=>revoked.push(value)},confirm:()=>true,indexedDB:{}};
  Object.defineProperty(w,'localStorage',{get:()=>{if(options.blockStorage)throw Error('Access denied');return saved;}});
  const shared=options.records||[],device=options.deviceRecords||[];
  function store(records,kind){return {kind,
    list:async()=>records.map(photo=>({...photo})),thumbnail:async()=>new Blob(['thumbnail']),image:async()=>new Blob(['image']),
    update:async(locationId,photo)=>{photoWrites.push({kind,locationId,photo:{...photo}});Object.assign(records.find(item=>item.id===photo.id),photo);},
    remove:async(locationId,id)=>{const at=records.findIndex(photo=>photo.id===id);if(at>=0)records.splice(at,1);},
  };}
  const sharedStore=store(shared,'shared'),deviceStore=store(device,'device');
  const panel=mountLocationPhotos({document:d,window:w,getLocation:()=>state.location,getSummary:()=>state.summary,getOwner:()=>state.owner,isAdmin:()=>state.admin,
    createSharedStore:()=>sharedStore,createDeviceStore:()=>deviceStore,onPdfChanged:options.onPdfChanged,
    exportPdf:async source=>{exports.push(source);return options.exportPdf?options.exportPdf(source):pdfResult();},
    sendToBuilder:async(documents,config)=>{assert.equal(config.isCurrent(),true);sent.push(...documents);return {count:documents.length};}
  });
  panel.contextChanged();
  const host=()=>d.getElementById('locationPhotos');
  const notes=()=>host().querySelector('[data-photo-report-notes]');
  const tile=id=>host().querySelector(`[data-photo-id="${id}"]`);
  return {d,w,state,saved,exports,photoWrites,sent,revoked,panel,host,notes,tile};
}
async function enterNotes(h,value){h.notes().value=value;await h.notes().trigger('input');}
async function choose(h,id){const radio=h.tile(id).querySelector('[data-photo-overview]');radio.checked=true;await radio.trigger('change');}
async function library(h,kind){const select=h.host().querySelector('[data-photo-library]');select.value=kind;await select.trigger('change');await settle();}


test('PDF drafts persist by location and every account context, with separate library photo choices',()=>{
  const storage=browserStorage(),drafts=createPhotoReportDraftStore({getStorage:()=>storage});
  drafts.update(scope(),{notes:'Use the east entrance.\r\nKeep the pedestrian path clear.',overviewPhotoIds:{shared:'outside-a'}});
  drafts.update(scope(),{overviewPhotoIds:{device:'inside-b'}});
  const reopened=createPhotoReportDraftStore({getStorage:()=>storage}),draft=reopened.load(scope());
  assert.equal(draft.notes,'Use the east entrance.\nKeep the pedestrian path clear.');
  assert.deepEqual(draft.overviewPhotoIds,{shared:'outside-a',device:'inside-b'});
  assert.equal(draft.persistence,'saved');
  for(const key of [scope('2'),scope('1','admin-b'),scope('1','admin-a',false),scope('1','',false)])assert.equal(reopened.load(key).notes,'');
  draft.overviewPhotoIds.shared='mutated';assert.equal(reopened.load(scope()).overviewPhotoIds.shared,'outside-a');
  assert.throws(()=>drafts.update(scope(),{notes:'x'.repeat(PDF_NOTES_LIMIT+1)}),/6,000/);
  assert.equal(drafts.load(scope()).notes,'Use the east entrance.\nKeep the pedestrian path clear.');
});

test('blocked browser saving keeps per-location drafts in memory and reports the fallback',()=>{
  const drafts=createPhotoReportDraftStore({getStorage:()=>{throw Error('Blocked');}});
  assert.equal(drafts.load(scope()).persistence,'session');
  drafts.update(scope(),{notes:'First location'});drafts.update(scope('2'),{notes:'Second location'});
  assert.equal(drafts.load(scope()).notes,'First location');assert.equal(drafts.load(scope('2')).notes,'Second location');
  const quota=createPhotoReportDraftStore({getStorage:()=>({getItem:()=>null,setItem:()=>{throw Error('Quota');}})});
  assert.equal(quota.update(scope(),{notes:'Still here'}).persistence,'session');assert.equal(quota.load(scope()).notes,'Still here');
  assert.equal(reportNotes('One\r\nTwo\rThree'),'One\nTwo\nThree');
});

test('only included photos can become an overview and exterior photos are the automatic preference',()=>{
  const photos=[picture('inside','interior'),picture('outside'),picture('excluded','exterior',false)];
  assert.equal(selectedOverviewPhotoId(photos),'outside');
  assert.equal(selectedOverviewPhotoId(photos,'inside'),'inside');
  assert.equal(selectedOverviewPhotoId(photos,'excluded'),'outside');
  assert.equal(selectedOverviewPhotoId(photos,'removed'),'outside');
  assert.equal(selectedOverviewPhotoId([picture('inside','interior')]),'inside');
  assert.equal(selectedOverviewPhotoId([picture('none','exterior',false)]),'');
});

test('anonymous and signed-in public viewers see their own saved notes without accessing private photos',async()=>{
  const storage=browserStorage(),h=harness({storage,state:{admin:false,owner:''}});
  assert.equal(h.host().querySelector('[data-photo-gallery]'),null);
  await enterNotes(h,'Anonymous site visit');
  h.state.owner='viewer-a';h.panel.contextChanged();assert.equal(h.notes().value,'');await enterNotes(h,'Viewer A site visit');
  const a=await h.panel.buildPdfSnapshot();assert.equal(h.exports.at(-1).notes,'Viewer A site visit');
  h.state.owner='viewer-b';assert.equal(a.isCurrent(),false);h.panel.contextChanged();assert.equal(h.notes().value,'');await enterNotes(h,'Viewer B site visit');
  h.state.owner='viewer-a';h.panel.contextChanged();assert.equal(h.notes().value,'Viewer A site visit');
  h.state.owner='';h.panel.contextChanged();assert.equal(h.notes().value,'Anonymous site visit');
  h.panel.dispose();
  const reopened=harness({storage,state:{admin:false,owner:'viewer-a'}});assert.equal(reopened.notes().value,'Viewer A site visit');
  assert.match(reopened.host().querySelector('[data-photo-notes-status]').textContent,/Saved in this browser/);
  assert.equal(reopened.photoWrites.length,0);assert.equal(reopened.host().querySelector('[data-photo-gallery]'),null);reopened.panel.dispose();
});

test('export captures current note text even when a browser change did not dispatch input, and keeps private review data out',async()=>{
  const h=harness({state:{admin:false,owner:''}});
  h.notes().value='One line from the site visit.\nA second point for the team.';
  const snapshot=await h.panel.buildPdfSnapshot();
  assert.equal(h.exports[0].notes,h.notes().value);assert.equal(h.exports[0].overviewPhotoId,'');
  assert.ok(!JSON.stringify(h.exports[0].report).includes('PRIVATE INSPECTION'));
  assert.equal(snapshot.isCurrent(),true);
  h.notes().value+='\nAnother point.';assert.equal(snapshot.isCurrent(),false);
  h.notes().value='x'.repeat(PDF_NOTES_LIMIT+1);assert.throws(()=>h.panel.buildPdfSnapshot(),/6,000/);
  h.panel.dispose();
});

test('overview radio choices stay with their library while PDF notes follow the location',async()=>{
  const h=harness({records:[{...picture('inside-a','interior'),caption:'Entrance'},{...picture('outside-a'),caption:'Entrance'},picture('excluded-a','exterior',false)],deviceRecords:[picture('device-inside','interior'),picture('device-outside')]});await settle();
  assert.equal(h.tile('inside-a').querySelector('[data-photo-overview]').getAttribute('aria-label'),'Use interior photo 1: Entrance as overview photo');
  assert.equal(h.tile('outside-a').querySelector('[data-photo-overview]').getAttribute('aria-label'),'Use exterior photo 2: Entrance as overview photo');
  assert.equal(h.tile('outside-a').querySelector('[data-photo-overview]').checked,true);
  const excluded=h.tile('excluded-a').querySelector('[data-photo-overview]');assert.equal(excluded.disabled,true);assert.equal(excluded.dataset.unavailable,'true');
  await choose(h,'excluded-a');assert.equal(excluded.checked,false);
  await enterNotes(h,'A location note');await choose(h,'inside-a');
  let snapshot=await h.panel.buildPdfSnapshot();assert.equal(h.exports.at(-1).overviewPhotoId,'inside-a');assert.equal(h.exports.at(-1).notes,'A location note');
  assert.equal(h.photoWrites.length,0,'choosing an overview never changes shared photo metadata');
  await library(h,'device');assert.equal(snapshot.isCurrent(),false);assert.equal(h.notes().value,'A location note');
  await choose(h,'device-inside');await library(h,'shared');assert.equal(h.tile('inside-a').querySelector('[data-photo-overview]').checked,true);
  snapshot=await h.panel.buildPdfSnapshot();
  const include=h.tile('inside-a').querySelector('[data-photo-select]');include.checked=false;await include.trigger('change');
  assert.equal(snapshot.isCurrent(),false);assert.equal(h.tile('inside-a').querySelector('[data-photo-overview]').disabled,true);assert.equal(h.tile('outside-a').querySelector('[data-photo-overview]').checked,true);
  await h.panel.buildPdfSnapshot();assert.equal(h.exports.at(-1).overviewPhotoId,'outside-a');
  assert.equal(h.exports.at(-1).photos.find(photo=>photo.id==='inside-a').selected,false);
  await library(h,'device');assert.equal(h.tile('device-inside').querySelector('[data-photo-overview]').checked,true);
  await h.tile('device-inside').querySelector('[data-photo-remove]').trigger('click');
  assert.equal(h.tile('device-inside'),null);assert.equal(h.tile('device-outside').querySelector('[data-photo-overview]').checked,true);
  h.panel.dispose();
});

test('editing notes during PDF rendering rejects the old snapshot and notifies the combined export',async()=>{
  const gate=deferred();let changes=0;
  const h=harness({state:{admin:false,owner:''},exportPdf:()=>gate.promise,onPdfChanged:()=>{changes++;}});
  await enterNotes(h,'Original notes');const pending=h.panel.buildPdfSnapshot();
  const previous=changes;await enterNotes(h,'Revised notes');assert.ok(changes>previous);
  assert.equal(h.exports[0].notes,'Original notes','renderer keeps an immutable note snapshot');
  gate.resolve(pdfResult());await assert.rejects(pending,/changed/);h.panel.dispose();
});

test('notes and overview changes revoke completed download links and prevent stale PowerPoint handoffs',async()=>{
  let snapshot,changes=0;
  const h=harness({records:[picture('inside','interior'),picture('outside')],onPdfChanged:()=>{changes++;if(snapshot)assert.equal(snapshot.isCurrent(),false);}});await settle();
  await enterNotes(h,'Original notes');
  await h.host().querySelector('[data-photo-pdf]').trigger('click');
  const link=h.host().querySelector('[data-photo-pdf-links]').querySelector('a');
  const presentation=h.host().querySelectorAll('button').find(node=>node.textContent==='Add to PowerPoint');
  snapshot=await h.panel.buildPdfSnapshot();const previous=changes;
  await enterNotes(h,'Updated notes');assert.ok(changes>previous);assert.ok(h.revoked.includes(link.href));
  assert.equal(h.host().querySelector('[data-photo-pdf-links]').children.length,0);
  assert.equal((await link.trigger('click')).defaultPrevented,true);await presentation.trigger('click');assert.equal(h.sent.length,0);
  snapshot=undefined;await h.host().querySelector('[data-photo-pdf]').trigger('click');
  const second=h.host().querySelector('[data-photo-pdf-links]').querySelector('a');snapshot=await h.panel.buildPdfSnapshot();
  await choose(h,'inside');assert.ok(h.revoked.includes(second.href));assert.equal(snapshot.isCurrent(),false);
  h.panel.dispose();
});

test('storage failure leaves notes usable across location changes and displays a truthful status',async()=>{
  const h=harness({blockStorage:true,state:{admin:false,owner:'viewer-a'}});
  await enterNotes(h,'Kept while this page stays open.');
  assert.match(h.host().querySelector('[data-photo-notes-status]').textContent,/session only/);
  h.state.location={id:'2',name:'Second location'};h.panel.contextChanged();assert.equal(h.notes().value,'');await enterNotes(h,'Second location notes');
  h.state.location={id:'1',name:'Example location'};h.panel.contextChanged();assert.equal(h.notes().value,'Kept while this page stays open.');
  await h.panel.buildPdfSnapshot();assert.equal(h.exports.at(-1).notes,'Kept while this page stays open.');h.panel.dispose();
});

test('the PDF success message exposes a renderer text warning',async()=>{
  const h=harness({state:{admin:false,owner:''},exportPdf:async()=>({...pdfResult(),textWarning:true})});
  await h.host().querySelector('[data-photo-pdf]').trigger('click');
  assert.match(h.host().querySelector('[data-photo-status]').textContent,/Some text characters need review/);h.panel.dispose();
});

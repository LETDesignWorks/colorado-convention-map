import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLocationPhotos} from '../bus-access/photos.mjs';
import {createPhotoReportDraftStore,photoReportScope} from '../bus-access/photos-report-draft.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const result=()=>({blob:new Blob(['%PDF-location']),filename:'location.pdf',pages:1,textWarning:false});
const picture=(id,selected=true,category='exterior')=>({id,selected,category,caption:id+' caption',createdAt:123,image:new Blob(['image'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'})});
const scope=(id='1',owner='admin-a')=>photoReportScope({locationId:id,owner,admin:true});
async function settle(){for(let i=0;i<30;i++)await Promise.resolve();}
async function until(check){for(let i=0;i<60&&!check();i++)await Promise.resolve();assert.ok(check(),'asynchronous operation reached its expected stage');}

// A small DOM lets these checks exercise the mounted panel's real event and
// snapshot guards, including navigation that removes the original inputs.
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element{
  constructor(tag,document){
    this.tagName=tag.toLowerCase();this.ownerDocument=document;this.children=[];this.parentElement=null;this.attributes=new Map();this.events=new Map();this._text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;
    this.dataset=new Proxy({},{set:(target,key,value)=>{target[key]=String(value);this.attributes.set('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),String(value));return true;}});
    this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!set.has(name))set.add(name);else set.delete(name);this.className=[...set].join(' ');},add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false)};
  }
  get className(){return this.attributes.get('class')||'';}set className(value){this.attributes.set('class',value);}
  get id(){return this.attributes.get('id')||'';}set id(value){this.attributes.set('id',value);}
  get isConnected(){let node=this;while(node.parentElement)node=node.parentElement;return node===this.ownerDocument.root;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='value')this.value=decode(String(value));if(name==='checked')this.checked=true;if(name==='disabled')this.disabled=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  after(node){const parent=this.parentElement,index=parent.children.indexOf(this);node.remove();node.parentElement=parent;parent.children.splice(index+1,0,node);}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
  set textContent(value){this.replaceChildren();this._text=String(value);}get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
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
    const nodes=[];const visit=node=>node.children.forEach(child=>{nodes.push(child);visit(child);});visit(this);
    const match=(node,part)=>{if(part.startsWith('#'))return node.id===part.slice(1);const a=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return a?node.attributes.has(a[1])&&(a[2]===undefined||node.getAttribute(a[1])===a[2]):node.tagName===part;};
    return nodes.filter(node=>selector.split(',').some(group=>{const parts=group.trim().split(/\s+/);if(!match(node,parts.pop()))return false;let ancestor=node.parentElement;while(parts.length){const part=parts.pop();while(ancestor&&!match(ancestor,part))ancestor=ancestor.parentElement;if(!ancestor)return false;ancestor=ancestor.parentElement;}return true;}));
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn);}
  async trigger(type){for(const fn of this.events.get(type)||[])await fn({target:this,currentTarget:this,preventDefault(){}});}
}
function documentStub(){const d={createElement:tag=>new Element(tag,d)};d.root=d.createElement('html');d.head=d.createElement('head');d.body=d.createElement('body');d.root.append(d.head,d.body);d.getElementById=id=>d.root.querySelector('#'+id);const detail=d.createElement('div');detail.id='detail';d.body.append(detail);return d;}

function harness(options={}){
  const d=documentStub(),state={selectedId:'1',owner:'admin-a',admin:true,...options.state};
  const locations=new Map([['1',{id:'1',name:'First location',address:'First address',congregations:['First congregation'],contact1:{name:'PRIVATE'}}],['2',{id:'2',name:'Second location',address:'Second address',congregations:['Second congregation'],internalNotes:'PRIVATE'}]]);
  const summaries=new Map([['1',{status:'Approved',publicSummary:'First saved summary'}],['2',{status:'Conditional',busSize:'Shuttle bus',publicSummary:'Second saved summary',contact1:{name:'PRIVATE'},internalNotes:'PRIVATE'}]]);
  const shared=options.shared||{'1':[picture('first')],'2':[picture('second-outside'),picture('second-inside',true,'interior'),picture('excluded',false)]};
  const device=options.device||{'admin-a':{'1':[],'2':[picture('device-only'),picture('device-unchecked',false)]},'other-admin':{'2':[picture('other-account')]}};
  const reads=[],imageReads=[],writes=[],exports=[],browserWrites=[],values=new Map();let draftStore,draftInstances=0,opened=0;
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{browserWrites.push({key,value});values.set(key,value);}};
  const w={indexedDB:{},confirm:()=>true,URL:{createObjectURL:()=> 'blob:photo',revokeObjectURL(){}}};
  Object.defineProperty(w,'localStorage',{get(){if(options.blockStorage)throw Error('Blocked');return storage;}});
  function store(kind,owner){
    const records=id=>(kind==='shared'?shared:device[owner]||{})[id]||[];
    return {kind,
      async list(id){reads.push({kind,owner,id});const rows=records(id).map(photo=>({...photo}));return options.list?options.list({kind,owner,id,rows}):rows;},
      async thumbnail(id,photo){return options.thumbnail?options.thumbnail({kind,owner,id,photo}):photo.thumbnail;},
      async image(id,photo){imageReads.push({kind,owner,id,photoId:photo.id});return options.image?options.image({kind,owner,id,photo}):photo.image;},
      async update(id,photo){writes.push({kind,owner,id,photo});if(options.update)await options.update({kind,owner,id,photo});Object.assign(records(id).find(row=>row.id===photo.id),photo);},
      async add(id,photo){writes.push({kind,owner,id,photo});records(id).push({...photo});},
      async remove(id,photoId){writes.push({kind,owner,id,photoId});const rows=records(id),at=rows.findIndex(row=>row.id===photoId);if(at>=0)rows.splice(at,1);}
    };
  }
  const panel=mountLocationPhotos({document:d,window:w,getLocation:()=>locations.get(state.selectedId),getSummary:()=>summaries.get(state.selectedId),
    ...(options.legacy?{}:{getLocationById:id=>locations.get(id),getSummaryFor:id=>summaries.get(id)}),
    getOwner:()=>state.owner,isAdmin:()=>state.admin,openPresentation:()=>{opened++;},
    createSharedStore:options.sharedAvailable===false?undefined:()=>store('shared'),createDeviceStore:({owner})=>store('device',owner),
    createReportDraftStore:config=>{draftInstances++;draftStore=createPhotoReportDraftStore(config);return draftStore;},
    exportPdf:async source=>{exports.push(source);if(options.exportPdf)return options.exportPdf(source);for(const photo of source.photos.filter(item=>item.selected!==false))await source.loadImage(photo);return result();}
  });
  panel.contextChanged();
  const host=()=>d.getElementById('locationPhotos'),notes=()=>host().querySelector('[data-photo-report-notes]'),tile=id=>host().querySelector(`[data-photo-id="${id}"]`);
  return {panel,state,locations,summaries,shared,device,reads,imageReads,writes,exports,browserWrites,host,notes,tile,get drafts(){return draftStore;},get draftInstances(){return draftInstances;},get opened(){return opened;},
    async navigate(id){state.selectedId=id;panel.contextChanged();await settle();}};
}

test('noncurrent exports reuse session-only settings, public report fields, and selected photos without changing the visible location or storage',async()=>{
  const h=harness({blockStorage:true});await settle();
  h.drafts.update(scope('2'),{notes:'Session-only second-location notes',overviewPhotoIds:{shared:'second-inside'}});
  const visibleNotes=h.notes(),beforeWrites=h.browserWrites.length;
  const info=await h.panel.inspectPresentationLocation('2',{library:'shared'});
  assert.deepEqual(info,{photoCount:2,totalPhotos:3,hasNotes:true,useOnlySelected:true,overviewPhotoId:'second-inside'});
  assert.ok(Object.values(info).every(value=>typeof value!=='object'),'catalog information retains no image objects');
  const built=await h.panel.buildPresentationLocation('2',{library:'shared'}),source=h.exports.at(-1);
  assert.equal(source.report.name,'Second location');assert.equal(source.report.publicSummary,'Second saved summary');assert.equal(source.report.busSize,'Shuttle bus');
  assert.equal(JSON.stringify(source.report).includes('PRIVATE'),false);assert.equal(source.notes,'Session-only second-location notes');assert.equal(source.overviewPhotoId,'second-inside');
  assert.deepEqual(h.imageReads.map(read=>read.photoId),['second-outside','second-inside']);assert.equal(h.shared['2'][2].selected,false);
  assert.equal(h.state.selectedId,'1');assert.equal(h.notes(),visibleNotes);assert.equal(h.draftInstances,1);assert.equal(h.browserWrites.length,beforeWrites);assert.deepEqual(h.writes,[]);assert.equal(built.isCurrent(),true);
});

test('device and shared libraries keep separate choices and device reads stay scoped to the captured owner',async()=>{
  const h=harness();await settle();
  h.drafts.update(scope('2'),{useOnlySelectedPhotos:{device:false},overviewPhotoIds:{device:'device-unchecked',shared:'second-inside'}});
  const before=h.reads.length,built=await h.panel.buildPresentationLocation('2',{library:'device'}),source=h.exports.at(-1);
  assert.equal(source.source,'device');assert.equal(source.overviewPhotoId,'device-unchecked');assert.deepEqual(source.photos.map(photo=>photo.selected),[true,true]);
  assert.deepEqual(h.reads.slice(before),[{kind:'device',owner:'admin-a',id:'2'}]);assert.equal(h.device['admin-a']['2'][1].selected,false);assert.equal(built.isCurrent(),true);
  assert.deepEqual(await h.panel.inspectPresentationLocation('2',{library:'shared'}),{photoCount:2,totalPhotos:3,hasNotes:false,useOnlySelected:true,overviewPhotoId:'second-inside'});
});

test('inspection can finish during thumbnail loading while building preserves loading and unsaved-caption safeguards',async()=>{
  const thumbnail=deferred(),h=harness({thumbnail:()=>thumbnail.promise});await settle();
  assert.equal((await h.panel.inspectPresentationLocation('1')).photoCount,1);
  await assert.rejects(h.panel.buildPresentationLocation('1'),/still loading or saving/);
  thumbnail.resolve(new Blob(['thumbnail']));await settle();
  const caption=h.tile('first').querySelector('[data-photo-caption]');caption.value='Unsaved caption';
  await assert.rejects(h.panel.buildPresentationLocation('1'),/Save the edited captions/);
  caption.value='first caption';h.notes().value='Live notes without an input event';
  const built=await h.panel.buildPresentationLocation('1');assert.equal(h.exports.at(-1).notes,'Live notes without an input event');assert.equal(built.isCurrent(),true);
  h.notes().value='Changed live notes';assert.equal(built.isCurrent(),false);
});

test('pending photo writes block inspection and snapshots, then release after the write completes',async()=>{
  const update=deferred(),h=harness({update:()=>update.promise});await settle();
  const checked=h.tile('first').querySelector('[data-photo-select]');checked.checked=false;const saving=checked.trigger('change');
  await assert.rejects(h.panel.inspectPresentationLocation('1'),/still saving/);await assert.rejects(h.panel.buildPresentationLocation('1'),/still saving/);
  update.resolve();await saving;assert.equal((await h.panel.inspectPresentationLocation('1')).photoCount,0);
});

test('navigation alone preserves a snapshot, while report, draft, sign-in and later caption changes invalidate it',async()=>{
  const h=harness();await settle();
  const current=await h.panel.buildPresentationLocation('1');await h.navigate('2');assert.equal(current.isCurrent(),true);await h.navigate('1');assert.equal(current.isCurrent(),true);
  const caption=h.tile('first').querySelector('[data-photo-caption]');caption.value='Changed after returning';await caption.trigger('input');assert.equal(current.isCurrent(),false);
  const other=await h.panel.buildPresentationLocation('2');h.summaries.get('2').publicSummary='Changed saved summary';assert.equal(other.isCurrent(),false);
  const draft=await h.panel.buildPresentationLocation('2');h.drafts.update(scope('2'),{notes:'Different notes'});assert.equal(draft.isCurrent(),false);
  const account=await h.panel.buildPresentationLocation('2');h.state.owner='other-admin';assert.equal(account.isCurrent(),false);h.state.owner='admin-a';h.state.admin=false;assert.equal(account.isCurrent(),false);
});

test('caption edits during rendering reject the result even when the original inputs have left the page',async()=>{
  const render=deferred(),h=harness({exportPdf:()=>render.promise});await settle();
  const pending=h.panel.buildPresentationLocation('1');await until(()=>h.exports.length===1);
  const caption=h.tile('first').querySelector('[data-photo-caption]');caption.value='Edited during export';await caption.trigger('input');await h.navigate('2');
  render.resolve(result());await assert.rejects(pending,/captions.*changed/);
});

test('aborting catalog reads, image loads, or PDF rendering discards pending results',async()=>{
  const list=deferred(),h=harness({list:({id,rows})=>id==='2'?list.promise:rows});await settle();
  const before=h.reads.length,already=new AbortController();already.abort();await assert.rejects(h.panel.inspectPresentationLocation('2',{signal:already.signal}),{name:'AbortError'});assert.equal(h.reads.length,before);
  const listing=new AbortController(),pending=h.panel.inspectPresentationLocation('2',{signal:listing.signal});listing.abort();await assert.rejects(pending,{name:'AbortError'});list.resolve([]);
  const image=deferred(),images=harness({image:()=>image.promise});await settle();const imaging=new AbortController(),imagePdf=images.panel.buildPresentationLocation('2',{signal:imaging.signal});await until(()=>images.imageReads.length===1);imaging.abort();await assert.rejects(imagePdf,{name:'AbortError'});image.resolve(new Blob(['image']));
  const render=deferred(),rendering=harness({exportPdf:()=>render.promise});await settle();const controller=new AbortController(),pdf=rendering.panel.buildPresentationLocation('2',{signal:controller.signal});await until(()=>rendering.exports.length===1);controller.abort();await assert.rejects(pdf,{name:'AbortError'});render.resolve(result());await settle();
});

test('administrator, location, and library guards fail without reading another account or silently choosing a different library',async()=>{
  const h=harness();await settle();const before=h.reads.length;
  h.state.admin=false;await assert.rejects(h.panel.inspectPresentationLocation('2'),/Administrator sign-in/);h.state.admin=true;h.state.owner='';await assert.rejects(h.panel.buildPresentationLocation('2'),/Administrator sign-in/);h.state.owner='admin-a';
  await assert.rejects(h.panel.inspectPresentationLocation('2',{library:'both'}),/Choose This device or Shared/);await assert.rejects(h.panel.inspectPresentationLocation('missing'),/unavailable/);assert.equal(h.reads.length,before);
  const device=harness({sharedAvailable:false});await settle();assert.deepEqual(device.panel.getPresentationContext(),{library:'device',sharedAvailable:false});const readCount=device.reads.length;await assert.rejects(device.panel.inspectPresentationLocation('2',{library:'shared'}),/Shared photo storage is unavailable/);assert.equal(device.reads.length,readCount);
});

test('current-only fallback supports existing mounts and the new button opens the batch action without switching locations',async()=>{
  const h=harness({legacy:true});await settle();
  assert.deepEqual(h.panel.getPresentationContext(),{library:'shared',sharedAvailable:true});await assert.rejects(h.panel.inspectPresentationLocation('2'),/unavailable/);
  await h.host().querySelector('[data-photo-presentation]').trigger('click');assert.equal(h.opened,1);assert.equal(h.state.selectedId,'1');
  const built=await h.panel.buildPresentationLocation('1');await h.navigate('2');assert.equal(built.isCurrent(),true);
  h.panel.dispose();assert.equal(built.isCurrent(),false);
});

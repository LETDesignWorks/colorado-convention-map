import {inspectPresentationLocations,buildLocationsPresentation} from './locations-presentation.mjs?v=locations-pptx-20261108-1';

const MAX_LOCATIONS=50;
const cssUrl=new URL('./locations-presentation.css?v=locations-pptx-20261108-1',import.meta.url).href;
const messageOf=error=>String(error?.message||error||'Please try again.');
const locationName=location=>String(location?.name||'Meeting location');
const prepared=row=>!row.error&&Boolean(row.photos?.photoCount>0||row.photos?.hasNotes||row.layouts.length);

export function mountLocationsPresentation({getLocations,getCurrentLocationId=()=>'',getOwner=()=>'',isAdmin=()=>false,getPhotoContext=()=>({library:'device',sharedAvailable:false}),inspectPhoto,buildPhoto,listLayouts,document:d=globalThis.document,window:w=globalThis.window,inspect=inspectPresentationLocations,build=buildLocationsPresentation}){
  const style=d.createElement('link');style.rel='stylesheet';style.href=cssUrl;d.head.append(style);
  let state=null,disposed=false;
  const owner=()=>String(getOwner?.()||'');
  const authorized=s=>Boolean(s&&isAdmin()&&s.owner&&owner()===s.owner);
  const active=s=>state===s&&!disposed;

  function readSource(){
    const raw=getLocations();
    if(!Array.isArray(raw))throw Error('The meeting locations are not available yet. Try Refresh in a moment.');
    const locations=JSON.parse(JSON.stringify(raw)),ids=new Set();
    for(const location of locations){
      const id=String(location?.id||'');
      if(!id||ids.has(id))throw Error('The location list could not be checked. Refresh the page and try again.');
      ids.add(id);
    }
    const photo=getPhotoContext()||{},context={library:photo.library==='shared'?'shared':'device',sharedAvailable:Boolean(photo.sharedAvailable)};
    return {locations,context,key:JSON.stringify({locations,photo})};
  }
  function sourceCurrent(s,key=s.sourceKey){
    if(!active(s)||!authorized(s))return false;
    try{return readSource().key===key;}catch{return false;}
  }
  function selectionKey(s){
    return JSON.stringify({library:s.nodes.library.value,photos:s.nodes.photos.checked,parking:s.nodes.parking.checked,rows:s.rows.map(row=>[String(row.location.id),row.include.checked,row.layout.value])});
  }
  function say(s,message,error=false){
    if(!active(s))return;
    s.nodes.status.textContent=message;s.nodes.status.classList.toggle('locations-presentation-error',error);
  }
  function clearResult(s){
    if(s.resultUrl)w.URL.revokeObjectURL(s.resultUrl);
    s.resultUrl=null;s.resultCurrent=null;s.nodes.links.replaceChildren();s.nodes.warnings.replaceChildren();s.nodes.warnings.hidden=true;
  }
  function stopWork(s){
    s.operation++;s.controller?.abort();s.controller=null;s.phase='';
  }
  function close(){
    const s=state;if(!s)return;
    stopWork(s);s.revision++;clearResult(s);state=null;
    if(s.dialog.open)s.dialog.close();s.dialog.remove();d.body.classList.remove('locations-presentation-open');
    if(s.returnFocus?.isConnected&&!s.returnFocus.disabled&&!s.returnFocus.hidden)s.returnFocus.focus?.();
  }
  function invalidate(s,message,{refresh=false}={}){
    if(!active(s))return;
    if(!authorized(s)){close();return;}
    stopWork(s);s.revision++;clearResult(s);s.stale||=refresh;sync(s);say(s,message,refresh);
  }
  function rowComponents(s,row){
    const includePhotos=Boolean(s.nodes.photos.checked&&row.photos&&!row.error);
    const layoutId=s.nodes.parking.checked?row.layout.value:'';
    const layoutValid=!layoutId||row.layouts.some(record=>String(record.id)===layoutId);
    return {includePhotos,layoutId,layoutValid,available:!row.error&&(includePhotos||Boolean(layoutId&&layoutValid))};
  }
  function sync(s,{normalize=false}={}){
    if(!active(s))return;
    const busy=Boolean(s.phase),locked=busy||s.stale;
    for(const node of [s.nodes.library,s.nodes.photos,s.nodes.parking,s.nodes.prepared,s.nodes.clear,s.nodes.refresh])node.disabled=busy;
    s.nodes.prepared.disabled=locked||!s.rows.some(prepared);s.nodes.clear.disabled=locked||!s.rows.some(row=>row.include.checked);
    for(const row of s.rows){
      const components=rowComponents(s,row);
      if(normalize&&!components.available)row.include.checked=false;
      row.include.disabled=locked||!components.available;
      row.layout.disabled=locked||Boolean(row.error)||!s.nodes.parking.checked||!row.layouts.length;
      row.node.classList.toggle('locations-presentation-unavailable',Boolean(row.error)||!components.available);
      const selected=row.layouts.find(record=>String(record.id)===row.layout.value);
      row.layoutStatus.textContent=row.error?'':selected?`${String(selected.id)===String(row.layouts[0]?.id)?'Latest saved layout':'Saved layout'}: ${selected.plan?.name||'Parking layout'}`:row.layout.value?'The chosen saved copy is unavailable. Choose another copy or None.':row.layouts.length?'No parking layout selected.':'No saved parking layout.';
      row.layoutStatus.classList.toggle('locations-presentation-error',Boolean(row.layout.value&&!components.layoutValid));
    }
    const selected=s.rows.filter(row=>row.include.checked),invalid=selected.some(row=>{const parts=rowComponents(s,row);return !parts.available||!parts.layoutValid;}),ready=s.rows.filter(prepared).length,failed=s.rows.filter(row=>row.error).length;
    s.nodes.summary.textContent=`${selected.length} selected · ${ready} prepared${failed?` · ${failed} unavailable`:''}${invalid?' · review unavailable choices':''}${selected.length>MAX_LOCATIONS?` · choose ${MAX_LOCATIONS} or fewer`:''}`;
    s.nodes.create.disabled=locked||!selected.length||invalid||selected.length>MAX_LOCATIONS;
    s.nodes.cancel.hidden=!busy;s.nodes.cancel.textContent=s.phase==='inspect'?'Cancel checking':'Cancel creation';
    s.nodes.list.setAttribute('aria-busy',String(s.phase==='inspect'));
  }
  function selectionChanged(s){
    if(!active(s))return;
    if(!authorized(s)){close();return;}
    stopWork(s);s.revision++;clearResult(s);sync(s,{normalize:true});
    say(s,s.nodes.photos.checked||s.nodes.parking.checked?'Choose the locations and saved layouts to include, then create the PowerPoint.':'Choose location photo reports, saved parking layouts, or both.');
  }
  function collectSelections(s){
    if(s.stale)throw Error('Saved content changed. Choose Refresh before creating the PowerPoint.');
    if(!s.nodes.photos.checked&&!s.nodes.parking.checked)throw Error('Choose location photo reports, saved parking layouts, or both.');
    const rows=s.rows.filter(row=>row.include.checked);
    if(!rows.length)throw Error('Select at least one meeting location.');
    if(rows.length>MAX_LOCATIONS)throw Error(`Select ${MAX_LOCATIONS} locations or fewer for one PowerPoint.`);
    return rows.map(row=>{
      const {includePhotos,layoutId,layoutValid,available}=rowComponents(s,row);
      if(row.error)throw Error(`${locationName(row.location)} could not be checked. Refresh it or remove it from the selection.`);
      if(!layoutValid)throw Error(`Choose an available saved parking layout for ${locationName(row.location)}, or choose None.`);
      if(!available)throw Error(`${locationName(row.location)} needs a location photo report or a saved parking layout.`);
      return {location:row.location,includePhotos,layoutId};
    });
  }
  function savedLabel(record,index){
    let date='';
    if(record.savedAt){const value=new Date(record.savedAt);if(!Number.isNaN(value.getTime()))date=` · ${value.toLocaleString('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} MT`;}
    return `${index===0?'Latest: ':''}${record.plan?.name||'Parking layout'}${date}`;
  }
  function normalizedRows(locations,inspected){
    const rows=Array.isArray(inspected)?inspected:[],byId=new Map(rows.map(row=>[String(row?.location?.id),row]));
    return locations.map(location=>{
      const row=byId.get(String(location.id));
      const valid=row?.photos&&Number.isInteger(row.photos.photoCount)&&row.photos.photoCount>=0&&Number.isInteger(row.photos.totalPhotos)&&row.photos.totalPhotos>=row.photos.photoCount&&Array.isArray(row.layouts);
      const error=row?.error?messageOf(row.error):valid?'':'This location could not be checked. Choose Refresh to try again.';
      return {location,photos:error?null:row.photos,layouts:error?[]:row.layouts,error};
    });
  }
  function renderRows(s,rows,preferences,defaults){
    s.nodes.list.replaceChildren();s.rows=[];
    const hasPrepared=rows.some(prepared),current=String(getCurrentLocationId()||'');
    for(const [index,row]of rows.entries()){
      const id=String(row.location.id),previous=preferences.get(id),node=d.createElement('li');node.className='locations-presentation-row';node.dataset.locationId=id;
      const details=d.createElement('div'),label=d.createElement('label');label.className='locations-presentation-choice';
      const include=d.createElement('input');include.type='checkbox';include.dataset.locationsSelect='';
      include.checked=!row.error&&(defaults?(prepared(row)||(!hasPrepared&&id===current)):Boolean(previous?.included));
      const name=d.createElement('strong');name.textContent=locationName(row.location);label.append(include,name);details.append(label);
      const address=d.createElement('p');address.className='locations-presentation-address';address.textContent=row.location.address||'No address saved.';details.append(address);
      const metadata=d.createElement('p');metadata.id=`locationsPresentationMeta${index}`;metadata.className='locations-presentation-metadata';include.setAttribute('aria-describedby',metadata.id);
      if(row.error){metadata.textContent=`Unavailable: ${row.error}`;metadata.classList.add('locations-presentation-error');}
      else{
        metadata.textContent=`${row.photos.photoCount} of ${row.photos.totalPhotos} photos included · ${row.photos.useOnlySelected===false?'All saved photos':'Selected photos only'} · ${row.photos.hasNotes?'PDF notes saved in this browser':'No PDF notes in this browser'}.`;
        if(!row.photos.photoCount&&!row.photos.hasNotes)metadata.textContent+=' Photo report: location details only.';
      }
      details.append(metadata);
      const parking=d.createElement('div'),layoutLabel=d.createElement('label');layoutLabel.className='locations-presentation-layout-label';layoutLabel.textContent='Saved parking layout';
      const layout=d.createElement('select');layout.dataset.locationsLayout='';layout.setAttribute('aria-label',`Saved parking layout for ${locationName(row.location)}`);
      const none=d.createElement('option');none.value='';none.textContent='None';layout.append(none);
      row.layouts.forEach((record,copyIndex)=>{const option=d.createElement('option');option.value=String(record.id);option.textContent=savedLabel(record,copyIndex);layout.append(option);});
      const previousLayout=previous?.layout;
      if(previousLayout&&!row.layouts.some(record=>String(record.id)===previousLayout)){
        const missing=d.createElement('option');missing.value=previousLayout;missing.textContent='Unavailable saved copy — choose another';missing.disabled=true;layout.append(missing);
      }
      layout.value=previous?previousLayout:(row.layouts[0]?String(row.layouts[0].id):'');
      layoutLabel.append(layout);parking.append(layoutLabel);
      const layoutStatus=d.createElement('small');layoutStatus.dataset.locationsLayoutStatus='';parking.append(layoutStatus);
      node.append(details,parking);s.nodes.list.append(node);
      const entry={...row,node,include,layout,layoutStatus};s.rows.push(entry);
      include.addEventListener('change',()=>selectionChanged(s));layout.addEventListener('change',()=>selectionChanged(s));
    }
    if(!rows.length){const empty=d.createElement('li');empty.className='locations-presentation-empty';empty.textContent='No meeting locations are available.';s.nodes.list.append(empty);}
  }
  function changedDuringWork(s){
    if(!active(s))return;
    const refresh=!sourceCurrent(s)||s.nodes.library.value!==s.library;
    invalidate(s,refresh?'Saved content or the photo library changed. Choose Refresh before creating the PowerPoint.':'The selection changed. Create the PowerPoint again.',{refresh});
  }
  async function scan({defaults=false}={}){
    const s=state;if(!s)return;
    if(!authorized(s)){close();return;}
    const preferences=new Map(s.rows.map(row=>[String(row.location.id),{included:row.include.checked,layout:row.layout.value}]));
    stopWork(s);s.revision++;clearResult(s);s.stale=true;
    let source;
    try{
      source=readSource();s.nodes.shared.disabled=!source.context.sharedAvailable;
      const library=s.nodes.library.value;
      if(!['shared','device'].includes(library)||(library==='shared'&&!source.context.sharedAvailable))throw Error('Shared storage is unavailable. Choose This device to check its saved photos.');
      s.library=library;s.locations=source.locations;s.sourceKey=source.key;
    }catch(error){sync(s);say(s,messageOf(error),true);return;}
    const controller=new AbortController(),operation=++s.operation,revision=s.revision;
    s.controller=controller;s.phase='inspect';s.rows=[];s.nodes.list.replaceChildren();
    const loading=d.createElement('li');loading.className='locations-presentation-empty';loading.textContent='Checking saved photos and parking layouts…';s.nodes.list.append(loading);sync(s);say(s,'Checking meeting locations…');
    const belongs=()=>active(s)&&s.operation===operation&&!controller.signal.aborted;
    const isCurrent=()=>belongs()&&s.revision===revision&&s.nodes.library.value===s.library&&sourceCurrent(s,source.key);
    try{
      const inspected=await inspect(source.locations,{library:s.library,inspectPhoto,listLayouts,signal:controller.signal,isCurrent,progress:value=>{if(isCurrent())say(s,String(value));}});
      if(!belongs())return;if(!isCurrent()){changedDuringWork(s);return;}
      const rows=normalizedRows(source.locations,inspected);renderRows(s,rows,preferences,defaults||!preferences.size);s.stale=false;
      sync(s,{normalize:true});
      const failed=rows.filter(row=>row.error).length,missing=s.rows.filter(row=>row.layout.value&&!row.layouts.some(record=>String(record.id)===row.layout.value)).length;
      say(s,`${rows.length} locations checked. ${rows.filter(prepared).length} prepared${failed?`; ${failed} unavailable — see the location messages`:''}.${missing?` ${missing} saved layout choices need review.`:''} Choose the locations to include.`,Boolean(failed||missing));
    }catch(error){
      if(!belongs())return;if(!isCurrent()){changedDuringWork(s);return;}
      const text=messageOf(error);renderRows(s,source.locations.map(location=>({location,photos:null,layouts:[],error:text})),new Map(),false);s.stale=false;say(s,`Locations could not be checked: ${text} Choose Refresh to try again.`,true);
    }finally{if(belongs()){s.controller=null;s.phase='';sync(s);}}
  }
  async function create(){
    const s=state;if(!s||s.phase)return;
    if(!authorized(s)){close();return;}
    let selections;
    try{
      if(!sourceCurrent(s)||s.nodes.library.value!==s.library)throw Error('Saved content or the photo library changed. Choose Refresh first.');
      selections=collectSelections(s);
    }catch(error){say(s,messageOf(error),true);return;}
    stopWork(s);s.revision++;clearResult(s);
    const controller=new AbortController(),operation=++s.operation,revision=s.revision,key=selectionKey(s),sourceKey=s.sourceKey;
    s.controller=controller;s.phase='build';sync(s);say(s,'Preparing the selected location reports and parking layouts…');
    const belongs=()=>active(s)&&s.operation===operation&&!controller.signal.aborted;
    const isCurrent=()=>belongs()&&s.revision===revision&&selectionKey(s)===key&&sourceCurrent(s,sourceKey);
    try{
      const result=await build(selections,{library:s.library,buildPhoto,listLayouts,signal:controller.signal,isCurrent,document:d,window:w,progress:value=>{if(isCurrent())say(s,String(value));}});
      if(!belongs())return;if(!isCurrent()){changedDuringWork(s);return;}
      if(!result?.blob?.size)throw Error('The PowerPoint was empty. Please create it again.');
      if(typeof result.isCurrent!=='function'||!result.isCurrent())throw Error('Saved photos, notes, or parking layouts changed. Refresh and create the PowerPoint again.');
      const current=()=>{try{return isCurrent()&&result.isCurrent();}catch{return false;}};
      s.resultCurrent=current;s.resultUrl=w.URL.createObjectURL(result.blob);
      const download=d.createElement('a');download.className='btn blue';download.href=s.resultUrl;download.download=result.filename||'meeting-locations.pptx';download.dataset.locationsDownload='';download.textContent='Download PowerPoint';
      download.addEventListener('click',event=>{if(current())return;event.preventDefault();invalidate(s,'Saved content or the selection changed. Refresh and create a new PowerPoint.',{refresh:true});});
      s.nodes.links.append(download);
      const warnings=Array.isArray(result.warnings)?result.warnings:[];
      if(warnings.length){
        const title=d.createElement('strong');title.textContent='Presentation notices';const list=d.createElement('ul');
        warnings.forEach(value=>{const item=d.createElement('li');item.textContent=String(value);list.append(item);});s.nodes.warnings.append(title,list);s.nodes.warnings.hidden=false;
      }
      const slides=result.slides||result.pages,locations=result.locationCount||selections.length;
      say(s,`PowerPoint ready: ${slides} slide${slides===1?'':'s'} for ${locations} location${locations===1?'':'s'}. The download will start automatically; the link remains available.${warnings.length?' Review the notices below.':''}`);
      download.click();
    }catch(error){if(belongs()){if(!isCurrent()){changedDuringWork(s);return;}say(s,`PowerPoint was not created: ${messageOf(error)}`,true);}}
    finally{if(belongs()){s.controller=null;s.phase='';sync(s);}}
  }
  function contextChanged(){
    const s=state;if(!s)return;
    if(!authorized(s)){close();return;}
    try{s.nodes.shared.disabled=!readSource().context.sharedAvailable;}catch{}
    invalidate(s,'Saved location data changed. Choose Refresh to check it before creating a PowerPoint.',{refresh:true});
  }
  function trapFocus(s,event){
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const controls=[...s.dialog.querySelectorAll('button,input,select,a[href]')].filter(node=>{
      if(node.disabled)return false;
      for(let parent=node;parent&&parent!==s.dialog;parent=parent.parentElement)if(parent.hidden)return false;
      return true;
    });
    if(!controls.length){event.preventDefault();s.dialog.focus();return;}
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&(d.activeElement===first||!controls.includes(d.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(d.activeElement===last||!controls.includes(d.activeElement))){event.preventDefault();first.focus();}
  }
  async function open(){
    if(disposed||!isAdmin()||!owner())return false;
    if(state){if(authorized(state)){state.nodes.close.focus();return true;}close();}
    const dialog=d.createElement('dialog');dialog.id='locationsPresentationDialog';dialog.className='locations-presentation-dialog';dialog.setAttribute('aria-labelledby','locationsPresentationTitle');dialog.setAttribute('aria-describedby','locationsPresentationHelp');dialog.tabIndex=-1;
    dialog.innerHTML=`<header class="locations-presentation-heading"><div><small>MEETING LOCATIONS</small><h2 id="locationsPresentationTitle">Create a PowerPoint</h2></div><button type="button" class="btn light" data-locations-close>Close</button></header>
      <div class="locations-presentation-options"><p id="locationsPresentationHelp">Uses each location’s saved overview photo, selected-photo settings, and PDF notes from this browser. Choose saved parking layouts below; the latest copy is selected initially. Each PDF page becomes a slide, preserving its design.</p>
      <div class="locations-presentation-controls"><label class="locations-presentation-library">Photo library<select data-locations-library><option value="shared" data-locations-shared>Shared storage</option><option value="device">This device</option></select></label><fieldset><legend>Include</legend><label><input type="checkbox" data-locations-include-photos checked> Location photo reports</label><label><input type="checkbox" data-locations-include-parking checked> Saved parking layouts</label></fieldset></div>
      <div class="locations-presentation-toolbar"><button type="button" class="btn light" data-locations-prepared>Select all prepared</button><button type="button" class="btn light" data-locations-clear>Clear selection</button><button type="button" class="btn light" data-locations-refresh>Refresh</button><span data-locations-summary aria-live="polite"></span></div></div>
      <ul class="locations-presentation-list" data-locations-list aria-label="Meeting locations"></ul>
      <footer class="locations-presentation-footer"><div class="locations-presentation-actions"><button type="button" class="btn blue" data-locations-create disabled>Create PowerPoint</button><button type="button" class="btn light" data-locations-cancel hidden>Cancel creation</button><div data-locations-links></div></div><p data-locations-status role="status" aria-live="polite"></p><div class="locations-presentation-warnings" data-locations-warnings hidden></div></footer>`;
    const q=selector=>dialog.querySelector(selector),nodes={close:q('[data-locations-close]'),library:q('[data-locations-library]'),shared:q('[data-locations-shared]'),photos:q('[data-locations-include-photos]'),parking:q('[data-locations-include-parking]'),prepared:q('[data-locations-prepared]'),clear:q('[data-locations-clear]'),refresh:q('[data-locations-refresh]'),summary:q('[data-locations-summary]'),list:q('[data-locations-list]'),create:q('[data-locations-create]'),cancel:q('[data-locations-cancel]'),links:q('[data-locations-links]'),status:q('[data-locations-status]'),warnings:q('[data-locations-warnings]')};
    const s={dialog,nodes,owner:owner(),returnFocus:d.activeElement,rows:[],locations:[],library:'device',sourceKey:'',revision:0,operation:0,controller:null,phase:'',stale:true,resultUrl:null,resultCurrent:null};state=s;
    try{const {context}=readSource();s.library=context.library==='shared'&&context.sharedAvailable?'shared':'device';nodes.shared.disabled=!context.sharedAvailable;}catch{}
    nodes.library.value=s.library;d.body.append(dialog);d.body.classList.add('locations-presentation-open');dialog.showModal();nodes.close.focus();
    nodes.close.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(active(s))close();});dialog.addEventListener('keydown',event=>trapFocus(s,event));
    nodes.library.addEventListener('change',()=>scan());nodes.refresh.addEventListener('click',()=>scan());
    for(const node of [nodes.photos,nodes.parking])node.addEventListener('change',()=>selectionChanged(s));
    nodes.prepared.addEventListener('click',()=>{for(const row of s.rows)row.include.checked=prepared(row)&&rowComponents(s,row).available;selectionChanged(s);});
    nodes.clear.addEventListener('click',()=>{for(const row of s.rows)row.include.checked=false;selectionChanged(s);});
    nodes.create.addEventListener('click',create);
    nodes.cancel.addEventListener('click',()=>{if(!active(s))return;const scanning=s.phase==='inspect';invalidate(s,scanning?'Checking cancelled. Choose Refresh to check the locations again.':'PowerPoint creation cancelled. Your selections are kept.',{refresh:scanning});if(scanning){s.nodes.list.replaceChildren();const notice=d.createElement('li');notice.className='locations-presentation-empty';notice.textContent='Locations have not been checked. Choose Refresh to continue.';s.nodes.list.append(notice);}});
    await scan({defaults:true});return active(s);
  }
  return {open,contextChanged,dispose(){close();disposed=true;style.remove();}};
}

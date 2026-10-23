import {newTrafficPlan,validatePlan,clone,coneRow,arrowheads,MAX_ITEMS} from './traffic-model.mjs?v=traffic-20261023-46';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS={bus:'#25ceff',car:'#de9bff',walk:'#ffed67'};
const PIN_LABELS={entry:'ENTRANCE',exit:'EXIT',loading:'BUS LOADING','no-entry':'NO ENTRY',note:'NOTE'};
const CONE='<svg viewBox="0 0 28 30" width="26" height="28" aria-hidden="true"><path d="M10 2h8l6 23H4Z" fill="#fb771a" stroke="#51280d" stroke-width="1.5"/><path d="M8 9h12l1.5 5h-15Z" fill="white"/><path d="M5 20h18l1 4H4Z" fill="white"/><rect x="1" y="25" width="26" height="4" rx="1" fill="#e5680d" stroke="#51280d"/></svg>';
const cssUrl=new URL('./traffic-planner.css?v=traffic-20261023-46',import.meta.url).href;
export function mountTrafficPlanner({L,getLocation,isAdmin,storage,notify=()=>{},document:documentHost=globalThis.document,window:windowHost=globalThis.window}) {
  const d=documentHost,w=windowHost;
  if(d.getElementById('trafficPlannerLauncher'))return null;
  const style=d.createElement('link');style.rel='stylesheet';style.href=cssUrl;d.head.append(style);
  const card=d.createElement('section');card.id='trafficPlannerLauncher';card.className='card traffic-launcher';
  card.innerHTML='<h3>Traffic patterns &amp; cones</h3><p data-location>Select a meeting place to plan its parking lot.</p><button type="button" class="btn blue" data-open>Open parking-lot planner</button><small>Administrator-only layouts. Separate from inspection notes and territory plans.</small>';
  d.getElementById('detail').before(card);
  let state=null,sequence=0;
  const uid=()=>w.crypto.randomUUID();
  const permitted=()=>Boolean(state&&isAdmin()&&String(getLocation()?.id)===state.plan.locationId);
  const editable=()=>permitted()&&!state.busy;
  const say=message=>{if(state)state.nodes.status.textContent=message;};
  function syncButtons(){
    if(!state)return;
    const s=state;
    s.nodes.undo.disabled=s.busy||!s.undo.length;
    s.nodes.redo.disabled=s.busy||!s.redo.length;
    s.nodes.finish.disabled=s.busy||!s.draft||s.draft.points.length<2;
    s.nodes.cancelDraw.disabled=s.busy||!s.draft;
    s.nodes.save.disabled=s.busy||!permitted();
    s.nodes.load.disabled=s.busy||!s.records.length;
    s.nodes.removeSaved.disabled=s.busy||!s.records.length;
    s.nodes.saved.disabled=s.busy||!s.records.length;
    s.nodes.count.textContent=`${s.plan.items.filter(i=>i.kind==='cone').length} cones · ${s.plan.items.filter(i=>i.kind==='route').length} routes · ${s.plan.items.filter(i=>i.kind==='pin').length} labels`;
    s.nodes.dirty.textContent=s.dirty?'Unsaved layout changes':'No unsaved layout changes';
    s.nodes.dialog.querySelectorAll('[data-tool]').forEach(button=>{button.disabled=s.busy;button.setAttribute('aria-pressed',String(button.dataset.tool===s.mode));});
  }
  function recordChange(fn){
    if(!editable())return false;
    const s=state,before=clone(s.plan);
    try{fn(s.plan);s.plan=validatePlan(s.plan,s.plan.locationId);}
    catch(error){s.plan=before;say(error.message);return false;}
    s.undo.push(before);if(s.undo.length>40)s.undo.shift();s.redo=[];s.dirty=true;render();return true;
  }
  function historyMove(from,to){
    if(!editable()||state.draft||!state[from].length)return;
    state[to].push(clone(state.plan));state.plan=state[from].pop();state.selected=null;state.removeVertex=false;state.dirty=true;syncFields();render();
  }
  function view(){const s=state,c=s.map.getCenter();return {lat:c.lat,lng:c.lng,zoom:s.map.getZoom(),base:s.plan.view.base};}
  function syncFields(){if(!state)return;state.nodes.name.value=state.plan.name;state.nodes.notes.value=state.plan.notes;}
  function selectItem(id){if(!editable()||state.mode!=='select')return;state.selected=id;state.removeVertex=false;render();}
  function icon(html,size=[28,30],anchor=[14,15]){return L.divIcon({className:'traffic-map-icon',html,iconSize:size,iconAnchor:anchor});}
  function render(){
    const s=state;if(!s?.map)return;
    s.items.clearLayers();s.handles.clearLayers();
    const interactive=editable()&&s.mode==='select';
    for(const item of s.plan.items){
      const selected=item.id===s.selected;
      if(item.kind==='route'){
        L.polyline(item.points,{color:'#142736',weight:selected?10:8,opacity:.85,interactive:false}).addTo(s.items);
        const line=L.polyline(item.points,{color:COLORS[item.routeType],weight:selected?6:4,opacity:1,dashArray:item.routeType==='walk'?'10 6':null,bubblingMouseEvents:false}).addTo(s.items);
        line.bindTooltip(escape(item.label||`${item.routeType} route`));line.on('click',()=>selectItem(item.id));
        const projected=item.points.map(p=>s.map.latLngToLayerPoint(p));
        arrowheads(projected).forEach(a=>L.marker(s.map.layerPointToLatLng(L.point(a.x,a.y)),{interactive:false,keyboard:false,icon:icon(`<span class="traffic-arrow" style="transform:rotate(${a.angle}deg);color:${COLORS[item.routeType]}">➤</span>`,[24,24],[12,12])}).addTo(s.items));
        if(selected&&interactive){
          item.points.forEach((p,i)=>{
            const h=L.marker(p,{draggable:!s.removeVertex,bubblingMouseEvents:false,icon:icon(`<span class="traffic-handle${s.removeVertex?' traffic-handle-remove':''}"></span>`,[18,18],[9,9]),title:`Route point ${i+1}: drag to move${s.removeVertex?', click to remove':''}`}).addTo(s.handles);
            h.on('dragend',()=>{const q=h.getLatLng();recordChange(plan=>{plan.items.find(x=>x.id===item.id).points[i]=[q.lat,q.lng];});});
            h.on('click',()=>{if(!s.removeVertex)return;if(item.points.length<=2)return say('A route needs at least two points. Use Delete selected item to remove the route.');recordChange(plan=>plan.items.find(x=>x.id===item.id).points.splice(i,1));});
          });
          if(!s.removeVertex)item.points.slice(1).forEach((p,i)=>{
            const a=item.points[i],mid=[(a[0]+p[0])/2,(a[1]+p[1])/2];
            L.marker(mid,{bubblingMouseEvents:false,icon:icon('<span class="traffic-midpoint">+</span>',[16,16],[8,8]),title:'Add a route point here'}).addTo(s.handles).on('click',()=>recordChange(plan=>plan.items.find(x=>x.id===item.id).points.splice(i+1,0,mid)));
          });
        }
      }else{
        const html=item.kind==='cone'?`<span class="traffic-cone${selected?' traffic-selected':''}">${CONE}</span>`:`<span class="traffic-label traffic-label-${item.pinType}${selected?' traffic-selected':''}">${escape(item.label||PIN_LABELS[item.pinType])}</span>`;
        const marker=L.marker(item.point,{draggable:interactive,bubblingMouseEvents:false,icon:icon(html),title:item.kind==='cone'?'Traffic cone: drag to move':item.label}).addTo(s.items);
        marker.on('click',()=>selectItem(item.id));marker.on('dragend',()=>{const p=marker.getLatLng();recordChange(plan=>{plan.items.find(x=>x.id===item.id).point=[p.lat,p.lng];});});
      }
    }
    renderDraft();renderSelection();syncButtons();
  }
  function renderDraft(){
    const s=state;s.sketch.clearLayers();
    if(!s.draft)return;
    if(s.draft.points.length>1)L.polyline(s.draft.points,{color:s.mode==='cone-row'?'#ff8a22':COLORS[s.nodes.routeType.value],weight:4,dashArray:'7 5',interactive:false}).addTo(s.sketch);
    s.draft.points.forEach(p=>L.circleMarker(p,{radius:5,color:'#fff',fillColor:'#ed7828',fillOpacity:1,interactive:false}).addTo(s.sketch));
  }
  function renderSelection(){
    const s=state,item=s.plan.items.find(i=>i.id===s.selected),box=s.nodes.selected;
    box.replaceChildren();
    if(!item){box.textContent='Choose Move / select, then click a cone, route, or label to edit it.';return;}
    const title=d.createElement('strong');title.textContent=item.kind==='cone'?'Selected cone':item.label||'Selected route';box.append(title);
    if(item.kind!=='cone'){
      const label=d.createElement('label');label.textContent='Item label';const input=d.createElement('input');input.value=item.label;input.maxLength=100;label.append(input);box.append(label);
      input.addEventListener('change',()=>recordChange(plan=>{plan.items.find(x=>x.id===item.id).label=input.value;}));
    }
    const action=(label,fn)=>{const button=d.createElement('button');button.type='button';button.className='btn light';button.textContent=label;button.disabled=s.busy;button.addEventListener('click',fn);box.append(button);};
    if(item.kind==='route'){
      action('Reverse traffic direction',()=>recordChange(plan=>plan.items.find(x=>x.id===item.id).points.reverse()));
      action(s.removeVertex?'Done removing route points':'Remove route points',()=>{s.removeVertex=!s.removeVertex;render();});
      const help=d.createElement('small');help.textContent='Drag solid points to reshape. Click + to insert a point. Arrows follow the route’s drawing direction.';box.append(help);
    }
    action('Delete selected item',()=>{recordChange(plan=>{plan.items=plan.items.filter(x=>x.id!==item.id);});s.selected=null;renderSelection();});
  }
  function setTool(mode){
    if(!editable())return;
    if(state.draft?.points.length&&!w.confirm('Discard the unfinished line? Finished layout items will stay.'))return;
    state.mode=mode;state.draft=['route','cone-row'].includes(mode)?{points:[]}:null;state.selected=null;state.removeVertex=false;
    const hints={select:'Drag a cone or label to move it. Click a route to edit its points.',route:'Click along the travel path, in the direction vehicles or pedestrians will move. Then choose Finish line.','cone-row':'Click along the proposed cone line. Choose the cone count, then Finish line.',cone:'Click the map to place cones. Continue clicking for more, then choose Move / select.',pin:'Choose a label type and click its position on the map.'};
    say(hints[mode]);render();
  }
  function mapClick(event){
    if(!editable())return;
    const s=state,p=[event.latlng.lat,event.latlng.lng];
    if(s.draft){if(s.draft.points.length>=200)return say('Finish this line before adding more points.');s.draft.points.push(p);renderDraft();syncButtons();return;}
    if(s.mode==='cone')recordChange(plan=>plan.items.push({id:uid(),kind:'cone',label:'',point:p}));
    if(s.mode==='pin'){const pinType=s.nodes.pinType.value;recordChange(plan=>plan.items.push({id:uid(),kind:'pin',pinType,label:s.nodes.itemLabel.value.trim()||PIN_LABELS[pinType],point:p}));}
  }
  function finishLine(){
    if(!editable()||!state.draft||state.draft.points.length<2)return;
    const s=state,points=clone(s.draft.points);let items;
    try{items=s.mode==='cone-row'?coneRow(points,Number(s.nodes.coneCount.value)).map(point=>({id:uid(),kind:'cone',label:'',point})):[{id:uid(),kind:'route',routeType:s.nodes.routeType.value,label:s.nodes.itemLabel.value.trim()||`${s.nodes.routeType.selectedOptions[0].textContent} route`,points}];}
    catch(error){say(error.message);return;}
    if(s.plan.items.length+items.length>MAX_ITEMS)return say(`Keep this layout to ${MAX_ITEMS} items or fewer.`);
    if(recordChange(plan=>plan.items.push(...items))){s.mode='select';s.draft=null;s.selected=items.length===1?items[0].id:null;say('Added to this draft. Save layout to keep a named copy for this meeting place.');render();}
  }
  function savedOptions(){
    const s=state,previous=s.nodes.saved.value;s.nodes.saved.replaceChildren();
    for(const r of s.records){const o=d.createElement('option');o.value=r.id;o.textContent=`${r.plan.name} (${new Date(r.savedAt).toLocaleString('en-US',{timeZone:'America/Denver'})} MT)`;s.nodes.saved.append(o);}
    if(s.records.some(r=>r.id===previous))s.nodes.saved.value=previous;
    syncButtons();
  }
  async function refreshSaved(autoLoad=false){
    const s=state;if(!permitted())return;
    say('Loading traffic layouts for this location…');
    try{const records=await storage.list(s.plan.locationId);if(state!==s||!permitted())return;s.records=records;savedOptions();
      if(autoLoad&&records.length&&!s.dirty&&!s.draft?.points.length)loadPlan(records[0].plan);
      say(records.length?`${records.length} saved traffic layout(s) available. Save creates a new copy; earlier copies stay available.`:'No saved traffic layouts yet. Zoom to the parking lot and begin drawing.');
    }catch(error){if(state===s)say(`Saved layouts could not be loaded: ${error.message}. Your draft is unchanged; use Reload saved layouts to retry.`);}
  }
  function loadPlan(plan){
    const s=state;let checked;
    try{checked=validatePlan(plan,s.plan.locationId);}catch(error){say(error.message);return false;}
    if((s.dirty||s.draft?.points.length)&&!w.confirm('Replace this unsaved traffic draft with the selected layout? Download JSON first to keep a local copy.'))return false;
    s.plan=checked;s.undo=[];s.redo=[];s.selected=null;s.removeVertex=false;s.draft=null;s.mode='select';s.dirty=false;syncFields();
    setBasemap(checked.view.base,false);s.suppressView=true;s.map.setView([checked.view.lat,checked.view.lng],checked.view.zoom,{animate:false});s.suppressView=false;render();return true;
  }
  async function save(){
    if(!editable())return;
    const s=state;
    if(s.draft?.points.length)return say('Finish or cancel the current line before saving.');
    s.plan.name=s.nodes.name.value.trim();s.plan.notes=s.nodes.notes.value;s.plan.view=view();
    let snapshot;try{snapshot=validatePlan(s.plan,s.plan.locationId);}catch(error){say(error.message);return;}
    const fingerprint=JSON.stringify(snapshot);s.busy=true;render();say('Saving a new traffic layout copy to this meeting location…');
    try{const saved=await storage.save(snapshot);if(state!==s||!permitted())return;s.records.unshift(saved);s.dirty=JSON.stringify(s.plan)!==fingerprint;savedOptions();s.nodes.saved.value=saved.id;say(`Saved “${snapshot.name}” to ${snapshot.locationName}.${s.dirty?' Further changes are still unsaved.':''}`);}
    catch(error){if(state===s)say(`Layout was NOT saved: ${error.message}. Keep this window open or Download JSON to preserve the draft.`);}
    finally{if(state===s){s.busy=false;render();}}
  }
  function download(){
    if(!state)return;
    const s=state;
    if(s.draft?.points.length)return say('Finish or cancel the line before downloading the layout.');
    try{const data=validatePlan({...s.plan,name:s.nodes.name.value,notes:s.nodes.notes.value,view:view()},s.plan.locationId);
      const url=w.URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=d.createElement('a');a.href=url;a.download=`${data.name.replace(/[^a-zA-Z0-9]+/g,'-')}-traffic.json`;d.body.append(a);a.click();a.remove();w.setTimeout(()=>w.URL.revokeObjectURL(url),1500);
      say('JSON backup downloaded. This does not save the layout to the cloud.');
    }catch(error){say(error.message);}
  }
  function setBasemap(base,dirty=true){
    const s=state;if(!s?.map)return;
    if(s.tile)s.map.removeLayer(s.tile);
    const satellite=base==='satellite';
    s.tile=L.tileLayer(satellite?'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}':'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxNativeZoom:19,maxZoom:22,attribution:satellite?'Tiles © Esri — Esri, Maxar, Earthstar Geographics and GIS User Community':'© OpenStreetMap contributors'}).addTo(s.map);
    let errors=0;s.tile.on('tileerror',()=>{if(state===s&&++errors===3)say('Some background tiles are unavailable. Try Street map or zoom out; the layout is unchanged.');});
    s.plan.view.base=base;s.nodes.basemap.value=base;if(dirty)s.dirty=true;syncButtons();
  }
  function close(force=false){
    const s=state;if(!s)return true;
    if(!force&&s.busy){say('A save or deletion is still running. Keep this window open until its result is shown.');return false;}
    if(!force&&(s.dirty||s.draft?.points.length)&&!w.confirm('Close without saving this traffic draft? Cancel to save or download it first.'))return false;
    sequence++;state=null;s.map?.remove();s.nodes.dialog.close();s.nodes.dialog.remove();d.body.classList.remove('traffic-dialog-open');card.querySelector('[data-open]').focus();return true;
  }
  function contextChanged(){
    const location=getLocation(),button=card.querySelector('[data-open]');
    card.querySelector('[data-location]').textContent=location?`${location.name} — zoom into the parking lot, draw directional paths, and place cones.`:'Select a meeting place first.';
    button.disabled=!location||!isAdmin()||!L;
    button.textContent=isAdmin()?'Open parking-lot planner':'Sign in above to plan traffic';
    if(state&&(!isAdmin()||String(location?.id)!==state.plan.locationId))close(true);
  }
  function open(){
    if(state||!isAdmin()||!L||!getLocation())return;
    const location=clone(getLocation()),dialog=d.createElement('dialog');dialog.className='traffic-dialog';dialog.setAttribute('aria-labelledby','trafficTitle');
    dialog.innerHTML=`<header class="traffic-heading"><div><small>BUS REVIEW · PARKING-LOT PLANNING</small><h2 id="trafficTitle">Traffic patterns &amp; cones</h2><p>${escape(location.name)} · ${escape(location.address)}</p></div><button type="button" class="btn light" data-close>Close planner</button></header>
      <div class="traffic-body"><aside class="traffic-tools">
      <label>Layout name<input data-name maxlength="160"></label>
      <div class="traffic-pair"><button class="btn light" data-tool="select">Move / select</button><button class="btn light" data-zoom>Zoom to parking lot</button></div>
      <label>Background<select data-basemap><option value="satellite">Satellite / aerial</option><option value="street">Street map</option></select></label>
      <h3>Draw the traffic pattern</h3><label>Route type<select data-route-type><option value="bus">Bus</option><option value="car">Car</option><option value="walk">Pedestrian</option></select></label>
      <button class="btn blue" data-tool="route">Draw directional route</button>
      <h3>Lay out cones</h3><div class="traffic-pair"><button class="btn light" data-tool="cone">Place cones</button><button class="btn light" data-tool="cone-row">Draw cone row</button></div>
      <label>Cones in the row<input data-cone-count type="number" min="2" max="100" step="1" value="10"></label>
      <small>Row count is your planning choice, not a recommended safety spacing. Each cone can be moved separately.</small>
      <h3>Add location labels</h3><label>Label type<select data-pin-type><option value="entry">Entrance</option><option value="exit">Exit</option><option value="loading">Bus loading</option><option value="no-entry">No entry</option><option value="note">Note</option></select></label>
      <label>Label / route name<input data-item-label maxlength="100" placeholder="Optional: east entrance, bus loop…"></label><button class="btn light" data-tool="pin">Place label</button>
      <div class="traffic-pair"><button class="btn blue" data-finish disabled>Finish line</button><button class="btn light" data-cancel-draw disabled>Cancel line</button><button class="btn light" data-undo disabled>Undo</button><button class="btn light" data-redo disabled>Redo</button></div>
      <div class="traffic-selection" data-selected></div>
      <label>Setup notes<textarea data-notes maxlength="2500" rows="3" placeholder="Arrival sequence, volunteer positions, areas to keep clear…"></textarea></label>
      <p data-dirty class="traffic-dirty"></p><button class="btn blue" data-save>Save layout — new copy</button>
      <details class="traffic-saved" open><summary>Saved layouts for this location</summary><label>Choose a saved layout<select data-saved></select></label><div class="traffic-pair"><button class="btn light" data-load>Load layout</button><button class="btn light" data-refresh>Reload saved layouts</button><button class="btn light" data-new>New blank layout</button><button class="btn light" data-remove-saved>Delete saved copy</button></div></details>
      <div class="traffic-pair"><button class="btn light" data-download>Download JSON</button><button class="btn light" data-import>Import JSON</button></div><input data-file type="file" accept="application/json,.json" hidden>
      </aside><div class="traffic-map-area"><div class="traffic-map" data-map aria-label="Parking lot traffic layout map" role="application"></div><div class="traffic-map-legend"><span>▲ Cone</span><span class="traffic-bus-key">➜ Bus</span><span class="traffic-car-key">➜ Car</span><span class="traffic-walk-key">➜ Pedestrian</span><strong data-count></strong></div><p class="traffic-warning">Planning sketch only. Aerial imagery may be outdated; zooming beyond its native detail only enlarges it. Confirm the layout on site with the property and transportation teams, including bus turning clearance, pedestrian access, and emergency access. This is not a live-traffic layer or an approved traffic-control plan.</p><p data-status class="traffic-status" role="status" aria-live="polite"></p></div></div>`;
    d.body.append(dialog);const q=selector=>dialog.querySelector(selector);
    const nodes={dialog,name:q('[data-name]'),notes:q('[data-notes]'),dirty:q('[data-dirty]'),saved:q('[data-saved]'),load:q('[data-load]'),removeSaved:q('[data-remove-saved]'),undo:q('[data-undo]'),redo:q('[data-redo]'),finish:q('[data-finish]'),cancelDraw:q('[data-cancel-draw]'),save:q('[data-save]'),count:q('[data-count]'),status:q('[data-status]'),selected:q('[data-selected]'),routeType:q('[data-route-type]'),pinType:q('[data-pin-type]'),coneCount:q('[data-cone-count]'),itemLabel:q('[data-item-label]'),basemap:q('[data-basemap]')};
    state={plan:newTrafficPlan(location),nodes,records:[],mode:'select',draft:null,selected:null,removeVertex:false,dirty:false,busy:false,undo:[],redo:[],suppressView:true,sequence:++sequence};
    const s=state;dialog.showModal();d.body.classList.add('traffic-dialog-open');
    s.map=L.map(q('[data-map]'),{maxZoom:22,minZoom:1,zoomControl:true,doubleClickZoom:false}).setView([location.lat,location.lng],19);
    s.items=L.featureGroup().addTo(s.map);s.handles=L.featureGroup().addTo(s.map);s.sketch=L.featureGroup().addTo(s.map);
    L.control.scale({imperial:true,metric:false}).addTo(s.map);setBasemap('satellite',false);s.suppressView=false;
    s.map.on('click',mapClick);s.map.on('zoomend',()=>{if(state===s)render();});
    s.map.on('moveend',()=>{if(state!==s||s.suppressView)return;const v=view();if(JSON.stringify(v)!==JSON.stringify(s.plan.view)){s.plan.view=v;s.dirty=true;syncButtons();}});
    w.setTimeout(()=>{if(state===s)s.map.invalidateSize({pan:false});},100);
    q('[data-close]').addEventListener('click',()=>close());dialog.addEventListener('cancel',event=>{event.preventDefault();if(s.draft){s.draft=null;s.mode='select';render();say('Unfinished line cancelled.');}else close();});
    dialog.querySelectorAll('[data-tool]').forEach(button=>{button.type='button';button.addEventListener('click',()=>setTool(button.dataset.tool));});
    nodes.finish.addEventListener('click',finishLine);nodes.cancelDraw.addEventListener('click',()=>{if(!editable())return;s.draft=null;s.mode='select';render();say('Unfinished line cancelled.');});
    nodes.undo.addEventListener('click',()=>historyMove('undo','redo'));nodes.redo.addEventListener('click',()=>historyMove('redo','undo'));
    nodes.name.addEventListener('input',()=>{s.plan.name=nodes.name.value;s.dirty=true;syncButtons();});nodes.notes.addEventListener('input',()=>{s.plan.notes=nodes.notes.value;s.dirty=true;syncButtons();});
    nodes.basemap.addEventListener('change',()=>setBasemap(nodes.basemap.value));q('[data-zoom]').addEventListener('click',()=>s.map.setView([location.lat,location.lng],20,{animate:false}));
    nodes.save.addEventListener('click',save);q('[data-refresh]').addEventListener('click',()=>refreshSaved());
    nodes.load.addEventListener('click',()=>{if(!editable())return;const record=s.records.find(x=>x.id===nodes.saved.value);if(record&&loadPlan(record.plan))say('Saved layout loaded. Edits will be saved as a new copy.');});
    q('[data-new]').addEventListener('click',()=>{if(editable()&&loadPlan(newTrafficPlan(location)))say('Blank layout ready. Existing saved layouts are unchanged.');});
    nodes.removeSaved.addEventListener('click',async()=>{if(!editable())return;const record=s.records.find(x=>x.id===nodes.saved.value);if(!record||!w.confirm(`Delete the saved traffic copy “${record.plan.name}”? This cannot be undone. Download it first if needed. Your current draft and inspection notes will not change.`))return;s.busy=true;render();say('Deleting the selected saved traffic copy…');try{await storage.remove(s.plan.locationId,record.id);if(state===s&&permitted()){s.records=s.records.filter(x=>x.id!==record.id);savedOptions();say('Saved copy deleted. The current editable draft and review notes are unchanged.');}}catch(error){if(state===s)say(`Deletion failed: ${error.message}`);}finally{if(state===s){s.busy=false;render();}}});
    q('[data-download]').addEventListener('click',download);q('[data-import]').addEventListener('click',()=>{if(editable())q('[data-file]').click();});
    q('[data-file]').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(!file||!editable())return;try{if(file.size>200000)throw Error('This JSON file is too large.');const value=JSON.parse(await file.text());if(state!==s||!editable())return;if(loadPlan(value)){s.dirty=true;syncButtons();say('JSON imported into this draft. Save layout to keep a cloud copy.');}}catch(error){if(state===s)say(`Import failed: ${error.message}`);}});
    syncFields();render();refreshSaved(true);
  }
  card.querySelector('[data-open]').addEventListener('click',()=>{try{open();}catch(error){if(state)close(true);notify(`Could not open the traffic planner: ${error.message}`,true);}});
  const unload=event=>{if(state&&(state.dirty||state.busy||state.draft?.points.length)){event.preventDefault();event.returnValue='';}};
  w.addEventListener('beforeunload',unload);contextChanged();
  return {contextChanged,open,close,dispose(){close(true);w.removeEventListener('beforeunload',unload);card.remove();style.remove();}};
}

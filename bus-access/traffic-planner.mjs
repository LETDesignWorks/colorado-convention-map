import {newTrafficPlan,validatePlan,clone,point as checkedPoint,coneRow,arrowheads,MAX_ITEMS,DEFAULT_PARKING_SPACE_WIDTH_FEET,MAX_PARKING_SPACES,estimateParkingRow,parkingRowCount,parkingSpacePoints,parkingSummary} from './traffic-model.mjs?v=parking-dots-20261108-1';
import {exportTrafficPdf} from './traffic-pdf.mjs?v=parking-map-only-20261108-1';
import {mergePdfDocuments} from '../pdf-tools/pdf-merge.mjs?v=packets-20261107-1';
import {sendPdfsToBuilder} from '../pdf-tools/handoff.mjs?v=packets-20261107-1';
import {createTrafficBasemap} from './traffic-basemap.mjs?v=street-names-20261107-1';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS={bus:'#25ceff',car:'#de9bff',walk:'#ffed67'};
const PARKING_COLOR='#36d7b7';
const isParkingTool=mode=>mode==='parking-row'||mode==='parking-auto';
const autoParkingGuidance=hasStart=>hasStart?'Start set. Click the end of the row at the outside edge of the last space. The dots will appear automatically.':'Click the start of the row at the outside edge of the first space, then click the outside edge of the last space. The second click adds the dots automatically.';
const PIN_LABELS={entry:'ENTRANCE',exit:'EXIT',loading:'BUS LOADING','no-entry':'NO ENTRY',note:'NOTE'};
const CONE='<svg viewBox="0 0 28 30" width="26" height="28" aria-hidden="true"><path d="M10 2h8l6 23H4Z" fill="#fb771a" stroke="#51280d" stroke-width="1.5"/><path d="M8 9h12l1.5 5h-15Z" fill="white"/><path d="M5 20h18l1 4H4Z" fill="white"/><rect x="1" y="25" width="26" height="4" rx="1" fill="#e5680d" stroke="#51280d"/></svg>';
const cssUrl=new URL('./traffic-planner.css?v=auto-parking-20261108-1',import.meta.url).href;
// Reuse the two existing renderers so individual and combined exports share
// the same artwork, selected photos, geometry, and privacy rules.
export async function buildParkingPdfPacket(source,{combined=false,getLocationPdf,exportPdf=exportTrafficPdf,mergePdfs=mergePdfDocuments,exportOptions={},isCurrent=()=>true}={}){
  const plan=validatePlan(source,source.locationId),progress=exportOptions.progress||(()=>{});
  let review;
  const stillCurrent=()=>isCurrent()&&(!review?.isCurrent||review.isCurrent());
  const assertCurrent=()=>{if(!stillCurrent())throw Error('The layout, location, selected photos, review details, or sign-in changed. Create the PDF again.');};
  assertCurrent();
  if(combined){
    if(typeof getLocationPdf!=='function')throw Error('The Bus Access Review PDF is still loading. Please try again in a moment.');
    progress('Preparing the Bus Access Review and selected location photos…');
    review=await getLocationPdf({expectedLocationId:plan.locationId});assertCurrent();
    if(!review?.blob?.size)throw Error('The Bus Access Review PDF could not be prepared. No combined PDF was created.');
  }
  const parking=await exportPdf(plan,exportOptions);assertCurrent();
  if(!parking?.blob?.size)throw Error('The parking-lot PDF was empty. Please retry.');
  let result=parking;
  if(combined){
    const stem=(plan.locationName||plan.name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100)||'meeting-location';
    progress('Combining the review, selected photos, and parking-lot plan…');
    result=await mergePdfs([{name:review.filename||'Bus Access Review.pdf',blob:review.blob},{name:parking.filename||'Parking-lot plan.pdf',blob:parking.blob}],{filename:`${stem}-bus-access-and-parking.pdf`,title:`${plan.locationName} - Bus access and parking`,progress,document:exportOptions.document,window:exportOptions.window,PDFLib:exportOptions.PDFLib,signal:exportOptions.signal});
    assertCurrent();
  }
  if(!result?.blob?.size)throw Error('The PDF was empty. Please retry.');
  return {...result,textWarning:Boolean(parking.textWarning||review?.textWarning),isCurrent:stillCurrent};
}
export function mountTrafficPlanner({L,getLocation,isAdmin,storage,getLocationPdf,exportPdf=exportTrafficPdf,mergePdfs=mergePdfDocuments,sendToBuilder=sendPdfsToBuilder,notify=()=>{},document:documentHost=globalThis.document,window:windowHost=globalThis.window}) {
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
  function optionalParkingCount(value,badInput=false,label='Adjusted parking total'){
    const raw=String(value??'').trim();
    if(badInput)throw Error(`${label} must be a whole number from 0 to ${MAX_PARKING_SPACES.toLocaleString('en-US')}, or leave it blank to use the calculated count.`);
    if(raw==='')return null;
    const count=Number(raw);
    if(!Number.isInteger(count)||count<0||count>MAX_PARKING_SPACES)throw Error(`${label} must be a whole number from 0 to ${MAX_PARKING_SPACES.toLocaleString('en-US')}.`);
    return count;
  }
  function parkingWidth(value,badInput=false){
    const raw=String(value??'').trim(),width=Number(raw);
    if(badInput||raw===''||!Number.isFinite(width)||width<1||width>100)throw Error('Enter feet per parking space along the row between 1 and 100.');
    return width;
  }
  function selectedParkingInput(){
    const s=state,item=s.plan.items.find(row=>row.id===s.selected&&row.kind==='parking-row');
    if(!item)return null;
    const width=s.nodes.selected.querySelector('[data-parking-row-width]'),count=s.nodes.selected.querySelector('[data-parking-row-count]'),label=s.nodes.selected.querySelector('[data-parking-row-label]');
    if(!width||!count)return null;
    return {id:item.id,label:label?.value??item.label,width:width.value,widthBadInput:Boolean(width.validity?.badInput),count:count.value,countBadInput:Boolean(count.validity?.badInput)};
  }
  function parkingInputPlan(){
    const s=state,plan=clone(s.plan),total=s.nodes.parkingTotal;
    plan.parking={totalOverride:optionalParkingCount(total.value,Boolean(total.validity?.badInput))};
    const edits=new Map(s.parkingEdits),current=selectedParkingInput();
    if(current)edits.set(current.id,current);
    for(const [id,edit]of edits){
      const row=plan.items.find(item=>item.id===id&&item.kind==='parking-row');if(!row)continue;
      row.label=edit.label;row.spaceWidthFeet=parkingWidth(edit.width,edit.widthBadInput);
      row.countOverride=optionalParkingCount(edit.count,edit.countBadInput,'Adjusted row count');
    }
    return plan;
  }
  function capturePlan(){
    const s=state;
    return validatePlan({...parkingInputPlan(),name:s.nodes.name.value,notes:s.nodes.notes.value,view:view()},s.plan.locationId);
  }
  function commitParkingInputs(){
    const s=state;let next;
    try{next=validatePlan(parkingInputPlan(),s.plan.locationId);}catch(error){say(error.message);return false;}
    if(JSON.stringify(next)!==JSON.stringify(s.plan)){
      s.undo.push(clone(s.plan));if(s.undo.length>40)s.undo.shift();s.redo=[];s.plan=next;s.dirty=true;clearPdfLinks();
    }
    s.parkingEdits.clear();s.nodes.parkingTotal.value=next.parking.totalOverride??'';
    return true;
  }
  function renderParkingSummary(){
    const s=state;
    try{
      const summary=parkingSummary(parkingInputPlan()),value=summary.total===null?'Parking spaces: Not counted':`Parking spaces: ${summary.total.toLocaleString('en-US')}`;
      s.nodes.parkingSummary.textContent=value;s.nodes.parkingMapCount.textContent=value;s.nodes.parkingSummary.classList.remove('traffic-count-invalid');
      s.nodes.parkingDetails.textContent=summary.rowCount?`${summary.rowCount} marked row${summary.rowCount===1?'':'s'}: ${summary.rowTotal.toLocaleString('en-US')} spaces.${summary.totalOverride!==null?' Your entered total is used in the PDF.':''}`:summary.totalOverride!==null?'Total entered without marked rows.':'Mark parking rows to count spaces, or enter a total.';
    }catch(error){
      s.nodes.parkingSummary.textContent='Parking count needs attention';s.nodes.parkingMapCount.textContent='Parking spaces: check the entered count';s.nodes.parkingDetails.textContent=error.message;s.nodes.parkingSummary.classList.add('traffic-count-invalid');
    }
    s.nodes.parkingReset.disabled=s.busy||(s.nodes.parkingTotal.value.trim()===''&&!s.nodes.parkingTotal.validity?.badInput);
    const parkingMode=isParkingTool(s.mode),auto=s.mode==='parking-auto';
    s.nodes.parkingActions.hidden=!parkingMode;s.nodes.parkingActions.dataset.auto=String(auto);
    s.nodes.parkingFinish.hidden=auto;
    s.nodes.parkingFinish.disabled=s.busy||s.mode!=='parking-row'||!s.draft||s.draft.points.length<2;
    s.nodes.parkingCancel.disabled=s.busy||!parkingMode||!s.draft;
    s.nodes.parkingDraft.textContent='';
    if(auto){
      const hasStart=Boolean(s.draft?.points.length);
      try{parkingWidth(s.nodes.parkingWidth.value,Boolean(s.nodes.parkingWidth.validity?.badInput));s.nodes.parkingDraft.textContent=autoParkingGuidance(hasStart);}
      catch(error){s.nodes.parkingDraft.textContent=`${error.message} ${hasStart?'Your start point is kept. Correct the width, then click the end of the row.':'Correct the width, then click the start of the row.'}`;}
    }else if(s.mode==='parking-row'&&s.draft?.points.length>=2){
      try{const width=parkingWidth(s.nodes.parkingWidth.value,Boolean(s.nodes.parkingWidth.validity?.badInput));s.nodes.parkingDraft.textContent=`Current row: ${estimateParkingRow({points:s.draft.points,spaceWidthFeet:width}).toLocaleString('en-US')} spaces. Choose Finish row to add the dots.`;}
      catch(error){s.nodes.parkingDraft.textContent=error.message;}
    }
  }
  function syncButtons(){
    if(!state)return;
    const s=state;
    let pendingParkingChange=false;
    try{pendingParkingChange=JSON.stringify(validatePlan(parkingInputPlan(),s.plan.locationId))!==JSON.stringify(s.plan);}catch{}
    // Valid number edits join history when the next action commits them, so
    // Undo must also be available before a first edit has been committed.
    s.nodes.undo.disabled=s.busy||(!s.undo.length&&!pendingParkingChange);
    s.nodes.redo.disabled=s.busy||!s.redo.length||pendingParkingChange;
    s.nodes.finish.hidden=s.mode==='parking-auto';
    s.nodes.finish.disabled=s.busy||s.mode==='parking-auto'||!s.draft||s.draft.points.length<2;
    s.nodes.cancelDraw.disabled=s.busy||!s.draft;
    s.nodes.save.disabled=s.busy||!permitted();
    s.nodes.pdf.disabled=s.busy||!permitted();
    s.nodes.combinedPdf.disabled=s.busy||!permitted()||typeof getLocationPdf!=='function';
    for(const node of [s.nodes.name,s.nodes.notes,s.nodes.basemap,s.nodes.parkingWidth,s.nodes.parkingTotal])node.disabled=s.busy;
    s.nodes.load.disabled=s.busy||!s.records.length;
    s.nodes.removeSaved.disabled=s.busy||!s.records.length;
    s.nodes.saved.disabled=s.busy||!s.records.length;
    s.nodes.count.textContent=`${s.plan.items.filter(i=>i.kind==='cone').length} cones · ${s.plan.items.filter(i=>i.kind==='route').length} routes · ${s.plan.items.filter(i=>i.kind==='pin').length} labels`;
    s.nodes.dirty.textContent=s.dirty?'Unsaved layout changes':'No unsaved layout changes';
    s.nodes.dialog.querySelectorAll('[data-tool]').forEach(button=>{button.disabled=s.busy;button.setAttribute('aria-pressed',String(button.dataset.tool===s.mode));});
    renderParkingSummary();
  }
  function recordChange(fn){
    if(!editable())return false;
    if(!commitParkingInputs())return false;
    const s=state,before=clone(s.plan);
    try{fn(s.plan);s.plan=validatePlan(s.plan,s.plan.locationId);}
    catch(error){s.plan=before;say(error.message);return false;}
    clearPdfLinks();s.undo.push(before);if(s.undo.length>40)s.undo.shift();s.redo=[];s.dirty=true;render();return true;
  }
  function historyMove(from,to){
    if(!editable()||state.draft)return;
    if(!commitParkingInputs()||!state[from].length)return;
    const previousBase=state.plan.view.base;
    clearPdfLinks();state[to].push(clone(state.plan));state.plan=state[from].pop();state.selected=null;state.removeVertex=false;state.dirty=true;syncFields();
    if(state.plan.view.base!==previousBase)setBasemap(state.plan.view.base,false);
    render();
  }
  function view(){const s=state,c=s.map.getCenter();return {lat:c.lat,lng:c.lng,zoom:s.map.getZoom(),base:s.plan.view.base};}
  function syncFields(){if(!state)return;state.nodes.name.value=state.plan.name;state.nodes.notes.value=state.plan.notes;state.nodes.parkingTotal.value=state.plan.parking?.totalOverride??'';}
  function selectItem(id){if(!editable()||state.mode!=='select'||!commitParkingInputs())return;state.selected=id;state.removeVertex=false;render();}
  function icon(html,size=[28,30],anchor=[14,15]){return L.divIcon({className:'traffic-map-icon',html,iconSize:size,iconAnchor:anchor});}
  function render(){
    const s=state;if(!s?.map)return;
    s.items.clearLayers();s.handles.clearLayers();
    const interactive=editable()&&s.mode==='select';
    for(const item of s.plan.items){
      const selected=item.id===s.selected;
      if(item.kind==='route'||item.kind==='parking-row'){
        const parking=item.kind==='parking-row',pointName=parking?'Parking row':'Route';
        if(parking){
          const selectRow=()=>selectItem(item.id),count=parkingRowCount(item).toLocaleString('en-US');
          for(const point of parkingSpacePoints(item))L.circleMarker(point,{radius:selected?5:4,color:'#142736',weight:1.5,opacity:1,fillColor:PARKING_COLOR,fillOpacity:1,interactive,bubblingMouseEvents:false,renderer:s.parkingRenderer}).addTo(s.items).on('click',selectRow);
          L.marker(item.points[0],{bubblingMouseEvents:false,icon:icon(`<span class="traffic-label traffic-parking-label${selected?' traffic-selected':''}">${count}</span>`,[1,1],[-8,24]),title:`Parking spaces: ${count}. Select to edit this row.`}).addTo(s.items).on('click',selectRow);
        }else{
          L.polyline(item.points,{color:'#142736',weight:selected?10:8,opacity:.85,interactive:false}).addTo(s.items);
          const line=L.polyline(item.points,{color:COLORS[item.routeType],weight:selected?6:4,opacity:1,dashArray:item.routeType==='walk'?'10 6':null,bubblingMouseEvents:false}).addTo(s.items);
          line.bindTooltip(escape(item.label||`${item.routeType} route`));line.on('click',()=>selectItem(item.id));
          const projected=item.points.map(p=>s.map.latLngToLayerPoint(p));
          arrowheads(projected).forEach(a=>L.marker(s.map.layerPointToLatLng(L.point(a.x,a.y)),{interactive:false,keyboard:false,icon:icon(`<span class="traffic-arrow" style="transform:rotate(${a.angle}deg);color:${COLORS[item.routeType]}">➤</span>`,[24,24],[12,12])}).addTo(s.items));
        }
        if(selected&&interactive){
          item.points.forEach((p,i)=>{
            const h=L.marker(p,{draggable:!s.removeVertex,bubblingMouseEvents:false,icon:icon(`<span class="traffic-handle${s.removeVertex?' traffic-handle-remove':''}"></span>`,[18,18],[9,9]),title:`${pointName} point ${i+1}: drag to move${s.removeVertex?', click to remove':''}`}).addTo(s.handles);
            h.on('dragend',()=>{const q=h.getLatLng();recordChange(plan=>{plan.items.find(x=>x.id===item.id).points[i]=[q.lat,q.lng];});});
            h.on('click',()=>{if(!s.removeVertex)return;if(item.points.length<=2)return say(`${parking?'A parking row':'A route'} needs at least two points. Use Delete selected item to remove it.`);recordChange(plan=>plan.items.find(x=>x.id===item.id).points.splice(i,1));});
          });
          if(!s.removeVertex)item.points.slice(1).forEach((p,i)=>{
            const a=item.points[i],mid=[(a[0]+p[0])/2,(a[1]+p[1])/2];
            L.marker(mid,{bubblingMouseEvents:false,icon:icon('<span class="traffic-midpoint">+</span>',[16,16],[8,8]),title:`Add a ${parking?'parking row':'route'} point here`}).addTo(s.handles).on('click',()=>recordChange(plan=>plan.items.find(x=>x.id===item.id).points.splice(i+1,0,mid)));
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
    if(s.mode==='parking-auto'){
      if(s.draft.points.length)L.circleMarker(s.draft.points[0],{radius:7,color:PARKING_COLOR,weight:2,fill:false,interactive:false}).addTo(s.sketch);
      return;
    }
    if(s.draft.points.length>1)L.polyline(s.draft.points,{color:s.mode==='parking-row'?PARKING_COLOR:s.mode==='cone-row'?'#ff8a22':COLORS[s.nodes.routeType.value],weight:4,dashArray:'7 5',interactive:false}).addTo(s.sketch);
    s.draft.points.forEach(p=>L.circleMarker(p,{radius:5,color:'#fff',fillColor:'#ed7828',fillOpacity:1,interactive:false}).addTo(s.sketch));
  }
  function renderSelection(){
    const s=state,item=s.plan.items.find(i=>i.id===s.selected),box=s.nodes.selected;
    // Preserve the live number inputs while the map moves. In particular, a
    // partial number such as "-" has an empty .value but still has badInput.
    if(item?.kind==='parking-row'&&s.editorId===item.id&&s.parkingEdits.has(item.id)){
      box.querySelectorAll('input,button').forEach(node=>node.disabled=s.busy);return;
    }
    box.replaceChildren();
    s.editorId=item?.id||null;
    if(!item){box.textContent='Choose Move / select, then click a parking dot or number, cone, route, or label to edit it.';return;}
    const parking=item.kind==='parking-row';
    const title=d.createElement('strong');title.textContent=item.kind==='cone'?'Selected cone':item.label||(parking?'Selected parking row':'Selected route');box.append(title);
    const rememberParkingEdit=()=>{
      if(!editable())return;
      const edit=selectedParkingInput();if(edit)s.parkingEdits.set(item.id,edit);
      clearPdfLinks();s.dirty=true;syncButtons();
    };
    if(item.kind!=='cone'){
      const label=d.createElement('label');label.textContent=parking?'Parking row name':'Item label';const input=d.createElement('input');input.value=item.label;input.maxLength=100;input.disabled=s.busy;label.append(input);box.append(label);
      if(parking){input.dataset.parkingRowLabel='';input.addEventListener('input',rememberParkingEdit);}
      else input.addEventListener('change',()=>recordChange(plan=>{plan.items.find(x=>x.id===item.id).label=input.value;}));
    }
    const action=(label,fn)=>{const button=d.createElement('button');button.type='button';button.className='btn light';button.textContent=label;button.disabled=s.busy;button.addEventListener('click',fn);box.append(button);return button;};
    if(parking){
      const rowCount=d.createElement('p');rowCount.className='traffic-row-count';rowCount.textContent=`Parking spaces: ${parkingRowCount(item).toLocaleString('en-US')}`;box.append(rowCount);
      const widthLabel=d.createElement('label');widthLabel.textContent='Feet per space along this row';const width=d.createElement('input');width.type='number';width.min='1';width.max='100';width.step='0.1';width.value=item.spaceWidthFeet;width.dataset.parkingRowWidth='';width.disabled=s.busy;widthLabel.append(width);box.append(widthLabel);
      const countLabel=d.createElement('label');countLabel.textContent='Adjusted row count (optional)';const count=d.createElement('input');count.type='number';count.min='0';count.max=String(MAX_PARKING_SPACES);count.step='1';count.value=item.countOverride??'';count.placeholder=`Calculated count: ${estimateParkingRow(item)}`;count.dataset.parkingRowCount='';count.disabled=s.busy;countLabel.append(count);box.append(countLabel);
      for(const input of [width,count])input.addEventListener('input',rememberParkingEdit);
      action('Apply row changes',()=>{if(editable()&&commitParkingInputs()){render();say('Parking row updated. Save the layout to keep this count.');}}).dataset.parkingRowApply='';
      action('Use calculated count',()=>{if(!editable())return;count.value='';rememberParkingEdit();if(commitParkingInputs()){render();say('The row now uses its calculated count.');}}).dataset.parkingRowReset='';
      const help=d.createElement('small');help.textContent='Leave the adjusted count blank to calculate it from the row length and feet per space. Enter 0 if this row has no usable spaces. Count each row separately, and verify the marked spaces on site.';box.append(help);
    }
    if(item.kind==='route'||parking){
      if(!parking)action('Reverse traffic direction',()=>recordChange(plan=>plan.items.find(x=>x.id===item.id).points.reverse()));
      action(s.removeVertex?'Done removing points':`Remove ${parking?'row':'route'} points`,()=>{if(!editable()||!commitParkingInputs())return;s.removeVertex=!s.removeVertex;render();});
      const help=d.createElement('small');help.textContent=parking?'Drag square handles to adjust the row. Click + to insert a point. The dots follow the row, and its count updates from the length unless you have entered a row count.':'Drag solid points to reshape. Click + to insert a point. Arrows follow the route’s drawing direction.';box.append(help);
    }
    action('Delete selected item',()=>{if(recordChange(plan=>{plan.items=plan.items.filter(x=>x.id!==item.id);})){s.selected=null;renderSelection();}});
  }
  function setTool(mode){
    if(!editable())return;
    if(!commitParkingInputs())return;
    if(state.draft?.points.length&&!w.confirm('Discard the unfinished line? Finished layout items will stay.'))return;
    state.mode=mode;state.draft=['route','cone-row','parking-row','parking-auto'].includes(mode)?{points:[]}:null;state.selected=null;state.removeVertex=false;
    const hints={select:'Drag a cone or label to move it. Click a route, parking dot, or parking number to edit its points.',route:'Click along the travel path, in the direction vehicles or pedestrians will move. Then choose Finish line.','cone-row':'Click along the proposed cone line. Choose the cone count, then Finish line.','parking-row':'Mark one parking row from the outside edge of its first space to the outside edge of its last space. Choose Finish row to show the spaces as dots. Use separate rows on each side of an aisle.','parking-auto':autoParkingGuidance(false),cone:'Click the map to place cones. Continue clicking for more, then choose Move / select.',pin:'Choose a label type and click its position on the map.'};
    say(hints[mode]);render();
  }
  function mapClick(event){
    if(!editable())return;
    if(!commitParkingInputs())return;
    const s=state,p=[event.latlng.lat,event.latlng.lng];
    if(s.mode==='parking-auto'&&s.draft){
      let endpoint;
      try{endpoint=checkedPoint(p);}catch(error){say(`${error.message} ${autoParkingGuidance(Boolean(s.draft.points.length))}`);return;}
      if(!s.draft.points.length){
        s.draft.points=[endpoint];clearPdfLinks();renderDraft();syncButtons();say(autoParkingGuidance(true));return;
      }
      const start=s.draft.points[0];
      s.draft.points=[start,endpoint];
      if(!finishLine()){
        s.draft.points=[start];renderDraft();syncButtons();
        say(`${s.nodes.status.textContent} Your start point is kept. Correct the width if needed, then click the end of the row again.`);
      }
      return;
    }
    if(s.draft){if(s.draft.points.length>=200)return say('Finish this line before adding more points.');s.draft.points.push(p);renderDraft();syncButtons();return;}
    if(s.mode==='cone')recordChange(plan=>plan.items.push({id:uid(),kind:'cone',label:'',point:p}));
    if(s.mode==='pin'){const pinType=s.nodes.pinType.value;recordChange(plan=>plan.items.push({id:uid(),kind:'pin',pinType,label:s.nodes.itemLabel.value.trim()||PIN_LABELS[pinType],point:p}));}
  }
  function finishLine(){
    if(!editable()||!state.draft||state.draft.points.length<2)return false;
    const s=state,points=clone(s.draft.points);let items;
    try{
      if(isParkingTool(s.mode))items=[{id:uid(),kind:'parking-row',label:`Parking row ${s.plan.items.filter(item=>item.kind==='parking-row').length+1}`,points,spaceWidthFeet:parkingWidth(s.nodes.parkingWidth.value,Boolean(s.nodes.parkingWidth.validity?.badInput)),countOverride:null}];
      else items=s.mode==='cone-row'?coneRow(points,Number(s.nodes.coneCount.value)).map(point=>({id:uid(),kind:'cone',label:'',point})):[{id:uid(),kind:'route',routeType:s.nodes.routeType.value,label:s.nodes.itemLabel.value.trim()||`${s.nodes.routeType.selectedOptions[0].textContent} route`,points}];
    }
    catch(error){say(error.message);return false;}
    if(s.plan.items.length+items.length>MAX_ITEMS){say(`Keep this layout to ${MAX_ITEMS} items or fewer.`);return false;}
    if(recordChange(plan=>plan.items.push(...items))){s.mode='select';s.draft=null;s.selected=items.length===1&&items[0].kind!=='parking-row'?items[0].id:null;say(items[0].kind==='parking-row'?`Parking spaces added: ${parkingRowCount(items[0]).toLocaleString('en-US')}. Click a dot or the number to adjust the row, then save the layout.`:'Added to this draft. Save layout to keep a named copy for this meeting place.');render();return true;}
    return false;
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
      if(autoLoad&&records.length&&!s.busy&&!s.dirty&&!s.draft?.points.length)loadPlan(records[0].plan);
      say(records.length?`${records.length} saved traffic layout(s) available. Save creates a new copy; earlier copies stay available.`:'No saved traffic layouts yet. Zoom to the parking lot and begin drawing.');
    }catch(error){if(state===s)say(`Saved layouts could not be loaded: ${error.message}. Your draft is unchanged; use Reload saved layouts to retry.`);}
  }
  function loadPlan(plan){
    const s=state;let checked;
    try{checked=validatePlan(plan,s.plan.locationId);}catch(error){say(error.message);return false;}
    if((s.dirty||s.draft?.points.length)&&!w.confirm('Replace this unsaved traffic draft with the selected layout? Download JSON first to keep a local copy.'))return false;
    clearPdfLinks();s.plan=checked;s.undo=[];s.redo=[];s.parkingEdits.clear();s.selected=null;s.editorId=null;s.removeVertex=false;s.draft=null;s.mode='select';s.dirty=false;syncFields();
    setBasemap(checked.view.base,false);s.suppressView=true;s.map.setView([checked.view.lat,checked.view.lng],checked.view.zoom,{animate:false});s.suppressView=false;render();return true;
  }
  async function save(){
    if(!editable())return;
    const s=state;
    if(s.draft?.points.length)return say('Finish or cancel the current line before saving.');
    if(!commitParkingInputs())return;
    let snapshot;try{snapshot=capturePlan();}catch(error){say(error.message);return;}
    s.plan=clone(snapshot);
    const fingerprint=JSON.stringify(snapshot);s.busy=true;render();say('Saving a new traffic layout copy to this meeting location…');
    try{const saved=await storage.save(snapshot);if(state!==s||!permitted())return;s.records.unshift(saved);s.dirty=JSON.stringify(s.plan)!==fingerprint;savedOptions();s.nodes.saved.value=saved.id;say(`Saved “${snapshot.name}” to ${snapshot.locationName}.${s.dirty?' Further changes are still unsaved.':''}`);}
    catch(error){if(state===s)say(`Layout was NOT saved: ${error.message}. Keep this window open or Download JSON to preserve the draft.`);}
    finally{if(state===s){s.busy=false;render();}}
  }
  function clearPdfLinks(){
    if(!state)return;const s=state;
    s.pdfCurrent=null;
    if(s.pdfUrl){w.URL.revokeObjectURL(s.pdfUrl);s.pdfUrl=null;}
    s.nodes.pdfLinks?.replaceChildren();
  }
  function invalidatePdfContext(){
    if(state?.pdfCurrent&&!state.pdfCurrent()){clearPdfLinks();say('The location review or selected photos changed. Create a new PDF.');}
  }
  async function makePdf(combined=false){
    if(!editable())return;const s=state;
    if(s.draft?.points.length)return say('Finish or cancel the current line before exporting a PDF.');
    if(!commitParkingInputs())return;
    let captured;try{captured=capturePlan();}
    catch(error){say(error.message);return;}
    const fingerprint=JSON.stringify(captured);
    const isCurrent=()=>{
      if(state!==s||!permitted())return false;
      try{return JSON.stringify(capturePlan())===fingerprint;}
      catch{return false;}
    };
    clearPdfLinks();s.busy=true;render();say('Preparing your convention-branded PDF...');
    try{
      const built=await buildParkingPdfPacket(captured,{combined,getLocationPdf,exportPdf,mergePdfs,isCurrent,exportOptions:{document:d,window:w,unsaved:s.dirty,progress:message=>{if(state===s&&permitted())say(message);}}});
      if(state!==s||!permitted())return;
      if(!built.isCurrent())throw Error('The layout or review changed. Create the PDF again.');
      s.pdfUrl=w.URL.createObjectURL(built.blob);s.pdfCurrent=built.isCurrent;
      const open=d.createElement('a');open.href=s.pdfUrl;open.target='_blank';open.rel='noopener';open.className='btn light';open.textContent='Open PDF / Print';
      const download=d.createElement('a');download.href=s.pdfUrl;download.download=built.filename;download.className='btn blue';download.textContent='Download PDF';
      const checkCurrent=()=>{if(built.isCurrent())return true;clearPdfLinks();say('The layout or review changed. Create a new PDF.');return false;};
      for(const link of [open,download])link.addEventListener('click',event=>{if(!checkCurrent())event.preventDefault();});
      const presentation=d.createElement('button');presentation.type='button';presentation.className='btn light';presentation.textContent='Add to PowerPoint';
      presentation.addEventListener('click',async()=>{
        if(!checkCurrent())return;
        presentation.disabled=true;
        try{await sendToBuilder([{name:built.filename,blob:built.blob}],{window:w,isCurrent:built.isCurrent,notify:message=>{if(state===s&&permitted())say(message);}});}
        catch(error){if(state===s&&permitted())say(`Could not add the PDF to PowerPoint: ${error.message}`);}
        finally{if(state===s&&presentation.isConnected)presentation.disabled=false;}
      });
      s.nodes.pdfLinks.append(open,download,presentation);
      say(`PDF ready (${built.pages||'multiple'} ${built.pages===1?'page':'pages'}). ${combined?'Bus Access Review and selected photos come first, followed by the parking map. ':''}Parking spaces alone use one map page. Traffic layouts also include setup notes and item details. The sky header and hills footer appear on every page. Exporting does not save your layout to the cloud.${built.textWarning?' Some text characters need review; see the PDF text notice.':''}`);
    }catch(error){if(state===s&&permitted())say(`PDF was not created: ${error.message} Your layout and saved work are unchanged.`);}
    finally{if(state===s){s.busy=false;render();}}
  }
  function download(){
    if(!editable())return;
    const s=state;
    if(s.draft?.points.length)return say('Finish or cancel the line before downloading the layout.');
    if(!commitParkingInputs())return;
    try{const data=capturePlan();
      const url=w.URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=d.createElement('a');a.href=url;a.download=`${data.name.replace(/[^a-zA-Z0-9]+/g,'-')}-traffic.json`;d.body.append(a);a.click();a.remove();w.setTimeout(()=>w.URL.revokeObjectURL(url),1500);
      say('JSON backup downloaded. This does not save the layout to the cloud.');
    }catch(error){say(error.message);}
  }
  function setBasemap(base,dirty=true){
    const s=state;if(!s?.map)return;
    s.basemapLayers??=createTrafficBasemap({L,map:s.map,onTileError:kind=>{
      if(state===s)say(kind==='streetNames'?'Some street names could not load. Try Street map or zoom out; the layout is unchanged.':'Some background tiles are unavailable. Try Street map or zoom out; the layout is unchanged.');
    }});
    s.basemapLayers.set(base);
    s.plan.view.base=base;s.nodes.basemap.value=base;if(dirty){clearPdfLinks();s.dirty=true;}syncButtons();
  }
  function close(force=false){
    const s=state;if(!s)return true;
    if(!force&&s.busy){say('A save, deletion, or PDF export is still running. Keep this window open until its result is shown.');return false;}
    if(!force&&(s.dirty||s.draft?.points.length)&&!w.confirm('Close without saving this traffic draft? Cancel to save or download it first.'))return false;
    clearPdfLinks();sequence++;state=null;s.basemapLayers?.dispose();s.map?.remove();s.nodes.dialog.close();s.nodes.dialog.remove();d.body.classList.remove('traffic-dialog-open');card.querySelector('[data-open]').focus();return true;
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
      <label>Background<select data-basemap><option value="satellite">Satellite + street names</option><option value="street">Street map</option></select></label>
      <small>Street names appear on the map and in exported PDFs. Cones, routes, and your location labels stay on top.</small>
      <section class="traffic-parking-controls" aria-labelledby="trafficParkingTitle"><h3 id="trafficParkingTitle">Parking spaces</h3>
      <p class="traffic-parking-summary" data-parking-summary role="status" aria-live="polite">Parking spaces: Not counted</p><small data-parking-details></small>
      <label>Average space width (ft)<input data-parking-width type="number" min="1" max="100" step="0.1" value="${DEFAULT_PARKING_SPACE_WIDTH_FEET}" aria-describedby="trafficParkingWidthHelp"></label>
      <small id="trafficParkingWidthHelp">Use the average spacing along the row, starting at ${DEFAULT_PARKING_SPACE_WIDTH_FEET} ft per space. Adjust it to match the parking spaces.</small>
      <div class="traffic-pair traffic-parking-tools"><button class="btn blue" data-tool="parking-auto">Auto-mark spaces</button><button class="btn blue" data-tool="parking-row">Mark parking row</button></div>
      <small>Auto-mark spaces: click the outside edge of the first space, then the outside edge of the last space. The second click adds the dots. Mark parking row: add points along a row, then choose Finish row. Mark each side of an aisle separately.</small>
      <div class="traffic-pair traffic-parking-actions" data-parking-actions hidden><button type="button" class="btn blue" data-parking-finish disabled>Finish row</button><button type="button" class="btn light" data-parking-cancel disabled>Cancel row</button></div><small class="traffic-parking-draft" data-parking-draft></small>
      <label>Adjusted parking total (optional)<input data-parking-total type="number" min="0" max="${MAX_PARKING_SPACES}" step="1" placeholder="Use marked-row total" aria-describedby="trafficParkingTotalHelp"></label>
      <small id="trafficParkingTotalHelp">Leave blank to use the row total, or enter the number you want to use for this lot. An adjusted total stays in place as you edit rows. Verify spaces on site.</small><button type="button" class="btn light" data-parking-reset>Use row count</button></section>
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
      <button type="button" class="btn blue" data-export-pdf>Export parking-lot PDF</button>
      <button type="button" class="btn blue" data-export-combined>Export bus review + parking PDF</button>
      <small>Parking spaces alone use one map page. Traffic layouts include setup notes and item details. Combined PDFs start with the saved Bus Access Review and included location photos, followed by the parking map and any traffic details. Both options keep the sky header and hills footer.</small>
      <div class="traffic-pair" data-pdf-links aria-label="Generated traffic layout PDF"></div>
      <details class="traffic-saved" open><summary>Saved layouts for this location</summary><label>Choose a saved layout<select data-saved></select></label><div class="traffic-pair"><button class="btn light" data-load>Load layout</button><button class="btn light" data-refresh>Reload saved layouts</button><button class="btn light" data-new>New blank layout</button><button class="btn light" data-remove-saved>Delete saved copy</button></div></details>
      <div class="traffic-pair"><button class="btn light" data-download>Download JSON</button><button class="btn light" data-import>Import JSON</button></div><input data-file type="file" accept="application/json,.json" hidden>
      </aside><div class="traffic-map-area"><div class="traffic-map" data-map aria-label="Parking lot traffic layout map" role="application"></div><div class="traffic-map-legend"><span>▲ Cone</span><span class="traffic-bus-key">➜ Bus</span><span class="traffic-car-key">➜ Car</span><span class="traffic-walk-key">➜ Pedestrian</span><span class="traffic-parking-key">● Parking spaces</span><strong data-count></strong><span class="traffic-parking-map-total" data-parking-map-count>Parking spaces: Not counted</span></div><p class="traffic-warning">Planning sketch only. Aerial imagery may be outdated; zooming beyond its native detail only enlarges it. Confirm the layout on site with the property and transportation teams, including bus turning clearance, pedestrian access, and emergency access. This is not a live-traffic layer or an approved traffic-control plan.</p><p data-status class="traffic-status" role="status" aria-live="polite"></p></div></div>`;
    d.body.append(dialog);const q=selector=>dialog.querySelector(selector);
    const nodes={dialog,name:q('[data-name]'),notes:q('[data-notes]'),dirty:q('[data-dirty]'),saved:q('[data-saved]'),load:q('[data-load]'),removeSaved:q('[data-remove-saved]'),undo:q('[data-undo]'),redo:q('[data-redo]'),finish:q('[data-finish]'),cancelDraw:q('[data-cancel-draw]'),save:q('[data-save]'),pdf:q('[data-export-pdf]'),combinedPdf:q('[data-export-combined]'),pdfLinks:q('[data-pdf-links]'),count:q('[data-count]'),status:q('[data-status]'),selected:q('[data-selected]'),routeType:q('[data-route-type]'),pinType:q('[data-pin-type]'),coneCount:q('[data-cone-count]'),itemLabel:q('[data-item-label]'),basemap:q('[data-basemap]'),parkingWidth:q('[data-parking-width]'),parkingTotal:q('[data-parking-total]'),parkingSummary:q('[data-parking-summary]'),parkingDetails:q('[data-parking-details]'),parkingReset:q('[data-parking-reset]'),parkingMapCount:q('[data-parking-map-count]'),parkingActions:q('[data-parking-actions]'),parkingFinish:q('[data-parking-finish]'),parkingCancel:q('[data-parking-cancel]'),parkingDraft:q('[data-parking-draft]')};
    state={plan:newTrafficPlan(location),nodes,records:[],mode:'select',draft:null,selected:null,editorId:null,parkingEdits:new Map(),removeVertex:false,dirty:false,busy:false,undo:[],redo:[],suppressView:true,sequence:++sequence};
    const s=state;dialog.showModal();d.body.classList.add('traffic-dialog-open');
    s.map=L.map(q('[data-map]'),{maxZoom:22,minZoom:1,zoomControl:true,doubleClickZoom:false}).setView([location.lat,location.lng],19);
    s.parkingRenderer=typeof L.canvas==='function'?L.canvas({padding:.5,tolerance:4}):null;
    s.items=L.featureGroup().addTo(s.map);s.handles=L.featureGroup().addTo(s.map);s.sketch=L.featureGroup().addTo(s.map);
    L.control.scale({imperial:true,metric:false}).addTo(s.map);setBasemap('satellite',false);s.suppressView=false;
    s.map.on('click',mapClick);s.map.on('zoomend',()=>{if(state===s)render();});
    s.map.on('moveend',()=>{if(state!==s||s.suppressView)return;const v=view();if(JSON.stringify(v)!==JSON.stringify(s.plan.view)){clearPdfLinks();s.plan.view=v;s.dirty=true;syncButtons();}});
    w.setTimeout(()=>{if(state===s)s.map.invalidateSize({pan:false});},100);
    q('[data-close]').addEventListener('click',()=>close());dialog.addEventListener('cancel',event=>{event.preventDefault();if(s.draft){s.draft=null;s.mode='select';render();say('Unfinished line cancelled.');}else close();});
    dialog.querySelectorAll('[data-tool]').forEach(button=>{button.type='button';button.addEventListener('click',()=>setTool(button.dataset.tool));});
    nodes.finish.addEventListener('click',finishLine);nodes.cancelDraw.addEventListener('click',()=>{if(!editable())return;s.draft=null;s.mode='select';render();say('Unfinished line cancelled.');});
    nodes.parkingFinish.addEventListener('click',finishLine);nodes.parkingCancel.addEventListener('click',()=>{if(!editable()||!isParkingTool(s.mode))return;const auto=s.mode==='parking-auto';s.draft=null;s.mode='select';render();say(auto?'Auto-marking cancelled.':'Unfinished parking row cancelled.');});
    nodes.undo.addEventListener('click',()=>historyMove('undo','redo'));nodes.redo.addEventListener('click',()=>historyMove('redo','undo'));
    nodes.name.addEventListener('input',()=>{clearPdfLinks();s.plan.name=nodes.name.value;s.dirty=true;syncButtons();});nodes.notes.addEventListener('input',()=>{clearPdfLinks();s.plan.notes=nodes.notes.value;s.dirty=true;syncButtons();});
    nodes.parkingTotal.addEventListener('input',()=>{if(!editable())return;clearPdfLinks();s.dirty=true;syncButtons();});
    nodes.parkingReset.addEventListener('click',()=>{if(!editable())return;nodes.parkingTotal.value='';if(commitParkingInputs()){render();say('The parking total now follows the marked rows.');}});
    nodes.parkingWidth.addEventListener('input',()=>{if(editable())syncButtons();});
    nodes.basemap.addEventListener('change',()=>setBasemap(nodes.basemap.value));q('[data-zoom]').addEventListener('click',()=>s.map.setView([location.lat,location.lng],20,{animate:false}));
    nodes.save.addEventListener('click',save);nodes.pdf.addEventListener('click',()=>makePdf(false));nodes.combinedPdf.addEventListener('click',()=>makePdf(true));q('[data-refresh]').addEventListener('click',()=>refreshSaved());
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
  return {contextChanged,invalidatePdfContext,open,close,dispose(){close(true);w.removeEventListener('beforeunload',unload);card.remove();style.remove();}};
}

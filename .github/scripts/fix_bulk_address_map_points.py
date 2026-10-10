from pathlib import Path
import re

VERSION = 'territories-20261010-4'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label} replacement count was {count}')
    return updated


bulk_path = Path('territories/bulk-addresses.js')
bulk = bulk_path.read_text(encoding='utf-8')

bulk = replace_once(
    bulk,
    "if(h.included!==false&&!h.avoid)b.included++;",
    "if(h.included!==false&&!h.avoid&&usableCoordinates(h.lat,h.lng))b.included++;",
    'workset included count'
)
bulk = replace_once(
    bulk,
    "function batchHouses(eligible=true){ return api.getHouses().filter(h=>inBatch(h,activeBatchId)&&(!eligible||(h.included!==false&&!h.avoid))); }",
    "function batchHouses(eligible=true){ return api.getHouses().filter(h=>inBatch(h,activeBatchId)&&(!eligible||(h.included!==false&&!h.avoid&&usableCoordinates(h.lat,h.lng)))); }",
    'workset coordinate filter'
)
bulk = replace_once(
    bulk,
    "function number(value){ const n=Number(String(value??'').replace(/,/g,'')); return Number.isFinite(n)?n:null; }",
    """function number(value){
  const text=clean(value).replace(/,/g,'');
  if(!text)return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}
function usableCoordinates(lat,lng){
  const y=Number(lat),x=Number(lng);
  return Number.isFinite(y)&&Number.isFinite(x)&&y>=-90&&y<=90&&x>=-180&&x<=180&&!(Math.abs(y)<1&&Math.abs(x)<1);
}
function invalidBatchHouses(){return batchHouses(false).filter(h=>!usableCoordinates(h.lat,h.lng));}""",
    'blank coordinate parsing'
)

new_add_row = r"""function addRow(row,resolved,batchId,batchName,index){
  const lat=Number(resolved.lat??row.lat),lng=Number(resolved.lng??row.lng);
  if(!usableCoordinates(lat,lng))return'No usable coordinates';
  if(useBoundary()){
    if(!api.getBoundaryGeometry?.())return'No congregation boundary';
    if(!api.pointInsideBoundary?.({lat,lng}))return'Outside current boundary';
  }
  let h=index.get(key(row.address));
  if(h){
    const needsRepair=!usableCoordinates(h.lat,h.lng);
    if(needsRepair){
      h.lat=lat;
      h.lng=lng;
      h.address=clean(resolved.matchedAddress||row.address)||h.address;
      h.baseAddress=h.baseAddress||row.address;
      h.source=`Bulk address workset — ${batchName}`;
      h.classification=h.classification||'Imported address workset';
      h.bulkImported=true;
      h.supplemental=true;
      tag(h,batchId,batchName);
      index.set(key(h.address),h);
      return'repaired';
    }
    tag(h,batchId,batchName);
    return'matched';
  }
  const record={id:id('bulk-address'),address:clean(resolved.matchedAddress||row.address),baseAddress:row.address,lat,lng,unit:'',source:`Bulk address workset — ${batchName}`,classification:'Imported address workset',residential:true,unitCount:1,included:true,avoid:false,territoryId:null,supplemental:true,bulkImported:true,bulkBatchIds:[batchId],bulkBatchNames:[batchName],bulkBatchId:batchId,bulkBatchName:batchName,bulkSourceRow:row.row};
  if(!api.addHouseRecord(record))return'Duplicate address';
  index.set(key(row.address),record);
  index.set(key(record.address),record);
  return'added';
}
async function readList"""
bulk = regex_once(
    bulk,
    r"function addRow\(row,resolved,batchId,batchName,index\)\{.*?\}\nasync function readList",
    new_add_row,
    'add-row coordinate repair'
)
bulk = bulk.replace(
    "pending.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng)).length",
    "pending.filter(r=>usableCoordinates(r.lat,r.lng)).length"
)

new_import = r"""async function importList(){
  if(!requireAdmin()||!requireContext()||!pending.length)return;
  if(useBoundary()&&!api.getBoundaryGeometry?.())return toast('Draw or load a congregation boundary, or choose CSV address-only map.',true);
  const batchName=clean(el.name.value)||'Prepared address list';
  const batchId=`bulk-${slug(batchName)}-${Date.now().toString(36)}`;
  const index=indexHouses(),geocode=[];
  let added=0,matched=0,repaired=0;
  unresolved=[];
  el.import.disabled=true;
  progress(0,pending.length);
  const countStatus=status=>{
    if(status==='added')added++;
    else if(status==='matched')matched++;
    else if(status==='repaired')repaired++;
    return ['added','matched','repaired'].includes(status);
  };
  for(const row of pending){
    const existing=index.get(key(row.address));
    if(existing&&usableCoordinates(existing.lat,existing.lng)){
      tag(existing,batchId,batchName);
      matched++;
    }else if(usableCoordinates(row.lat,row.lng)){
      const status=addRow(row,row,batchId,batchName,index);
      if(!countStatus(status))unresolved.push({...row,reason:status});
    }else geocode.push(row);
  }
  const handled=pending.length-geocode.length;
  const results=await pool(geocode,async row=>({row,resolved:await census(row.address)}),done=>progress(handled+done,pending.length));
  for(const result of results){
    if(result?.resolved){
      const status=addRow(result.row,result.resolved,batchId,batchName,index);
      if(!countStatus(status))unresolved.push({...result.row,reason:status});
    }else unresolved.push({...result?.row,reason:result?.error?.message||'No match'});
  }
  activeBatchId=batchId;
  api.recalculateTerritoryHouseIds?.();
  api.render();
  refresh();
  el.batch.value=batchId;
  el.focus.checked=true;
  focus();
  zoom();
  el.progress.hidden=true;
  pending=[];
  el.preview.hidden=true;
  el.file.value='';
  el.paste.value='';
  el.import.disabled=true;
  updateUnresolved();
  const ready=added+matched+repaired;
  const repairNote=repaired?` ${repaired} previously misplaced location${repaired===1?' was':'s were'} repaired.`:'';
  setMessage(`${ready.toLocaleString()} addresses are ready in “${batchName}” (${added} new, ${matched} matched, ${repaired} repaired).${unresolved.length?` ${unresolved.length} unresolved.`:''}${repairNote}`,unresolved.length?'warning':'success');
  toast(`${batchName} is mapped and ready for territory grouping.${repaired?` ${repaired} location${repaired===1?' was':'s were'} repaired.`:''}`);
}
function updateUnresolved"""
bulk = regex_once(
    bulk,
    r"async function importList\(\)\{.*?\}\nfunction updateUnresolved",
    new_import,
    'bulk import function'
)

bulk = replace_once(
    bulk,
    "function groupBatch(){if(!requireAdmin())return;const b=batch(),houses=batchHouses();if(!b||!houses.length)return toast('Select a workset with included addresses.',true);",
    "function groupBatch(){if(!requireAdmin())return;const b=batch(),broken=invalidBatchHouses(),houses=batchHouses();if(!b||!houses.length)return toast('Select a workset with mapped included addresses.',true);if(broken.length)return toast(`${broken.length.toLocaleString()} address location${broken.length===1?' needs':'s need'} repair before territories can be created. Select Repair Mapped Locations.`,true);",
    'grouping invalid-coordinate guard'
)

repair_function = r"""async function repairBatchLocations(){
  if(!requireAdmin())return;
  const b=batch(),broken=invalidBatchHouses();
  if(!b)return toast('Select an address workset first.',true);
  if(!broken.length)return toast('All addresses in this workset already have usable map locations.');
  if(!confirm(`Repair ${broken.length.toLocaleString()} misplaced or unmapped address location${broken.length===1?'':'s'} in “${b.name}”? The addresses will be located again and the map will return to the neighborhood.`))return;
  el.repair.disabled=true;
  el.repair.textContent='Repairing Locations…';
  unresolved=[];
  progress(0,broken.length);
  try{
    const results=await pool(broken,async house=>({house,resolved:await census(house.baseAddress||house.address)}),done=>progress(done,broken.length));
    let repaired=0;
    for(const result of results){
      const house=result?.house;
      const resolved=result?.resolved;
      if(house&&resolved&&usableCoordinates(resolved.lat,resolved.lng)){
        house.lat=Number(resolved.lat);
        house.lng=Number(resolved.lng);
        house.address=clean(resolved.matchedAddress||house.address);
        house.source=`Repaired address location — ${b.name}`;
        house.bulkImported=true;
        house.supplemental=true;
        repaired++;
      }else if(house){
        unresolved.push({address:house.baseAddress||house.address,reason:result?.error?.message||'No address match'});
      }
    }
    api.recalculateTerritoryHouseIds?.();
    api.render();
    refresh();
    focus();
    zoom();
    updateUnresolved();
    setMessage(`${repaired.toLocaleString()} address location${repaired===1?' was':'s were'} repaired and placed in the neighborhood.${unresolved.length?` ${unresolved.length} could not be located and are listed below.`:' Select Save Address Set to Selected Hall to retain the repair.'}`,unresolved.length?'warning':'success');
    toast(`${repaired.toLocaleString()} address location${repaired===1?' repaired':'s repaired'}. ${unresolved.length?`${unresolved.length} still need review.`:'The map and territory PDFs are ready to use.'}`);
  }finally{
    el.progress.hidden=true;
    el.repair.textContent='Repair Mapped Locations';
    refresh();
  }
}
"""
bulk = replace_once(bulk, "function refresh(){", repair_function + "function refresh(){", 'repair function insertion')

new_refresh = r"""function refresh(){
  refreshContext();
  const list=batches(),previous=activeBatchId||el.batch.value;
  el.batch.innerHTML=list.length?list.map(b=>`<option value="${esc(b.id)}">${esc(b.name)} — ${b.total.toLocaleString()}</option>`).join(''):'<option value="">Import a workset first</option>';
  el.batch.value=list.some(b=>b.id===previous)?previous:list[0]?.id||'';
  activeBatchId=el.batch.value;
  const b=batch(),broken=b?invalidBatchHouses().length:0;
  el.stats.textContent=b?`${b.total.toLocaleString()} addresses • ${b.included.toLocaleString()} mapped and included • ${b.assigned.toLocaleString()} assigned${broken?` • ${broken.toLocaleString()} need location repair`:''}`:'No workset selected.';
  [el.group,el.manual,el.remove].forEach(x=>x.disabled=!b||!api.isAdmin());
  el.repair.disabled=!b||!api.isAdmin()||!broken;
  el.focus.disabled=!b;
  el.note.textContent=b?broken?`Repair the ${broken.toLocaleString()} misplaced address location${broken===1?'':'s'} before grouping or printing territories.`:`Only the ${b.included.toLocaleString()} mapped included addresses in “${b.name}” will be grouped.`:'Import or select a workset.';
}
function focus"""
bulk = regex_once(bulk, r"function refresh\(\)\{.*?\}\nfunction focus", new_refresh, 'workset refresh')
bulk = replace_once(
    bulk,
    "function zoom(){const points=batchHouses().map(h=>[h.lat,h.lng]);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[40,40],maxZoom:17});}",
    "function zoom(){const points=batchHouses().filter(h=>usableCoordinates(h.lat,h.lng)).map(h=>[Number(h.lat),Number(h.lng)]);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[40,40],maxZoom:17});}",
    'workset zoom'
)

bulk = replace_once(
    bulk,
    '<div class="button-grid"><button id="bulkGroup" class="btn primary admin-control" disabled>Create Territories from Workset</button><button id="bulkManual" class="btn save admin-control" disabled>Draw Manual Territory</button><button id="bulkRemove" class="btn danger admin-control" disabled>Remove Workset</button></div>',
    '<div class="button-grid"><button id="bulkRepair" class="btn outline admin-control" disabled>Repair Mapped Locations</button><button id="bulkGroup" class="btn primary admin-control" disabled>Create Territories from Workset</button><button id="bulkManual" class="btn save admin-control" disabled>Draw Manual Territory</button><button id="bulkRemove" class="btn danger admin-control" disabled>Remove Workset</button></div>',
    'repair button'
)
bulk = replace_once(
    bulk,
    "method:document.getElementById('bulkMethod'),group:document.getElementById('bulkGroup'),manual:document.getElementById('bulkManual'),remove:document.getElementById('bulkRemove'),note:document.getElementById('bulkNote')",
    "method:document.getElementById('bulkMethod'),repair:document.getElementById('bulkRepair'),group:document.getElementById('bulkGroup'),manual:document.getElementById('bulkManual'),remove:document.getElementById('bulkRemove'),note:document.getElementById('bulkNote')",
    'repair element binding'
)
bulk = replace_once(
    bulk,
    "el.focus.onchange=()=>el.focus.checked?(focus(),zoom()):resetFocus();el.group.onclick=groupBatch;",
    "el.focus.onchange=()=>el.focus.checked?(focus(),zoom()):resetFocus();el.repair.onclick=repairBatchLocations;el.group.onclick=groupBatch;",
    'repair event binding'
)
bulk_path.write_text(bulk, encoding='utf-8')


app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "function pointFeature(item) { return turf.point([Number(item.lng), Number(item.lat)]); }",
    """function validMapCoordinates(item) {
  const lat = Number(item?.lat), lng = Number(item?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(Math.abs(lat) < 1 && Math.abs(lng) < 1);
}
function pointFeature(item) { return turf.point([Number(item.lng), Number(item.lat)]); }""",
    'global coordinate validator'
)
app = replace_once(
    app,
    "function addHouseRecord(record) {\n  const key = normalizeAddressKey(record.address, true);",
    "function addHouseRecord(record) {\n  if (!validMapCoordinates(record)) return false;\n  const key = normalizeAddressKey(record.address, true);",
    'house coordinate guard'
)
app = replace_once(
    app,
    "  for (const house of houses) {\n    const marker = L.circleMarker",
    "  for (const house of houses) {\n    if (!validMapCoordinates(house)) continue;\n    const marker = L.circleMarker",
    'house marker coordinate guard'
)
app = app.replace(
    ".filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)))",
    ".filter(house => validMapCoordinates(house))"
)
app = replace_once(
    app,
    "return houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).sort",
    "return houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id && validMapCoordinates(house)).sort",
    'PDF address coordinate filter'
)
app = replace_once(
    app,
    "const points = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id).map(pointFeature);",
    "const points = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id && validMapCoordinates(house)).map(pointFeature);",
    'territory geometry coordinate filter'
)
app = replace_once(
    app,
    "  const included = houses.filter(house => house.included && !house.avoid);\n  if (!included.length)",
    "  const misplaced = houses.filter(house => house.included && !house.avoid && !validMapCoordinates(house));\n  if (misplaced.length) { toast(`${misplaced.length.toLocaleString()} address location${misplaced.length === 1 ? ' needs' : 's need'} repair before territories can be grouped. Use Repair Mapped Locations in Pre-Done Address Lists.`, true); return; }\n  const included = houses.filter(house => house.included && !house.avoid && validMapCoordinates(house));\n  if (!included.length)",
    'automatic grouping coordinate guard'
)
app = replace_once(
    app,
    "  const territoryHouses = territoryHousesSorted(territory);\n  if (!territoryHouses.length) { toast('This territory does not have any assigned addresses.', true); return; }",
    "  const assignedTerritoryHouses = houses.filter(house => house.included && !house.avoid && house.territoryId === territory.id);\n  const misplacedTerritoryHouses = assignedTerritoryHouses.filter(house => !validMapCoordinates(house));\n  if (misplacedTerritoryHouses.length) { toast(`${misplacedTerritoryHouses.length.toLocaleString()} address location${misplacedTerritoryHouses.length === 1 ? ' needs' : 's need'} repair before this PDF can be created. Use Repair Mapped Locations in Pre-Done Address Lists.`, true); return; }\n  const territoryHouses = territoryHousesSorted(territory);\n  if (!territoryHouses.length) { toast('This territory does not have any mapped assigned addresses.', true); return; }",
    'PDF coordinate repair message'
)
app = replace_once(
    app,
    "  const mapped = houses.filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)));",
    "  const mapped = houses.filter(house => validMapCoordinates(house));",
    'Hall boundary coordinate filter'
)
app = replace_once(
    app,
    "  geocodeAddress: address => geocodeAvoidAddress(address),\n  refresh: emitPlannerDataChange",
    "  geocodeAddress: address => geocodeAvoidAddress(address),\n  validMapCoordinates,\n  refresh: emitPlannerDataChange",
    'coordinate validator API'
)
app_path.write_text(app, encoding='utf-8')


hall_path = Path('territories/hall-address-sets.js')
hall = hall_path.read_text(encoding='utf-8')
hall = replace_once(
    hall,
    "function validAddresses(data = context()) {\n  return data.houses.filter(house => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)));\n}",
    "function validAddresses(data = context()) {\n  return data.houses.filter(house => api?.validMapCoordinates?.(house) ?? (Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)) && !(Math.abs(Number(house.lat)) < 1 && Math.abs(Number(house.lng)) < 1)));\n}",
    'Hall address-set coordinate filter'
)
hall_path.write_text(hall, encoding='utf-8')


for path_name in ('territories/bootstrap.js', 'territories/index.html'):
    path = Path(path_name)
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'territories-\d{8}-\d+', VERSION, text)
    path.write_text(text, encoding='utf-8')

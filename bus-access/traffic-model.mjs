// All geometry uses [latitude, longitude]. Layouts are planning sketches, not bus turning-radius simulations.
export const SCHEMA_VERSION = 1;
export const MAX_LAYOUTS = 20;
export const MAX_ITEMS = 800;
export const MAX_STORE_BYTES = 650000;
export const clone = value => JSON.parse(JSON.stringify(value));
const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const number = value => value !== null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value));
export function point(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(number) || Math.abs(Number(value[0])) > 85 || Math.abs(Number(value[1])) > 180) throw Error('A map point has invalid coordinates.');
  return value.map(Number);
}
export function datedLayoutName(name, now = new Date()) {
  return `${text(name, 85)} — ${new Intl.DateTimeFormat('en-US', {timeZone: 'America/Denver', month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(now)}`;
}
export function newTrafficPlan(location, now = new Date()) {
  if (!location?.id) throw Error('Select a meeting location first.');
  const [lat,lng] = point([location.lat,location.lng]);
  return {schemaVersion:1,locationId:String(location.id),locationName:text(location.name),locationAddress:text(location.address,240),name:datedLayoutName(location.name,now),notes:'',view:{lat,lng,zoom:19,base:'satellite'},items:[]};
}
export function validatePlan(input, expectedLocationId) {
  if (!input || input.schemaVersion !== 1) throw Error('This traffic layout format is not supported.');
  if (!text(input.locationId) || String(input.locationId) !== String(expectedLocationId)) throw Error('This traffic layout belongs to a different meeting location.');
  if (!text(input.name)) throw Error('Enter a name for this layout.');
  const [lat,lng] = point([input.view?.lat,input.view?.lng]);
  if (!number(input.view?.zoom) || Number(input.view.zoom) < 1 || Number(input.view.zoom) > 22) throw Error('The saved map zoom is invalid.');
  if (!Array.isArray(input.items) || input.items.length > MAX_ITEMS) throw Error(`A layout can contain up to ${MAX_ITEMS} items.`);
  const ids = new Set(); let vertices = 0;
  const items = input.items.map(item => {
    const id = text(item.id,100);
    if (!id || ids.has(id)) throw Error('Layout items must have unique IDs.');
    ids.add(id);
    const base = {id,kind:item.kind,label:text(item.label,100)};
    if (item.kind === 'cone') return {...base,point:point(item.point)};
    if (item.kind === 'pin') {
      if (!['entry','exit','loading','no-entry','note'].includes(item.pinType)) throw Error('Unknown map label type.');
      return {...base,pinType:item.pinType,point:point(item.point)};
    }
    if (item.kind === 'route') {
      if (!['bus','car','walk'].includes(item.routeType) || !Array.isArray(item.points) || item.points.length < 2 || item.points.length > 200) throw Error('A route needs 2–200 points and a valid route type.');
      vertices += item.points.length;
      if (vertices > 5000) throw Error('This layout has too many route points. Split it into smaller layouts.');
      const points = item.points.map(point);
      if (points.every(p=>p[0]===points[0][0]&&p[1]===points[0][1])) throw Error('A route must contain at least two different points.');
      return {...base,routeType:item.routeType,points};
    }
    throw Error('Unknown traffic layout item.');
  });
  return {schemaVersion:1,locationId:String(expectedLocationId),locationName:text(input.locationName),locationAddress:text(input.locationAddress,240),name:text(input.name),notes:text(input.notes,2500),view:{lat,lng,zoom:Number(input.view.zoom),base:input.view.base==='street'?'street':'satellite'},items};
}
export function distanceMeters(a,b) {
  const r = Math.PI/180, dlat=(b[0]-a[0])*r, dlng=(b[1]-a[1])*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlng/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function coneRow(rawPoints,count) {
  if (!Number.isInteger(count) || count<2 || count>100) throw Error('Choose between 2 and 100 cones in a row.');
  if (!Array.isArray(rawPoints) || rawPoints.length<2 || rawPoints.length>200) throw Error('Mark at least two points for the cone row.');
  const points=rawPoints.map(point), lengths=points.slice(1).map((p,i)=>distanceMeters(points[i],p));
  const total=lengths.reduce((a,b)=>a+b,0);
  if (total<0.2 || total>2000) throw Error('Draw a cone row between 0.2 and 2,000 metres long.');
  return Array.from({length:count},(_,i)=>{
    if(i===count-1)return [...points.at(-1)];
    let d=total*i/(count-1),segment=0;
    while(segment<lengths.length-1&&d>=lengths[segment]){d-=lengths[segment];segment++;}
    const t=lengths[segment]?d/lengths[segment]:0,a=points[segment],b=points[segment+1];
    return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  });
}
export function arrowheads(projected) {
  return projected.slice(1).flatMap((b,i)=>{
    const a=projected[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<12)return [];
    const count=Math.min(30,Math.max(1,Math.floor(len/75)));
    return Array.from({length:count},(_,j)=>({x:a.x+dx*(j+.5)/count,y:a.y+dy*(j+.5)/count,angle:Math.atan2(dy,dx)*180/Math.PI}));
  });
}
export function readLayouts(value,locationId) {
  if(value===undefined || value===null || value==='')return [];
  let parsed;
  try{parsed=JSON.parse(value);}catch{throw Error('The saved traffic layouts could not be read. They have not been replaced.');}
  if(parsed.schemaVersion!==1 || !Array.isArray(parsed.layouts) || parsed.layouts.length>MAX_LAYOUTS)throw Error('The saved traffic layout library is not supported.');
  const ids=new Set();
  return parsed.layouts.map(record=>{
    if(!record.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(record.id)||ids.has(record.id)||!number(record.savedAt))throw Error('The saved traffic library has an invalid entry.');
    ids.add(record.id);
    return {id:record.id,savedAt:Number(record.savedAt),plan:validatePlan(record.plan,locationId)};
  }).sort((a,b)=>b.savedAt-a.savedAt);
}
export function appendLayout(value,plan,id,now=Date.now()) {
  const validated=validatePlan(plan,plan.locationId), layouts=readLayouts(value,validated.locationId);
  if(layouts.some(x=>x.id===id))throw Error('This layout copy already exists. Reload the saved list before trying again.');
  if(layouts.length>=MAX_LAYOUTS)throw Error(`There are already ${MAX_LAYOUTS} saved layouts here. Download and delete an older layout before saving another.`);
  layouts.unshift({id,savedAt:now,plan:validated});
  const json=JSON.stringify({schemaVersion:1,layouts});
  readLayouts(json,validated.locationId);
  if(new TextEncoder().encode(json).length>MAX_STORE_BYTES)throw Error('This location’s traffic layout library is full. Download and remove an older layout before saving another.');
  return json;
}
export function removeLayout(value,locationId,id) {
  const layouts=readLayouts(value,locationId);
  if(!layouts.some(x=>x.id===id))throw Error('That saved layout no longer exists. Reload the saved list.');
  return JSON.stringify({schemaVersion:1,layouts:layouts.filter(x=>x.id!==id)});
}
// A save is a new immutable copy; no inspection fields or other layouts are rewritten by this service.
export function createTrafficStorage({db,doc,getDocFromServer,runTransaction,isAdmin,makeId=()=>crypto.randomUUID(),now=()=>Date.now()}) {
  const guard=()=>{if(!isAdmin())throw Error('Administrator sign-in is required for traffic layouts.');};
  return {
    async list(locationId){guard();const snapshot=await getDocFromServer(doc(db,'reviews',String(locationId)));guard();return readLayouts(snapshot.exists()?snapshot.data().trafficLayoutsJson:undefined,locationId);},
    async save(plan){guard();const captured=validatePlan(plan,plan.locationId),id=makeId(),savedAt=now(),ref=doc(db,'reviews',captured.locationId);
      await runTransaction(db,async tx=>{guard();const snapshot=await tx.get(ref);guard();const json=appendLayout(snapshot.exists()?snapshot.data().trafficLayoutsJson:undefined,captured,id,savedAt);tx.set(ref,{trafficLayoutsJson:json},{merge:true});});
      return {id,savedAt,plan:captured};
    },
    async remove(locationId,id){guard();const ref=doc(db,'reviews',String(locationId));await runTransaction(db,async tx=>{guard();const snapshot=await tx.get(ref);guard();const json=removeLayout(snapshot.exists()?snapshot.data().trafficLayoutsJson:undefined,locationId,id);tx.set(ref,{trafficLayoutsJson:json},{merge:true});});}
  };
}

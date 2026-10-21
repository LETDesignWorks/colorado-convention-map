// Times are Denver wall-clock values, independent of the viewer's device timezone.
export const RECORD_TYPE = 'activity-multistop-route';
export function wallTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new Error('Enter a date and start time.');
  const time = Date.parse(value + ':00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,16) !== value) throw new Error('Enter a valid date and time.');
  return time;
}
export const wallString = time => new Date(time).toISOString().slice(0,16);
export function numeric(value, label, min=0, max=1000000, integer=false) {
  if (value === '' || value === null || value === undefined) throw new Error(`Enter ${label}.`);
  const n=Number(value);
  if (!Number.isFinite(n) || n<min || n>max || (integer && !Number.isInteger(n))) throw new Error(`${label} must be ${integer?'a whole number ':''}between ${min} and ${max}.`);
  return n;
}
export function validPoint(p) { return p && p.lat!=='' && p.lng!=='' && p.lat!=null && p.lng!=null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat))<=90 && Math.abs(Number(p.lng))<=180; }
export function routePoints(plan) {
  const points=plan.stops.map(p=>({...p}));
  if(plan.roundTrip && points.length && (points[0].lat!==points.at(-1).lat || points[0].lng!==points.at(-1).lng)) points.push({...points[0],dwell:0,boarding:0,role:'Return to start',automaticReturn:true});
  return points;
}
export function calculate(plan, legs) {
  if(!Array.isArray(plan.stops) || plan.stops.length<2 || plan.stops.length>20) throw new Error('Add between 2 and 20 stops.');
  plan.stops.forEach(p=>{if(!validPoint(p)) throw new Error(`Locate ${p.name || 'each stop'} on the map first.`);numeric(p.dwell,'stop time',0,2880);});
  const start=wallTime(plan.startLocal), runs=numeric(plan.runs,'number of runs',1,30,true);
  const points=routePoints(plan);
  if(runs>1 && (points[0].lat!==points.at(-1).lat || points[0].lng!==points.at(-1).lng)) throw new Error('Repeated runs must return to the starting point. Enable round trip or add the starting point as the last stop.');
  if(legs.length!==points.length-1) throw new Error('Recalculate the route after changing stops.');
  const buffer=numeric(plan.buffer,'traffic allowance per leg',0,240), turnaround=numeric(plan.turnaround,'time between runs',0,1440);
  const buses=numeric(plan.buses,'bus count',1,100,true), seats=numeric(plan.seats,'seats per bus',1,100,true), delegates=numeric(plan.delegates,'delegates per run',1,10000,true);
  if(delegates>buses*seats) throw new Error(`The plan has ${delegates} delegates but only ${buses*seats} seats. Increase buses or reduce delegates.`);
  if(!['new','same'].includes(plan.passengers)) throw new Error('Choose whether each run carries the same or new delegates.');
  if(!['day','run','hour'].includes(plan.costBasis)) throw new Error('Choose a bus cost basis.');
  const rate=numeric(plan.rate,'bus cost',0,1000000), extras=numeric(plan.extras,'total additional costs',0,1000000);
  let clock=start, mileage=0, driving=0;
  const timeline=[];
  for(let run=1;run<=runs;run++) {
    for(let i=0;i<points.length;i++) {
      const point=points[i], arrival=clock;
      // Loading is part of the entered stop duration, never an extra hidden delay.
      const boarding=numeric(point.boarding??0,'loading minutes',0,240);
      if(boarding>Number(point.dwell)) throw new Error(`Loading minutes at ${point.name||'this stop'} cannot exceed stop minutes. Increase the stop duration to allow loading.`);
      clock+=Number(point.dwell)*60000;
      timeline.push({run,stop:i+1,name:point.name,role:point.role,arrival:wallString(arrival),departure:wallString(clock),dwell:Number(point.dwell),boarding,ready:boarding>0?wallString(clock-boarding*60000):null,finalStop:i===points.length-1});
      if(i<legs.length) {
        const leg=legs[i];
        const base=numeric(leg.minutes,'driving minutes',0,10000), miles=numeric(leg.miles,'distance',0,10000);
        const manual=plan.overrides?.[i];
        const minutes=manual!=='' && manual!=null ? numeric(manual,'manual driving minutes',0,10000) : base;
        clock+=(minutes+buffer)*60000; driving+=minutes; mileage+=miles;
      }
    }
    if(run<runs) clock+=turnaround*60000;
  }
  const totalMinutes=(clock-start)/60000;
  const totalCost=rate*buses*(plan.costBasis==='run'?runs:plan.costBasis==='hour'?totalMinutes/60:1)+extras;
  const uniqueDelegates=delegates*(plan.passengers==='new'?runs:1);
  return {timeline,startLocal:plan.startLocal,endLocal:wallString(clock),totalMinutes,driving,miles:mileage,totalCost,uniqueDelegates,delegateRuns:delegates*runs,costPerDelegate:totalCost/uniqueDelegates,costPerDelegateRun:totalCost/(delegates*runs),runs,buses,capacity:buses*seats};
}
export function conflicts(records) {
  const result=[];
  for(let i=0;i<records.length;i++) for(let j=i+1;j<records.length;j++) {
    const a=records[i],b=records[j],coach=String(a.coachId||'').trim().toLowerCase();
    if(!coach || coach!==String(b.coachId||'').trim().toLowerCase() || a.id===b.id) continue;
    try {if(wallTime(a.startLocal)<wallTime(b.endLocal) && wallTime(b.startLocal)<wallTime(a.endLocal)) result.push([a,b]);} catch { /* Unscheduled legacy records are shown but cannot be compared. */ }
  }
  return result;
}
export function legacyRoute(record) {
  const r=record, activity=r.recordType==='activity-bus-plan';
  if(!activity && r.recordType!=='bus-route') return null;
  const start={...(activity?r.hotel:r.origin),name:r.hotelName||'Hotel',address:r.hotelAddress||'',dwell:0,role:'Hotel'};
  const stops=activity ? [start,{...r.outboundPoint,name:r.outboundPointName||r.activityName,address:r.outboundPointAddress||'',dwell:0,role:'Activity drop-off'}] : [start,{...r.destination,name:r.destinationName||'Field service',address:r.destinationAddress||'',dwell:0,role:'Field service',hallId:r.destinationId||''}];
  if(activity) {if(validPoint(r.returnPoint) && (r.returnPoint.lat!==r.outboundPoint?.lat || r.returnPoint.lng!==r.outboundPoint?.lng)) stops.push({...r.returnPoint,name:r.returnPointName||'Activity pickup',dwell:0,role:'Pickup'});stops.push({...start,role:'Return'});}
  return {id:r.id,name:r.planName||r.routeName||'Saved route',coachId:r.coachId||'',startLocal:r.reportLocal||r.departureLocal||'',endLocal:r.availableLocal||r.hotelReturnLocal||r.meetingLocal||'',stops:stops.filter(validPoint),legacy:true,kind:activity?'Activity schedule':'Field-service route',sourcePath:activity?'activities':'routes',miles:activity?Number(r.outboundDistanceMiles||0)+Number(r.returnDistanceMiles||0):Number(r.distanceMiles||0)};
}
export function decodeRecord(record) {
  if(record.recordType!==RECORD_TYPE) return legacyRoute(record);
  try {const plan=JSON.parse(record.planJson),legs=JSON.parse(record.legsJson);const summary=calculate(plan,legs);return {...plan,id:record.id,legs,summary,startLocal:summary.startLocal,endLocal:summary.endLocal,kind:'Activity route',shared:true};}catch{return null;}
}
export function encodeRecord(plan,legs) {
  const summary=calculate(plan,legs);
  const keys=['name','coachId','startLocal','buffer','runs','turnaround','buses','seats','delegates','passengers','costBasis','rate','extras','notes','stops','roundTrip','overrides'];
  const cleanPlan=Object.fromEntries(keys.filter(key=>plan[key]!==undefined).map(key=>[key,plan[key]]));
  // JSON strings avoid Firestore's nested-array restriction for route geometry.
  return {recordType:RECORD_TYPE,schemaVersion:1,planName:plan.name,coachId:plan.coachId,departureLocal:summary.startLocal,availableLocal:summary.endLocal,timeZone:'America/Denver',planJson:JSON.stringify(cleanPlan),legsJson:JSON.stringify(legs)};
}

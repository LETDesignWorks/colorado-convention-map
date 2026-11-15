import {readTravel} from '../assets/travel-register.mjs';
import {denverInput} from '../routes/travel-plan.mjs';
const time=value=>Number.isFinite(value)?denverInput(new Date(value)):'';
const point=p=>({id:String(p.id||''),name:String(p.name||'Location'),address:String(p.address||'')});
export function travelCostDraft(record){
  const data=readTravel(record);if(!data)throw Error('Choose an available Travel Route.');
  const {plan,result}=data;
  return {sourceRouteId:record.id,sourceUpdated:record.updatedAt?.seconds||0,routeName:plan.name||'Travel route',date:plan.time?.slice(0,10)||'',sourceDraft:!!record.travelDraft||!result,planningStatus:plan.planningStatus||'planned',vehicle:plan.vehicle||'',people:Number(plan.passengers)||'',extras:0,notes:'',legs:plan.stops.slice(0,-1).map((stop,i)=>{
    const next=plan.stops[i+1],leg=result?.legs?.[i],minutes=Number.isFinite(leg?.arrive)&&Number.isFinite(leg?.ready??leg?.depart)?Math.max(0,(leg.arrive-(leg.ready??leg.depart))/60000):null;
    return {from:point(stop),to:point(next),mode:stop.mode||'bus',departure:time(leg?.depart),arrival:time(leg?.arrive),ready:time(leg?.ready),criticalStart:next.startTime||'',stopMinutes:Number(next.dwell)||0,sourceLabel:leg?.label||'Schedule needs calculation',quantity:1,basis:stop.mode==='walk'?'none':stop.mode==='rail'?'person':stop.mode==='car'?'vehicle':'hour',rate:0,hours:minutes===null?'':Math.round(minutes/60*1000)/1000};
  })};
}
function number(value,label,max=1000000){if(value===''||value==null||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>max)throw Error('Enter a valid '+label+'.');return Number(value);}
export function calculateTravelCost(draft){
  const people=number(draft.people,'passenger count',10000);if(people<1||!Number.isInteger(people))throw Error('Enter a whole passenger count of at least 1.');
  if(!Array.isArray(draft.legs)||!draft.legs.length||draft.legs.length>20)throw Error('Choose a route with travel legs.');
  const rows=draft.legs.map(l=>{
    if(!['none','person','vehicle','hour'].includes(l.basis))throw Error('Choose a pricing method.');
    if(l.basis==='none')return 0;
    const rate=number(l.rate,'rate'),quantity=l.basis==='person'?people:number(l.quantity,'vehicle count',100);
    if(l.basis!=='person'&&(!Number.isInteger(quantity)||quantity<1))throw Error('Enter a whole vehicle count of at least 1.');
    const hours=l.basis==='hour'?number(l.hours,'billable hours',10000):1;
    return Math.round(rate*quantity*hours*100)/100;
  });
  const extras=number(draft.extras,'additional costs'),total=Math.round((rows.reduce((a,b)=>a+b,0)+extras)*100)/100;
  return {rows,extras,total,people,perPerson:total/people,hasRates:draft.legs.some(l=>l.basis!=='none'&&Number(l.rate)>0)||extras>0};
}
export function encodeTravelCost(draft){
  calculateTravelCost(draft);
  const clean=Object.fromEntries(['sourceRouteId','sourceUpdated','routeName','date','sourceDraft','planningStatus','vehicle','people','extras','notes'].map(k=>[k,draft[k]??'']));
  clean.legs=draft.legs.map(l=>({...Object.fromEntries(['mode','departure','arrival','ready','criticalStart','stopMinutes','sourceLabel','quantity','basis','rate','hours'].map(k=>[k,l[k]??''])),from:point(l.from),to:point(l.to)}));
  return {recordType:'activity-multistop-route',planningSubtype:'travel-cost-estimate',sourceTravelRouteId:draft.sourceRouteId,planName:'Cost estimate · '+draft.routeName,estimateJson:JSON.stringify(clean),timeZone:'America/Denver'};
}
export function decodeTravelCost(record){try{if(record.planningSubtype!=='travel-cost-estimate')return null;const draft=JSON.parse(record.estimateJson);calculateTravelCost(draft);return {id:record.id,draft};}catch{return null;}}

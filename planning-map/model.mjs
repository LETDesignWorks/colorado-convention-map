export const PRIVATE_LAYERS={
 travel:{section:'routes',types:['bus-route','route-plan']},
 activitiesRoutes:{section:'activities',types:['activity-bus-plan']},
 multistop:{section:'activityPlanning',types:['activity-multistop-route']},
 territories:{section:'territories',types:['territory-boundary','territory-plan']}
};
export function permittedTypes(canView){return Object.entries(PRIVATE_LAYERS).flatMap(([layer,v])=>canView(v.section)?v.types.map(type=>({layer,type})):[]);}
export function decode(value,fallback=null){try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}}
export function savedRoute(record){
 if(record.travelSchemaVersion===1&&record.plan)return {name:record.routeName,points:record.plan.stops,legs:decode(record.resultJson,record.result)?.legs||[],source:'travel-routes',planning:false};
 if(record.recordType==='activity-multistop-route'){
  const plan=decode(record.planJson,{}),legs=decode(record.legsJson,[]);
  return {name:plan.name||record.planName,points:plan.stops||[],legs:legs.map(l=>({mode:'bus',segments:[{mode:'bus',points:(l.path||[]).map(p=>[p[1],p[0]])}]})),source:'activity-planning',planning:false};
 }
 const activity=record.recordType==='activity-bus-plan';
 const points=activity?[{...record.hotel,name:record.hotelName}, {...record.outboundPoint,name:record.outboundPointName||record.activityName}, {...record.returnPoint,name:record.returnPointName||'Pickup'}, {...record.hotel,name:record.hotelName}]:[{...record.origin,name:record.hotelName||record.originName},{...record.destination,name:record.destinationName||record.destinationLabel}];
 return {name:record.routeName||record.planName||'Saved route',points,legs:[],source:activity?'activities':'travel-routes',planning:true};
}
export function territoryShapes(record){
 if(record.recordType==='territory-boundary'){const geometry=decode(record.boundaryJson||record.geometryJson||record.geometry);return geometry?[{geometry,name:record.name||record.congregation||'Territory boundary'}]:[];}
 return (decode(record.territoriesJson,[])||[]).flatMap(t=>{const geometry=decode(t.geometryJson||t.geometry);return geometry?[{geometry,name:t.name||record.planName||'Territory'}]:[];});
}


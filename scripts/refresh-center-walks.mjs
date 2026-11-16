// Refresh the four public candidate-area pedestrian routes. No private planning data is sent.
import {writeFile} from 'node:fs/promises';
import {WALK_ORIGIN,PICKUP_CANDIDATES} from '../convention-center/pickup-data.mjs';
function decode(encoded){let i=0,lat=0,lng=0;const points=[];while(i<encoded.length){let values=[];for(let n=0;n<2;n++){let b,shift=0,value=0;do{b=encoded.charCodeAt(i++)-63;value|=(b&31)<<shift;shift+=5;}while(b>=32);values.push(value&1?~(value>>1):value>>1);}lat+=values[0];lng+=values[1];points.push([lat/1e6,lng/1e6]);}return points;}
const results=await Promise.allSettled(PICKUP_CANDIDATES.map(async point=>{
 const input={locations:[{lat:WALK_ORIGIN.lat,lon:WALK_ORIGIN.lng},{lat:point.lat,lon:point.lng}],costing:'pedestrian',costing_options:{pedestrian:{walking_speed:4}},units:'kilometers'};
 const response=await fetch('https://valhalla1.openstreetmap.de/route?json='+encodeURIComponent(JSON.stringify(input)),{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(point.id+': route HTTP '+response.status);const data=await response.json();if(data.trip?.status!==0)throw Error(point.id+': '+(data.error||'No walking route'));
 const leg=data.trip.legs[0];return {id:point.id,meters:Math.round(data.trip.summary.length*1000),routingMinutes:Math.ceil(data.trip.summary.time/60),points:decode(leg.shape),instructions:leg.maneuvers.map(m=>m.instruction)};
}));
const errors=results.filter(r=>r.status==='rejected');if(errors.length)throw AggregateError(errors.map(r=>r.reason),'No route file changed because a request failed.');
const routes=results.map(r=>r.value);const output={checked:process.argv[2]||new Date().toISOString().slice(0,10),origin:WALK_ORIGIN,provider:'Valhalla / OpenStreetMap · pedestrian routing',providerUrl:'https://valhalla.openstreetmap.de/',licenseUrl:'https://www.openstreetmap.org/copyright',method:'Distances follow a routed pedestrian path to approximate candidate-area pins. Times shown in the planner use 4 km/h or 3 km/h, before crossings, indoor travel or boarding.',routes};
await writeFile(new URL('../convention-center/pickup-walks.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(routes.map(r=>({id:r.id,meters:r.meters,points:r.points.length,instructions:r.instructions})),null,2));

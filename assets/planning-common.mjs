import {HALLS,DTC_BOUNDARY,DTC} from '../bus-access/locations.mjs';
import {HALLS as TERRITORY_HALLS} from '../territories/halls.js';
import {HOTELS} from '../routes/hotel-data.mjs';
import {ACTIVITY_POINTS} from '../activities/data.js';
export {HALLS,HOTELS,ACTIVITY_POINTS,DTC_BOUNDARY,DTC};
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export const CENTERS=[{id:'ccc',name:'Colorado Convention Center',address:'700 14th St, Denver, CO 80202',lat:39.74248,lng:-104.99567,group:'Convention centers'},{id:'dtc',name:'DTC Center Point',address:'I-25 & E Belleview Ave, Denver Tech Center, CO',lat:39.624,lng:-104.905,group:'Convention centers',note:'Planning reference: use the final pickup address when confirmed.'}];
export function catalog(records=[]){
 const halls=new Map([...HALLS,...TERRITORY_HALLS].map(p=>[String(p.id),{...p,id:String(p.id),group:'Field service / meeting places'}]));
 for(const p of records)if(!p.recordType&&((halls.has(String(p.id)))||p.customLocation===true))halls.set(String(p.id),{...halls.get(String(p.id)),...p,group:'Field service / meeting places'});
 return [...CENTERS,...HOTELS.map(p=>({...p,group:'Hotels'})),...halls.values(),...ACTIVITY_POINTS.map(p=>({...p,group:'Activities'})),{id:'encouraging-gathering',name:'Encouraging Gathering',address:'',lat:null,lng:null,group:'Activities',customAddress:true}];
}
export function icon(symbol,color='#174b80',extra=''){return L.divIcon({className:'planning-map-icon '+extra,html:'<span style="--pin-color:'+color+'">'+escapeHtml(symbol)+'</span>',iconSize:[30,34],iconAnchor:[15,17]});}
export function mapBase(id){const m=L.map(id,{preferCanvas:true}).setView([39.72,-104.99],10);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(m);return m;}
export function railLayers(data,map,{stations=true,lines=true}={}){
 const stationLayer=L.layerGroup(),lineLayer=L.layerGroup(),seen=new Set();
 for(const p of data.patterns){const key=p.route+':'+p.shapeId;if(seen.has(key))continue;seen.add(key);const r=data.routes.find(r=>r.id===p.route),shape=data.shapes[p.shapeId];if(shape?.length)L.polyline(shape,{color:'#'+(r?.color||'666666'),weight:3,opacity:.6}).bindPopup('RTD '+escapeHtml(r?.name||p.route)+' Line — reference alignment').addTo(lineLayer);}
 for(const s of data.stations)L.marker([s.lat,s.lng],{icon:icon('🚆',s.lines.length?'#5a458c':'#667085','rail-station-icon')}).bindPopup('<b>'+escapeHtml(s.name)+'</b><br>'+escapeHtml(s.address)+'<br>'+(s.lines.length?'Lines '+escapeHtml(s.lines.join(', ')):'No train trips in this timetable; confirm service')+'<br><a target="_blank" rel="noopener" href="https://app.rtd-denver.com/en-US/facilities">RTD station details</a>').addTo(stationLayer);
 if(stations)stationLayer.addTo(map);if(lines)lineLayer.addTo(map);return {stations:stationLayer,lines:lineLayer};
}

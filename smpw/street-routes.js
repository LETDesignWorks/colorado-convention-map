import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const ROUTER = 'https://valhalla1.openstreetmap.de/route';
const LOGO = new URL('../assets/denver-2027-logo.png', location.href).href;
const COLORS = { walking: '#14845f', transit: '#2f6fb4', driving: '#d66a17' };
const CLIENT_ID = 'letdesignworks-denver2027';

let map, db, layer, unsubscribe, activeRoute;
let revision = 0;
const hubs = new Map();
const locations = new Map();
const cache = new Map();
let previousDirectLines = null;
const el = {};

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const mode = value => ['walking','transit','driving'].includes(value) ? value : 'driving';
const modeName = value => ({walking:'Walking',transit:'RTD / transit',driving:'Driving'})[mode(value)];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function toast(message, error = false) {
  const host = document.getElementById('toast');
  if (!host) return;
  host.textContent = message;
  host.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(host._timer);
  host._timer = setTimeout(() => host.className = 'toast', 4800);
}
function fmtMiles(miles) {
  if (!Number.isFinite(Number(miles))) return '—';
  return miles < .1 ? `${Math.max(1, Math.round(miles * 5280))} ft` : `${Number(miles).toFixed(miles < 10 ? 1 : 0)} mi`;
}
function fmtTime(seconds) {
  if (!Number.isFinite(Number(seconds)) || seconds <= 0) return 'Schedule dependent';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}
function point(point) { return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`; }
function googleDirections(origin, destination, travelMode) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api','1'); url.searchParams.set('origin',point(origin)); url.searchParams.set('destination',point(destination)); url.searchParams.set('travelmode',travelMode);
  return url.href;
}
function appleDirections(origin, destination, travelMode) {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('saddr',point(origin)); url.searchParams.set('daddr',point(destination)); url.searchParams.set('dirflg',travelMode === 'transit' ? 'r' : travelMode === 'driving' ? 'd' : 'w');
  return url.href;
}
function localDateTime() {
  const date = new Date(Date.now() + 30 * 60000); date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const p = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
function friendlyDate(value) {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(date);
}
function decodeShape(encoded) {
  const points = []; let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e6, lng / 1e6]);
  }
  return points;
}
function stepMode(maneuver, fallback) {
  if (maneuver.transit_info) return 'transit';
  const text = clean(maneuver.travel_mode).toLowerCase();
  return text.includes('pedestrian') ? 'walking' : text.includes('transit') ? 'transit' : text.includes('drive') || text.includes('auto') ? 'driving' : fallback;
}
function normalizeResponse(json, requestedMode) {
  if (!json?.trip?.legs?.length) throw new Error(json?.error || json?.error_message || 'No route was returned.');
  const geometry = [], steps = [];
  json.trip.legs.forEach(leg => {
    const shape = leg.shape ? decodeShape(leg.shape) : [];
    if (geometry.length && shape.length) shape.shift();
    geometry.push(...shape);
    (leg.maneuvers || []).forEach(m => {
      const transit = m.transit_info || {};
      steps.push({
        instruction: clean(m.instruction || m.verbal_pre_transition_instruction || 'Continue on the route.'),
        distance: Number(m.length), time: Number(m.time), mode: stepMode(m, requestedMode),
        detail: [transit.short_name, transit.long_name, transit.headsign ? `toward ${transit.headsign}` : '', transit.operator_name].filter(Boolean).join(' • ')
      });
    });
  });
  if (!geometry.length) throw new Error('The routing service returned no route shape.');
  return { geometry, steps, distance: Number(json.trip.summary?.length), time: Number(json.trip.summary?.time), provider: 'Valhalla / OpenStreetMap' };
}
async function fetchRoute(hub, destination, travelMode, departure) {
  const key = [hub.id,destination.id,travelMode,departure].join('|');
  if (cache.has(key)) return cache.get(key);
  const costing = travelMode === 'walking' ? 'pedestrian' : travelMode === 'transit' ? 'multimodal' : 'auto';
  const payload = {
    locations:[{lat:hub.lat,lon:hub.lng,type:'break',name:hub.name},{lat:destination.lat,lon:destination.lng,type:'break',name:destination.name}],
    costing, units:'miles', language:'en-US', directions_type:'instructions', id:`denver2027-${hub.id}-${destination.id}-${travelMode}`
  };
  if (travelMode === 'transit') {
    payload.date_time = departure ? {type:1,value:departure} : {type:0};
    payload.costing_options = {transit:{use_bus:1,use_rail:1,use_transfers:.35},pedestrian:{walking_speed:4.8}};
  }
  const url = new URL(ROUTER); url.searchParams.set('json',JSON.stringify(payload));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),26000);
  let response;
  try {
    try { response = await fetch(url,{signal:controller.signal,headers:{Accept:'application/json','X-Client-Id':CLIENT_ID}}); }
    catch { response = await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}}); }
  } finally { clearTimeout(timer); }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error_code) throw new Error(json.error || json.error_message || `Routing returned ${response.status}.`);
  const route = normalizeResponse(json,travelMode); cache.set(key,route); return route;
}
function bearing(a,b) {
  const r = v => v * Math.PI / 180, d = v => v * 180 / Math.PI;
  const y = Math.sin(r(b[1]-a[1])) * Math.cos(r(b[0]));
  const x = Math.cos(r(a[0])) * Math.sin(r(b[0])) - Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(r(b[1]-a[1]));
  return (d(Math.atan2(y,x)) + 360) % 360;
}
function midpoint(points) {
  const index = Math.max(1,Math.floor(points.length * .55)); return {point:points[index],angle:bearing(points[index-1],points[index])};
}
function arrowIcon(color,angle) {
  return L.divIcon({className:'',html:`<div class="street-route-arrow" style="transform:rotate(${angle}deg);color:${color}"><svg viewBox="0 0 32 32"><path d="M16 2L29 28L16 22L3 28Z"/></svg></div>`,iconSize:[32,32],iconAnchor:[16,16]});
}
function endpointIcon(label,end=false) {
  return L.divIcon({className:'',html:`<div class="${end?'street-route-end':'street-route-start'}">${esc(label)}</div>`,iconSize:[44,34],iconAnchor:[22,17]});
}
function hideDirectLines() {
  if (!el.showRoutes) return;
  if (previousDirectLines === null) previousDirectLines = el.showRoutes.checked;
  if (el.showRoutes.checked) { el.showRoutes.checked = false; el.showRoutes.dispatchEvent(new Event('change',{bubbles:true})); }
}
function restoreDirectLines() {
  if (el.showRoutes && previousDirectLines) { el.showRoutes.checked = true; el.showRoutes.dispatchEvent(new Event('change',{bubbles:true})); }
  previousDirectLines = null;
}
function renderMap(route) {
  layer.clearLayers(); const color = COLORS[route.mode];
  L.polyline(route.geometry,{color:'#fff',weight:9,opacity:.92,lineCap:'round'}).addTo(layer);
  L.polyline(route.geometry,{color,weight:route.mode==='transit'?6:5,opacity:.95,dashArray:route.mode==='walking'?'4 7':route.mode==='transit'?'11 7':null,lineCap:'round'}).addTo(layer);
  const mid = midpoint(route.geometry); L.marker(mid.point,{icon:arrowIcon(color,mid.angle),interactive:false,zIndexOffset:700}).addTo(layer);
  L.marker([route.hub.lat,route.hub.lng],{icon:endpointIcon(route.hub.markerLabel||'HUB'),interactive:false,zIndexOffset:710}).addTo(layer);
  L.marker([route.location.lat,route.location.lng],{icon:endpointIcon(route.location.markerLabel||'S',true),interactive:false,zIndexOffset:710}).addTo(layer);
  map.fitBounds(L.latLngBounds(route.geometry),{padding:[55,55],maxZoom:16}); hideDirectLines();
}
function stepHtml(step,index,routeMode) {
  return `<li class="street-route-step" data-mode="${esc(step.mode||routeMode)}"><span class="street-route-step-number">${index+1}</span><span><strong>${esc(step.instruction)}</strong>${step.detail?`<small>${esc(step.detail)}</small>`:''}</span><span class="street-route-step-distance">${fmtMiles(step.distance)}${step.time>0?`<br>${fmtTime(step.time)}`:''}</span></li>`;
}
function showDetails(route) {
  el.status.className='street-route-status success';
  el.status.innerHTML=`<strong>${esc(route.hub.markerLabel||'HUB')} — ${esc(route.hub.name)}</strong> to <strong>${esc(route.location.markerLabel||'S')} — ${esc(route.location.name)}</strong>${route.mode==='transit'&&route.departure?`<br>Planned departure: ${esc(friendlyDate(route.departure))}`:'<br>The displayed route follows the mapped street, pedestrian, or transit network.'}`;
  el.metrics.hidden=false; el.routeMode.textContent=modeName(route.mode); el.distance.textContent=fmtMiles(route.distance); el.duration.textContent=fmtTime(route.time); el.provider.textContent=route.provider;
  el.directions.hidden=!route.steps.length; el.steps.innerHTML=route.steps.map((step,index)=>stepHtml(step,index,route.mode)).join('');
  el.print.disabled=false; el.clear.disabled=false;
}
function setStatus(message,type='') {
  el.status.className=`street-route-status${type?` ${type}`:''}`; el.status.textContent=message;
  el.metrics.hidden=true; el.directions.hidden=true; el.print.disabled=true; el.clear.disabled=false;
}
function selected() {
  return {hub:hubs.get(el.hub.value),location:locations.get(el.location.value),mode:mode(el.travelMode.value),departure:el.departure.value};
}
async function loadRoute() {
  const choice = selected();
  if (!choice.hub || !choice.location) return toast('Choose both an SMPW hub and cart location.',true);
  const token=++revision; setStatus(`Building ${modeName(choice.mode).toLowerCase()} directions on the mapped network…`,'loading');
  try {
    const result=await fetchRoute(choice.hub,choice.location,choice.mode,choice.departure);
    if(token!==revision)return;
    activeRoute={...result,...choice}; renderMap(activeRoute); showDetails(activeRoute); toast(`${modeName(choice.mode)} route loaded.`);
  } catch(error) {
    if(token!==revision)return;
    activeRoute=null; layer.clearLayers(); setStatus(`Could not build the street-following route: ${error.message}. Use the Google Maps or Apple Maps links for live directions.`,'error'); toast('The route could not be loaded.',true);
  }
}
function clearRoute() {
  revision++; activeRoute=null; layer?.clearLayers(); restoreDirectLines();
  el.status.className='street-route-status'; el.status.innerHTML='Choose a hub, cart location, and travel method, then select <strong>Show Route on Streets</strong>.';
  el.metrics.hidden=true; el.directions.hidden=true; el.print.disabled=true; el.clear.disabled=true;
}
function syncTransitTime() { el.departureWrap.hidden=mode(el.travelMode.value)!=='transit'; if(!el.departure.value)el.departure.value=localDateTime(); }

function printRoute() {
  if(!activeRoute)return toast('Load a route before printing.',true);
  const route=activeRoute, popup=window.open('','_blank'); if(!popup)return toast('Allow pop-ups for this site and try again.',true);
  const data=JSON.stringify({geometry:route.geometry,hub:{lat:route.hub.lat,lng:route.hub.lng,label:route.hub.markerLabel||'HUB'},location:{lat:route.location.lat,lng:route.location.lng,label:route.location.markerLabel||'S'},color:COLORS[route.mode],mode:route.mode}).replace(/</g,'\u003c');
  const steps=route.steps.map((step,index)=>`<li class="step" data-mode="${esc(step.mode||route.mode)}"><span>${index+1}</span><div><strong>${esc(step.instruction)}</strong>${step.detail?`<small>${esc(step.detail)}</small>`:''}</div><em>${fmtMiles(step.distance)}${step.time>0?`<br>${fmtTime(step.time)}`:''}</em></li>`).join('');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SMPW ${esc(modeName(route.mode))} Directions</title><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#1f2d3d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.sheet{width:min(10.3in,calc(100% - 24px));margin:12px auto;background:#fff;padding:18px;border-radius:15px}.head{display:grid;grid-template-columns:68px 1fr auto;gap:12px;align-items:center;border-bottom:3px solid #083f73;padding-bottom:10px}.head img{width:64px;height:64px;object-fit:contain}.head h1{margin:0;color:#083f73;font-size:22px}.head p{margin:4px 0;color:#627184;font-size:10px}.badge{background:${COLORS[route.mode]};color:#fff;border-radius:999px;padding:8px 12px;font-weight:900;font-size:11px}.summary{display:grid;grid-template-columns:2fr 2fr 1fr 1fr;gap:7px;margin:11px 0}.summary div{border:1px solid #d7e1ea;border-radius:9px;padding:8px}.summary span{display:block;font-size:8px;text-transform:uppercase;color:#708094;font-weight:900}.summary strong{display:block;font-size:10px;margin-top:3px}.map{height:4.5in;border:1px solid #bac9d6;border-radius:11px;overflow:hidden}.actions{display:flex;gap:7px;margin:10px 0}.actions a,.actions button{padding:9px 11px;border-radius:8px;border:1px solid #b8c8d6;background:#fff;color:#083f73;text-decoration:none;font-weight:850;font-size:9px}.actions button{background:#083f73;color:#fff}.steps{list-style:none;padding:0;margin:0;display:grid;gap:5px}.step{display:grid;grid-template-columns:25px 1fr auto;gap:7px;padding:7px;border:1px solid #dbe4ec;border-radius:8px;break-inside:avoid}.step>span{width:22px;height:22px;border-radius:50%;background:#596f83;color:#fff;display:grid;place-items:center;font-size:8px;font-weight:900}.step[data-mode=walking]>span{background:#14845f}.step[data-mode=transit]>span{background:#2f6fb4}.step[data-mode=driving]>span{background:#d66a17}.step strong{font-size:9px}.step small{display:block;font-size:8px;color:#6a788a}.step em{font-style:normal;font-size:8px;text-align:right;color:#596b7d;font-weight:850}.note{margin:10px 0;padding:8px 10px;border-left:5px solid #d7a33d;background:#fff8e8;font-size:9px}.foot{margin-top:10px;border-top:1px solid #d7e1ea;padding-top:7px;font-size:8px;color:#718092;display:flex;justify-content:space-between}.pin{min-width:30px;height:30px;border-radius:15px;padding:0 6px;color:#fff;border:3px solid #fff;display:grid;place-items:center;font-size:8px;font-weight:900}.start{background:#5c42a3}.end{background:#083f73}@media print{body{background:#fff}.sheet{width:100%;margin:0;padding:.18in}.actions{display:none}.map{height:4.1in}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:letter portrait;margin:.28in}}</style></head><body><main class="sheet"><header class="head"><img src="${LOGO}"><div><h1>SMPW Hub-to-Cart Directions</h1><p>${esc(route.hub.markerLabel||'HUB')} — ${esc(route.hub.name)} to ${esc(route.location.markerLabel||'S')} — ${esc(route.location.name)}</p></div><span class="badge">${esc(modeName(route.mode))}</span></header><section class="summary"><div><span>Start</span><strong>${esc(route.hub.address||route.hub.name)}</strong></div><div><span>Destination</span><strong>${esc(route.location.address||route.location.name)}</strong></div><div><span>Distance</span><strong>${fmtMiles(route.distance)}</strong></div><div><span>Time</span><strong>${fmtTime(route.time)}</strong></div></section>${route.mode==='transit'&&route.departure?`<div class="note">Planned RTD departure: ${esc(friendlyDate(route.departure))}. Recheck current service, platform, transfers, and construction before use.</div>`:''}<div id="printMap" class="map"></div><div class="actions"><button onclick="window.print()">Print Route Sheet</button><a href="${esc(googleDirections(route.hub,route.location,route.mode))}" target="_blank">Google Maps</a><a href="${esc(appleDirections(route.hub,route.location,route.mode))}" target="_blank">Apple Maps</a></div><h2>Directions</h2><ol class="steps">${steps}</ol><footer class="foot"><span>Denver 2027 SMPW planning — verify locally before use.</span><span>Map data © OpenStreetMap contributors</span></footer></main><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script><script>const d=${data};const m=L.map('printMap',{scrollWheelZoom:false});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(m);L.polyline(d.geometry,{color:'#fff',weight:9,opacity:.92}).addTo(m);L.polyline(d.geometry,{color:d.color,weight:d.mode==='transit'?6:5,opacity:.95,dashArray:d.mode==='walking'?'4 7':d.mode==='transit'?'11 7':null}).addTo(m);function i(l,e){return L.divIcon({className:'',html:'<div class="pin '+(e?'end':'start')+'">'+l+'</div>',iconSize:[44,34],iconAnchor:[22,17]})}L.marker([d.hub.lat,d.hub.lng],{icon:i(d.hub.label,false)}).addTo(m);L.marker([d.location.lat,d.location.lng],{icon:i(d.location.label,true)}).addTo(m);m.fitBounds(L.latLngBounds(d.geometry),{padding:[30,30],maxZoom:16});setTimeout(()=>m.invalidateSize(),300);<\/script></body></html>`); popup.document.close();
}

function inject() {
  if(document.getElementById('streetRouteStatus'))return;
  const style=document.createElement('style'); style.textContent=`.street-route-arrow{width:30px;height:30px;display:grid;place-items:center;filter:drop-shadow(0 1px 2px #fff) drop-shadow(0 1px 4px #0007);transform-origin:50% 50%}.street-route-arrow svg{width:27px;height:27px;fill:currentColor;stroke:#fff;stroke-width:2}.street-route-start,.street-route-end{min-width:30px;height:30px;border-radius:15px;padding:0 7px;display:grid;place-items:center;color:#fff;border:3px solid #fff;box-shadow:0 1px 7px #0007;font-size:8px;font-weight:900}.street-route-start{background:#5c42a3}.street-route-end{background:#083f73}.street-route-status{border:1px solid #d7e1ea;border-radius:11px;background:#f8fafc;padding:10px;font-size:11px;line-height:1.45;color:#506176;margin-top:9px}.street-route-status.loading{background:#fff9e9;color:#735400}.street-route-status.success{background:#eff9f3;color:#215d43}.street-route-status.error{background:#fff2f1;color:#842f2a}.street-route-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:8px}.street-route-metrics article{border:1px solid #d9e3eb;border-radius:10px;padding:8px}.street-route-metrics span{display:block;font-size:8px;text-transform:uppercase;color:#728194;font-weight:900}.street-route-metrics strong{display:block;font-size:10px;margin-top:3px}.street-route-time{grid-column:1/-1}.street-route-directions{margin-top:10px}.street-route-directions h3{font-size:13px;color:#083f73}.street-route-step-list{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:340px;overflow:auto}.street-route-step{display:grid;grid-template-columns:25px 1fr auto;gap:7px;padding:7px;border:1px solid #dbe4ec;border-radius:9px}.street-route-step-number{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#596f83;color:#fff;font-size:8px;font-weight:900}.street-route-step[data-mode=walking] .street-route-step-number{background:#14845f}.street-route-step[data-mode=transit] .street-route-step-number{background:#2f6fb4}.street-route-step[data-mode=driving] .street-route-step-number{background:#d66a17}.street-route-step strong{font-size:10px}.street-route-step small{display:block;font-size:8px;color:#6a788a}.street-route-step-distance{font-size:8px;text-align:right;color:#596b7d;font-weight:850}.street-route-line{width:31px;border-top:5px solid #d66a17}@media(max-width:560px){.street-route-metrics{grid-template-columns:1fr 1fr}}`; document.head.appendChild(style);
  document.getElementById('showRouteButton').textContent='Show Route on Streets';
  document.querySelector('.smpw-route-card .route-grid').insertAdjacentHTML('beforeend','<div class="field street-route-time" id="streetRouteDepartureWrap" hidden><label for="streetRouteDeparture">RTD departure date and time</label><input id="streetRouteDeparture" type="datetime-local"><small>Transit routing is schedule-sensitive. Recheck it before the convention.</small></div>');
  document.querySelector('.smpw-route-card .button-grid').insertAdjacentHTML('beforeend','<button class="btn outline" id="printStreetRoute" type="button" disabled>Print Route Sheet</button><button class="btn outline" id="clearStreetRoute" type="button" disabled>Clear Street Route</button>');
  document.getElementById('routeLinks').insertAdjacentHTML('afterend','<div class="street-route-status" id="streetRouteStatus">Choose a hub, cart location, and travel method, then select <strong>Show Route on Streets</strong>.</div><div class="street-route-metrics" id="streetRouteMetrics" hidden><article><span>Method</span><strong id="streetRouteMode">—</strong></article><article><span>Distance</span><strong id="streetRouteDistance">—</strong></article><article><span>Travel time</span><strong id="streetRouteDuration">—</strong></article><article><span>Route source</span><strong id="streetRouteProvider">—</strong></article></div><div class="street-route-directions" id="streetRouteDirections" hidden><h3>Turn-by-turn directions</h3><ol class="street-route-step-list" id="streetRouteSteps"></ol></div>');
  document.querySelector('.map-legend')?.insertAdjacentHTML('beforeend','<div><span class="street-route-line"></span>Street-following route</div>');
}
function cacheElements(){Object.assign(el,{location:document.getElementById('routeLocationSelect'),hub:document.getElementById('routeHubSelect'),travelMode:document.getElementById('routeModeSelect'),departureWrap:document.getElementById('streetRouteDepartureWrap'),departure:document.getElementById('streetRouteDeparture'),show:document.getElementById('showRouteButton'),print:document.getElementById('printStreetRoute'),clear:document.getElementById('clearStreetRoute'),status:document.getElementById('streetRouteStatus'),metrics:document.getElementById('streetRouteMetrics'),routeMode:document.getElementById('streetRouteMode'),distance:document.getElementById('streetRouteDistance'),duration:document.getElementById('streetRouteDuration'),provider:document.getElementById('streetRouteProvider'),directions:document.getElementById('streetRouteDirections'),steps:document.getElementById('streetRouteSteps'),showRoutes:document.getElementById('showRoutes')});el.departure.value=localDateTime();}
function subscribe(){unsubscribe=onSnapshot(collection(db,'halls'),snapshot=>{hubs.clear();locations.clear();snapshot.forEach(item=>{const data=item.data(),lat=Number(data.lat),lng=Number(data.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;if(data.recordType==='smpw-hub')hubs.set(item.id,{id:item.id,...data,lat,lng});if(data.recordType==='smpw-location')locations.set(item.id,{id:item.id,...data,lat,lng});});},error=>setStatus(`Route data could not be loaded: ${error.message}`,'error'));}
function wire(){el.show.addEventListener('click',loadRoute);el.print.addEventListener('click',printRoute);el.clear.addEventListener('click',clearRoute);[el.location,el.hub,el.travelMode,el.departure].forEach(item=>item.addEventListener('change',()=>{syncTransitTime();clearRoute();}));}
async function init(){while(!document.querySelector('.smpw-route-card'))await wait(50);inject();cacheElements();map=window.__DENVER2027_SMPW_MAP__||await new Promise(resolve=>window.addEventListener('denver2027-smpw-map-ready',event=>resolve(event.detail.map),{once:true}));layer=L.layerGroup().addTo(map);const services=window.__DENVER2027_SMPW_FIREBASE__||await new Promise(resolve=>window.addEventListener('denver2027-smpw-firebase-ready',event=>resolve(event.detail),{once:true}));db=services.db;subscribe();syncTransitTime();wire();}
init().catch(error=>toast(`Street-following routes could not start: ${error.message}`,true));

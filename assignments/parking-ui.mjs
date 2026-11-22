import {createParkingSearch,isRailStation,validParkingPoint,walkingUrl,parkingSearchUrl,RTD_PARKING_URL} from './parking-model.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
const distance=meters=>(meters/1609.344).toFixed(2)+' mi straight-line';
export function mountNearbyParking({root,map,L=globalThis.L,toggle,searcher,storage}={}){
 if(!root)return {selectStation(){}};
 if(!storage)try{storage=globalThis.localStorage;}catch{}
 const service=searcher||createParkingSearch({storage});
 const layer=map&&L?L.layerGroup().addTo(map):null,markers=new Map();
 let station=null,radius=805,visible=true,result=null,loading=false,error='',revision=0,pending=null,selectedId='';
 try{const value=storage?.getItem('denver2027.parking-visible');if(value==='false')visible=false;}catch{}
 root.innerHTML=`<div class="card-heading"><div><span class="eyebrow">RTD MEETING POINT</span><h2>Nearby car parking</h2></div><span class="parking-symbol" aria-hidden="true">P</span></div>
 <p data-parking="station" class="parking-station"></p>
 <label class="parking-check"><input data-parking="show" type="checkbox"> Show nearby parking on the map</label>
 <div data-parking="content">
  <div class="parking-tools"><label>Search radius<select data-parking="radius"><option value="402">¼ mile</option><option value="805" selected>½ mile</option><option value="1609">1 mile</option></select></label><button data-parking="refresh" class="btn outline" type="button">Refresh parking</button><button data-parking="fit" class="btn outline" type="button">Fit parking &amp; station</button></div>
  <p class="parking-help">Nearby mapped lots, including station parking where mapped. Distances are straight-line; use walking directions to check crossings and entrances. Prices, available spaces and permission to leave cars are not guaranteed.</p>
  <details class="parking-rtd"><summary>RTD parking fees &amp; use</summary><p>At RTD’s paid Park-n-Rides, in-district vehicles get the first 24 hours free, then pay $2 per additional 24 hours. Out-of-district vehicles pay $4 per 24 hours. Some RTD facilities are free for both. These rates do not apply to other operators’ lots.</p><p>RTD parking requires use of RTD transit unless RTD gives permission. A meeting for service or transfer to a charter bus alone does not establish permission to leave cars there.</p><p>RTD rules checked November 22, 2026. Recheck for your travel date. ${link(RTD_PARKING_URL,'Check RTD fees, district &amp; restrictions')}</p></details>
  <p data-parking="status" class="parking-status" role="status" aria-live="polite"></p>
  <div data-parking="list" class="parking-list"></div>
  <p class="parking-help">${link('https://www.openstreetmap.org/copyright','Parking data © OpenStreetMap contributors')} · ${link('https://overpass.private.coffee/','Detailed search &amp; privacy')} · ${link('https://github.com/komoot/photon','Photon backup search')}. Fee and access tags may be incomplete or outdated. Markers represent lot centers, not confirmed entrances.</p>
  <p><a data-parking="search" target="_blank" rel="noopener noreferrer">Search more parking in Google Maps ↗</a></p>
 </div>`;
 const el=name=>root.querySelector(`[data-parking="${name}"]`);
 function clearMarkers(){layer?.clearLayers();markers.clear();}
 function cancel(){revision++;pending?.abort();pending=null;loading=false;}
 function syncVisibility(){
  const active=Boolean(station);root.hidden=!active;
  el('show').checked=visible;el('content').hidden=!visible;
  if(toggle){toggle.disabled=!active;toggle.checked=active&&visible;toggle.title=active?'Show or hide nearby parking for '+station.name:'Select a rail station meeting point to find nearby car parking.';}
 }
 function popup(place,index){return `<div class="parking-popup"><strong>P${index+1} · ${esc(place.name)}</strong><p>${esc(place.address||'Street address not recorded')}<br>${esc(distance(place.distanceMeters))} to ${esc(station.name)}</p><p><b>${esc(place.fee.label)}</b><br>${esc(place.fee.detail)}</p><p>${esc(place.access)}</p>${place.parkRide?'<p>Park-n-Ride: check transit-use requirements.</p>':''}<p>${link(walkingUrl(place,station),'Walk to station')} · ${link(place.source,'Parking details')}</p></div>`;}
 function drawMarkers(){
  clearMarkers();if(!visible||!station||!result||!layer)return;
  result.places.forEach((place,index)=>{
   const marker=L.marker([place.lat,place.lng],{title:`Parking ${index+1}: ${place.name}`,zIndexOffset:200,icon:L.divIcon({className:'parking-map-icon',html:`<span class="parking-pin ${place.publicAccess?'':'parking-unconfirmed'}">P<small>${index+1}</small></span>`,iconSize:[40,34],iconAnchor:[20,17],popupAnchor:[0,-16]})}).addTo(layer);
   marker.bindPopup(popup(place,index),{maxWidth:320});
   marker.on('click',()=>highlight(place.id));markers.set(place.id,marker);
  });
 }
 function highlight(id){selectedId=id;el('list').querySelectorAll('[data-parking-id]').forEach(row=>row.classList.toggle('parking-selected',row.dataset.parkingId===id));}
 function render(){
  syncVisibility();clearMarkers();if(!station)return;
  el('station').textContent=station.name;el('search').href=parkingSearchUrl(station);
  el('refresh').disabled=loading;el('radius').value=String(radius);el('fit').disabled=loading||!result?.places.length||!map;
  el('list').setAttribute('aria-busy',String(loading));
  if(loading){el('status').textContent='Finding nearby car parking…';el('list').innerHTML='';return;}
  if(error){el('status').textContent=error;el('list').innerHTML='';return;}
  if(!result){el('status').textContent='Turn on nearby parking to search around this station.';el('list').innerHTML='';return;}
  const date=new Date(result.checkedAt).toLocaleString('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  el('status').textContent=(result.limited?'Limited backup search (up to 20 matches). Costs and access details may be missing — confirm permission before using a lot. ':'')+(result.places.length?`${result.places.length} mapped parking ${result.places.length===1?'location':'locations'}, nearest first.`:'No parking options with usable pins were found in this radius. Try a larger radius or Google Maps; this does not mean no parking exists.')+(result.restricted?` ${result.restricted} private, customer-only or restricted ${result.restricted===1?'lot excluded':'lots excluded'}.`:'')+` Retrieved ${date} (Denver time)${result.cached?' · cached for up to 1 hour':''}.`;
  el('list').innerHTML=result.places.map((p,i)=>`<article class="parking-result" data-parking-id="${esc(p.id)}"><div class="parking-result-heading"><span class="parking-number">P${i+1}</span><h3>${esc(p.name)}</h3></div><p>${esc(p.address||'Street address not recorded')}<br><span class="parking-muted">${esc(distance(p.distanceMeters))} from station</span></p><p class="parking-fee parking-fee-${p.fee.kind}"><strong>${esc(p.fee.label)}</strong><br>${esc(p.fee.detail)}</p><p class="parking-access">${esc(p.access)}</p>${p.parkRide?'<p>Park-n-Ride · confirm transit-use requirements.</p>':''}${p.operator?`<p>Operator: ${esc(p.operator)}</p>`:''}${p.capacity?`<p>Mapped capacity: ${p.capacity} spaces (not live availability)</p>`:''}${p.hours?`<p>Mapped hours: ${esc(p.hours)}</p>`:''}${p.maxstay?`<p>Stay limit: ${esc(p.maxstay)}</p>`:''}<div class="parking-links"><button class="btn outline" type="button" data-parking-pin="${esc(p.id)}" ${map?'':'disabled'}>Show pin</button>${link(walkingUrl(p,station),'Walking directions')}${p.website?link(p.website,'Operator website'):''}${link(p.source,'Source &amp; details')}</div></article>`).join('');
  drawMarkers();highlight(selectedId);
 }
 async function load(refresh=false){
  cancel();if(!station||!visible)return;
  const token=revision,point={...station},controller=new AbortController();pending=controller;loading=true;error='';result=null;render();
  try{const found=await service.search(point,radius,{signal:controller.signal,refresh});if(token!==revision)return;result=found;}
  catch(e){if(token!==revision)return;error=e.name==='AbortError'?'Parking search cancelled. Refresh to try again.':e.message||'Parking search is unavailable. Retry or search in Google Maps.';}
  finally{if(token===revision){loading=false;pending=null;render();}}
 }
 function setVisible(value){
  visible=Boolean(value);try{storage?.setItem('denver2027.parking-visible',String(visible));}catch{}
  if(!visible){cancel();render();}else if(!result&&station){void load();}else render();
 }
 function selectStation(point){
  const next=isRailStation(point)&&validParkingPoint(point)?{...point,lat:Number(point.lat),lng:Number(point.lng)}:null;
  const same=station&&next&&String(station.id)===String(next.id)&&station.lat===next.lat&&station.lng===next.lng;
  if(same){station=next;el('station').textContent=next.name;return;}
  cancel();station=next;result=null;error='';selectedId='';render();if(station&&visible)void load();
 }
 el('show').addEventListener('change',()=>setVisible(el('show').checked));
 const toggleListener=()=>setVisible(toggle.checked);toggle?.addEventListener('change',toggleListener);
 el('radius').addEventListener('change',()=>{radius=Number(el('radius').value);void load();});
 el('refresh').addEventListener('click',()=>void load(true));
 el('fit').addEventListener('click',()=>{if(station&&result?.places.length&&map){map.fitBounds([[station.lat,station.lng],...result.places.map(p=>[p.lat,p.lng])],{padding:[45,45],maxZoom:16});map.getContainer?.().scrollIntoView?.({behavior:'smooth',block:'center'});}});
 el('list').addEventListener('click',event=>{const button=event.target.closest('[data-parking-pin]');if(!button)return;const place=result?.places.find(p=>p.id===button.dataset.parkingPin);if(!place)return;highlight(place.id);map?.setView([place.lat,place.lng],Math.max(16,map.getZoom()),{animate:true});markers.get(place.id)?.openPopup();map?.getContainer?.().scrollIntoView?.({behavior:'smooth',block:'center'});});
 render();
 return {selectStation,destroy(){cancel();clearMarkers();if(layer)map.removeLayer(layer);toggle?.removeEventListener('change',toggleListener);root.innerHTML='';}};
}

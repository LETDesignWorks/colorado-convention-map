import {CONGREGATIONS} from '../assignments/congregations-data.mjs';
import {HOME_POINTS} from '../assignments/home-points.mjs';
import {homeFor,groupHomes,validPoint} from '../assignments/location-model.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export {CONGREGATIONS};
export function congregationMapPoints(records,locations){
  const profiles=new Map(records.filter(r=>r.recordType==='congregation-address').map(r=>[String(r.congregationId),r]));
  return groupHomes(CONGREGATIONS,c=>homeFor(c,profiles.get(c.id),[...locations,...HOME_POINTS]));
}
export function createVisualTravelMap({map,icon,landmarkIcon,onChoose}){
  const layers=new Map(['meetings','congregations','hotels','activities'].map(id=>[id,L.featureGroup().addTo(map)]));
  let prefs={};try{prefs=JSON.parse(localStorage.getItem('denver2027.travel.layers')||'{}');}catch{}
  for(const [id,layer]of layers){const box=document.querySelector('[data-travel-layer="'+id+'"]');box.checked=prefs[id]??true;if(!box.checked)map.removeLayer(layer);box.onchange=()=>{prefs[id]=box.checked;if(box.checked)layer.addTo(map);else map.removeLayer(layer);try{localStorage.setItem('denver2027.travel.layers',JSON.stringify(prefs));}catch{}};}
  const choose=(point,event)=>{if(event?.originalEvent)L.DomEvent?.stopPropagation(event.originalEvent);onChoose(point);};
  function point(p,key,symbol,color){
    if(!validPoint(p.lat,p.lng))return;
    const marker=L.marker([Number(p.lat),Number(p.lng)],{icon:landmarkIcon(p,{fallback:icon(symbol,color)}),title:p.name,zIndexOffset:100}).addTo(layers.get(key));
    marker.bindTooltip(esc(p.name));marker.on('click',e=>choose(p,e));
  }
  return {update(locations,records=[]){
    for(const layer of layers.values())layer.clearLayers();
    for(const p of locations){if(p.group==='Field service / meeting places')point(p,'meetings',p.markerLabel||p.number||'M','#be7825');if(p.group==='Hotels')point(p,'hotels','▣','#245bab');if(p.group==='Activities')point(p,'activities','★','#bd4d3e');}
    const assigned=new Set(records.filter(r=>r.recordType==='congregation-assignment'&&r.meetingPointId).map(r=>String(r.congregationId)));
    const homes=congregationMapPoints(records,locations);let mapped=0;
    for(const home of homes){mapped+=home.congregations.length;
      const marker=L.marker([home.lat,home.lng],{icon:icon('⌂',home.congregations.some(c=>assigned.has(c.id))?'#b42391':'#7554a3','travel-congregation-pin'),title:home.congregations.map(c=>c.name).join('; '),zIndexOffset:300}).addTo(layers.get('congregations'));
      const asPoint=c=>({id:'congregation-'+c.id,name:c.name,address:home.address,lat:home.lat,lng:home.lng,group:'Congregations',congregationIds:[c.id]});
      marker.bindTooltip(esc(home.congregations.map(c=>c.name).join(' · ')));
      if(home.congregations.length===1)marker.on('click',e=>choose(asPoint(home.congregations[0]),e));
      else {const box=document.createElement('div');box.innerHTML='<strong>Select a congregation</strong><p>'+esc(home.address)+'</p>';for(const c of home.congregations){const button=document.createElement('button');button.type='button';button.textContent=c.name;button.className='map-location-choice';button.onclick=()=>{choose(asPoint(c));map.closePopup();};box.append(button);}marker.bindPopup(box,{maxHeight:280});}
    }
    document.getElementById('visualMapStatus').textContent=mapped+' congregations mapped · '+(CONGREGATIONS.length-mapped)+' need an address or pin. Click a location to fill the selected route stop.';
  },fit(){const points=[...layers.values()].filter(l=>map.hasLayer(l)).flatMap(l=>l.getLayers());if(points.length)map.fitBounds(L.featureGroup(points).getBounds(),{padding:[45,45],maxZoom:13});}};
}

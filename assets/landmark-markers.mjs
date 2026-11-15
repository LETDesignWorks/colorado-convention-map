// One landmark identity and icon definition for every interactive planning map.
export const LANDMARKS = Object.freeze([
  Object.freeze({id:'ccc',name:'Colorado Convention Center',address:'700 14th St, Denver, CO 80202',lat:39.74248,lng:-104.99567,image:'blue-bear.jpg',alt:'Colorado Convention Center — Blue Bear'}),
  Object.freeze({id:'dtc',name:'DTC Center Point',address:'I-25 & E Belleview Ave, Denver Tech Center, CO',lat:39.624,lng:-104.905,image:'denver-tech-center.svg',alt:'Denver Tech Center logo'})
]);
const normalized=value=>String(value??'').trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
const aliases={ccc:['ccc','special-ccc','landmark-ccc','colorado convention center'],dtc:['dtc','special-dtc','landmark-dtc','dtc center','dtc center point','denver tech center','denver technological center']};
export function landmarkFor(point){
  if(!point)return null;
  const names=typeof point==='string'?[point]:[point.id,point.locationId,point.name];
  return LANDMARKS.find(p=>names.some(name=>aliases[p.id].includes(normalized(name))))||null;
}
function styles(){
  if(typeof document==='undefined'||document.getElementById('landmark-marker-styles'))return;
  const style=document.createElement('style');style.id='landmark-marker-styles';
  style.textContent=`
    .leaflet-marker-icon.landmark-pin{background:transparent;border:0;overflow:visible;}
    .landmark-pin .landmark-face{display:flex;align-items:center;justify-content:center;width:48px;height:48px;box-sizing:border-box;background:#fff;border:2px solid #174c77;border-radius:15px;box-shadow:0 3px 8px #102b4555;position:relative;}
    .landmark-pin .landmark-face::after{content:'';position:absolute;bottom:-8px;left:18px;width:10px;height:10px;background:#fff;border-right:2px solid #174c77;border-bottom:2px solid #174c77;transform:rotate(45deg);}
    .landmark-pin img{display:block;width:40px;height:40px;object-fit:contain;border:0;border-radius:10px;position:relative;z-index:1;}
    .landmark-pin .landmark-step{position:absolute;right:-7px;top:-8px;display:grid;place-items:center;min-width:22px;height:22px;padding:0 3px;box-sizing:border-box;border-radius:50%;border:2px solid white;background:#174c77;color:white;font:700 12px/1 system-ui;box-shadow:0 1px 4px #102b4555;z-index:2;}
    .landmark-pin:focus-visible .landmark-face{outline:3px solid #068afa;outline-offset:3px;}
  `;document.head.appendChild(style);
}
export function landmarkIcon(point,{step='',fallback=null,leaflet=globalThis.L}={}){
  const landmark=landmarkFor(point);if(!landmark)return fallback;
  styles();
  const src=new URL('./landmarks/'+landmark.image,import.meta.url).href;
  const badge=/^\d{1,2}$/.test(String(step))?`<span class="landmark-step" aria-label="Stop ${step}">${step}</span>`:'';
  return leaflet.divIcon({className:'landmark-pin landmark-'+landmark.id,html:`<span class="landmark-face"><img src="${src}" alt="${landmark.alt}" width="40" height="40" draggable="false"></span>${badge}`,iconSize:[48,56],iconAnchor:[24,56],popupAnchor:[0,-51],tooltipAnchor:[0,-48]});
}
// Callers own this layer, so focused views and Full Planning Map switches retain control.
export function addLandmarkReferences(map,{exclude=[],leaflet=globalThis.L}={}){
  const layer=leaflet.layerGroup().addTo(map);
  layer.refresh=(points=[])=>{
    layer.clearLayers();const excluded=new Set(points.map(p=>landmarkFor(p)?.id).filter(Boolean));
    for(const p of LANDMARKS)if(!excluded.has(p.id))leaflet.marker([p.lat,p.lng],{icon:landmarkIcon(p,{leaflet}),title:p.name,zIndexOffset:200}).bindPopup(`<strong>${p.name}</strong><br>${p.address}${p.id==='dtc'?'<br>Planning reference; confirm the final pickup address.':''}`).addTo(layer);
    return layer;
  };
  return layer.refresh(exclude);
}

// Share the same map sources between the interactive planner and PDF exports.
export const SATELLITE_TILE_URL='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const STREET_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Esri schedules this legacy reference service for retirement in March 2028;
// revisit this shared source if the planner is kept beyond the 2027 convention.
// https://www.arcgis.com/home/item.html?id=94f838a535334cf1aa061846514b77c7
export const STREET_NAMES_TILE_URL='https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
// Street-name tiles above level 19 can be empty. Enlarge the last useful level
// when the parking-lot planner zooms closer, just as it does with aerial imagery.
export const MAX_NATIVE_ZOOM=19;
export const MAX_MAP_ZOOM=22;
export const SATELLITE_ATTRIBUTION='Imagery: © Esri, Maxar, Earthstar Geographics and GIS User Community';
export const STREET_NAMES_ATTRIBUTION='Street names: © Esri, HERE, Garmin, © OpenStreetMap contributors';
export const STREET_ATTRIBUTION='Map: © OpenStreetMap contributors';

export function tileUrl(template,zoom,x,y){
  return template.replace('{z}',String(zoom)).replace('{x}',String(x)).replace('{y}',String(y));
}

// One replaceable group keeps satellite imagery and names together. Both stay
// in tilePane, beneath the planner's vector routes, cones, and editing handles.
export function createTrafficBasemap({L,map,onTileError=()=>{}}){
  let current=null;
  function set(base){
    if(current)map.removeLayer(current);
    const satellite=base==='satellite',group=L.layerGroup();
    current=group;
    function layer(url,attribution,zIndex,kind){
      const tile=L.tileLayer(url,{maxNativeZoom:MAX_NATIVE_ZOOM,maxZoom:MAX_MAP_ZOOM,pane:'tilePane',zIndex,attribution});
      let errors=0;
      tile.on('tileerror',()=>{if(current===group&&++errors===3)onTileError(kind);});
      group.addLayer(tile);
    }
    layer(satellite?SATELLITE_TILE_URL:STREET_TILE_URL,satellite?SATELLITE_ATTRIBUTION:STREET_ATTRIBUTION,1,'background');
    if(satellite)layer(STREET_NAMES_TILE_URL,STREET_NAMES_ATTRIBUTION,2,'streetNames');
    group.addTo(map);
  }
  function dispose(){const group=current;current=null;if(group)map.removeLayer(group);}
  return {set,dispose};
}

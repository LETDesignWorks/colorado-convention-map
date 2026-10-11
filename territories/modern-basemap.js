const BASEMAP_VERSION = 'territories-20261011-20';
const STORAGE_KEY = 'denver2027:territory-basemap';

const BASEMAPS = Object.freeze({
  clean: {
    label: 'Clean Streets',
    description: 'Clear street and building context — recommended',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 20,
      maxNativeZoom: 19,
      crossOrigin: 'anonymous',
      updateWhenIdle: true,
      keepBuffer: 4,
      attribution: 'Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Mapwithyou, NOSTRA, © OpenStreetMap contributors, GIS User Community'
    }
  },
  osm: {
    label: 'OpenStreetMap',
    description: 'Original map appearance',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 20,
      crossOrigin: 'anonymous',
      updateWhenIdle: true,
      keepBuffer: 4,
      attribution: '© OpenStreetMap contributors'
    }
  }
});

let planner = null;
let map = null;
let activeLayer = null;
let activeKey = 'clean';
let control = null;

function savedKey() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return BASEMAPS[value] ? value : 'clean';
  } catch {
    return 'clean';
  }
}

function saveKey(key) {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* optional */ }
}

function removeOriginalBasemap() {
  if (!map || !globalThis.L) return;
  const removals = [];
  map.eachLayer(layer => {
    if (!(layer instanceof L.TileLayer)) return;
    const url = String(layer?._url || '');
    if (/tile\.openstreetmap\.org|server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Street_Map/i.test(url)) {
      removals.push(layer);
    }
  });
  removals.forEach(layer => map.removeLayer(layer));
}

function setBasemap(key, { persist = true } = {}) {
  if (!map || !BASEMAPS[key]) return false;
  activeKey = key;
  if (activeLayer) map.removeLayer(activeLayer);
  removeOriginalBasemap();
  const definition = BASEMAPS[key];
  activeLayer = L.tileLayer(definition.url, definition.options).addTo(map);
  activeLayer.bringToBack?.();
  if (persist) saveKey(key);
  const select = document.getElementById('territoryBasemapSelect');
  if (select && select.value !== key) select.value = key;
  return true;
}

function createControl() {
  if (!map || control) return;
  const BasemapControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar territory-basemap-control');
      container.innerHTML = `
        <label for="territoryBasemapSelect">Map style</label>
        <select id="territoryBasemapSelect" aria-label="Map style">
          ${Object.entries(BASEMAPS).map(([key, definition]) => `<option value="${key}">${definition.label}</option>`).join('')}
        </select>
        <small>PDFs use Clean Streets</small>`;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      container.querySelector('select')?.addEventListener('change', event => setBasemap(event.target.value));
      return container;
    }
  });
  control = new BasemapControl();
  control.addTo(map);
}

function injectStyles() {
  if (document.getElementById('territory-modern-basemap-styles')) return;
  const style = document.createElement('style');
  style.id = 'territory-modern-basemap-styles';
  style.textContent = `
    .territory-basemap-control{background:rgba(255,255,255,.96);border:1px solid #b9c8d4!important;border-radius:10px!important;padding:7px 8px;box-shadow:0 4px 14px rgba(24,53,79,.18);font:700 9px/1.3 system-ui,sans-serif;color:#334d64}
    .territory-basemap-control label{display:block;margin-bottom:4px;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#60758a}
    .territory-basemap-control select{min-width:128px;border:1px solid #afbfcc;border-radius:7px;background:#fff;padding:5px 7px;color:#20384f;font:750 9px system-ui,sans-serif}
    .territory-basemap-control small{display:block;margin-top:4px;font-size:7px;color:#718297}
    @media(max-width:720px){.territory-basemap-control{padding:5px 6px}.territory-basemap-control select{min-width:112px}}
    @media print{.territory-basemap-control{display:none!important}}
  `;
  document.head.appendChild(style);
}

async function initialize() {
  for (let index = 0; index < 300; index += 1) {
    const candidate = globalThis.__denverTerritoryPlannerAPI;
    if (candidate?.getMap?.()) {
      planner = candidate;
      map = candidate.getMap();
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!map) return;
  injectStyles();
  setBasemap(savedKey(), { persist: false });
  createControl();
  setTimeout(() => map.invalidateSize?.(), 80);
  console.info(`Denver 2027 modern territory basemap loaded (${BASEMAP_VERSION}).`);
}

globalThis.__denverTerritoryBasemap = Object.freeze({
  version: BASEMAP_VERSION,
  set: setBasemap,
  current: () => activeKey,
  definitions: BASEMAPS
});

export { setBasemap, BASEMAPS };

initialize();

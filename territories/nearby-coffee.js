// Use the complete Colorado snapshot where it covers the nearest shops. Else
// search around this territory's center, without sending home addresses or names.
import { streetAddressInfo } from './street-addresses.js?v=territories-20261017-31';
let datasetPromise = null;
const liveCache = new Map();
const SEARCH_RADII_METERS = [1500, 5000, 20000, 80000, 200000];
const OVERPASS_ENDPOINTS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const METERS_PER_MILE = 1609.344;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const valid = point => point.lat != null && point.lng != null && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) &&
  Math.abs(Number(point.lat)) <= 85 && Math.abs(Number(point.lng)) <= 180;
export function coffeeSearchCenter(houses) {
  const points = houses.filter(valid);
  if (!points.length) return null;
  let xs = points.map(p => Number(p.lng));
  const ys = points.map(p => Number(p.lat));
  if (Math.max(...xs) - Math.min(...xs) > 180) xs = xs.map(x => x < 0 ? x + 360 : x);
  const lng = (Math.min(...xs) + Math.max(...xs)) / 2;
  return { lat: (Math.min(...ys) + Math.max(...ys)) / 2, lng: lng > 180 ? lng - 360 : lng };
}
export function coffeeDistanceMiles(a, b) {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function selectNearbyCoffee(places, center) {
  if (!valid(center || {})) return [];
  const candidates = places.filter(place => valid(place) && clean(place.name))
    .map(place => ({ ...place, name: clean(place.name), miles: coffeeDistanceMiles(center, place),
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lng}`)}` }));
  const unique = [];
  // Prefer an address-bearing record when providers describe the same shop.
  const nameKey = name => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(coffeecompany|coffee)$/, '');
  const addressKey = place => { const info = streetAddressInfo(place); return info.key ? `${info.number}|${info.key}|${info.unit}`.toUpperCase() : ''; };
  for (const candidate of candidates.sort((a, b) => Number(Boolean(b.address)) - Number(Boolean(a.address)) || (b.confidence || 0) - (a.confidence || 0) || a.miles - b.miles)) {
    if (!unique.some(other => (other.id && other.id === candidate.id) || (nameKey(other.name) === nameKey(candidate.name) &&
      coffeeDistanceMiles(other, candidate) < .04) || (addressKey(candidate) && addressKey(other) === addressKey(candidate) &&
      coffeeDistanceMiles(other, candidate) < .1))) unique.push(candidate);
  }
  return unique.sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name)).slice(0, 5);
}

export function overpassCoffeeShops(data) {
  if (!Array.isArray(data?.elements) || data.remark) throw new Error('Incomplete coffee search');
  return data.elements.flatMap(element => {
    const tags = element.tags || {}, point = element.center || element;
    const name = clean(tags.name || tags.brand);
    // Do not offer private facilities, closed businesses, or coffee bean stores.
    if (tags.amenity !== 'cafe' || !name || !valid({ lat: point.lat, lng: point.lon }) ||
      ['private', 'no'].includes(tags.access) || tags.disused === 'yes' || tags.abandoned === 'yes' ||
      tags['disused:amenity'] || tags['abandoned:amenity'] || tags['opening_hours'] === 'closed') return [];
    const street = clean([tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '));
    return [{ id: `osm-${element.type}-${element.id}`, name, lat: Number(point.lat), lng: Number(point.lon),
      address: clean(tags['addr:full']) || [street, clean(tags['addr:city'])].filter(Boolean).join(', '),
      sources: ['OpenStreetMap'] }];
  });
}

async function fetchJson(fetcher, url, options, timeoutMs) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error('Coffee listings unavailable');
    return await response.json();
  } finally { clearTimeout(timeout); }
}

function insideCoverage(center, coverage) {
  return Array.isArray(coverage) && coverage.length === 4 && coverage.every(Number.isFinite) &&
    center.lng >= coverage[0] && center.lat >= coverage[1] && center.lng <= coverage[2] && center.lat <= coverage[3];
}

function coveredNearest(center, coverage, shops) {
  if (!insideCoverage(center, coverage) || shops.length < 5) return false;
  // A circle around the fifth shop must fit inside the extract: near a state
  // border, a closer shop could be on the other side, so also query live data.
  const miles = shops.at(-1).miles + .5;
  const dlat = miles / 69, dlng = dlat / Math.cos(center.lat * Math.PI / 180);
  return center.lng - dlng >= coverage[0] && center.lat - dlat >= coverage[1] &&
    center.lng + dlng <= coverage[2] && center.lat + dlat <= coverage[3];
}

async function searchLiveCoffee(center, localShops, fetcher, options) {
  const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  const cache = options.cache || liveCache, now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.checkedAt < 30 * 60 * 1000) {
    return { ...cached, shops: selectNearbyCoffee([...localShops, ...cached.shops], center) };
  }
  let shops = localShops, searchRadiusMiles = 0, dataDate = '', endpointIndex = 0;
  for (const meters of SEARCH_RADII_METERS) {
    options.onProgress?.(`Finding the nearest coffee shops (searching ${Math.round(meters / METERS_PER_MILE)} miles)…`);
    // Bounding-box searches are cheaper for the public service than geometry
    // proximity scans. Rank the results by actual distance below, and expand
    // unless the fifth shop fits inside the searched area's inscribed circle.
    const dlat = meters / 110000, dlng = dlat / Math.cos(center.lat * Math.PI / 180);
    const wrap = lng => (lng + 540) % 360 - 180;
    const bounds = [Math.max(-90, center.lat - dlat), wrap(center.lng - dlng),
      Math.min(90, center.lat + dlat), wrap(center.lng + dlng)].map(value => value.toFixed(4)).join(',');
    const query = `[out:json][timeout:25];nwr[amenity=cafe](${bounds});out center tags;`;
    let data;
    while (endpointIndex < OVERPASS_ENDPOINTS.length) {
      try {
        const encoded = encodeURIComponent(query).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        const url = `${OVERPASS_ENDPOINTS[endpointIndex]}?data=${encoded}`;
        data = await fetchJson(fetcher, url, {}, options.timeoutMs ?? 30000);
        const found = overpassCoffeeShops(data);
        shops = selectNearbyCoffee([...shops, ...found], center);
        break;
      } catch { endpointIndex++; }
    }
    if (!data || endpointIndex === OVERPASS_ENDPOINTS.length) {
      return { status: shops.length ? 'partial' : 'unavailable', shops, checkedAt: now, searchRadiusMiles, dataDate };
    }
    searchRadiusMiles = meters / METERS_PER_MILE;
    dataDate = clean(data.osm3s?.timestamp_osm_base).slice(0, 10) || new Date(now).toISOString().slice(0, 10);
    if (shops.length === 5 && shops.at(-1).miles <= searchRadiusMiles) break;
  }
  const result = { status: 'ready', shops, checkedAt: now, searchRadiusMiles, dataDate };
  if (cache.size >= 64) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

export async function loadNearbyCoffee(houses, options = {}) {
  const center = coffeeSearchCenter(houses), fetcher = options.fetcher || globalThis.fetch;
  const now = options.now ?? Date.now();
  if (!center) return { status: 'unavailable', center: null, shops: [], checkedAt: now };
  let data = null;
  try {
    const read = async () => {
      const value = await fetchJson(fetcher, new URL('./coffee-shops-colorado.json?v=territories-20261017-31', import.meta.url),
        { cache: 'force-cache' }, options.timeoutMs ?? 8000);
      if (!Array.isArray(value.shops) || !value.dataDate) throw new Error('Invalid coffee listings');
      return value;
    };
    data = options.fetcher ? await read() : await (datasetPromise ||= read().catch(error => { datasetPromise = null; throw error; }));
  } catch { /* A missing local snapshot must not prevent a worldwide lookup. */ }
  const localShops = data && insideCoverage(center, data.coverage) ? selectNearbyCoffee(data.shops, center) : [];
  if (data && coveredNearest(center, data.coverage, localShops)) {
    return { status: 'ready', center, shops: localShops, checkedAt: now,
      source: data.source, dataDate: data.dataDate, release: data.release };
  }
  const live = await searchLiveCoffee(center, localShops, fetcher, options);
  return { ...live, center, source: 'OpenStreetMap',
    ...(localShops.length ? { source: 'Overture Maps and OpenStreetMap', localDataDate: data.dataDate } : {}) };
}

export function drawNearbyCoffeePage(doc, coffee, map) {
  const center = coffee.center;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(72, 87, 104);
  doc.text('Closest listed coffee shops and cafes to this territory, nearest first. The search widens when needed.', .48, 1.27);
  const searchUrl = center ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`coffee shops near ${center.lat},${center.lng}`)}` : 'https://www.google.com/maps/search/coffee/';
  if (!coffee.shops.length) {
    const message = coffee.status === 'ready' ? 'No coffee shops were listed within this search area.' : 'Nearby coffee shops could not be loaded for this export.';
    doc.setTextColor(40, 55, 72); doc.text(message, .48, 1.85);
    doc.setTextColor(11, 91, 159); doc.textWithLink('Search this area for coffee shops', .48, 2.16, { url: searchUrl });
    return;
  }
  coffee.shops.forEach((shop, i) => {
    const y = 1.76 + i * 1.03;
    doc.setFillColor(125, 73, 37); doc.circle(.62, y - .045, .13, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), .62, y - .045, { align: 'center', baseline: 'middle' });
    doc.setTextColor(40, 55, 72); doc.setFontSize(11);
    const name = doc.splitTextToSize(shop.name, 3.65);
    const nameLines = name.slice(0, 2); if (name.length > 2) nameLines[1] += '...';
    doc.text(nameLines, .88, y);
    const addressY = y + nameLines.length * .17 + .04;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const address = doc.splitTextToSize(shop.address || 'Street address not listed; use the map location.', 3.65);
    const addressLines = address.slice(0, 2); if (address.length > 2) addressLines[1] += '...';
    doc.text(addressLines, .88, addressY);
    doc.setTextColor(11, 91, 159); doc.setFontSize(8.5);
    doc.textWithLink(`${shop.miles.toFixed(1)} mi from center  |  Open map location`, .88, addressY + addressLines.length * .16 + .06, { url: shop.url });
  });
  const box = { x: 5.03, y: 1.57, width: 5.5, height: 4.03 };
  if (map?.dataUrl && map.streetTilesLoaded) {
    doc.addImage(map.dataUrl, 'JPEG', box.x, box.y, box.width, box.height, undefined, 'FAST');
    const territoryX = box.x + map.territoryPoint.x / map.viewport.width * box.width;
    const territoryY = box.y + map.territoryPoint.y / map.viewport.height * box.height;
    doc.setFillColor(255, 255, 255); doc.setDrawColor(11, 91, 159); doc.setLineWidth(.012);
    doc.roundedRect(territoryX - .47, territoryY - .105, .94, .21, .035, .035, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(11, 91, 159);
    doc.text('Territory center', territoryX, territoryY, { align: 'center', baseline: 'middle' });
    const pins = [];
    for (const [i, point] of map.coffeePoints.entries()) {
      const anchor = { x: box.x + point.x / map.viewport.width * box.width, y: box.y + point.y / map.viewport.height * box.height };
      let pin = anchor;
      outer: for (const radius of [0, .28, .42, .6]) for (let angle = 0; angle < 8; angle++) {
        const candidate = { x: anchor.x + Math.cos(angle * Math.PI / 4) * radius, y: anchor.y + Math.sin(angle * Math.PI / 4) * radius };
        if (candidate.x < box.x + .15 || candidate.x > box.x + box.width - .15 || candidate.y < box.y + .15 || candidate.y > box.y + box.height - .22) continue;
        const coversCenter = Math.abs(candidate.x - territoryX) < .63 && Math.abs(candidate.y - territoryY) < .25;
        if (!coversCenter && pins.every(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) > .27)) { pin = candidate; break outer; }
      }
      pins.push(pin);
      doc.setDrawColor(125, 73, 37); doc.setLineWidth(.012); doc.line(anchor.x, anchor.y, pin.x, pin.y);
      doc.setFillColor(125, 73, 37); doc.setDrawColor(255, 255, 255); doc.setLineWidth(.02); doc.circle(pin.x, pin.y, .12, 'FD');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(String(i + 1), pin.x, pin.y, { align: 'center', baseline: 'middle' });
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(72, 87, 104);
    doc.text('Numbers = coffee shops  |  Blue outline = territory', box.x, 5.87);
  } else {
    doc.setTextColor(72, 87, 104); doc.setFontSize(9);
    doc.text('Location map unavailable. Use the map links beside each shop.', box.x, 1.85, { maxWidth: box.width });
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(72, 87, 104);
  doc.text('Distances are straight-line estimates, not walking or driving routes.', .48, 7.14);
  doc.text(coffee.status === 'partial' ? 'The wider search was unavailable; these are the closest available listings. Check current hours.' :
    'Check current hours before visiting. Map listings may be incomplete.', .48, 7.35);
  doc.textWithLink(`Coffee listings: ${coffee.source || 'Overture Maps'} and contributors`, .48, 7.60, { url: new URL('./coffee-data-sources.html', import.meta.url).href });
  doc.textWithLink('Search for more coffee shops', 10.53, 7.14, { align: 'right', url: searchUrl });
  doc.text(`Data: ${coffee.dataDate || coffee.localDataDate || 'date unavailable'}`, 10.53, 7.60, { align: 'right' });
}

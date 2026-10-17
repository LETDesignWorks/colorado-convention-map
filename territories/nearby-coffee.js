// Nearby shops are selected locally from the bundled Overture Maps snapshot.
// No territory address or location is sent to a business-search service.
import { streetAddressInfo } from './street-addresses.js?v=territories-20261017-31';
let datasetPromise = null;
const RADIUS_MILES = 2;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const valid = point => point.lat != null && point.lng != null && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) &&
  Math.abs(Number(point.lat)) <= 85 && Math.abs(Number(point.lng)) <= 180;
export function coffeeSearchCenter(houses) {
  const points = houses.filter(valid);
  if (!points.length) return null;
  const xs = points.map(p => Number(p.lng)), ys = points.map(p => Number(p.lat));
  return { lat: (Math.min(...ys) + Math.max(...ys)) / 2, lng: (Math.min(...xs) + Math.max(...xs)) / 2 };
}
export function coffeeDistanceMiles(a, b) {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function selectNearbyCoffee(places, center) {
  const candidates = places.filter(place => valid(place) && clean(place.name))
    .map(place => ({ ...place, name: clean(place.name), miles: coffeeDistanceMiles(center, place),
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lng}`)}` }))
    .filter(place => place.miles <= RADIUS_MILES);
  const unique = [];
  // Prefer an address-bearing record when providers describe the same shop.
  const nameKey = name => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(coffeecompany|coffee)$/, '');
  const addressKey = place => { const info = streetAddressInfo(place); return info.key ? `${info.number}|${info.key}|${info.unit}`.toUpperCase() : ''; };
  for (const candidate of candidates.sort((a, b) => Number(Boolean(b.address)) - Number(Boolean(a.address)) || (b.confidence || 0) - (a.confidence || 0) || a.miles - b.miles)) {
    if (!unique.some(other => other.id === candidate.id || (nameKey(other.name) === nameKey(candidate.name) &&
      coffeeDistanceMiles(other, candidate) < .04) || (addressKey(candidate) && addressKey(other) === addressKey(candidate) &&
      coffeeDistanceMiles(other, candidate) < .1))) unique.push(candidate);
  }
  return unique.sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name)).slice(0, 5);
}
export async function loadNearbyCoffee(houses, options = {}) {
  const center = coffeeSearchCenter(houses), fetcher = options.fetcher || globalThis.fetch;
  const now = options.now ?? Date.now();
  if (!center) return { status: 'unavailable', center: null, shops: [], checkedAt: now };
  try {
    const read = async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher(new URL('./coffee-shops-colorado.json?v=territories-20261017-31', import.meta.url),
          { signal: controller.signal, credentials: 'omit', cache: 'force-cache' });
        if (!response.ok) throw new Error('Coffee listings unavailable');
        const data = await response.json();
        if (!Array.isArray(data.shops) || !data.dataDate) throw new Error('Invalid coffee listings');
        return data;
      } finally { clearTimeout(timeout); }
    };
    const data = options.fetcher ? await read() : await (datasetPromise ||= read().catch(error => { datasetPromise = null; throw error; }));
    return { status: 'ready', center, shops: selectNearbyCoffee(data.shops, center), checkedAt: now,
      source: data.source, dataDate: data.dataDate, release: data.release };
  } catch { return { status: 'unavailable', center, shops: [], checkedAt: now }; }
}

export function drawNearbyCoffeePage(doc, coffee, map) {
  const center = coffee.center;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(72, 87, 104);
  doc.text('Up to five nearby coffee shops and cafes, within 2 miles of the territory center.', .48, 1.27);
  const searchUrl = center ? `https://www.google.com/maps/search/coffee/@${center.lat},${center.lng},14z` : 'https://www.google.com/maps/search/coffee/';
  if (coffee.status !== 'ready' || !coffee.shops.length) {
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
        if (pins.every(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) > .27)) { pin = candidate; break outer; }
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
  doc.text('Check current hours before visiting. Map listings may be incomplete.', .48, 7.35);
  doc.textWithLink('Coffee listings: Overture Maps and contributors', .48, 7.60, { url: new URL('./coffee-data-sources.html', import.meta.url).href });
  doc.text(`Data: ${coffee.dataDate || 'date unavailable'}`, 10.53, 7.60, { align: 'right' });
}

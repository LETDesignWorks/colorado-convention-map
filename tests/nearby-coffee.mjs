import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { coffeeSearchCenter, coffeeDistanceMiles, selectNearbyCoffee, loadNearbyCoffee, overpassCoffeeShops } from '../territories/nearby-coffee.js';
const center = { lat: 39.58, lng: -104.94 };
const cafe = (id, delta = 0, extras = {}) => ({ id: String(id), lat: center.lat + delta, lng: center.lng, name: `Cafe ${id}`, ...extras });
assert.deepEqual(coffeeSearchCenter([center, { lat: 39.60, lng: -104.92 }]), { lat: 39.59, lng: -104.93 });
assert.equal(coffeeSearchCenter([]), null);
assert.equal(coffeeSearchCenter([{ lat: null, lng: null }]), null);
assert.equal(Math.abs(coffeeSearchCenter([{ lat: 0, lng: 179.99 }, { lat: 0, lng: -179.99 }]).lng), 180);
assert.equal(coffeeDistanceMiles(center, center), 0);
const places = [cafe(1), cafe(2, .004), cafe(3, .006), cafe(4, .008), cafe(5, .01), cafe(6, .012),
  cafe(7, .1), cafe(8, 0, { name: '' }), cafe(9, 0, { name: 'Cafe 1', address: '123 Main St, Test City' })];
const shops = selectNearbyCoffee(places, center);
assert.equal(shops.length, 5);
assert.deepEqual(shops.map(shop => shop.name), ['Cafe 1', 'Cafe 2', 'Cafe 3', 'Cafe 4', 'Cafe 5']);
assert.equal(shops[0].address, '123 Main St, Test City');
assert.equal(shops[0].id, '9');
assert.ok(shops.every((shop, i) => !i || shop.miles >= shops[i - 1].miles));
let request;
const loaded = await loadNearbyCoffee([center], { now: 123, fetcher: async (url, options) => {
  request = { url, options }; return { ok: true, json: async () => ({ shops: places, dataDate: '2026-09-23', coverage: [-109, 37, -102, 41] }) };
} });
assert.equal(loaded.status, 'ready'); assert.equal(loaded.shops.length, 5);
assert.equal(loaded.checkedAt, 123); assert.equal(loaded.dataDate, '2026-09-23');
assert.match(request.url.pathname, /coffee-shops-colorado\.json$/);
assert.equal(request.options.credentials, 'omit');
assert.ok(!String(request.url).includes('39.58'), 'No territory location sent to a search service');
for (const fetcher of [async () => { throw new Error('Offline'); },
  async () => ({ ok: false, status: 404 }), async () => ({ ok: true, json: async () => ({}) })]) {
  const result = await loadNearbyCoffee([center], { fetcher });
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.shops, []);
}
const empty = await loadNearbyCoffee([center], { cache: new Map(), fetcher: async () => ({ ok: true,
  json: async () => ({ shops: [], dataDate: '2026-09-23', elements: [] }) }) });
assert.equal(empty.status, 'ready'); assert.deepEqual(empty.shops, []);
assert.ok(empty.searchRadiusMiles > 120, 'A sparse area expands well beyond two miles');
const data = JSON.parse(await readFile(new URL('../territories/coffee-shops-colorado.json', import.meta.url)));
assert.ok(data.shops.length > 1000);
for (const shop of data.shops) {
  assert.ok(shop.id && shop.name && shop.lat >= 36.98 && shop.lat <= 41.02 && shop.lng >= -109.06 && shop.lng <= -102.04);
  assert.ok(Array.isArray(shop.sources));
  assert.ok(shop.confidence >= .95);
}
const nearby = selectNearbyCoffee(data.shops, center);
assert.equal(nearby.length, 5); assert.ok(nearby.every(shop => shop.address && shop.miles <= 2));
assert.equal(selectNearbyCoffee([cafe('far', .1)], center).length, 1, 'Keep the nearest shop even beyond two miles');
assert.equal(selectNearbyCoffee([cafe(undefined), cafe(undefined, .1, { name: 'Different Cafe' })].map(({ id, ...shop }) => shop), center).length, 2);
const rural = { lat: 39.4, lng: -104.3 };
const localFetcher = async url => { assert.match(String(url), /coffee-shops-colorado/); return { ok: true, json: async () => data }; };
const ruralResult = await loadNearbyCoffee([rural], { fetcher: localFetcher });
assert.equal(ruralResult.shops.length, 5);
assert.ok(ruralResult.shops.every(shop => shop.miles > 2), 'Rural territory previously had no coffee shops');
console.log('Rural Colorado:', ruralResult.shops.map(shop => `${shop.name} ${shop.miles.toFixed(1)} mi`).join(', '));

const away = { lat: 30.267, lng: -97.743 };
const elements = Array.from({ length: 5 }, (_, i) => ({ type: 'node', id: i + 1,
  lat: away.lat + .001 * i, lon: away.lng, tags: { amenity: 'cafe', name: `Remote Cafe ${i}`, 'addr:housenumber': String(12 + i), 'addr:street': 'Main St' } }));
const calls = [], cache = new Map();
const worldwideFetcher = async (url, options) => {
  if (String(url).includes('coffee-shops-colorado')) return { ok: true, json: async () => data };
  calls.push({ url: String(url), query: new URL(url).searchParams.get('data') });
  assert.equal(options.credentials, 'omit');
  return { ok: true, json: async () => ({ elements: calls.length === 1 ? elements.slice(0, 2) : elements,
    osm3s: { timestamp_osm_base: '2026-10-17T12:00:00Z' } }) };
};
const worldwide = await loadNearbyCoffee([{ ...away, address: 'PRIVATE HOME', avoid: false }], { fetcher: worldwideFetcher, cache, now: 123 });
assert.equal(worldwide.status, 'ready'); assert.equal(worldwide.shops.length, 5);
assert.ok(worldwide.shops.every(shop => shop.name.startsWith('Remote Cafe') && shop.miles < 1));
assert.equal(worldwide.dataDate, '2026-10-17');
assert.equal(calls.length, 2);
const queryBounds = query => query.match(/cafe\]\(([^)]+)\)/)[1].split(',').map(Number);
const firstBounds = queryBounds(calls[0].query), widerBounds = queryBounds(calls[1].query);
assert.ok(firstBounds[0] < away.lat && firstBounds[2] > away.lat && firstBounds[1] < away.lng && firstBounds[3] > away.lng);
assert.ok(widerBounds[0] < firstBounds[0] && widerBounds[2] > firstBounds[2], 'Sparse results expand the search');
assert.ok(calls.every(call => !call.query.includes('PRIVATE HOME')));
await loadNearbyCoffee([away], { fetcher: worldwideFetcher, cache, now: 124 });
assert.equal(calls.length, 2, 'Repeated export reuses this location, not another territory');
await loadNearbyCoffee([away], { fetcher: worldwideFetcher, cache, now: 30 * 60 * 1000 + 124 });
assert.equal(calls.length, 3, 'Expired search is refreshed');
const otherCenter = { lat: 40.7, lng: -74 };
await loadNearbyCoffee([otherCenter], { fetcher: worldwideFetcher, cache, now: 125 });
const otherBounds = queryBounds(calls.at(-1).query);
assert.ok(Math.abs((otherBounds[0] + otherBounds[2]) / 2 - otherCenter.lat) < .001, 'Moving territory uses its own location');

const parsed = overpassCoffeeShops({ elements: [elements[0], { ...elements[1], type: 'way', center: { lat: away.lat, lon: away.lng }, lat: undefined, lon: undefined },
  { ...elements[2], tags: { ...elements[2].tags, access: 'private' } },
  { ...elements[3], tags: { ...elements[3].tags, disused: 'yes' } },
  { ...elements[4], tags: { ...elements[4].tags, amenity: undefined, shop: 'coffee' } }] });
assert.equal(parsed.length, 2); assert.equal(parsed[1].lat, away.lat); assert.equal(parsed[0].address, '12 Main St');
assert.throws(() => overpassCoffeeShops({ elements: [], remark: 'runtime error: Query timed out' }));
let fallbackCalls = 0;
const fallback = await loadNearbyCoffee([away], { cache: new Map(), fetcher: async url => {
  if (String(url).includes('coffee-shops-colorado')) throw Error('Missing snapshot');
  fallbackCalls++;
  if (String(url).includes('maps.mail.ru')) throw Error('Endpoint down');
  return { ok: true, json: async () => ({ elements }) };
} });
assert.equal(fallback.status, 'ready'); assert.equal(fallback.shops.length, 5); assert.equal(fallbackCalls, 2);
let partialCalls = 0;
const partial = await loadNearbyCoffee([away], { cache: new Map(), fetcher: async url => {
  if (String(url).includes('coffee-shops-colorado')) return { ok: true, json: async () => data };
  if (++partialCalls > 1) throw Error('Widening failed');
  return { ok: true, json: async () => ({ elements: elements.slice(0, 2) }) };
} });
assert.equal(partial.status, 'partial'); assert.equal(partial.shops.length, 2, 'Keep useful results after a later failure');
const edge = await loadNearbyCoffee([{ lat: 39.3, lng: -102.05 }], { cache: new Map(), fetcher: async url => {
  if (String(url).includes('coffee-shops-colorado')) return { ok: true, json: async () => data };
  throw Error('Network unavailable');
} });
assert.equal(edge.status, 'partial'); assert.equal(edge.shops.length, 5, 'Retain Colorado fallback at the state border');
const timedOut = await loadNearbyCoffee([away], { timeoutMs: 5, cache: new Map(), fetcher: async (url, options) => {
  if (String(url).includes('coffee-shops-colorado')) return { ok: true, json: async () => data };
  return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Timed out'))));
} });
assert.equal(timedOut.status, 'unavailable');
console.log('Nearest shops, rural and worldwide lookup, widening, cache isolation/expiry, fallback, parsing and timeouts passed.');
console.log(nearby.map(shop => `${shop.name}: ${shop.address} (${shop.miles.toFixed(1)} mi)`).join('\n'));

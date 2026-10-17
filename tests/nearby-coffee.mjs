import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { coffeeSearchCenter, coffeeDistanceMiles, selectNearbyCoffee, loadNearbyCoffee } from '../territories/nearby-coffee.js';
const center = { lat: 39.58, lng: -104.94 };
const cafe = (id, delta = 0, extras = {}) => ({ id: String(id), lat: center.lat + delta, lng: center.lng, name: `Cafe ${id}`, ...extras });
assert.deepEqual(coffeeSearchCenter([center, { lat: 39.60, lng: -104.92 }]), { lat: 39.59, lng: -104.93 });
assert.equal(coffeeSearchCenter([]), null);
assert.equal(coffeeSearchCenter([{ lat: null, lng: null }]), null);
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
  request = { url, options }; return { ok: true, json: async () => ({ shops: places, dataDate: '2026-09-23' }) };
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
const empty = await loadNearbyCoffee([center], { fetcher: async () => ({ ok: true, json: async () => ({ shops: [], dataDate: '2026-09-23' }) }) });
assert.equal(empty.status, 'ready'); assert.deepEqual(empty.shops, []);
const data = JSON.parse(await readFile(new URL('../territories/coffee-shops-colorado.json', import.meta.url)));
assert.ok(data.shops.length > 1000);
for (const shop of data.shops) {
  assert.ok(shop.id && shop.name && shop.lat >= 36.98 && shop.lat <= 41.02 && shop.lng >= -109.06 && shop.lng <= -102.04);
  assert.ok(Array.isArray(shop.sources));
  assert.ok(shop.confidence >= .95);
}
const nearby = selectNearbyCoffee(data.shops, center);
assert.equal(nearby.length, 5); assert.ok(nearby.every(shop => shop.address && shop.miles <= 2));
console.log('Coffee data, radius/order, deduplication, missing addresses, empty and failed loads passed.');
console.log(nearby.map(shop => `${shop.name}: ${shop.address} (${shop.miles.toFixed(1)} mi)`).join('\n'));

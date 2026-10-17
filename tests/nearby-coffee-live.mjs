// Optional network integration check: node tests/nearby-coffee-live.mjs [deployed-site-base-url]
// Uses an isolated browser and never opens or writes a saved territory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.html') ? 'text/html' : 'application/json');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const base = process.argv[2] || `http://127.0.0.1:${server.address().port}/`;
  const page = await browser.newPage();
  page.on('requestfailed', request => console.log('Request failed:', request.url(), request.failure()?.errorText));
  page.on('console', message => { if (message.type() === 'error') console.log('Browser error:', message.text()); });
  page.on('response', response => { if (!response.ok()) console.log('HTTP error:', response.status(), response.url()); });
  // A simple public source page provides the same origin without booting the planner.
  await page.goto(new URL('territories/coffee-data-sources.html', base).href);
  for (const location of [
    { name: 'Rural Colorado', lat: 39.4, lng: -104.3 },
    { name: 'Austin', lat: 30.267, lng: -97.743 },
    { name: 'London', lat: 51.507, lng: -.127 }
  ]) {
    const result = await page.evaluate(async location => {
      const { loadNearbyCoffee } = await import('./nearby-coffee.js?v=territories-20261017-32');
      return loadNearbyCoffee([location]);
    }, location);
    console.log(`${location.name}: ${result.status}; ${result.source}; ${result.shops.map(shop => `${shop.name} (${shop.miles.toFixed(1)} mi)`).join('; ')}`);
    assert.equal(result.status, 'ready', location.name);
    assert.equal(result.shops.length, 5, location.name);
    if (location.name !== 'Rural Colorado') assert.ok(result.shops.every(shop => shop.miles < 3), 'Results must be from the requested location');
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

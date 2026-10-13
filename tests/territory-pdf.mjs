// Run with Playwright installed: node tests/territory-pdf.mjs [output-directory]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] || 'tmp/pdfs');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/test.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<button id="exportTerritoryPdfButton">Export PDF</button><select id="pdfTerritorySelect"><option value="sample">Sample</option></select>');
      return;
    }
    const path = resolve(root, '.' + pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.png': 'image/png', '.html': 'text/html' })[extname(path)] || 'application/octet-stream');
    let source = await readFile(path);
    if (pathname === '/territories/territory-flex-grouping-pdf.js') {
      // Expose existing functions for inspection, without changing their implementation.
      source = source.toString() + '\nexport { buildStreetMapImage, relevantAvoids, pointInsideGeometry, territoryGeometry };';
    }
    res.end(source);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PDF_BROWSER_CHANNEL ? { channel: process.env.PDF_BROWSER_CHANNEL } : {}) });
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const makeHomes = (rows, columns, dx, dy) => Array.from({ length: rows * columns }, (_, i) => ({
  id: `home-${i}`, address: `${10000 + i * 2} Sample Street, Centennial, CO 80112`,
  lng: -104.94 + (i % columns) * dx, lat: 39.58 + Math.floor(i / columns) * dy,
  territoryId: 'sample', included: true
}));
const samples = [
  { name: 'neighborhood', homes: makeHomes(5, 8, 0.00040, 0.00055) },
  { name: 'crowded', homes: makeHomes(10, 8, 0.00016, 0.00040) },
  { name: 'irregular', homes: makeHomes(5, 8, 0.00020, 0.00045).map((home, i) => ({ ...home,
    lat: home.lat + Math.sin(i * 2.7) * 0.000035, lng: home.lng + Math.cos(i * 1.3) * 0.000025 })) },
  { name: 'single-home', homes: [{ ...makeHomes(1, 1, 0, 0)[0], address: '123 1/2 Sample Avenue' }] },
  { name: 'shared-position', homes: Array.from({ length: 12 }, (_, i) => ({ ...makeHomes(1, 1, 0, 0)[0],
    id: `unit-${i}`, address: `${1200 + Math.floor(i / 4) * 2} Sample Street Apt ${i + 1}` })) }
];
const report = [];
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
  await page.addScriptTag({ url: 'https://unpkg.com/@turf/turf@7.2.0/turf.min.js' });
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js' });
  await page.evaluate(() => {
    window.fixture = { homes: [], territory: null };
    window.messages = [];
    window.__denverTerritoryPlannerAPI = {
      requireAdmin: () => true, getMap: () => ({}), getHouses: () => fixture.homes,
      getTerritories: () => [fixture.territory], getSelectedHall: () => ({ name: 'Export Verification' }),
      getSelectedCongregation: () => 'PDF Label Test', toast: message => messages.push(message)
    };
  });
  await page.evaluate(async () => {
    window.pdfTest = await import('/territories/territory-flex-grouping-pdf.js');
    window.labelTest = await import('/territories/pdf-house-labels.js');
  });
  const parsing = await page.evaluate(() => ['123 Main St Apt 456', '123A Main St', '123-125 Main St', '123 1/2 Main St', '123½ Main St', 'Main St', 'PO Box 123'].map(address => labelTest.pdfHouseNumber({ address, _pdfNumber: 99 })));
  assert.deepEqual(parsing, ['123', '123A', '123-125', '123 1/2', '123 1/2', '', '']);
  for (const sample of samples) {
    const result = await page.evaluate(async sample => {
      const lngs = sample.homes.map(h => h.lng), lats = sample.homes.map(h => h.lat);
      const west = Math.min(...lngs) - 0.00020, east = Math.max(...lngs) + 0.00020;
      const south = Math.min(...lats) - 0.00020, north = Math.max(...lats) + 0.00020;
      const geometry = turf.bboxPolygon([west, south, east, north]).geometry;
      const insideAvoid = { id: 'avoid-in', avoid: true, address: '8888 Avoid Street', lat: south + 0.00004, lng: east - 0.00004 };
      const outside = [
        { id: 'avoid-out', avoid: true, address: '9999 Outside Avoid Street', territoryId: 'sample', lat: north + 0.001, lng: east },
        { id: 'house-out', address: '7777 Outside Assigned Street', territoryId: 'sample', lat: north + 0.001, lng: west },
        { ...sample.homes[0], id: 'excluded', address: '6666 Excluded Street', included: false },
        { ...sample.homes[0], id: 'other', address: '5555 Other Territory Street', territoryId: 'other' }
      ];
      fixture = { homes: [...sample.homes, insideAvoid, ...outside], territory: { id: 'sample', name: sample.name, geometry } };
      const avoids = pdfTest.relevantAvoids(fixture.homes, geometry);
      if (avoids.length !== 1 || avoids[0].id !== 'avoid-in') throw Error('Avoid boundary filtering failed');
      const maps = [];
      for (const view of ['overview', 'closer']) {
        const map = await pdfTest.buildStreetMapImage(fixture.territory, sample.homes, avoids, geometry, {}, { view });
        maps.push({ view, tiles: map.streetTilesLoaded, scale: 2 ** map.viewport.zoom * map.viewport.scale,
          overlaps: map.labelLayout.overlapPairs.length,
          leaderCrossings: map.labelLayout.leaderCrossings.length,
          collisions: map.labelLayout.overlapPairs.map(pair => pair.map(label => ({ lines: label.lines, x: label.x, y: label.y, bounds: label.bounds, angle: label.angle, radius: label.radius }))),
          labels: map.labelLayout.labels.map(label => ({ x: label.x, y: label.y, lines: label.lines, bounds: label.bounds,
            fontSize: label.fontSize, angle: label.angle, anchorX: label.anchorX, anchorY: label.anchorY, leader: label.leader, homes: label.houses.map(h => h.id) })) });
      }
      return maps;
    }, sample);
    await writeFile(resolve(output, sample.name + '-layout.json'), JSON.stringify(result, null, 2));
    for (const map of result) {
      assert.ok(map.tiles > 0, `${sample.name} ${map.view}: map tiles loaded`);
      assert.equal(map.overlaps, 0, `${sample.name} ${map.view}: label collisions ${JSON.stringify(map.collisions)}`);
      assert.deepEqual(map.labels.flatMap(l => l.homes).sort(), sample.homes.map(h => h.id).sort());
      for (const label of map.labels) {
        assert.equal(label.fontSize, 22);
        assert.equal(label.angle, 0);
        if (label.leader) {
          assert.deepEqual(label.leader.start, { x: label.anchorX, y: label.anchorY });
          assert.ok(Math.hypot(label.x - label.anchorX, label.y - label.anchorY) > 1);
        } else {
          assert.equal(label.x, label.anchorX);
          assert.equal(label.y, label.anchorY);
        }
        assert.ok(label.bounds.left >= 0 && label.bounds.right <= 1200 && label.bounds.top >= 0 && label.bounds.bottom < 740);
        assert.ok(label.lines.every(line => /^\d[\dA-Za-z /-]*$/.test(line)));
      }
    }
    if (sample.name === 'crowded') {
      assert.ok(result.every(map => map.labels.some(label => label.leader)), 'Crowded maps need leader lines');
      assert.ok(result.every(map => map.leaderCrossings === 0), 'Ordered crowded streets need clear, uncrossed leaders');
    }
    assert.ok(result[1].scale > result[0].scale, `${sample.name}: closer map is closer`);
    const downloaded = page.waitForEvent('download', { timeout: 120000 });
    await page.locator('#exportTerritoryPdfButton').click();
    const download = await downloaded;
    await download.saveAs(resolve(output, sample.name + '.pdf'));
    report.push({ sample: sample.name, homes: sample.homes.length, maps: result });
    console.log(`${sample.name}: both maps, all ${sample.homes.length} homes, no overlaps, export downloaded`);
  }
  await page.evaluate(() => { fixture.homes[0].address = 'Missing Number Street'; });
  await page.locator('#exportTerritoryPdfButton').click();
  assert.match(await page.evaluate(() => messages.at(-1)), /missing a street house number/);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

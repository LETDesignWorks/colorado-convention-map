import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const data=await readFile('bus-access/data.js','utf8');
const halls=JSON.parse(data.match(/export const HALLS=(\[[^;]+\]);/)[1]);
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/node_modules/leaflet/dist/leaflet.css"><link rel="stylesheet" href="/bus-access/styles.css">
<style>body{margin:0}#map{background:#edf3f6}.map-wrap{min-height:430px}.hall-label{font:700 11px Arial}.toolbar{z-index:1000}</style>
</head><body><div class="app"><header><div class="header-row"><div class="title"><h1>Bus Access Review</h1><p>45-minute planning center: Colorado Convention Center</p></div></div></header>
<div class="toolbar"><div class="search"><input placeholder="Search hall or meeting location"></div><select><option>All bus statuses</option></select><label class="boundary-display-label" for="boundaryDisplay">Map boundary<select id="boundaryDisplay" aria-describedby="boundaryDisplayNote"><option value="rounded">Rounded planning guide</option><option value="detailed">Detailed driving estimate</option></select></label></div>
<div class="workspace"><div class="map-wrap"><div id="map"></div><div class="map-note" id="boundaryDisplayNote" aria-live="polite"></div></div><aside class="panel"><div class="card"><h2>22 existing hall locations</h2><p>Changing the map boundary view does not edit any location, review, or saved traffic layout.</p></div></aside></div></div>
<script src="/node_modules/leaflet/dist/leaflet.js"></script><script type="module">
import {mountPlanningBoundary} from '/bus-access/rounded-boundary.mjs';import {DRIVE_TIME_AREA} from '/bus-access/drive-time-area.mjs';
const map=L.map('map').setView([39.74248,-104.99567],9);
const layer=mountPlanningBoundary(L,map,DRIVE_TIME_AREA,[39.74248,-104.99567],{selector:document.querySelector('#boundaryDisplay'),note:document.querySelector('#boundaryDisplayNote')});
map.fitBounds(layer.getBounds(),{padding:[18,18],animate:false});
for(const hall of ${JSON.stringify(halls)}) L.circleMarker([hall.lat,hall.lng],{radius:5,color:'#355a68',fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip(String(hall.number),{permanent:true,direction:'right',className:'hall-label'});
L.marker([39.74248,-104.99567],{icon:L.divIcon({className:'center-star',html:'★',iconSize:[36,36]})}).addTo(map);
window.fixtureMap=map;
</script></body></html>`;
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://local');if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  const file=path.resolve('.','.'+decodeURIComponent(url.pathname));if(!file.startsWith(process.cwd()+path.sep))throw Error('invalid path');
  const bytes=await readFile(file);res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(bytes);
 } catch {res.statusCode=404;res.end('not found');}
});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
await mkdir('test-results/rounded-boundary',{recursive:true});
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/fixture');await page.waitForSelector('.leaflet-overlay-pane path');
  assert.equal(await page.locator('#boundaryDisplay').inputValue(),'rounded');
  assert.match(await page.locator('#boundaryDisplayNote').textContent(),/rounded, approximate/);
  const stroke=page.locator('.leaflet-overlay-pane path').first();assert.equal(await stroke.getAttribute('stroke-width'),'5');
  const rawPath=await stroke.getAttribute('d');assert.ok(rawPath.length<13000);
  assert.equal(await page.locator('.hall-label').count(),22);await page.screenshot({path:`test-results/rounded-boundary/${width}-rounded.png`,fullPage:true});
  await page.selectOption('#boundaryDisplay','detailed');await page.waitForTimeout(350);
  assert.equal(await stroke.getAttribute('stroke-dasharray'),'9 7');assert.match(await page.locator('#boundaryDisplayNote').textContent(),/calculated 45-minute/);
  assert.ok((await stroke.getAttribute('d')).length>rawPath.length);assert.equal(await page.locator('.hall-label').count(),22);
  await page.screenshot({path:`test-results/rounded-boundary/${width}-detailed.png`,fullPage:true});
  await page.selectOption('#boundaryDisplay','rounded');await page.waitForTimeout(350);
  assert.equal(await stroke.getAttribute('stroke-width'),'5');assert.equal(await page.locator('.hall-label').count(),22);
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.close();console.log(`PASS ${width}: rounded default, detailed toggle, 22 unchanged markers, no horizontal overflow or page errors`);
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}

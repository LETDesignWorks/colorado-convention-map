import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bus-access/styles.css"><link rel="stylesheet" href="/node_modules/leaflet/dist/leaflet.css"><script src="/node_modules/leaflet/dist/leaflet.js"></script></head><body><main><div id="detail">Synthetic inspection form — no cloud records</div></main><script type="module">
import {mountTrafficPlanner} from '/bus-access/traffic-planner.mjs';
const location={id:'test-21',name:'Sample meeting location',address:'Synthetic parking-lot test',lat:39.6,lng:-105.0};
const copies=[];window.testCopies=copies;
mountTrafficPlanner({L,getLocation:()=>location,isAdmin:()=>true,storage:{list:async()=>copies.slice(),save:async plan=>{const r={id:crypto.randomUUID(),savedAt:Date.now(),plan:structuredClone(plan)};copies.unshift(r);return r;},remove:async(id,rid)=>{const i=copies.findIndex(x=>x.id===rid);if(i>=0)copies.splice(i,1);}}});
</script></body></html>`;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}const file=path.resolve('.','.'+decodeURIComponent(url.pathname));if(!file.startsWith(process.cwd()+path.sep))throw Error('forbidden');const bytes=await readFile(file);const ext=path.extname(file);res.setHeader('Content-Type',ext==='.css'?'text/css':ext==='.mjs'||ext==='.js'?'text/javascript':'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end('not found');}});
await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
await mkdir('test-results/traffic-pdf',{recursive:true});
try{
for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
 const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 const jpeg=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');c.fillStyle='#7e8981';c.fillRect(0,0,256,256);c.strokeStyle='#b0b9ac';c.lineWidth=20;for(const x of [64,192]){c.beginPath();c.moveTo(x,0);c.lineTo(x,256);c.stroke();c.beginPath();c.moveTo(0,x);c.lineTo(256,x);c.stroke();}c.fillStyle='#667068';c.fillRect(76,76,104,104);c.fillStyle='white';c.font='12px sans-serif';c.fillText('TEST LOT',94,130);return canvas.toDataURL('image/jpeg').split(',')[1];});
 let failTiles=false;
 await page.route('https://**/*',route=>route.fulfill(failTiles?{status:503,headers:{'Access-Control-Allow-Origin':'*'},body:'tile unavailable'}:{status:200,contentType:'image/jpeg',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from(jpeg,'base64')}));
 await page.goto('http://127.0.0.1:8765/fixture');await page.locator('[data-open]').click();
 await page.waitForSelector('dialog[open] [data-map]');
 await page.screenshot({path:`test-results/traffic-pdf/${viewport.width}-initial.png`});
 await page.locator('[data-name]').fill('Sample arrival layout');
 await page.locator('[data-tool="route"]').click();
 const map=page.locator('[data-map]');
 await map.click({position:{x:80,y:110}});await map.click({position:{x:200,y:110}});await map.click({position:{x:230,y:200}});
 await page.locator('[data-finish]').click();
 await page.locator('[data-cone-count]').fill('8');await page.locator('[data-tool="cone-row"]').click();
 await map.click({position:{x:80,y:160}});await map.click({position:{x:200,y:160}});await page.locator('[data-finish]').click();
 await page.locator('[data-tool="pin"]').click();await map.click({position:{x:80,y:240}});
 await page.locator('[data-save]').click();await page.waitForFunction(()=>window.testCopies.length===1);
 const saved=await page.evaluate(()=>window.testCopies[0]);assert.equal(saved.plan.items.filter(x=>x.kind==='cone').length,8);assert.equal(saved.plan.items.filter(x=>x.kind==='route').length,1);assert.equal(saved.plan.items.filter(x=>x.kind==='pin').length,1);
 await page.locator('[data-tool="select"]').click();
 if(viewport.width>600)await page.locator('.traffic-tools').evaluate(el=>el.scrollTop=0);else await page.locator('.traffic-body').evaluate(el=>el.scrollTop=0);
 const boxes=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return{dialog:rect('.traffic-dialog'),map:rect('[data-map]'),status:rect('[data-status]'),tools:rect('.traffic-tools'),area:rect('.traffic-map-area'),body:rect('.traffic-body')};});
 await page.screenshot({path:`test-results/traffic-pdf/${viewport.width}.png`});
 assert.ok(boxes.map.width>=250);assert.ok(boxes.map.height>=250);assert.ok(boxes.dialog.right<=viewport.width+1);assert.ok(boxes.status.bottom<=boxes.area.bottom+2,'Status must stay inside its map area');
 if(viewport.width<600)assert.ok(boxes.tools.y>=boxes.status.bottom-2,'Mobile tools must not overlap map messages');

 await page.locator('[data-notes]').fill('Sample setup only: use the marked entrance. Confirm the bus loop and pedestrian access on site.');
 await page.locator('[data-export-pdf]').click();await page.waitForSelector('[data-pdf-links] a[download]',{timeout:30000});
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-pdf-links] a[download]').click();const download=await downloadPromise;await download.saveAs(`test-results/traffic-pdf/${viewport.width}-layout.pdf`);
 assert.equal(await page.evaluate(()=>window.testCopies.length),1,'Export must not save or overwrite a cloud record');
 assert.match(await page.locator('[data-dirty]').textContent(),/Unsaved/);
 if(viewport.width===1440){
   failTiles=true;await page.locator('[data-export-pdf]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('PDF was not created'),{timeout:30000});
   assert.equal(await page.locator('[data-pdf-links] a').count(),0);assert.equal(await page.locator('[data-export-pdf]').isEnabled(),true);assert.match(await page.locator('[data-count]').textContent(),/8 cones/);
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS ${viewport.width}x${viewport.height}: click-to-draw route, eight cones, entrance label, new-copy save, no overlap or runtime errors.`);await page.close();
}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

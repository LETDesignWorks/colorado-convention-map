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
await mkdir('test-results/traffic',{recursive:true});
try{
for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
 const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#7e8981"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#b0b9ac" stroke-width="20"/><path d="M70 70h110v110H70Z" fill="#667068" stroke="#dce3c9"/><text x="84" y="128" fill="white" font-size="12">TEST TILE</text></svg>'}));
 await page.goto('http://127.0.0.1:8765/fixture');await page.locator('[data-open]').click();
 await page.waitForSelector('dialog[open] .leaflet-pane');
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
 await page.screenshot({path:`test-results/traffic/${viewport.width}.png`});
 assert.ok(boxes.map.width>=250);assert.ok(boxes.map.height>=250);assert.ok(boxes.dialog.right<=viewport.width+1);assert.ok(boxes.status.bottom<=boxes.area.bottom+2,'Status must stay inside its map area');
 if(viewport.width<600)assert.ok(boxes.tools.y>=boxes.status.bottom-2,'Mobile tools must not overlap map messages');
 assert.deepEqual(errors,[]);
 console.log(`PASS ${viewport.width}x${viewport.height}: click-to-draw route, eight cones, entrance label, new-copy save, no overlap or runtime errors.`);await page.close();
}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

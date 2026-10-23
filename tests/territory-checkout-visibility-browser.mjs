import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:14px;background:#edf2f6;font:14px Arial;color:#243a50}*{box-sizing:border-box}.side-panel{max-width:440px}.card{margin:12px 0;padding:14px;background:white;border:1px solid #cad7df;border-radius:12px}.eyebrow{font-size:10px;font-weight:700}.btn{padding:10px;background:white;border:1px solid #abbfc8;border-radius:6px;color:#203d58;text-decoration:none}.save{background:#427b5b;color:white}h2{font-size:20px}button:disabled{opacity:.55}.button-grid{display:grid;gap:8px}</style></head><body><aside class="side-panel"><section class="card setup-card"><h2>Select the Hall and congregation</h2><select id="hallSelect"><option>21 — Sample meeting location</option></select><section class="card" id="savedTerritoriesCard"><div class="card-heading"><h2>All saved territories for this meeting place</h2></div></section></section><section class="card saved-card"><div class="card-heading"><h2>Return to your territories</h2></div></section></aside><script type="module">
import {initializeCheckoutSheet} from '/territories/territory-checkout-ui.js';
await initializeCheckoutSheet();
window.startTestPlanner=()=>{const hall={id:'test21',name:'Sample meeting location',address:'Synthetic records only'};window.__denverTerritoryPlannerAPI={isAdmin:()=>true,getSelectedHall:()=>hall,getSelectedCongregation:()=> 'Sample host',getSavedRecordsStatus:()=> 'ready',meetingSessionManager:{registerSnapshot:async()=>({hall,rows:[{id:'t1',name:'Sample territory 1',congregation:'Sample host'}],congregation:'',sessionRows:0,reviewRows:0})}};window.dispatchEvent(new Event('territory-planner:data'));};
</script></body></html>`;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}const file=path.resolve('.','.'+decodeURIComponent(url.pathname));if(!file.startsWith(process.cwd()+path.sep))throw Error('invalid');const bytes=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end('not found');}});
await new Promise(r=>server.listen(8766,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});await mkdir('test-results/checkout52',{recursive:true});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',route=>route.abort());await page.goto('http://127.0.0.1:8766/fixture');
 await page.waitForSelector('#territoryCheckoutSheet');assert.ok(await page.locator('[data-export]').isDisabled());assert.equal(await page.locator('#hallAddressSetCard').count(),0);
 await page.evaluate(()=>window.startTestPlanner());await page.waitForFunction(()=>!document.querySelector('[data-export]').disabled);
 await page.locator('.saved-card [data-checkout-shortcut]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'territoryCheckoutSheet');
 await page.locator('[data-export]').click();await page.waitForSelector('[data-links] a[download]');
 const downloading=page.waitForEvent('download');await page.locator('[data-links] a[download]').click();await(await downloading).saveAs('test-results/checkout52/'+width+'.pdf');
 await page.locator('#hallSelect').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/checkout52/'+width+'.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();console.log('PASS visible checkout section, loading state, shortcut focus and real PDF download at '+width+'px');
}}finally{await browser.close();await new Promise(r=>server.close(r));}

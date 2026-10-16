// End-to-end UI verification with Firebase replaced by an isolated test store.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/saving-browser');
await mkdir(output, {recursive:true});
const storeModule = `
const key = 'isolated-saving-test';
let store = new Map(JSON.parse(localStorage.getItem(key) || '[]')), listeners = [];
const snapshot = ref => ({ metadata:{hasPendingWrites:false}, forEach(callback) {
  for (const [path,data] of store) if (path.startsWith(ref.name+'/') && (!ref.filters || ref.filters.every(f => f.op === 'in' ? f.value.includes(data[f.field]) : data[f.field] === f.value)))
    callback({id:path.split('/').at(-1), data:()=>structuredClone(data)});
}});
const notify = () => {localStorage.setItem(key,JSON.stringify([...store])); listeners.forEach(([ref,callback])=>callback(snapshot(ref)));};
export const initializeApp = () => ({}), getAuth = () => ({}), getFirestore = () => ({}), browserLocalPersistence = {};
export const getApp = () => ({}), getApps = () => [{}];
export const setPersistence = async () => {}, signInWithEmailAndPassword = async () => {}, signOut = async () => {}, sendPasswordResetEmail = async () => {};
export const onAuthStateChanged = (_auth,callback) => { queueMicrotask(()=>callback({email:'michaeltarin@hotmail.com'})); };
export const collection = (_db,name) => ({name});
export const doc = (...args) => {const name=args.length===1 ? args[0].name : args[1], id=args.length===1 ? crypto.randomUUID() : args[2]; return {id,path:name+'/'+id};};
export const where = (field,op,value) => ({field,op,value}), query = (ref,...filters) => ({...ref,filters});
export const onSnapshot = (ref,...args) => {const callback=args.find(arg=>typeof arg==='function'); const listener=[ref,callback]; listeners.push(listener); queueMicrotask(()=>callback(snapshot(ref))); return ()=>{listeners=listeners.filter(l=>l!==listener)};};
export const serverTimestamp = () => new Date().toISOString();
export const getDoc = async ref => ({id:ref.id,exists:()=>store.has(ref.path),data:()=>structuredClone(store.get(ref.path))});
export const writeBatch = () => {const operations=[]; return {set(ref,data,options){operations.push({ref,data:structuredClone(data),options});},delete(ref){operations.push({ref,remove:true});},async commit(){
  if(window.failPlanSave && operations.some(op=>op.data?.recordType==='territory-plan')) throw Object.assign(Error('Simulated save failure'),{code:'permission-denied'});
  for(const op of operations) {if(op.remove) store.delete(op.ref.path); else store.set(op.ref.path,op.options?.merge?{...store.get(op.ref.path),...op.data}:op.data);} notify();
}}};
export const setDoc = async (ref,data,options) => {if(window.failArchiveSave && data.recordType==='territory-pdf') throw Error('Simulated archive failure'); const batch=writeBatch(); batch.set(ref,data,options); await batch.commit();};
export const deleteDoc = async ref => {store.delete(ref.path); notify();};
`;
const server = createServer(async (req,res) => {
  try {
    let pathname = new URL(req.url,'http://localhost').pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const path = resolve(root, '.'+pathname);
    if (!path.startsWith(root+sep)) {res.writeHead(403).end();return;}
    let content = await readFile(path);
    if (pathname === '/territories/app-main.js') content = content.toString()+`
      window.seedSavingTest = data => { houses=data.houses; territories=data.territories; boundaryGeometry=data.geometry;
        currentPlanId=null; els.planName.value='Browser Save Test'; recalculateTerritoryHouseIds(); renderAllPlanningData(); };
    `;
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'text/plain');
    res.end(content);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,channel:process.env.PDF_BROWSER_CHANNEL || 'msedge'});
const page = await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
const pageErrors=[]; page.on('pageerror',error=>pageErrors.push(error.message));
const consoleErrors=[]; page.on('console',entry=>{if(entry.type()==='error') consoleErrors.push(entry.text());});
page.on('dialog',dialog=>dialog.accept());
await page.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:storeModule}));
const ready = async () => {
  await page.waitForFunction(()=>window.__denverTerritoryPlannerAPI?.isAdmin() && window.seedSavingTest && document.querySelector('#hallAddressSaveButton'));
  await page.waitForFunction(()=>document.querySelector('#groupingMethod [value="nearby-flex"]'));
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/territories/`);
  await ready();
  const geometry = {type:'Polygon',coordinates:[[[-104.942,39.579],[-104.936,39.579],[-104.936,39.584],[-104.942,39.584],[-104.942,39.579]]]};
  const homes = Array.from({length:8},(_,i)=>({id:`test-home-${i}`,address:`${1100+i*2} Sample Street`,lat:39.58+Math.floor(i/4)*.0005,lng:-104.94+(i%4)*.0005,included:true,territoryId:i<4?'test-a':'test-b'}));
  homes.push({id:'test-avoid',address:'8888 Sample Avoid Street',lat:39.5815,lng:-104.938,avoid:true,included:false});
  await page.evaluate(data=>seedSavingTest(data),{houses:homes,geometry,territories:[{id:'test-a',name:'Test A',colorIndex:0,geometry},{id:'test-b',name:'Test B',colorIndex:1,geometry}]});
  const download = page.waitForEvent('download',{timeout:120000});
  await page.locator('#exportTerritoryPdfButton').click();
  await (await download).saveAs(resolve(output,'original.pdf'));
  await page.locator('#savedTerritoryPdfs [data-download-territory-pdf]').waitFor();
  assert.equal(await page.locator('#savedPlans [data-load-plan]').count(),1);
  assert.equal(await page.locator('#planSaveMessage').getAttribute('data-state'),'success');
  const originalPlanId = await page.evaluate(()=>__denverTerritoryPlannerAPI.getCurrentPlanId());

  await page.reload(); await ready();
  await page.locator('#savedTerritoryPdfs [data-download-territory-pdf]').waitFor();
  const restoredDownload = page.waitForEvent('download');
  await page.locator('#savedTerritoryPdfs [data-download-territory-pdf]').click();
  await (await restoredDownload).saveAs(resolve(output,'reopened.pdf'));
  assert.deepEqual(await readFile(resolve(output,'reopened.pdf')),await readFile(resolve(output,'original.pdf')));
  await page.locator('#savedTerritoryPdfs [data-load-territory-pdf]').click();
  await page.waitForFunction(()=>__denverTerritoryPlannerAPI.getTerritories().length===1);
  assert.deepEqual(await page.evaluate(()=>({homes:__denverTerritoryPlannerAPI.getHouses().length,plan:__denverTerritoryPlannerAPI.getCurrentPlanId(),avoids:__denverTerritoryPlannerAPI.getHouses().filter(h=>h.avoid).length})),{homes:5,plan:null,avoids:1});
  assert.equal(await page.locator('#savedPlans [data-load-plan]').count(),1);
  await page.locator('#savedPlans [data-load-plan]').click();
  await page.waitForFunction(()=>__denverTerritoryPlannerAPI.getHouses().length===9);
  assert.equal(await page.evaluate(()=>__denverTerritoryPlannerAPI.getCurrentPlanId()),originalPlanId);

  await page.evaluate(()=>{window.failPlanSave=true;});
  await page.locator('#hallAddressSaveButton').click();
  await page.waitForFunction(()=>document.querySelector('#hallAddressMessage')?.dataset.state==='error');
  assert.match(await page.locator('#hallAddressMessage').textContent(),/not saved/);
  await page.evaluate(()=>{window.failPlanSave=false;});
  await page.locator('#savePlanButton').click();
  await page.waitForFunction(()=>document.querySelector('#planSaveMessage').dataset.state==='success');
  await page.locator('#savedTerritoryPdfs').scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(output,'saved-library.png')});
  assert.deepEqual(pageErrors,[]);
  await writeFile(resolve(output,'result.txt'),'PASS: Export saved the plan and PDF; reloading restored the identical PDF; Load territory restored the printed homes and avoid marker; the full plan remained intact; failed saves showed errors and retried successfully.');
  console.log('Browser saving passed: export → reload → download identical PDF → load territory copy → load full plan → failed save → successful retry.');
} catch (error) {
  console.error(JSON.stringify({pageErrors,consoleErrors,body:(await page.locator('body').innerText()).slice(-4000)},null,2));
  throw error;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}

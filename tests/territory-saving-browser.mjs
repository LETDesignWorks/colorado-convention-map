// End-to-end UI verification with Firebase replaced by an isolated test store.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
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
      window.markPdfOldForTest = async id => {const record=reviewRecords.get(id); await setDoc(doc(db,'reviews',id), {...record,pdfLayoutVersion:0});};
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
let allowReplace = true;
page.on('dialog',dialog=>allowReplace ? dialog.accept() : dialog.dismiss());
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
  const recoveryHall = await page.evaluate(()=>__denverTerritoryPlannerAPI.getSelectedHall());
  const recoveryCongregation = await page.evaluate(()=>__denverTerritoryPlannerAPI.getSelectedCongregation());
  const recoveryHomes = homes.filter(h=>h.avoid || h.territoryId==='test-a').map(h=>({...h,avoid:Boolean(h.avoid),territoryId:h.avoid?null:h.territoryId}));
  const recoveryTerritory = {id:'test-a',name:'Recovered Test A',colorIndex:0,geometry,houseIds:recoveryHomes.filter(h=>!h.avoid).map(h=>h.id)};
  const originalBytes = Buffer.from(await page.evaluate(() => {
    const old = new jspdf.jsPDF(); old.text('An earlier territory PDF without grouped addresses or coffee shops.', 12, 20);
    return Array.from(new Uint8Array(old.output('arraybuffer')));
  }));
  const recovery = {format:'denver-territory-recovery',version:1,plan:{name:'Recovered browser plan',hall:recoveryHall,congregation:recoveryCongregation,
    houses:recoveryHomes,territories:[recoveryTerritory],geometry},originals:[{filename:'original-test-a.pdf',pdfBase64:originalBytes.toString('base64'),
    sha256:createHash('sha256').update(originalBytes).digest('hex'),snapshot:{territory:recoveryTerritory,houses:recoveryHomes,hall:recoveryHall,congregation:recoveryCongregation}}]};
  const recoveryPath=resolve(output,'recovery-test.json'); await writeFile(recoveryPath,JSON.stringify(recovery));
  await page.locator('.recovery-tools summary').click();
  await page.locator('#territoryRecoveryFile').setInputFiles(recoveryPath);
  await page.waitForFunction(()=>!document.querySelector('#restoreRecoveryButton').disabled);
  await page.locator('#restoreRecoveryButton').click();
  await page.waitForFunction(()=>document.querySelector('#territoryRecoveryStatus').dataset.state==='success');
  assert.equal(await page.evaluate(()=>__denverTerritoryPlannerAPI.getCurrentPlanId()),originalPlanId);
  assert.equal(await page.locator('#savedPlans [data-load-plan]').count(),2);
  await page.reload(); await ready();
  await page.locator('#savedPlans .saved-row').filter({hasText:'Recovered browser plan'}).getByRole('button',{name:'Load',exact:true}).click();
  await page.waitForFunction(()=>__denverTerritoryPlannerAPI.getHouses().length===5);
  assert.equal(await page.evaluate(()=>__denverTerritoryPlannerAPI.getTerritories()[0].name),'Recovered Test A');
  const recoveredRow = page.locator('#savedTerritoryPdfs .saved-row').filter({hasText:'Recovered Test A'});
  const workspaceBeforeUpdate = await page.evaluate(()=>JSON.stringify({houses:__denverTerritoryPlannerAPI.getHouses(),territories:__denverTerritoryPlannerAPI.getTerritories(),plan:__denverTerritoryPlannerAPI.getCurrentPlanId()}));
  await page.evaluate(()=>{window.failArchiveSave=true;});
  await page.locator('#updateSavedPdfsButton').click();
  await page.waitForFunction(()=>document.querySelector('#savedPdfUpdateStatus').dataset.state==='error');
  assert.equal(await recoveredRow.getByRole('button',{name:'Original PDF',exact:true}).count(),0);
  assert.match(await recoveredRow.innerText(),/Earlier format/);
  await page.evaluate(()=>{window.failArchiveSave=false;});
  const recoveredPdfDownload=page.waitForEvent('download');
  await recoveredRow.getByRole('button',{name:'Download PDF',exact:true}).click();
  await (await recoveredPdfDownload).saveAs(resolve(output,'recovery-updated.pdf'));
  assert.notDeepEqual(await readFile(resolve(output,'recovery-updated.pdf')),originalBytes);
  assert.match(await recoveredRow.innerText(),/Updated format.*Street-grouped addresses.*5 coffee stops/);
  assert.equal(await page.evaluate(()=>JSON.stringify({houses:__denverTerritoryPlannerAPI.getHouses(),territories:__denverTerritoryPlannerAPI.getTerritories(),plan:__denverTerritoryPlannerAPI.getCurrentPlanId()})),workspaceBeforeUpdate);
  const originalDownload=page.waitForEvent('download');
  await recoveredRow.getByRole('button',{name:'Original PDF',exact:true}).click();
  await (await originalDownload).saveAs(resolve(output,'recovery-original.pdf'));
  assert.deepEqual(await readFile(resolve(output,'recovery-original.pdf')),originalBytes);
  // A later layout migration updates in place and retains the first original.
  const recoveredArchiveId = await recoveredRow.locator('[data-download-territory-pdf]').getAttribute('data-download-territory-pdf');
  await page.evaluate(id=>markPdfOldForTest(id),recoveredArchiveId);
  await page.locator('#updateSavedPdfsButton').click();
  await page.waitForFunction(()=>document.querySelector('#savedPdfUpdateStatus').textContent.startsWith('All 1 saved PDFs updated'));
  assert.equal(await page.locator('#savedTerritoryPdfs .saved-row').count(),2,'Updating keeps the same rows, without duplicate exports');
  await page.reload(); await ready();
  await recoveredRow.getByRole('button',{name:'Original PDF',exact:true}).waitFor();
  const freshUpdated=page.waitForEvent('download');
  await recoveredRow.getByRole('button',{name:'Download PDF',exact:true}).click();
  await (await freshUpdated).saveAs(resolve(output,'recovery-updated-reloaded.pdf'));
  const freshOriginal=page.waitForEvent('download');
  await recoveredRow.getByRole('button',{name:'Original PDF',exact:true}).click();
  await (await freshOriginal).saveAs(resolve(output,'recovery-original-reloaded.pdf'));
  assert.deepEqual(await readFile(resolve(output,'recovery-original-reloaded.pdf')),originalBytes);
  // Edit the exact earlier PDF selected from the all-saved-territories layer.
  const retainedBeforeEdit = await page.evaluate(()=>localStorage.getItem('isolated-saving-test'));
  const currentBeforeEdit = await page.evaluate(()=>JSON.stringify({houses:__denverTerritoryPlannerAPI.getHouses(),territories:__denverTerritoryPlannerAPI.getTerritories(),plan:__denverTerritoryPlannerAPI.getCurrentPlanId()}));
  await page.locator('#showAllSavedTerritories').click();
  await page.locator('#savedTerritoriesList [data-saved-index]').first().click();
  const oldVersion = await page.locator('#savedTerritoryVersion option').evaluateAll(options=>options.find(option=>option.textContent.includes('Original PDF'))?.value);
  assert.ok(oldVersion, 'The original PDF is offered in the retained history');
  await page.locator('#savedTerritoryVersion').selectOption(oldVersion);
  allowReplace = false;
  await page.locator('#editSavedTerritory').click();
  assert.equal(await page.evaluate(()=>JSON.stringify({houses:__denverTerritoryPlannerAPI.getHouses(),territories:__denverTerritoryPlannerAPI.getTerritories(),plan:__denverTerritoryPlannerAPI.getCurrentPlanId()})),currentBeforeEdit);
  allowReplace = true;
  await page.locator('#editSavedTerritory').click();
  await page.locator('#savedTerritoryEditCard').waitFor({state:'visible'});
  assert.equal(await page.locator('#savedTerritoriesPanel').isVisible(),false);
  assert.equal(await page.locator('#savedTerritoryEditName').innerText(),'Recovered Test A');
  assert.equal(await page.evaluate(()=>__denverTerritoryPlannerAPI.getCurrentPlanId()),null);
  await page.locator('#editSavedTerritoryBoundaryButton').click();
  await page.locator('#territoryEditActions').waitFor({state:'visible'});
  assert.ok(await page.locator('.leaflet-editing-icon').count(), 'The saved polygon has editable handles');
  // Move the selected polygon's right edge inward, excluding one column of homes.
  await page.evaluate(()=>{
    const api=__denverTerritoryPlannerAPI, editing=[];
    api.getMap().eachLayer(layer=>{if(layer._denverTerritoryId==='test-a' && layer.setLatLngs) editing.push(layer);});
    if(!editing.length)throw Error('Editable boundary was not found');
    editing[0].setLatLngs([[39.579,-104.942],[39.579,-104.9388],[39.584,-104.9388],[39.584,-104.942]]);
    api.getHouses().find(h=>h.id==='test-home-0').address='1200 Corrected Sample Street';
  });
  const revisedDownload = page.waitForEvent('download',{timeout:120000});
  await page.locator('#saveEditedTerritoryPdfButton').click();
  await (await revisedDownload).saveAs(resolve(output,'edited-saved-territory.pdf'));
  await page.waitForFunction(()=>document.querySelector('#savedTerritoryEditStatus')?.dataset.state==='success');
  assert.equal(await page.locator('#territoryEditActions').isVisible(),false,'Saving the PDF also applies open boundary handles');
  const savedAfterEdit = await page.evaluate(()=>JSON.parse(localStorage.getItem('isolated-saving-test')));
  const recordsAfterEdit = new Map(savedAfterEdit);
  for(const [key,value] of JSON.parse(retainedBeforeEdit)) assert.deepEqual(recordsAfterEdit.get(key),value,'Earlier saved records stay unchanged');
  const newRecords = savedAfterEdit.filter(([key])=>!new Map(JSON.parse(retainedBeforeEdit)).has(key)).map(([,value])=>value);
  const newPdf = newRecords.find(record=>record.recordType==='territory-pdf');
  assert.ok(newPdf); assert.equal(newPdf.territoryId,'test-a'); assert.equal(newPdf.houseCount,3);
  assert.notEqual(newPdf.planId,originalPlanId);
  const pdfSnapshot = JSON.parse(newPdf.snapshotPartIds.map(id=>recordsAfterEdit.get('reviews/'+id).data).join(''));
  assert.ok(pdfSnapshot.houses.some(h=>h.address==='1200 Corrected Sample Street'));
  assert.equal(Math.max(...pdfSnapshot.territory.geometry.coordinates[0].map(p=>p[0])),-104.9388);
  await page.locator('#savedTerritoryEditCard').scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(output,'edit-saved-territory.png')});
  await page.reload(); await ready();
  await page.locator('#savedTerritoryPdfs [data-load-territory-pdf]').first().click();
  await page.locator('#savedTerritoryEditCard').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>__denverTerritoryPlannerAPI.getTerritories()[0].houseIds.length),3);
  assert.ok(await page.evaluate(()=>__denverTerritoryPlannerAPI.getHouses().some(h=>h.address==='1200 Corrected Sample Street')));
  await page.locator('#savedTerritoryPdfs').scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(output,'saved-library.png')});
  assert.deepEqual(pageErrors,[]);
  await writeFile(resolve(output,'result.txt'),'PASS: Plan/PDF saving, recovery, automatic saved-PDF upgrades, batch upgrades, failed-upgrade retry, unchanged current workspace, no duplicate rows, updated files after reload, and byte-identical original PDF downloads.');
  console.log('Browser saving passed: export and recovery; automatic and batch PDF upgrades; failed-upgrade retry; original PDF preserved; updated files after reload; unchanged workspace and no duplicate rows.');
} catch (error) {
  console.error(JSON.stringify({pageErrors,consoleErrors,body:(await page.locator('body').innerText()).slice(-4000)},null,2));
  throw error;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}

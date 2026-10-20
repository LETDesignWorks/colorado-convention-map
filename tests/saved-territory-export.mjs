// Exercise the production PDF action with an isolated renderer/archive adapter.
// This verifies edit -> snapshot -> plan save -> new PDF ordering without CDN access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../territories/territory-flex-grouping-pdf.js', import.meta.url), 'utf8');
const action = source.slice(source.indexOf('async function generateTerritoryPdf('), source.indexOf('\nfunction captureActions('));
const calls = [], feedback = { textContent: '', dataset: {} }, notices = [], events = [];
const geometry = x => ({ type: 'Polygon', coordinates: [[[x,39],[x+.01,39],[x+.01,39.01],[x,39]]] });
let territory = { id: 'saved-1', name: 'Saved Territory', geometry: geometry(-105) };
let houses = [{ id: 'home', address: '100 Example St', included: true, lat: 39, lng: -105, territoryId: 'saved-1' }];
let failPlan = false, failArchive = false, finish = true;
const context = vm.createContext({
  console: { error() {} }, JSON, Blob,
  Element: class {}, CustomEvent: class { constructor(type, options) { this.type=type; this.detail=options.detail; } },
  window: { dispatchEvent: event => events.push(event) },
  document: { getElementById: () => feedback }, jspdf: { jsPDF: class {} },
  planner: {
    requireAdmin: () => true,
    async finishTerritoryBoundaryEdit(id) { calls.push('finish boundary'); assert.equal(id,territory.id); if(finish) territory.geometry=geometry(-104.9); return finish; },
    dedupeHouses: () => 0, getTerritories: () => [territory], getHouses: () => houses,
    async savePlan() { calls.push('save plan'); return failPlan ? null : 'revision-plan'; },
    async saveTerritoryPdf(blob,filename,snapshot,planId) { calls.push('archive'); if(failArchive) throw Error('Archive unavailable'); assert.equal(planId,'revision-plan'); assert.equal(snapshot.territory.geometry.coordinates[0][0][0],-104.9); }
  },
  validCoordinates: () => true, pointInsideGeometry: () => true, sortedByAddress: values => values,
  pdfHouseNumber: () => '100', relevantAvoids: values => values, territoryGeometry: item => item.geometry,
  selectedHall: () => ({id:'hall'}), selectedCongregation: () => 'Test Congregation',
  statusPill: () => ({textContent:''}), hideStatus() {}, toast: message => notices.push(message),
  async buildTerritoryPdf(snapshot) { calls.push('render'); assert.equal(snapshot.territory.geometry.coordinates[0][0][0],-104.9); return {blob:new Blob(['test PDF']),filename:'revised.pdf',snapshot}; },
  triggerDownload() { calls.push('download'); }
});
vm.runInContext('let pdfBusy=false;\n'+action+'\nglobalThis.generate=generateTerritoryPdf;',context);
const button = {textContent:'Save Updated Territory & PDF',disabled:false};
await context.generate('saved-1',button);
assert.deepEqual(calls,['finish boundary','save plan','render','archive','download']);
assert.equal(feedback.dataset.state,'success');
assert.equal(events[0].type,'territory-planner:pdf-saved');
assert.equal(events[0].detail.territoryId,'saved-1');
assert.equal(button.disabled,false); assert.equal(button.textContent,'Save Updated Territory & PDF');

calls.length=0; events.length=0; failPlan=true;
await context.generate('saved-1',button);
assert.deepEqual(calls,['finish boundary','save plan']); assert.equal(events.length,0);
failPlan=false; failArchive=true; calls.length=0;
await context.generate('saved-1',button);
assert.deepEqual(calls,['finish boundary','save plan','render','archive','download']);
assert.equal(feedback.dataset.state,'error'); assert.equal(events.length,0);
assert.match(feedback.textContent,/library copy could not be saved/);
failArchive=false; finish=false; calls.length=0;
await context.generate('saved-1',button);
assert.deepEqual(calls,['finish boundary']);
console.log('Updated PDF action verified: finish active handles before snapshot, save plan then archive, preserve territory ID, success notification, failed-plan stop, archive-failure recovery.');

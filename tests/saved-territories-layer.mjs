// Exercise the real UI controller with deterministic DOM/Leaflet adapters.
// Every workspace control is a sentinel; any saved-record write throws.
import assert from 'node:assert/strict';
import { mountSavedTerritories } from '../territories/saved-territories-layer.js';

const elements = new Map();
class Element {
  constructor(id = '', dataset = {}) {
    this.id = id; this.dataset = dataset; this.events = {}; this.children = []; this.style = {};
    this.hidden = false; this.disabled = false; this.isConnected = true; this.value = ''; this.attributes = {};
    if (id) elements.set(id, this);
  }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  async fire(type, value) { if (value !== undefined) this.value = value; for (const fn of this.events[type] || []) await fn({ currentTarget: this, target: this }); }
  async click() { assert.ok(!this.disabled); await this.fire('click'); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { document.activeElement = this; }
  removeChildren() {
    for (const child of this.children) { child.removeChildren(); child.isConnected = false; if (child.id && elements.get(child.id) === child) elements.delete(child.id); }
    this.children = [];
  }
  set innerHTML(value) {
    this.removeChildren(); this.html = value;
    for (const match of value.matchAll(/<(?:button|select|p|div|section)\b([^>]*)>/g)) {
      const attrs = match[1], id = attrs.match(/\bid="([^"]+)"/)?.[1] || '';
      const index = attrs.match(/data-saved-index="([^"]+)"/)?.[1];
      const node = new Element(id, index === undefined ? {} : { savedIndex: index });
      node.disabled = /\bdisabled\b/.test(attrs); this.children.push(node);
    }
  }
  get innerHTML() { return this.html || ''; }
  replaceChildren(...children) { this.removeChildren(); this.children = children; this.html = ''; }
  querySelectorAll(selector) { return selector === '[data-saved-index]' ? this.children.filter(c => c.dataset.savedIndex !== undefined) : []; }
}
globalThis.document = { getElementById: id => elements.get(id), createElement: () => new Element(), createTextNode: value => Object.assign(new Element(), { textContent: value }) };
globalThis.window = new EventTarget();
for (const id of ['savedTerritoriesCard','showAllSavedTerritories','hideSavedTerritories','refreshSavedTerritories','savedTerritoriesStatus','savedTerritoriesList','savedTerritoryDetail','savedTerritoriesPanel','zoomSavedTerritories','latestSavedTerritories','savedTerritoriesHall','savedTerritoriesProblems']) new Element(id);
const el = id => elements.get(id), tick = () => new Promise(resolve => setImmediate(resolve));
const workspace = { houses: [{ id: 'unsaved', address: 'Unsaved address' }], territories: [{ id: 'current', name: 'Unsaved territory' }],
  boundary: { unsaved: true }, currentPlanId: null, selectedHouseIds: ['unsaved'], focusedTerritoryId: 'current', activeEditId: 'current',
  planName: 'Unsaved plan', boundaryName: 'Unsaved boundary', manualHouseMode: true, generation: 11 };
const before = JSON.stringify(workspace);
const editable = new Set(['current outline', 'current addresses', 'current edit handles']);
const editableBefore = [...editable];
const overlays = new Set(), panes = new Map();
let fitCount = 0;
const map = { getPane: name => panes.get(name), createPane: name => { const pane = { style: {} }; panes.set(name, pane); return pane; },
  removeLayer: layer => overlays.delete(layer), fitBounds: () => { fitCount++; } };
let group;
const vectors = [];
const L = {
  featureGroup() { group = { children: [], addTo() { overlays.add(this); return this; }, clearLayers() { this.children = []; }, getBounds() { return { isValid: () => !!this.children.length }; } }; return group; },
  geoJSON(geometry, options) {
    const child = { bindTooltip(value) { this.tooltip = value; }, on(type, handler) { this[type] = handler; } };
    const vector = { geometry, options, child, eachLayer(fn) { fn(child); }, addTo(target) { target.children.push(this); return this; }, getBounds: () => ({ isValid: () => true }) };
    vectors.push(vector); return vector;
  }, DomEvent: { stopPropagation(event) { event.stopped = true; } }
};
const geometry = x => ({ type: 'Polygon', coordinates: [[[x,39],[x+.01,39],[x+.01,39.01],[x,39]]] });
let admin = true, hall = { id: 'a', name: 'Meeting place A' }, recordStatus = 'ready', holdSnapshot = null, holdPdf = null;
const record = (id, tid, time, x) => ({ id, recordType: 'territory-pdf', hallId: 'a', territoryId: tid, territoryName: 'Same Name', updatedAt: time, x });
const records = new Map([record('old', 'one', '2021-01-01', -105.1), record('new', 'one', '2026-01-01', -105), record('different', 'two', '2024-01-01', -104.9)].map(r => [r.id, r]));
const recordsBefore = JSON.stringify([...records]);
const reader = async r => {
  if (holdSnapshot) await holdSnapshot;
  return { hall: { id: r.hallId }, congregation: 'Test congregation', territory: { id: r.territoryId, name: '<script>Same Name</script>', geometry: geometry(r.x) },
    houses: [{ id: 'saved-home', address: '100 Example St', territoryId: r.territoryId, lat: 39, lng: r.x }] };
};
let pdfReads = 0;
mountSavedTerritories({ map, getHall: () => hall, isAdmin: () => admin, getRecords: () => new Map(records), getStatus: () => recordStatus,
  readSnapshot: reader, readPdf: async () => { pdfReads++; if (holdPdf) await holdPdf; return new Blob(['exact PDF']); }, L, turf: {} });
const invariant = () => { assert.equal(JSON.stringify(workspace), before); assert.deepEqual([...editable], editableBefore); assert.equal(JSON.stringify([...records]), recordsBefore); };
assert.equal(el('showAllSavedTerritories').disabled, false);
await el('showAllSavedTerritories').click(); await tick();
assert.equal(group.children.length, 2); assert.equal(overlays.size, 1); assert.equal(fitCount, 0, 'show must not move current viewport');
assert.match(el('savedTerritoriesStatus').textContent, /2 saved territories/);
assert.ok(group.children.some(l => l.geometry.coordinates[0][0][0] === -105));
assert.ok(group.children.every(l => l.options.bubblingMouseEvents === false));
const clickEvent = { originalEvent: {} };
group.children.find(l => l.geometry.coordinates[0][0][0] === -105).child.click(clickEvent);
assert.equal(clickEvent.originalEvent.stopped, true, 'saved click must not trigger manual-house or selection clicks');
assert.equal(el('savedTerritoryDetail').hidden, false);
assert.match(el('savedTerritoryDetail').innerHTML, /&lt;script&gt;/, 'saved names are escaped');
await el('savedTerritoryVersion').fire('change', '1');
assert.ok(group.children.some(l => l.geometry.coordinates[0][0][0] === -105.1), 'earlier boundary appears');
await el('zoomSavedTerritory').click(); assert.equal(fitCount, 1);
await el('openSavedTerritoryPdf').click(); assert.equal(pdfReads, 1);
assert.equal(el('savedTerritoryPdfLinks').children[0].textContent, 'View PDF in new tab');
assert.equal(el('savedTerritoryPdfLinks').children[2].textContent, 'Download this saved PDF');
invariant();
await el('latestSavedTerritories').click();
assert.ok(group.children.some(l => l.geometry.coordinates[0][0][0] === -105));
await el('hideSavedTerritories').click();
assert.equal(group.children.length, 0); assert.equal(overlays.size, 0); assert.equal(el('savedTerritoriesPanel').hidden, true); invariant();

// Hiding during a pending snapshot must not resurrect the layer.
let release;
holdSnapshot = new Promise(resolve => { release = resolve; });
await el('showAllSavedTerritories').click(); await el('hideSavedTerritories').click(); release(); holdSnapshot = null; await tick();
assert.equal(group.children.length, 0); assert.equal(overlays.size, 0);
await el('showAllSavedTerritories').click(); await tick();
group.children[0].child.click({});
holdPdf = new Promise(resolve => { release = resolve; });
const pending = el('openSavedTerritoryPdf').click();
admin = false; window.dispatchEvent(new Event('territory-planner:data')); release(); holdPdf = null; await pending; await tick();
assert.equal(overlays.size, 0); assert.equal(group.children.length, 0); assert.equal(el('showAllSavedTerritories').disabled, true);
assert.equal(el('savedTerritoryPdfLinks'), undefined, 'late PDF cannot re-expose private data after sign-out'); invariant();

admin = true; window.dispatchEvent(new Event('territory-planner:data'));
await el('showAllSavedTerritories').click(); await tick();
hall = { id: 'b', name: 'Meeting place B' }; window.dispatchEvent(new Event('territory-planner:data')); await tick();
assert.equal(group.children.length, 0, 'old Hall outlines removed');
assert.match(el('savedTerritoriesList').innerHTML, /No saved territories/);
hall = { id: 'a', name: 'Meeting place A' }; window.dispatchEvent(new Event('territory-planner:data')); await tick();
assert.equal(group.children.length, 2);
recordStatus = 'cached'; window.dispatchEvent(new Event('territory-planner:saved-records')); await tick();
assert.match(el('savedTerritoriesStatus').textContent, /cached records/);
invariant();
console.log('Layer controls passed: show/hide, isolated outlines, click propagation, escaped names, earlier geometry, exact PDF link, latest reset, zoom, pending reads, Hall switching, sign-out, cached status; workspace unchanged throughout.');

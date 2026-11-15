import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {workKey} from '../territories/saved-work-model.js';
import {chooseMeetingPlan, latestMeetingBoundary, createMeetingBoundaryFlow, homeFingerprint, mappedHome, outsideHomes} from '../territories/meeting-place-model.js';

const planner = fs.readFileSync(new URL('../territories/app-main.js', import.meta.url), 'utf8');
const directions = fs.readFileSync(new URL('../territories/directions.js', import.meta.url), 'utf8');
function actualFunction(source, name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `Missing production function ${name}`);
  const end = source.indexOf('\n}', match.index);
  assert.ok(end > match.index, `Missing function end for ${name}`);
  return source.slice(match.index, end + 2);
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({defer = false} = {}) {
  const views = [], mapEvents = new Map(), paintQueue = [], notices = [], created = [];
  let zoom = 10, clears = 0, confirmation = true;
  const map = {
    setView(point, nextZoom) { zoom = nextZoom; views.push({point: Array.from(point), zoom}); return this; },
    getZoom: () => zoom, stop() {}, on(name, fn) { mapEvents.set(name, fn); return this; }
  };
  const group = () => ({items: [], addTo() { return this; }, clearLayers() { this.items = []; }});
  const marker = point => ({point, events: {}, addTo(layer) { layer.items.push(this); return this; },
    bindPopup() { return this; }, on(name, fn) { this.events[name] = fn; return this; },
    getLatLng() { return {lat: this.point[0], lng: this.point[1]}; }});
  const landmarks = [marker([39.74248, -104.99567]), marker([39.624, -104.905])];
  const list = {
    rows: [], set innerHTML(html) { this.rows = [...html.matchAll(/data-house-id="([^"]+)"/g)].map(match => ({
      dataset: {houseId: match[1]}, addEventListener(name, fn) { this[name] = fn; }
    })); }, querySelectorAll() { return this.rows; }
  };
  const context = vm.createContext({
    map, canvasRenderer: null, boundaryGroup: null, territoryGroup: null, territoryEditGroup: null,
    houseGroup: null, hallGroup: null, hallMarkers: new Map(), houseMarkers: new Map(),
    selectedHall: null, selectedCongregation: '', boundaryGeometry: null, houses: [], territories: [],
    selectedHouseIds: new Set(), hallSelectionSequence: 0, manualHouseMode: false, drawMode: null,
    hallLocations: [{id: 'a', name: 'Meeting A', lat: 39.5, lng: -105}, {id: 'b', name: 'Meeting B', lat: 40, lng: -104.5}],
    els: {hallSelect: {value: ''}, hallDetail: {}, houseSearch: {value: ''}, houseList: list, addHouseButton: {}},
    L: {canvas: () => ({}), map: () => map, tileLayer: group, featureGroup: group, marker,
      circleMarker: marker, Draw: {Event: {CREATED: 'draw:created', EDITED: 'draw:edited', EDITSTOP: 'draw:editstop', DRAWSTOP: 'draw:drawstop'}},
      DomEvent: {stopPropagation(event) { event.stopped = true; }}},
    addLandmarkReferences: () => ({eachLayer(fn) { landmarks.forEach(fn); }}),
    hallIcon: () => ({}), markerLabel: location => location.id, escapeHtml: String,
    locationTypeLabel: () => 'Meeting point', distanceMiles: () => 1, CCC: [39.74248, -104.99567],
    populateCongregations() {}, inferSourceForLocation: () => 'manual', updateSourceDetail() {},
    updateSummary() {}, emitPlannerDataChange() {}, startLoading() {}, stopLoading() {},
    paintBeforeWork: () => defer ? new Promise(resolve => paintQueue.push(resolve)) : Promise.resolve(),
    confirm: () => confirmation,
    clearPlanWorkspace() { clears++; context.houses = []; context.territories = []; context.boundaryGeometry = null; },
    visibleMapHouses: () => context.houses, houseStyle: () => ({}), mapHouseIsUploaded: () => false,
    updateMapHouseDisplayNotice() {}, updateSelectionUi() {},
    HOUSE_LIST_LIMIT: 350, TERRITORY_COLORS: ['blue'], clean: value => String(value ?? '').trim(),
    compareStreetAddresses: (a, b) => a.address.localeCompare(b.address),
    streetAddressInfo: house => ({key: house.address, name: house.address}),
    prompt: () => '123 Test Street', uniqueId: () => 'manual-test', addHouseRecord: point => created.push(point),
    renderAllPlanningData() {}, toast: (...args) => notices.push(args), clearTimeout, setTimeout
  });
  for (const name of ['validMapCoordinates', 'focusMapPoint', 'initMap', 'selectHall', 'renderHallMarkers',
    'selectHallWithFeedback', 'evenlySampleHouses', 'renderHouseMarkers', 'renderHouseList', 'toggleHouseSelection']) {
    vm.runInContext(actualFunction(planner, name), context);
  }
  context.initMap(); views.length = 0;
  return {context, views, mapEvents, paintQueue, landmarks, list, created,
    clears: () => clears, confirm: value => { confirmation = value; }};
}

test('meeting markers focus their area and preserve an already closer view', async () => {
  const f = fixture(); f.context.renderHallMarkers();
  f.context.hallMarkers.get('a').events.click(); await tick();
  assert.deepEqual(f.views.at(-1), {point: [39.5, -105], zoom: 15});
  f.context.map.setView([39.5, -105], 18);
  f.context.hallMarkers.get('b').events.click(); await tick();
  assert.equal(f.context.selectedHall.id, 'b');
  assert.deepEqual(f.views.at(-1), {point: [40, -104.5], zoom: 18});
});

test('canceling a meeting change preserves the workspace and current view', async () => {
  const f = fixture(); await f.context.selectHallWithFeedback('a');
  const unsaved = [{id: 'house', address: 'Unsaved home', lat: 39.6, lng: -105}];
  f.context.houses = unsaved; f.confirm(false); f.views.length = 0;
  f.context.hallMarkers.get('b').events.click(); await tick();
  assert.equal(f.context.selectedHall.id, 'a'); assert.equal(f.context.els.hallSelect.value, 'a');
  assert.equal(f.context.houses, unsaved); assert.equal(f.clears(), 0); assert.equal(f.views.length, 0);
});

test('rapid meeting choices allow only the newest queued selection to focus', async () => {
  const f = fixture({defer: true});
  const first = f.context.selectHallWithFeedback('a'), latest = f.context.selectHallWithFeedback('b');
  f.paintQueue[1](); await latest; f.paintQueue[0](); await first;
  assert.equal(f.context.selectedHall.id, 'b');
  assert.deepEqual(f.views, [{point: [40, -104.5], zoom: 15}]);
});

test('address marker and directory row clicks focus the address while toggling selection', () => {
  const f = fixture();
  f.context.houses = [{id: 'home', address: '123 A Street', lat: 39.61, lng: -105.02, included: true}];
  f.context.renderHouseMarkers(); const event = {};
  f.context.houseMarkers.get('home').events.click(event);
  assert.equal(event.stopped, true); assert.equal(f.context.selectedHouseIds.has('home'), true);
  assert.deepEqual(f.views.at(-1), {point: [39.61, -105.02], zoom: 17});
  f.context.map.setView([0, 0], 19); f.list.rows[0].click();
  assert.equal(f.context.selectedHouseIds.has('home'), false);
  assert.deepEqual(f.views.at(-1), {point: [39.61, -105.02], zoom: 19});
});

test('CCC and DTC references focus individually without changing the active meeting place', () => {
  const f = fixture(); f.context.selectHall('a');
  for (const landmark of f.landmarks) {
    landmark.events.click(); assert.equal(f.context.selectedHall.id, 'a');
    assert.deepEqual(f.views.at(-1), {point: landmark.point, zoom: 15});
  }
});

test('raw map clicks retain normal house placement and drawing behavior without auto-zoom', () => {
  const f = fixture(), click = f.mapEvents.get('click'), event = {latlng: {lat: 39.5, lng: -105}};
  click(event); assert.equal(f.created.length, 0); assert.equal(f.views.length, 0);
  f.context.manualHouseMode = true; f.context.drawMode = 'selection';
  click(event); assert.equal(f.created.length, 0); assert.equal(f.views.length, 0);
  f.context.drawMode = null; click(event);
  assert.equal(f.created.length, 1); assert.equal(f.context.manualHouseMode, false);
  assert.equal(f.created[0].lat, 39.5); assert.equal(f.created[0].lng, -105); assert.equal(f.views.length, 0);
});

test('missing or invalid coordinates do not move the map', () => {
  const f = fixture();
  for (const point of [null, {}, {lat: null, lng: -105}, {lat: 'bad', lng: -105}, {lat: 91, lng: -105}, {lat: 0, lng: 0}]) {
    assert.equal(f.context.focusMapPoint(point), false);
  }
  assert.equal(f.views.length, 0);
});

test('additional congregation meeting-point markers use the same focused selection as their list action', () => {
  const f = fixture(), points = new Map([['m', {id: 'm', name: 'Local meeting point', lat: 39.59, lng: -105.03}]]);
  const ctx = vm.createContext({map: f.context.map, api: {focusMapPoint: f.context.focusMapPoint},
    L: f.context.L, meetingLayer: {items: [], clearLayers() { this.items = []; }}, meetingMarkers: new Map(),
    meetingPoints: points, visibleMeetingPoints: () => [...points.values()],
    el: {origin: {value: ''}}, meetingPointIcon: () => ({}), esc: String, clean: value => String(value ?? '').trim(),
    populateDestinationOptions() {}, updateDirectionLinks() {}});
  vm.runInContext(actualFunction(directions, 'renderMeetingPointMarkers'), ctx);
  vm.runInContext(actualFunction(directions, 'useMeetingPoint'), ctx);
  ctx.renderMeetingPointMarkers(); ctx.meetingMarkers.get('m').events.click();
  assert.equal(ctx.el.origin.value, 'meeting:m');
  assert.deepEqual(f.views.at(-1), {point: [39.59, -105.03], zoom: 15});
});

test('late saved-address and boundary restoration retains the view; explicit loading still fits addresses', async () => {
  const source = fs.readFileSync(new URL('../territories/meeting-place-ui.js', import.meta.url), 'utf8');
  for (const withPlan of [true, false]) {
    const geometry = {type: 'Polygon', coordinates: [[[-105.1, 39.5], [-105, 39.5], [-105, 39.6], [-105.1, 39.5]]]};
    const records = new Map([['boundary', {id: 'boundary', recordType: 'territory-boundary', meetingPlaceBoundary: true,
      hallId: 'a', congregation: 'A', updatedAt: 1, boundary: geometry}]]);
    if (withPlan) records.set('work', {id: 'work', recordType: 'territory-plan', saveKind: 'work', hallId: 'a', congregation: 'A', updatedAt: 1});
    const elements = new Map(), events = new Map(), fits = [], options = [];
    const element = id => {
      if (!elements.has(id)) elements.set(id, {checked: true, value: '.12', textContent: '', disabled: false});
      return elements.get(id);
    };
    let homes = [], territories = [], boundary = null, generation = 0, ready = 'loading';
    const map = {fitBounds: value => fits.push(value), removeLayer() {}};
    const api = {getMap: () => map, getSavedRecords: () => records, getSavedRecordsStatus: () => ready,
      getSelectedHall: () => ({id: 'a', name: 'Meeting A'}), getSelectedCongregation: () => 'A',
      getWorkspaceGeneration: () => generation, isAdmin: () => true,
      getHouses: () => homes, getTerritories: () => territories, getBoundaryGeometry: () => boundary,
      loadPlanRecord(_id, focusOptions) {
        options.push(['plan', focusOptions.focus]); generation++;
        homes = [{id: 'home', address: '123 Test Street', lat: 39.55, lng: -105.05}]; territories = [{id: 'territory'}];
        return true;
      },
      setMeetingSearchBoundary(value, focusOptions) { options.push(['boundary', focusOptions.focus]); boundary = value; },
      saveMeetingPlaceBoundary() {}}
    const context = vm.createContext({
      __denverTerritoryPlannerAPI: api, document: {getElementById: element},
      window: {addEventListener: (name, fn) => events.set(name, fn)}, turf: {},
      L: {latLngBounds: points => points}, clearTimeout, setTimeout,
      startLoading() {}, stopLoading() {}, paintBeforeWork: () => Promise.resolve(),
      workKey, chooseMeetingPlan, latestMeetingBoundary, createMeetingBoundaryFlow, homeFingerprint, mappedHome, outsideHomes
    });
    vm.runInContext(source.slice(source.indexOf('let api, flow')), context);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(options, []);
    ready = 'ready'; events.get('territory-planner:saved-records')();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(options, withPlan ? [['plan', false], ['boundary', false]] : [['boundary', false]]);
    assert.equal(fits.length, 0, 'Shared records arriving in the background must not move the map');
    assert.equal(boundary.type, 'Polygon');
    if (withPlan) {
      await context.__denverMeetingPlaceFlow.restore(true);
      assert.deepEqual(options.slice(-2), [['plan', true], ['boundary', true]]);
      assert.equal(fits.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(fits[0])), [[39.55, -105.05]]);
    }
    context.__denverMeetingPlaceFlow.reset();
  }
});

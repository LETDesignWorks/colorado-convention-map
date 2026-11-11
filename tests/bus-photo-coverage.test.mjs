import test from 'node:test';
import assert from 'node:assert/strict';
import {photoCoverage, matchesPhotoCoverage, mountPhotoCoverage} from '../bus-access/photo-coverage.mjs';
import {revealLocationEditor} from '../bus-access/location-navigation.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const photo = (category, selected = true) => ({category, selected});
function harness({read = async () => [], deviceRead = async () => [], shared = true, admin = true} = {}) {
  let owner = 'admin', locations = ['1', '2', '3', '4'].map(id => ({id})), changes = 0;
  const controls = new Map(), events = new Map();
  const node = () => ({listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; }});
  const host = {...node(), hidden: true, setAttribute() {}, remove() {}, replaceChildren() { controls.clear(); },
    set innerHTML(value) {
      this.html = value;
      for (const name of ['summary', 'library', 'filter', 'refresh']) controls.set('[data-coverage-' + name + ']', node());
      controls.get('[data-coverage-filter]').options = ['all', 'missing', 'exterior', 'interior', 'both', 'complete', 'unknown'].map(value => ({value}));
    },
    querySelector(selector) { return controls.get(selector); }
  };
  const w = {addEventListener(type, fn) { events.set(type, fn); }, removeEventListener(type) { events.delete(type); }};
  const d = {createElement: () => host, getElementById: () => ({before() {}})};
  const api = mountPhotoCoverage({getLocations: () => locations, getOwner: () => owner, isAdmin: () => admin,
    createSharedStore: shared ? () => ({list: read}) : undefined,
    createDeviceStore: () => ({list: deviceRead}), onChange: () => changes++, document: d, window: w});
  return {api, host, controls, events,
    setAdmin(value) { admin = value; return api.contextChanged(); },
    setOwner(value) { owner = value; return api.contextChanged(); },
    setLocations(value) { locations = value; return api.contextChanged(); },
    choose(name, value) { const c = controls.get('[data-coverage-' + name + ']'); c.value = value; c.listeners.change({target: c}); },
    get summary() { return controls.get('[data-coverage-summary]')?.textContent; },
    get changes() { return changes; }};
}

test('counts all saved interior/exterior photos, independently of PDF selection', () => {
  const record = photoCoverage([photo('interior', false), photo('exterior'), photo('exterior', false)]);
  assert.deepEqual(record, {state: 'ready', interior: 1, exterior: 2, status: 'complete'});
  assert.equal(photoCoverage([]).status, 'both');
  assert.equal(photoCoverage([photo('interior')]).status, 'exterior');
  assert.equal(photoCoverage([photo('exterior')]).status, 'interior');
  assert.throws(() => photoCoverage(null));
});

test('missing filters never classify failed or loading reads as missing photos', () => {
  for (const record of [undefined, {state: 'loading'}, {state: 'error'}]) {
    for (const filter of ['missing', 'both', 'interior', 'exterior', 'complete']) assert.equal(matchesPhotoCoverage(record, filter), false);
    assert.equal(matchesPhotoCoverage(record, 'unknown'), true);
  }
  assert.equal(matchesPhotoCoverage(photoCoverage([]), 'interior'), true);
  assert.equal(matchesPhotoCoverage(photoCoverage([]), 'exterior'), true);
});

test('directory reports counts, filters by category, and preserves failures as unavailable', async () => {
  const rows = {'1': [photo('interior'), photo('exterior')], '2': [photo('interior')], '3': []};
  const h = harness({read: async id => { if (id === '4') throw Error('Offline'); return rows[id]; }});
  await tick();
  assert.equal(h.summary, '2 need photos · 1 complete · 1 unavailable');
  h.choose('filter', 'exterior');
  assert.deepEqual(['1','2','3','4'].filter(h.api.matches), ['2','3']);
  assert.match(h.api.badges('2'), /Exterior: missing/);
  assert.match(h.api.badges('4'), /unavailable/);
  h.choose('filter', 'unknown'); assert.deepEqual(['1','2','3','4'].filter(h.api.matches), ['4']);
  h.api.dispose();
});

test('saved additions/removals update coverage and stale refreshes cannot win', async () => {
  let records = [], slow, delay = false;
  const h = harness({read: async () => delay ? new Promise(resolve => slow = resolve) : records});
  await tick(); h.choose('filter', 'both'); assert.equal(h.api.matches('1'), true);
  delay = true;
  const first = h.api.refreshLocation({locationId: '1', library: 'shared', owner: 'admin'});
  delay = false; records = [photo('interior'), photo('exterior')];
  await h.api.refreshLocation({locationId: '1', library: 'shared', owner: 'admin'});
  slow([]); await first;
  assert.equal(h.api.matches('1'), false); assert.match(h.api.badges('1'), /Exterior: 1/);
  records = [];
  await h.api.refreshLocation({locationId: '1', library: 'shared', owner: 'admin'});
  assert.equal(h.api.matches('1'), true);
  h.api.dispose();
});

test('shared/device sources stay separate and refreshes from the other source are ignored', async () => {
  let deviceReads = 0;
  const h = harness({read: async () => [], deviceRead: async () => { deviceReads++; return [photo('exterior'), photo('interior')]; }});
  await tick(); assert.match(h.summary, /4 need photos/);
  h.choose('library', 'device'); await tick(); assert.match(h.summary, /4 complete/);
  await h.api.refreshLocation({locationId: '1', owner: 'admin', library: 'shared'});
  assert.equal(deviceReads, 4);
  h.api.dispose();
});

test('sign-out clears private status and discards pending results; public users do no reads', async () => {
  const pending = [];
  const h = harness({read: () => new Promise(resolve => pending.push(resolve))});
  await h.setAdmin(false);
  pending.forEach(resolve => resolve([photo('interior'), photo('exterior')]));
  await tick();
  assert.equal(h.host.hidden, true); assert.equal(h.api.badges('1'), ''); assert.equal(h.api.matches('1'), true);
  h.api.dispose();
  let reads = 0;
  const pub = harness({admin: false, read: async () => { reads++; return []; }});
  await tick(); assert.equal(reads, 0); assert.equal(pub.host.hidden, true); pub.api.dispose();
});

test('location changes add and remove coverage rows and refresh can recover failures', async () => {
  let failed = true;
  const h = harness({read: async () => { if (failed) throw Error('Offline'); return []; }});
  await tick(); assert.match(h.summary, /4 unavailable/);
  failed = false; await h.setLocations([{id:'new'}]);
  assert.equal(h.summary, '1 need photos · 0 complete');
  h.api.dispose();
});

test('desktop and mobile navigation reveals detail, honors sticky toolbar and reduced motion', () => {
  for (const mobile of [false, true]) {
    const calls = [], detail = {style: {}, setAttribute: (...args) => calls.push(['attribute', ...args]),
      focus: args => calls.push(['focus', args]), scrollIntoView: args => calls.push(['reveal', args])};
    revealLocationEditor({document: {
      getElementById: id => id === 'detail' ? detail : {scrollTo: args => calls.push(['panel', args])},
      querySelector: () => ({getBoundingClientRect: () => ({height: 140})})
    }, window: {matchMedia: () => ({matches: mobile}), getComputedStyle: () => ({position: mobile ? 'sticky' : 'static'})}});
    assert.equal(detail.style.scrollMarginTop, mobile ? '152px' : '12px');
    assert.deepEqual(calls.find(x => x[0] === 'focus')[1], {preventScroll: true});
    assert.deepEqual(calls.find(x => x[0] === 'panel')[1], {top: 0, behavior: mobile ? 'auto' : 'smooth'});
    assert.deepEqual(calls.find(x => x[0] === 'reveal')[1], {behavior: mobile ? 'auto' : 'smooth', block: 'start'});
  }
});


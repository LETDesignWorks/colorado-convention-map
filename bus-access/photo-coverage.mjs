import {createDevicePhotoStore} from './photos-model.mjs';

const FILTERS = [
  ['all', 'All photo statuses'], ['missing', 'Missing any photos'],
  ['exterior', 'Missing exterior'], ['interior', 'Missing interior'],
  ['both', 'Missing both'], ['complete', 'Complete'], ['unknown', 'Not checked / unavailable']
];

// Count saved photos, including photos excluded from PDF exports.
export function photoCoverage(records) {
  if (!Array.isArray(records)) throw Error('Photo library could not be read.');
  const interior = records.filter(photo => photo.category === 'interior').length;
  const exterior = records.filter(photo => photo.category === 'exterior').length;
  return {state: 'ready', interior, exterior,
    status: interior && exterior ? 'complete' : interior ? 'exterior' : exterior ? 'interior' : 'both'};
}
export function matchesPhotoCoverage(record, filter = 'all') {
  if (filter === 'all') return true;
  if (filter === 'unknown') return !record || record.state !== 'ready';
  if (record?.state !== 'ready') return false;
  if (filter === 'missing') return record.status !== 'complete';
  if (filter === 'interior' || filter === 'exterior') return record[filter] === 0;
  return record.status === filter;
}

export function mountPhotoCoverage({getLocations, getOwner, isAdmin, createSharedStore,
  createDeviceStore = createDevicePhotoStore, onChange = () => {},
  document: d = globalThis.document, window: w = globalThis.window}) {
  const host = d.createElement('section');
  host.className = 'photo-coverage'; host.hidden = true;
  host.setAttribute('aria-label', 'Location photo coverage');
  d.getElementById('hallList').before(host);
  let library = createSharedStore ? 'shared' : 'device', filter = 'all', context = '', epoch = 0, disposed = false;
  const records = new Map(), requests = new Map();
  const authorized = () => !disposed && isAdmin() && Boolean(getOwner());
  const contextKey = () => authorized() ? JSON.stringify([String(getOwner()), library, getLocations().map(x => String(x.id)).sort()]) : '';
  const valid = token => token === epoch && context === contextKey() && authorized();
  const store = () => library === 'shared' ? createSharedStore() : createDeviceStore({owner: String(getOwner()), indexedDB: w.indexedDB});
  const q = selector => host.querySelector(selector);
  function publish() {
    if (!authorized()) return;
    let missing = 0, complete = 0, checking = 0, unavailable = 0;
    for (const location of getLocations()) {
      const record = records.get(String(location.id));
      if (record?.state === 'ready') record.status === 'complete' ? complete++ : missing++;
      else if (record?.state === 'error') unavailable++;
      else checking++;
    }
    q('[data-coverage-summary]').textContent = `${missing} need photos · ${complete} complete${checking ? ` · ${checking} checking` : ''}${unavailable ? ` · ${unavailable} unavailable` : ''}`;
    for (const option of q('[data-coverage-filter]').options) {
      const label = FILTERS.find(([value]) => value === option.value)[1];
      const count = getLocations().filter(location => matchesPhotoCoverage(records.get(String(location.id)), option.value)).length;
      option.textContent = `${label} (${count})`;
    }
    q('[data-coverage-refresh]').disabled = checking > 0;
    onChange();
  }
  function template() {
    host.innerHTML = `<h4>Photo coverage <span class="private-chip">Administrator only</span></h4>
      <div class="coverage-controls">
        <label>Check photos in <select data-coverage-library aria-label="Photo coverage library">
          <option value="shared" ${createSharedStore ? '' : 'disabled'}>Shared storage${createSharedStore ? '' : ' — unavailable'}</option>
          <option value="device">This device</option></select></label>
        <label>Show locations <select data-coverage-filter aria-label="Filter locations by missing photos">${FILTERS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <button class="btn light" type="button" data-coverage-refresh>Refresh photo status</button>
      </div>
      <p class="coverage-help">${library === 'shared' ? 'Checks saved shared photos for every location. Device-only copies are separate.' : 'Checks photos saved in this browser only. Shared photos and other devices are separate.'} Counts include photos excluded from PDFs. Filters also apply to the map.</p>
      <p class="coverage-summary" data-coverage-summary role="status" aria-live="polite"></p>`;
    q('[data-coverage-library]').value = library;
    q('[data-coverage-filter]').value = filter;
    q('[data-coverage-library]').addEventListener('change', event => { library = event.target.value; contextChanged(true); });
    q('[data-coverage-filter]').addEventListener('change', event => { filter = event.target.value; onChange(); });
    q('[data-coverage-refresh]').addEventListener('click', () => contextChanged(true));
  }
  async function read(id, readingStore, token) {
    const request = (requests.get(id) || 0) + 1; requests.set(id, request);
    records.set(id, {state: 'loading'});
    try {
      const photos = await readingStore.list(id);
      if (!valid(token) || requests.get(id) !== request) return;
      records.set(id, photoCoverage(photos));
    } catch {
      if (!valid(token) || requests.get(id) !== request) return;
      records.set(id, {state: 'error'});
    }
    publish();
  }
  async function contextChanged(force = false) {
    const next = contextKey();
    if (!force && next === context) return;
    context = next; const token = ++epoch; records.clear(); requests.clear();
    host.hidden = !next;
    if (!next) { host.replaceChildren(); filter = 'all'; onChange(); return; }
    template();
    const ids = getLocations().map(location => String(location.id));
    ids.forEach(id => records.set(id, {state: 'loading'})); publish();
    let readingStore;
    try { readingStore = store(); }
    catch { ids.forEach(id => records.set(id, {state: 'error'})); publish(); return; }
    let index = 0;
    // Read metadata with bounded concurrency; do not download shared images.
    await Promise.all(Array.from({length: Math.min(4, ids.length)}, async () => {
      while (index < ids.length && valid(token)) await read(ids[index++], readingStore, token);
    }));
  }
  async function refreshLocation({locationId, owner, library: changedLibrary}) {
    if (!authorized() || String(owner) !== String(getOwner()) || changedLibrary !== library || !getLocations().some(x => String(x.id) === String(locationId))) return;
    const token = epoch, id = String(locationId);
    try { await read(id, store(), token); }
    catch { if (valid(token)) { records.set(id, {state: 'error'}); publish(); } }
  }
  function badges(id) {
    if (!authorized()) return '';
    const record = records.get(String(id));
    if (record?.state !== 'ready') return `<span class="coverage-badges"><span class="coverage-badge unknown">${record?.state === 'error' ? 'Photos unavailable — refresh to retry' : 'Checking photos…'}</span></span>`;
    return `<span class="coverage-badges">${['exterior', 'interior'].map(category => `<span class="coverage-badge ${record[category] ? 'complete' : 'missing'}">${category === 'exterior' ? 'Exterior' : 'Interior'}: ${record[category] || 'missing'}</span>`).join('')}</span>`;
  }
  const onFocus = () => { if (authorized()) contextChanged(true); };
  w.addEventListener('focus', onFocus);
  contextChanged();
  return {contextChanged, refreshLocation, badges,
    matches: id => !authorized() || matchesPhotoCoverage(records.get(String(id)), filter),
    dispose() { disposed = true; epoch++; records.clear(); requests.clear(); w.removeEventListener('focus', onFocus); host.remove(); }
  };
}


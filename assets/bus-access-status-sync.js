import {
  initializeApp,
  getApp,
  getApps
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getFirestore,
  collection,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

/**
 * Carries the public Bus Access Review status onto the same Kingdom Hall or
 * meeting-point marker wherever that location appears on the planning site.
 *
 * Approved locations are green. Locations marked Not Suitable are red.
 * Other review states keep the native color used by the individual map.
 */

const firebaseConfig = {
  apiKey: 'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',
  authDomain: 'convention-fs.firebaseapp.com',
  projectId: 'convention-fs',
  storageBucket: 'convention-fs.firebasestorage.app',
  messagingSenderId: '29365992209',
  appId: '1:29365992209:web:0bd35e723688b37d776ab0',
  measurementId: 'G-054BLBBE0F'
};

const STATUS = {
  approved: { label: 'Bus approved', color: '#0e9453', className: 'denver-bus-approved' },
  'not-suitable': { label: 'Not suitable for a bus', color: '#c9362b', className: 'denver-bus-not-suitable' }
};

const STYLE_ID = 'denver-2027-bus-status-sync-styles';
const LEGEND_CLASS = 'denver-2027-bus-status-key';
const APPLIED_CLASSES = Object.values(STATUS).map(item => item.className);

/* These are the marker and small directory-badge classes used by the current
   planning maps. The final selector is a guarded fallback for numbered Leaflet
   DivIcons in the large embedded planning map. An element is changed only when
   its label matches an actual public Bus Access Review record. */
const MARKER_SELECTOR = [
  '.meeting-map-pin',
  '.point-marker',
  '.meeting-marker-small',
  '.meeting-pin',
  '.location-pin',
  '.hall-pin',
  '.marker-pin',
  '.num',
  '.leaflet-marker-icon > div'
].join(',');

const REMOVE_FROM_LABEL = [
  '.assignment-count',
  '.point-count',
  '.count-sample',
  '.status-chip',
  '.distance-pill',
  '.territory-tag'
].join(',');

const statusByKey = new Map();
const attachedDocuments = new Set();
const observers = new Map();
const pendingScans = new WeakSet();

function normalizeKey(value = '') {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^#/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function addStatusKey(value, status) {
  const key = normalizeKey(value);
  if (key) statusByKey.set(key, status || 'not-reviewed');
}

function directText(element) {
  return Array.from(element?.childNodes || [])
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent || '')
    .join(' ')
    .trim();
}

function strippedText(element) {
  try {
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.(REMOVE_FROM_LABEL).forEach(node => node.remove());
    return String(clone.textContent || '').trim();
  } catch {
    return String(element?.textContent || '').trim();
  }
}

function keysFromText(value = '') {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return [];
  const keys = new Set();
  keys.add(normalizeKey(text));

  /* Most map markers begin with 11, M1, S2, etc. Do not reduce H17 or A1 to
     the bare number, which prevents hotel/activity markers from borrowing a
     Kingdom Hall status accidentally. */
  const leading = text.match(/^#?\s*([A-Z]{1,6}\s*-?\s*\d{1,4}|\d{1,4})(?:\b|\s|[.:—–-])/);
  if (leading) keys.add(normalizeKey(leading[1]));

  const namedHall = text.match(/\b(?:HALL|KINGDOM\s+HALL|LOCATION|MEETING\s+POINT)\s*#?\s*(\d{1,4})\b/);
  if (namedHall) keys.add(normalizeKey(namedHall[1]));

  return [...keys].filter(Boolean);
}

function candidateKeys(element) {
  const values = [
    element?.dataset?.busLocationId,
    element?.dataset?.locationId,
    element?.dataset?.hallId,
    element?.dataset?.meetingId,
    element?.dataset?.markerLabel,
    element?.getAttribute?.('data-location'),
    element?.getAttribute?.('data-id'),
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    directText(element),
    strippedText(element),
    element?.closest?.('.leaflet-marker-icon')?.getAttribute?.('title'),
    element?.parentElement?.getAttribute?.('aria-label')
  ].filter(Boolean);

  const keys = new Set();
  values.forEach(value => keysFromText(value).forEach(key => keys.add(key)));
  return [...keys];
}

function statusForElement(element) {
  for (const key of candidateKeys(element)) {
    if (statusByKey.has(key)) return statusByKey.get(key);
  }
  return '';
}

function installStyles(doc) {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .denver-bus-approved {
      background: ${STATUS.approved.color} !important;
      background-color: ${STATUS.approved.color} !important;
    }
    .denver-bus-not-suitable {
      background: ${STATUS['not-suitable'].color} !important;
      background-color: ${STATUS['not-suitable'].color} !important;
    }
    .denver-bus-approved svg,
    .denver-bus-approved svg path,
    .denver-bus-approved svg circle {
      fill: ${STATUS.approved.color};
    }
    .denver-bus-not-suitable svg,
    .denver-bus-not-suitable svg path,
    .denver-bus-not-suitable svg circle {
      fill: ${STATUS['not-suitable'].color};
    }
    .${LEGEND_CLASS} {
      display: flex !important;
      align-items: center !important;
      gap: 7px !important;
      font-size: 10px;
      line-height: 1.25;
    }
    .${LEGEND_CLASS} .denver-bus-status-dot {
      width: 17px;
      height: 17px;
      min-width: 17px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 0 0 1px #66788a;
      display: inline-block;
    }
    .${LEGEND_CLASS}.approved .denver-bus-status-dot { background: ${STATUS.approved.color}; }
    .${LEGEND_CLASS}.not-suitable .denver-bus-status-dot { background: ${STATUS['not-suitable'].color}; }
  `;
  doc.head.appendChild(style);
}

function legendAlreadyExplainsBusStatus(legend) {
  const text = String(legend?.textContent || '').toLowerCase();
  return text.includes('bus access') && text.includes('approved') && text.includes('not suitable');
}

function ensureLegend(doc) {
  const legend = doc.querySelector('.map-legend, .legend');
  if (!legend || legendAlreadyExplainsBusStatus(legend) || legend.querySelector(`.${LEGEND_CLASS}`)) return;

  const approved = doc.createElement('div');
  approved.className = `${LEGEND_CLASS} approved`;
  approved.innerHTML = '<span class="denver-bus-status-dot" aria-hidden="true"></span><span>Bus approved</span>';

  const unsuitable = doc.createElement('div');
  unsuitable.className = `${LEGEND_CLASS} not-suitable`;
  unsuitable.innerHTML = '<span class="denver-bus-status-dot" aria-hidden="true"></span><span>Not suitable for a bus</span>';

  legend.append(approved, unsuitable);
}

function clearAppliedStatus(element) {
  APPLIED_CLASSES.forEach(className => element.classList.remove(className));
  element.removeAttribute('data-bus-access-status');
  element.removeAttribute('data-bus-access-label');
  const wrapper = element.closest?.('.leaflet-marker-icon');
  if (wrapper && wrapper !== element) {
    wrapper.removeAttribute('data-bus-access-status');
    wrapper.removeAttribute('data-bus-access-label');
  }
}

function applyStatus(element, status) {
  clearAppliedStatus(element);
  const info = STATUS[status];
  if (!info) return false;

  element.classList.add(info.className);
  element.setAttribute('data-bus-access-status', status);
  element.setAttribute('data-bus-access-label', info.label);
  const wrapper = element.closest?.('.leaflet-marker-icon');
  if (wrapper && wrapper !== element) {
    wrapper.setAttribute('data-bus-access-status', status);
    wrapper.setAttribute('data-bus-access-label', info.label);
  }
  return true;
}

function scanDocument(doc) {
  if (!doc?.querySelectorAll) return;
  installStyles(doc);
  let matchedLocation = false;

  doc.querySelectorAll(MARKER_SELECTOR).forEach(element => {
    const status = statusForElement(element);
    if (status) matchedLocation = true;
    applyStatus(element, status);
  });

  if (matchedLocation) ensureLegend(doc);
  attachFrames(doc);
}

function scheduleScan(doc) {
  if (!doc || pendingScans.has(doc)) return;
  pendingScans.add(doc);
  const run = () => {
    pendingScans.delete(doc);
    scanDocument(doc);
  };
  const view = doc.defaultView;
  if (view?.requestAnimationFrame) view.requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function attachFrame(frame) {
  const attach = () => {
    try {
      if (frame.contentDocument) attachDocument(frame.contentDocument);
    } catch {
      /* Cross-origin frames are intentionally ignored. */
    }
  };
  if (!frame.dataset.denverBusStatusListener) {
    frame.dataset.denverBusStatusListener = 'true';
    frame.addEventListener('load', attach);
  }
  attach();
}

function attachFrames(doc) {
  doc.querySelectorAll?.('iframe').forEach(attachFrame);
}

function attachDocument(doc) {
  if (!doc || attachedDocuments.has(doc)) {
    if (doc) scheduleScan(doc);
    return;
  }
  attachedDocuments.add(doc);
  installStyles(doc);

  const begin = () => {
    scheduleScan(doc);
    attachFrames(doc);
    if (!doc.documentElement || observers.has(doc)) return;
    const Observer = doc.defaultView?.MutationObserver || MutationObserver;
    const observer = new Observer(() => scheduleScan(doc));
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    observers.set(doc, observer);
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
}

function applyEverywhere() {
  attachedDocuments.forEach(doc => {
    if (doc?.defaultView || doc === document) scheduleScan(doc);
  });
}

function loadPublicStatuses() {
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const db = getFirestore(app);
    onSnapshot(collection(db, 'halls'), snapshot => {
      statusByKey.clear();
      snapshot.forEach(record => {
        const data = record.data() || {};
        /* The halls collection also contains SMPW, rail-preference, and other
           planning records. Only actual Bus Access Review/location records are
           eligible for marker coloring. */
        if (!data.busStatus && data.customLocation !== true) return;
        if (data.recordType && data.recordType !== 'bus-access-location') return;

        const status = data.busStatus || 'not-reviewed';
        addStatusKey(record.id, status);
        addStatusKey(data.locationId, status);
        addStatusKey(data.hallId, status);
        addStatusKey(data.markerLabel, status);
        addStatusKey(data.number, status);
      });
      applyEverywhere();
      window.dispatchEvent(new CustomEvent('denver-bus-status-updated', {
        detail: { recordCount: statusByKey.size }
      }));
    }, error => console.warn('Public bus-access colors could not be loaded.', error));
  } catch (error) {
    console.warn('Public bus-access color synchronization could not start.', error);
  }
}

function start() {
  attachDocument(document);
  loadPublicStatuses();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

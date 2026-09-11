(() => {
  'use strict';

  const ADDRESS_MIN_LENGTH = 12;
  const AUTO_LOOKUP_DELAY_MS = 1350;
  const REQUEST_TIMEOUT_MS = 10000;
  const CACHE_KEY = 'southDtcRailAddressGeocodesV1';

  let debounceTimer = null;
  let lookupSequence = 0;
  let lastResolvedAddress = '';
  let lastRequestStartedAt = 0;
  let previewLayer = null;

  const get = id => document.getElementById(id);
  const addressInput = get('locationAddress');
  const latInput = get('locationLat');
  const lngInput = get('locationLng');
  const status = get('coordinateMessage');
  const locateButton = get('locationAddressButton');
  const form = get('addLocationForm');
  const modal = get('addLocationModal');

  if (!addressInput || !latInput || !lngInput || !status || !locateButton || !form || !modal) return;

  injectStyles();
  captureLeafletMap();
  const verifyLinks = createVerifyLinks();

  locateButton.textContent = 'Refresh Address Coordinates';
  locateButton.title = 'Locate the full address and update latitude and longitude';
  status.textContent = 'Enter a complete U.S. street address. After you pause typing, latitude and longitude will update automatically.';

  function injectStyles() {
    if (document.getElementById('address-autofill-styles')) return;
    const style = document.createElement('style');
    style.id = 'address-autofill-styles';
    style.textContent = `
      #coordinateMessage[data-state="working"] { color: #8a5c00; font-weight: 750; }
      #coordinateMessage[data-state="success"] { color: #17643f; font-weight: 750; }
      #coordinateMessage[data-state="error"] { color: #922f28; font-weight: 750; }
      #coordinateMessage[data-state="waiting"] { color: #59697c; }
      .address-verify-links { display:flex; flex-wrap:wrap; gap:8px; width:100%; margin-top:5px; }
      .address-verify-links a { color:#0b5b9f; font-size:10px; font-weight:800; text-decoration:none; }
      .address-verify-links a:hover { text-decoration:underline; }
    `;
    document.head.appendChild(style);
  }

  function captureLeafletMap() {
    if (!window.L || window.__southDtcRailMapCaptureInstalled) return;
    window.__southDtcRailMapCaptureInstalled = true;
    const originalMap = window.L.map;
    window.L.map = function (...args) {
      const map = originalMap.apply(this, args);
      const target = args[0];
      const isPlannerMap = target === 'map' || target?.id === 'map';
      if (isPlannerMap) {
        window.__southDtcRailMap = map;
        if (window.__southDtcPendingAddressPreview) {
          const pending = window.__southDtcPendingAddressPreview;
          window.__southDtcPendingAddressPreview = null;
          setTimeout(() => showPreview(pending), 0);
        }
      }
      return map;
    };
  }

  function createVerifyLinks() {
    const host = document.createElement('div');
    host.id = 'addressVerifyLinks';
    host.className = 'address-verify-links';
    host.hidden = true;
    status.insertAdjacentElement('afterend', host);
    return host;
  }

  function normalizeAddress(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function looksComplete(address) {
    if (address.length < ADDRESS_MIN_LENGTH) return false;
    if (!/^\s*\d+[A-Za-z-]?\s+/.test(address)) return false;
    const hasStateOrZip = /\b(?:CO|Colorado)\b/i.test(address) || /\b\d{5}(?:-\d{4})?\b/.test(address);
    const hasStreetWord = /\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|cir|circle|trl|trail|way|pkwy|parkway|hwy|highway|pl|place)\b/i.test(address);
    return hasStateOrZip && hasStreetWord;
  }

  function setStatus(message, state = 'waiting') {
    status.textContent = message;
    status.dataset.state = state;
  }

  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeCache(address, result) {
    try {
      const cache = readCache();
      cache[address.toLowerCase()] = result;
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Local storage may be unavailable in privacy mode; geocoding still works.
    }
  }

  function cachedResult(address) {
    return readCache()[address.toLowerCase()] || null;
  }

  function clearCoordinatesForChangedAddress() {
    const current = normalizeAddress(addressInput.value);
    if (!lastResolvedAddress || current.toLowerCase() === lastResolvedAddress.toLowerCase()) return;
    latInput.value = '';
    lngInput.value = '';
    verifyLinks.hidden = true;
    removePreview();
  }

  function dispatchCoordinateEvents() {
    for (const input of [latInput, lngInput]) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function showPreview(result) {
    const map = window.__southDtcRailMap;
    if (!map || !window.L) {
      window.__southDtcPendingAddressPreview = result;
      return;
    }
    if (previewLayer) {
      try { map.removeLayer(previewLayer); } catch { /* no-op */ }
    }
    previewLayer = window.L.circleMarker([result.lat, result.lng], {
      radius: 12,
      color: '#ffffff',
      weight: 4,
      fillColor: '#e77b18',
      fillOpacity: 1
    }).addTo(map);
    previewLayer.bindPopup(`<strong>Address preview</strong><br>${escapeHtml(result.matchedAddress || normalizeAddress(addressInput.value))}<br><small>Confirm this point before saving.</small>`).openPopup();
    map.setView([result.lat, result.lng], Math.max(map.getZoom(), 15), { animate: true });
  }

  function removePreview() {
    const map = window.__southDtcRailMap;
    if (previewLayer && map) {
      try { map.removeLayer(previewLayer); } catch { /* no-op */ }
    }
    previewLayer = null;
    window.__southDtcPendingAddressPreview = null;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function updateVerifyLinks(result) {
    const coordinate = `${Number(result.lat).toFixed(6)},${Number(result.lng).toFixed(6)}`;
    const google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinate)}`;
    const apple = `https://maps.apple.com/?ll=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(result.matchedAddress || 'Meeting point')}`;
    verifyLinks.innerHTML = `<a href="${google}" target="_blank" rel="noopener">Verify in Google Maps</a><a href="${apple}" target="_blank" rel="noopener">Verify in Apple Maps</a>`;
    verifyLinks.hidden = false;
  }

  function applyResult(address, result, sourceLabel) {
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('The address service returned invalid coordinates.');

    latInput.value = lat.toFixed(6);
    lngInput.value = lng.toFixed(6);
    lastResolvedAddress = address;
    dispatchCoordinateEvents();
    showPreview({ ...result, lat, lng });
    updateVerifyLinks({ ...result, lat, lng });
    setStatus(`Coordinates updated from ${sourceLabel}: ${result.matchedAddress || address}. Confirm the orange preview marker before saving.`, 'success');
  }

  function censusGeocode(address, sequence) {
    return new Promise((resolve, reject) => {
      const callbackName = `__southDtcCensusGeocode_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        script.remove();
        try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('The U.S. Census address service timed out.'));
      }, REQUEST_TIMEOUT_MS);

      window[callbackName] = payload => {
        if (sequence !== lookupSequence) {
          cleanup();
          reject(new Error('Address changed before the lookup finished.'));
          return;
        }
        const match = payload?.result?.addressMatches?.[0];
        const coordinates = match?.coordinates;
        cleanup();
        if (!coordinates) {
          reject(new Error('No Census address match was found.'));
          return;
        }
        resolve({
          lat: Number(coordinates.y),
          lng: Number(coordinates.x),
          matchedAddress: match.matchedAddress || address,
          source: 'U.S. Census Geocoder'
        });
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('The U.S. Census address service could not be reached.'));
      };

      const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
      url.searchParams.set('address', address);
      url.searchParams.set('benchmark', 'Public_AR_Current');
      url.searchParams.set('format', 'jsonp');
      url.searchParams.set('callback', callbackName);
      script.src = url.href;
      document.head.appendChild(script);
    });
  }

  async function nominatimGeocode(address) {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestStartedAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestStartedAt = Date.now();

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'us');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('q', address);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OpenStreetMap address service returned ${response.status}.`);
    const results = await response.json();
    if (!results.length) throw new Error('No address match was found.');
    return {
      lat: Number(results[0].lat),
      lng: Number(results[0].lon),
      matchedAddress: results[0].display_name || address,
      source: 'OpenStreetMap address search'
    };
  }

  async function geocodeAddress({ manual = false } = {}) {
    const address = normalizeAddress(addressInput.value);
    const sequence = ++lookupSequence;

    if (!address) {
      setStatus('Enter a complete street address first.', 'error');
      return;
    }
    if (!manual && !looksComplete(address)) {
      setStatus('Keep typing the complete street address, city, state, and ZIP. Coordinates will update after you pause.', 'waiting');
      return;
    }

    const cached = cachedResult(address);
    if (cached) {
      applyResult(address, cached, cached.source || 'the saved address cache');
      return;
    }

    setStatus(manual ? 'Locating the address…' : 'Address looks complete—updating coordinates…', 'working');
    locateButton.disabled = true;

    try {
      const result = await censusGeocode(address, sequence);
      if (sequence !== lookupSequence) return;
      writeCache(address, result);
      applyResult(address, result, result.source);
    } catch (censusError) {
      if (sequence !== lookupSequence) return;
      if (!manual) {
        setStatus('The address was not matched automatically. Finish the address or select Refresh Address Coordinates for a second address search.', 'error');
        return;
      }
      try {
        const result = await nominatimGeocode(address);
        if (sequence !== lookupSequence) return;
        writeCache(address, result);
        applyResult(address, result, result.source);
      } catch (fallbackError) {
        setStatus(`The address could not be located. ${fallbackError.message || censusError.message}`, 'error');
      }
    } finally {
      locateButton.disabled = false;
      locateButton.textContent = 'Refresh Address Coordinates';
    }
  }

  function scheduleAutomaticLookup() {
    clearTimeout(debounceTimer);
    lookupSequence += 1;
    clearCoordinatesForChangedAddress();
    const address = normalizeAddress(addressInput.value);
    if (!address) {
      setStatus('Enter a complete U.S. street address. Latitude and longitude will update automatically.', 'waiting');
      return;
    }
    if (!looksComplete(address)) {
      setStatus('Keep typing the street address, city, state, and ZIP. Coordinates will update after you pause.', 'waiting');
      return;
    }
    setStatus('Address looks complete. Waiting briefly before updating coordinates…', 'working');
    debounceTimer = setTimeout(() => geocodeAddress({ manual: false }), AUTO_LOOKUP_DELAY_MS);
  }

  addressInput.addEventListener('input', scheduleAutomaticLookup);
  addressInput.addEventListener('paste', () => setTimeout(scheduleAutomaticLookup, 0));
  addressInput.addEventListener('blur', () => {
    clearTimeout(debounceTimer);
    if (looksComplete(normalizeAddress(addressInput.value))) geocodeAddress({ manual: false });
  });

  locateButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearTimeout(debounceTimer);
    geocodeAddress({ manual: true });
  }, true);

  for (const input of [latInput, lngInput]) {
    input.addEventListener('change', () => {
      const lat = Number(latInput.value);
      const lng = Number(lngInput.value);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        showPreview({ lat, lng, matchedAddress: normalizeAddress(addressInput.value) || 'Manual coordinates' });
      }
    });
  }

  form.addEventListener('reset', () => {
    clearTimeout(debounceTimer);
    lookupSequence += 1;
    lastResolvedAddress = '';
    verifyLinks.hidden = true;
    removePreview();
    setTimeout(() => setStatus('Enter a complete U.S. street address. Latitude and longitude will update automatically.', 'waiting'), 0);
  });

  const modalObserver = new MutationObserver(() => {
    if (!modal.classList.contains('open')) {
      clearTimeout(debounceTimer);
      lookupSequence += 1;
      removePreview();
    }
  });
  modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
})();

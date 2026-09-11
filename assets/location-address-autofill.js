(() => {
  'use strict';

  if (window.__denver2027LocationAddressAutofillInstalled) return;
  window.__denver2027LocationAddressAutofillInstalled = true;

  const AUTO_LOOKUP_DELAY_MS = 1250;
  const REQUEST_TIMEOUT_MS = 10000;
  const ADDRESS_MIN_LENGTH = 12;
  const CACHE_KEY = 'denver2027AddressGeocodesV2';
  const MAP_REGISTRY = new Map();
  const PROFILE_STATES = new Map();
  let lastNominatimRequestAt = 0;

  installLeafletCapture();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  function initialize() {
    injectSharedStyles();
    const profiles = detectProfiles();
    for (const profile of profiles) setupProfile(profile);
  }

  function detectProfiles() {
    const profiles = [];

    if (document.getElementById('locationForm') && document.getElementById('locationModal')) {
      profiles.push({
        key: 'bus-access-location',
        formId: 'locationForm',
        modalId: 'locationModal',
        addressId: 'locationAddress',
        latId: 'locationLat',
        lngId: 'locationLng',
        mapId: 'map',
        toolsSelector: '#locationForm .coordinate-tools',
        lookupButtonId: 'locationAddressLookupButton',
        statusId: 'locationCoordinateMessage',
        useMapCenterId: 'useMapCenter',
        buttonClass: 'btn light',
        helpText: 'The address lookup fills these coordinates automatically. Use the current map center only as a backup after positioning the map over the exact property or entrance.',
        preview: true,
        requireResolvedAddress: true,
        contextActive: () => document.getElementById('locationModal')?.classList.contains('open')
      });
    }

    if (document.getElementById('addLocationForm') && document.getElementById('addLocationModal')) {
      profiles.push({
        key: 'south-dtc-location',
        formId: 'addLocationForm',
        modalId: 'addLocationModal',
        addressId: 'locationAddress',
        latId: 'locationLat',
        lngId: 'locationLng',
        mapId: 'map',
        toolsSelector: '#addLocationForm .coordinate-actions',
        lookupButtonId: 'locationAddressButton',
        statusId: 'coordinateMessage',
        useMapCenterId: 'useMapCenterButton',
        buttonClass: 'btn outline',
        preview: true,
        requireResolvedAddress: true,
        contextActive: () => document.getElementById('addLocationModal')?.classList.contains('open')
      });
    }

    if (
      document.getElementById('plannerForm') &&
      document.getElementById('customDestinationAddress') &&
      document.getElementById('customDestinationLat') &&
      document.getElementById('customDestinationLng')
    ) {
      profiles.push({
        key: 'route-custom-destination',
        formId: 'plannerForm',
        contextId: 'customDestinationWrap',
        addressId: 'customDestinationAddress',
        latId: 'customDestinationLat',
        lngId: 'customDestinationLng',
        mapId: 'map',
        insertAfterAddress: true,
        lookupButtonId: 'customDestinationAddressLookupButton',
        statusId: 'customDestinationCoordinateMessage',
        buttonClass: 'btn outline',
        preview: false,
        requireResolvedAddress: true,
        allowMapCoordinates: true,
        contextActive: () => {
          const wrap = document.getElementById('customDestinationWrap');
          const select = document.getElementById('destinationSelect');
          return Boolean(wrap && !wrap.hidden && select?.value === 'custom-map-point');
        }
      });
    }

    return profiles;
  }

  function setupProfile(profile) {
    const addressInput = document.getElementById(profile.addressId);
    const latInput = document.getElementById(profile.latId);
    const lngInput = document.getElementById(profile.lngId);
    const form = document.getElementById(profile.formId);
    if (!addressInput || !latInput || !lngInput || !form) return;

    const ui = ensureProfileUi(profile, addressInput);
    if (!ui.lookupButton || !ui.status || !ui.verifyLinks) return;

    const state = {
      profile,
      addressInput,
      latInput,
      lngInput,
      form,
      lookupButton: ui.lookupButton,
      status: ui.status,
      verifyLinks: ui.verifyLinks,
      previewLayer: null,
      debounceTimer: null,
      lookupSequence: 0,
      writingCoordinates: false,
      bypassNextSubmit: false,
      pendingSubmitter: null,
      initialAddress: '',
      initialCoordinates: null,
      resolvedAddress: '',
      lastCoordinateSignature: '',
      activeLastTick: false,
      coordinatePoll: null
    };
    PROFILE_STATES.set(profile.key, state);

    state.lookupButton.textContent = 'Refresh Address Coordinates';
    state.lookupButton.title = 'Locate the full street address and update latitude and longitude';
    setStatus(state, 'Enter a complete U.S. street address. After you pause typing, latitude and longitude will update automatically.', 'waiting');

    addressInput.addEventListener('input', () => scheduleAutomaticLookup(state));
    addressInput.addEventListener('paste', () => setTimeout(() => scheduleAutomaticLookup(state), 0));
    addressInput.addEventListener('blur', () => {
      if (!isActive(state)) return;
      clearTimeout(state.debounceTimer);
      const address = normalizeAddress(addressInput.value);
      if (looksComplete(address) && !isResolvedForCurrentAddress(state)) geocodeAddress(state, { manual: false });
    });

    state.lookupButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearTimeout(state.debounceTimer);
      geocodeAddress(state, { manual: true });
    }, true);

    for (const input of [latInput, lngInput]) {
      input.addEventListener('input', event => {
        if (state.writingCoordinates || !event.isTrusted) return;
        markManualCoordinates(state, 'Coordinates entered manually. Confirm the marker before saving.');
      });
      input.addEventListener('change', event => {
        if (state.writingCoordinates || !event.isTrusted) return;
        markManualCoordinates(state, 'Coordinates entered manually. Confirm the marker before saving.');
      });
    }

    const useMapCenterButton = profile.useMapCenterId ? document.getElementById(profile.useMapCenterId) : null;
    if (useMapCenterButton) {
      useMapCenterButton.addEventListener('click', () => {
        setTimeout(() => {
          if (!isActive(state)) return;
          markManualCoordinates(state, 'Map-center coordinates selected. Confirm the point before saving.');
        }, 25);
      });
    }

    form.addEventListener('submit', event => guardSubmit(state, event), true);
    form.addEventListener('reset', () => setTimeout(() => resetState(state), 0));

    if (profile.modalId) {
      const modal = document.getElementById(profile.modalId);
      if (modal) {
        const observer = new MutationObserver(() => {
          if (modal.classList.contains('open')) {
            setTimeout(() => beginSession(state), 0);
          } else {
            endSession(state);
          }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
      }
    }

    if (profile.contextId) {
      const context = document.getElementById(profile.contextId);
      if (context) {
        const observer = new MutationObserver(() => {
          if (isActive(state)) beginSession(state);
          else endSession(state);
        });
        observer.observe(context, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
      }
      const destinationSelect = document.getElementById('destinationSelect');
      destinationSelect?.addEventListener('change', () => setTimeout(() => {
        if (isActive(state)) beginSession(state);
        else endSession(state);
      }, 0));
    }

    state.coordinatePoll = window.setInterval(() => pollCoordinateChanges(state), 350);
    if (isActive(state)) beginSession(state);
  }

  function ensureProfileUi(profile, addressInput) {
    let host = profile.toolsSelector ? document.querySelector(profile.toolsSelector) : null;

    if (!host && profile.insertAfterAddress) {
      host = document.createElement('div');
      host.className = 'field full denver-address-tools';
      const addressField = addressInput.closest('.field') || addressInput.parentElement;
      addressField?.insertAdjacentElement('afterend', host);
    }
    if (!host) {
      host = document.createElement('div');
      host.className = 'denver-address-tools';
      addressInput.insertAdjacentElement('afterend', host);
    }
    host.classList.add('denver-address-tools');
    if (profile.helpText) {
      const existingHelp = Array.from(host.querySelectorAll('small')).find(item => item.id !== profile.statusId);
      if (existingHelp) existingHelp.textContent = profile.helpText;
    }

    let lookupButton = document.getElementById(profile.lookupButtonId);
    if (!lookupButton) {
      lookupButton = document.createElement('button');
      lookupButton.id = profile.lookupButtonId;
      lookupButton.type = 'button';
      lookupButton.className = profile.buttonClass || 'btn outline';
      host.prepend(lookupButton);
    }

    let status = document.getElementById(profile.statusId);
    if (!status) {
      status = document.createElement('small');
      status.id = profile.statusId;
      status.className = 'denver-address-status';
      host.appendChild(status);
    } else {
      status.classList.add('denver-address-status');
    }

    let verifyLinks = host.querySelector('.denver-address-verify-links');
    if (!verifyLinks) {
      verifyLinks = document.createElement('div');
      verifyLinks.className = 'denver-address-verify-links';
      verifyLinks.hidden = true;
      host.appendChild(verifyLinks);
    }

    return { host, lookupButton, status, verifyLinks };
  }

  function beginSession(state) {
    if (!isActive(state)) return;
    const address = normalizeAddress(state.addressInput.value);
    const coordinates = readCoordinates(state);
    state.initialAddress = address;
    state.initialCoordinates = coordinates ? { ...coordinates } : null;
    state.resolvedAddress = address && coordinates ? address : '';
    state.lastCoordinateSignature = coordinateSignature(coordinates);
    state.activeLastTick = true;
    clearTimeout(state.debounceTimer);
    state.lookupSequence += 1;
    removePreview(state);

    if (address && coordinates) {
      updateVerifyLinks(state, { ...coordinates, matchedAddress: address });
      setStatus(state, 'Existing address coordinates loaded. Change the address to refresh them, or verify the point in Google Maps or Apple Maps.', 'success');
    } else {
      state.verifyLinks.hidden = true;
      setStatus(state, 'Enter a complete U.S. street address. After you pause typing, latitude and longitude will update automatically.', 'waiting');
    }
  }

  function endSession(state) {
    clearTimeout(state.debounceTimer);
    state.lookupSequence += 1;
    state.activeLastTick = false;
    state.pendingSubmitter = null;
    removePreview(state);
  }

  function resetState(state) {
    state.initialAddress = '';
    state.initialCoordinates = null;
    state.resolvedAddress = '';
    state.lastCoordinateSignature = coordinateSignature(readCoordinates(state));
    state.verifyLinks.hidden = true;
    removePreview(state);
    setStatus(state, 'Enter a complete U.S. street address. After you pause typing, latitude and longitude will update automatically.', 'waiting');
  }

  function isActive(state) {
    try {
      return state.profile.contextActive ? Boolean(state.profile.contextActive()) : true;
    } catch {
      return true;
    }
  }

  function scheduleAutomaticLookup(state) {
    if (!isActive(state)) return;
    clearTimeout(state.debounceTimer);
    state.lookupSequence += 1;

    const address = normalizeAddress(state.addressInput.value);
    handleChangedAddress(state, address);

    if (!address) {
      setStatus(state, 'Enter a complete U.S. street address. Latitude and longitude will update automatically.', 'waiting');
      return;
    }
    if (!looksComplete(address)) {
      setStatus(state, 'Keep typing the street address, city, state, and ZIP. Coordinates will update after you pause.', 'waiting');
      return;
    }

    setStatus(state, 'Address looks complete. Waiting briefly before updating coordinates…', 'working');
    state.debounceTimer = setTimeout(() => geocodeAddress(state, { manual: false }), AUTO_LOOKUP_DELAY_MS);
  }

  function handleChangedAddress(state, currentAddress) {
    const currentKey = currentAddress.toLowerCase();
    const resolvedKey = state.resolvedAddress.toLowerCase();
    if (currentKey === resolvedKey) return;

    const initialKey = state.initialAddress.toLowerCase();
    if (currentKey && initialKey && currentKey === initialKey && state.initialCoordinates) {
      writeCoordinates(state, state.initialCoordinates);
      state.resolvedAddress = state.initialAddress;
      updateVerifyLinks(state, { ...state.initialCoordinates, matchedAddress: state.initialAddress });
      setStatus(state, 'Original saved address restored with its existing coordinates.', 'success');
      return;
    }

    clearCoordinates(state);
    state.resolvedAddress = '';
    state.verifyLinks.hidden = true;
    removePreview(state);
  }

  function guardSubmit(state, event) {
    if (!isActive(state)) return;
    if (state.bypassNextSubmit) {
      state.bypassNextSubmit = false;
      return;
    }

    const address = normalizeAddress(state.addressInput.value);
    const coordinates = readCoordinates(state);
    if (!address && coordinates) return;
    if (address && coordinates && isResolvedForCurrentAddress(state)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    state.pendingSubmitter = event.submitter || null;
    clearTimeout(state.debounceTimer);
    setStatus(state, 'Verifying the address before saving…', 'working');
    geocodeAddress(state, { manual: true, resumeSubmit: true });
  }

  function isResolvedForCurrentAddress(state) {
    const address = normalizeAddress(state.addressInput.value);
    return Boolean(address && readCoordinates(state) && address.toLowerCase() === state.resolvedAddress.toLowerCase());
  }

  async function geocodeAddress(state, { manual = false, resumeSubmit = false } = {}) {
    if (!isActive(state)) return false;
    const address = normalizeAddress(state.addressInput.value);
    const sequence = ++state.lookupSequence;

    if (!address) {
      setStatus(state, 'Enter a complete street address first.', 'error');
      return false;
    }
    if (!manual && !looksComplete(address)) {
      setStatus(state, 'Keep typing the complete street address, city, state, and ZIP.', 'waiting');
      return false;
    }

    const cached = cachedResult(address);
    if (cached) {
      applyResult(state, address, cached, cached.source || 'the saved address cache');
      if (resumeSubmit) resumeFormSubmit(state);
      return true;
    }

    setStatus(state, manual ? 'Locating and verifying the address…' : 'Address looks complete—updating coordinates…', 'working');
    state.lookupButton.disabled = true;

    try {
      const result = await censusGeocode(address, sequence, state);
      if (sequence !== state.lookupSequence) return false;
      writeCache(address, result);
      applyResult(state, address, result, result.source);
      if (resumeSubmit) resumeFormSubmit(state);
      return true;
    } catch (censusError) {
      if (sequence !== state.lookupSequence) return false;
      if (!manual) {
        setStatus(state, 'The address was not matched automatically. Finish the address or select Refresh Address Coordinates for a second address search.', 'error');
        return false;
      }
      try {
        const result = await nominatimGeocode(address);
        if (sequence !== state.lookupSequence) return false;
        writeCache(address, result);
        applyResult(state, address, result, result.source);
        if (resumeSubmit) resumeFormSubmit(state);
        return true;
      } catch (fallbackError) {
        setStatus(state, `The address could not be located. ${fallbackError.message || censusError.message}`, 'error');
        return false;
      }
    } finally {
      state.lookupButton.disabled = false;
      state.lookupButton.textContent = 'Refresh Address Coordinates';
    }
  }

  function resumeFormSubmit(state) {
    window.setTimeout(() => {
      state.bypassNextSubmit = true;
      try {
        if (state.pendingSubmitter && state.pendingSubmitter.form === state.form) state.form.requestSubmit(state.pendingSubmitter);
        else state.form.requestSubmit();
      } finally {
        state.pendingSubmitter = null;
      }
    }, 0);
  }

  function applyResult(state, address, result, sourceLabel) {
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('The address service returned invalid coordinates.');

    writeCoordinates(state, { lat, lng });
    state.resolvedAddress = address;
    updateVerifyLinks(state, { ...result, lat, lng });
    if (state.profile.preview) showPreview(state, { ...result, lat, lng });
    setStatus(state, `Coordinates updated from ${sourceLabel}: ${result.matchedAddress || address}. Confirm the point before saving.`, 'success');
  }

  function readCoordinates(state) {
    const lat = Number(state.latInput.value);
    const lng = Number(state.lngInput.value);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function writeCoordinates(state, coordinates) {
    state.writingCoordinates = true;
    state.latInput.value = Number(coordinates.lat).toFixed(6);
    state.lngInput.value = Number(coordinates.lng).toFixed(6);
    state.lastCoordinateSignature = coordinateSignature(coordinates);
    for (const input of [state.latInput, state.lngInput]) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    state.writingCoordinates = false;
  }

  function clearCoordinates(state) {
    state.writingCoordinates = true;
    state.latInput.value = '';
    state.lngInput.value = '';
    state.lastCoordinateSignature = '';
    for (const input of [state.latInput, state.lngInput]) input.dispatchEvent(new Event('input', { bubbles: true }));
    state.writingCoordinates = false;
  }

  function markManualCoordinates(state, message) {
    const coordinates = readCoordinates(state);
    if (!coordinates) return;
    const address = normalizeAddress(state.addressInput.value);
    state.resolvedAddress = address;
    state.lastCoordinateSignature = coordinateSignature(coordinates);
    updateVerifyLinks(state, { ...coordinates, matchedAddress: address || 'Manual coordinates' });
    if (state.profile.preview) showPreview(state, { ...coordinates, matchedAddress: address || 'Manual coordinates' });
    setStatus(state, message, 'success');
  }

  function pollCoordinateChanges(state) {
    const active = isActive(state);
    if (active && !state.activeLastTick) beginSession(state);
    state.activeLastTick = active;
    if (!active || state.writingCoordinates || !state.profile.allowMapCoordinates) return;

    const coordinates = readCoordinates(state);
    const signature = coordinateSignature(coordinates);
    if (!signature || signature === state.lastCoordinateSignature) return;
    state.lastCoordinateSignature = signature;
    markManualCoordinates(state, 'Map-selected coordinates loaded. Confirm the point before continuing.');
  }

  function coordinateSignature(coordinates) {
    if (!coordinates) return '';
    return `${Number(coordinates.lat).toFixed(6)},${Number(coordinates.lng).toFixed(6)}`;
  }

  function normalizeAddress(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function looksComplete(address) {
    if (address.length < ADDRESS_MIN_LENGTH) return false;
    if (!/^\s*\d+[A-Za-z-]?\s+/.test(address)) return false;
    const hasStateOrZip = /\b(?:CO|Colorado)\b/i.test(address) || /\b\d{5}(?:-\d{4})?\b/.test(address);
    const hasStreetWord = /\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|cir|circle|trl|trail|way|pkwy|parkway|hwy|highway|pl|place|ter|terrace|loop)\b/i.test(address);
    return hasStateOrZip && hasStreetWord;
  }

  function setStatus(state, message, statusState = 'waiting') {
    state.status.textContent = message;
    state.status.dataset.state = statusState;
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
      const keys = Object.keys(cache);
      if (keys.length > 120) {
        for (const key of keys.slice(0, keys.length - 100)) delete cache[key];
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Address lookup still works when local storage is unavailable.
    }
  }

  function cachedResult(address) {
    return readCache()[address.toLowerCase()] || null;
  }

  function censusGeocode(address, sequence, state) {
    return new Promise((resolve, reject) => {
      const callbackName = `__denver2027CensusGeocode_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let finished = false;
      let timeout;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        script.remove();
        try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('The U.S. Census address service timed out.'));
      }, REQUEST_TIMEOUT_MS);

      window[callbackName] = payload => {
        if (sequence !== state.lookupSequence) {
          cleanup();
          reject(new Error('The address changed before the lookup finished.'));
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
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastNominatimRequestAt = Date.now();

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

  function updateVerifyLinks(state, result) {
    const coordinate = `${Number(result.lat).toFixed(6)},${Number(result.lng).toFixed(6)}`;
    const google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinate)}`;
    const apple = `https://maps.apple.com/?ll=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(result.matchedAddress || 'Meeting point')}`;
    state.verifyLinks.innerHTML = `<a href="${google}" target="_blank" rel="noopener">Verify in Google Maps</a><a href="${apple}" target="_blank" rel="noopener">Verify in Apple Maps</a>`;
    state.verifyLinks.hidden = false;
  }

  function installLeafletCapture() {
    if (!window.L?.map || window.L.map.__denver2027Captured) return;
    const originalMap = window.L.map;
    const wrappedMap = function (...args) {
      const map = originalMap.apply(this, args);
      const target = args[0];
      const id = typeof target === 'string' ? target : target?.id;
      if (id) MAP_REGISTRY.set(id, map);
      return map;
    };
    Object.assign(wrappedMap, originalMap);
    wrappedMap.__denver2027Captured = true;
    window.L.map = wrappedMap;
  }

  function showPreview(state, result) {
    const map = MAP_REGISTRY.get(state.profile.mapId || 'map');
    if (!map || !window.L) return;
    removePreview(state);
    state.previewLayer = window.L.circleMarker([result.lat, result.lng], {
      radius: 12,
      color: '#ffffff',
      weight: 4,
      fillColor: '#e77b18',
      fillOpacity: 1
    }).addTo(map);
    state.previewLayer.bindPopup(`<strong>Address preview</strong><br>${escapeHtml(result.matchedAddress || normalizeAddress(state.addressInput.value))}<br><small>Confirm this point before saving.</small>`).openPopup();
    map.setView([result.lat, result.lng], Math.max(map.getZoom(), 15), { animate: true });
  }

  function removePreview(state) {
    const map = MAP_REGISTRY.get(state.profile.mapId || 'map');
    if (state.previewLayer && map) {
      try { map.removeLayer(state.previewLayer); } catch { /* no-op */ }
    }
    state.previewLayer = null;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function injectSharedStyles() {
    if (document.getElementById('denver-address-autofill-styles')) return;
    const style = document.createElement('style');
    style.id = 'denver-address-autofill-styles';
    style.textContent = `
      .denver-address-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; width:100%; }
      .denver-address-tools .denver-address-status { flex:1 1 260px; display:block; line-height:1.35; }
      .denver-address-status[data-state="working"] { color:#8a5c00 !important; font-weight:750; }
      .denver-address-status[data-state="success"] { color:#17643f !important; font-weight:750; }
      .denver-address-status[data-state="error"] { color:#922f28 !important; font-weight:750; }
      .denver-address-status[data-state="waiting"] { color:#59697c !important; }
      .denver-address-verify-links { display:flex; flex:1 1 100%; flex-wrap:wrap; gap:10px; margin-top:2px; }
      .denver-address-verify-links a { color:#0b5b9f; font-size:10px; font-weight:850; text-decoration:none; }
      .denver-address-verify-links a:hover { text-decoration:underline; }
      @media (max-width:600px) {
        .denver-address-tools > button { width:100%; }
      }
    `;
    document.head.appendChild(style);
  }
})();

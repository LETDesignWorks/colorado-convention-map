import { createSavedLayerLoader, savedGeometry } from './saved-territories-model.js?v=territories-20261020-36';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString() : 'Date unavailable';
const sourceLabel = version => version.source === 'plan' ? 'Saved plan' : version.source === 'original' ? 'Original PDF' : 'PDF snapshot';

// Viewing stays isolated from the workspace. Only the explicit Edit action may
// request an editable copy; the host validates it and confirms workspace replacement.
export function mountSavedTerritories({ map, getHall, isAdmin, getRecords, getStatus, readSnapshot, readPdf, editTerritory, L, turf }) {
  const card = document.getElementById('savedTerritoriesCard');
  if (!card) return;
  const el = id => document.getElementById(id);
  const show = el('showAllSavedTerritories'), hide = el('hideSavedTerritories'), refresh = el('refreshSavedTerritories');
  const autoShow = el('autoShowSavedTerritories');
  const preferenceKey = 'territory-planner:auto-show-saved-territories';
  // Only this display preference is persisted, never private saved records.
  try { autoShow.checked = window.localStorage.getItem(preferenceKey) === 'true'; } catch { /* Storage may be blocked. */ }
  const status = el('savedTerritoriesStatus'), list = el('savedTerritoriesList'), detail = el('savedTerritoryDetail');
  const panel = el('savedTerritoriesPanel'), zoom = el('zoomSavedTerritories'), latest = el('latestSavedTerritories');
  const loader = createSavedLayerLoader(), layer = L.featureGroup(), layers = new Map(), selectedVersions = new Map();
  let visible = false, groups = [], selectedKey = '', hallId = '', signedIn = false, epoch = 0, loadSequence = 0, refreshQueued = false;
  let issues = [], counts = { planCount: 0, pdfCount: 0 };
  const urls = new Set();
  if (!map.getPane('savedTerritories')) map.createPane('savedTerritories').style.zIndex = '450';
  const versionFor = group => group.versions.find(v => v.id === selectedVersions.get(group.key)) || group.versions[0];
  const active = () => visible && isAdmin() && String(getHall()?.id ?? '') === hallId;
  const revokeUrls = () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };

  function contextChanged() {
    const nextId = String(getHall()?.id ?? ''), nextAdmin = isAdmin();
    if (nextId !== hallId || nextAdmin !== signedIn) {
      hideLayer(); hallId = nextId; signedIn = nextAdmin;
      if (autoShow.checked && nextAdmin && nextId) showLayer();
    }
    show.disabled = !nextAdmin || !nextId;
    el('savedTerritoriesHall').textContent = getHall()?.name || 'Select a meeting place';
    if (!nextAdmin) status.textContent = 'Sign in to view saved territories.';
    else if (!visible) status.textContent = 'Includes every saved plan and PDF snapshot for this meeting place, across all dates and congregations.';
  }
  function hideLayer() {
    visible = false; epoch++; loadSequence++; loader.cancel(); revokeUrls();
    map.removeLayer(layer); layer.clearLayers(); layers.clear();
    groups = []; selectedKey = ''; selectedVersions.clear();
    list.replaceChildren(); detail.replaceChildren(); detail.hidden = true; panel.hidden = true;
    hide.hidden = true; show.hidden = false; show.setAttribute('aria-expanded', 'false');
    status.textContent = 'Saved-territory layer hidden. Your current work is unchanged.';
  }
  function showLayer() {
    if (!isAdmin() || !getHall()?.id) return;
    hallId = String(getHall().id); signedIn = true; visible = true;
    show.hidden = true; hide.hidden = false; panel.hidden = false; show.setAttribute('aria-expanded', 'true');
    layer.addTo(map); load();
  }
  async function load() {
    if (!active()) return;
    const sequence = ++loadSequence;
    epoch++;
    revokeUrls();
    status.textContent = 'Reading all saved plans and PDF snapshots for this meeting place…';
    refresh.disabled = true;
    try {
      const result = await loader.load({ records: getRecords(), hallId, readSnapshot });
      if (!result || !active() || sequence !== loadSequence) return;
      groups = result.groups; issues = result.issues; counts = result;
      for (const [key, id] of selectedVersions) if (!groups.some(g => g.key === key && g.versions.some(v => v.id === id))) selectedVersions.delete(key);
      if (!groups.some(g => g.key === selectedKey)) selectedKey = '';
      renderMap(); renderList(); renderDetail(); summary();
    } catch (error) {
      if (active() && sequence === loadSequence) status.textContent = `Saved territories could not be read: ${error.message}. Use Refresh to retry. Your current work is unchanged.`;
    } finally { if (sequence === loadSequence) refresh.disabled = false; }
  }
  function summary() {
    const recordStatus = getStatus();
    const historyCount = groups.reduce((n, g) => n + (versionFor(g) !== g.versions[0] ? 1 : 0), 0);
    status.textContent = `${groups.length} saved territories • ${counts.planCount} plans • ${counts.pdfCount} PDF snapshots. ` +
      (historyCount ? `${historyCount} earlier version(s) displayed; the others show their latest version. ` : 'Latest version of each territory displayed. ') +
      (issues.length ? `${issues.length} saved item(s) could not be fully read. See loading details below. ` : '') +
      (recordStatus === 'loading' ? 'Saved records are still loading. ' : recordStatus === 'cached' ? 'Showing cached records; reconnect and Refresh to check for newer saves. ' : recordStatus === 'error' ? 'The saved-record connection failed; this view may be incomplete. Reconnect or refresh the page. ' : '') +
      'Your current work is unchanged.';
    const problems = el('savedTerritoriesProblems');
    problems.hidden = !issues.length;
    problems.innerHTML = issues.length ? `<summary>Loading details (${issues.length})</summary><ul>${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    zoom.disabled = !layers.size; latest.disabled = !historyCount;
  }
  function renderMap() {
    layer.clearLayers(); layers.clear();
    for (const group of groups) {
      const version = versionFor(group);
      try {
        const geometry = savedGeometry(version, turf);
        if (!geometry) continue;
        const saved = L.geoJSON(geometry, { pane: 'savedTerritories', bubblingMouseEvents: false,
          style: { color: '#7850a5', weight: group.key === selectedKey ? 4 : 2, dashArray: '7 5', fillColor: '#9470bb', fillOpacity: .09 } });
        saved.eachLayer(child => {
          child.bindTooltip(`${esc(version.territory.name || 'Unnamed territory')} — Saved (view only)`, { sticky: true });
          child.on('click', event => {
            if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
            inspect(group.key);
          });
        });
        saved.addTo(layer); layers.set(group.key, saved);
      } catch (error) {
        const message = `${version.territory.name || 'Territory'}: boundary could not be displayed (${error.message}).`;
        if (!issues.includes(message)) issues.push(message);
      }
    }
  }
  function renderList() {
    list.innerHTML = groups.length ? groups.map((group, index) => {
      const version = versionFor(group), earlier = version !== group.versions[0];
      return `<button type="button" class="saved-territory-item${selectedKey === group.key ? ' selected' : ''}" data-saved-index="${index}" aria-pressed="${selectedKey === group.key}"><strong>${esc(version.territory.name || 'Unnamed territory')}</strong><span>${esc(version.congregation)} • ${group.versions.length} saved version(s)</span><small>${earlier ? 'Earlier version' : 'Latest'} • ${esc(sourceLabel(version))} • ${esc(date(version.time))}</small><small>${esc(version.sourceName)}${!layers.has(group.key) ? ' • Boundary unavailable' : ''}</small></button>`;
    }).join('') : '<p class="empty">No saved territories were found for this meeting place.</p>';
    list.querySelectorAll('[data-saved-index]').forEach(button => button.addEventListener('click', () => inspect(groups[Number(button.dataset.savedIndex)].key)));
  }
  function inspect(key) {
    selectedKey = key; renderMap(); renderList(); renderDetail(); summary();
    detail.hidden = false; detail.focus({ preventScroll: false });
  }
  function renderDetail() {
    revokeUrls();
    const group = groups.find(g => g.key === selectedKey);
    detail.hidden = !group;
    if (!group) { detail.replaceChildren(); return; }
    const version = versionFor(group), earlier = version !== group.versions[0];
    const homes = version.houses.filter(h => !h.avoid), avoids = version.houses.filter(h => h.avoid);
    detail.innerHTML = `<h3>${esc(version.territory.name || 'Unnamed territory')} <span class="saved-readonly-chip">View only</span></h3>
      <label for="savedTerritoryVersion">Inspect a saved version</label><select id="savedTerritoryVersion">${group.versions.map((v, i) => `<option value="${i}"${v.id === version.id ? ' selected' : ''}>${i === 0 ? 'Latest — ' : ''}${esc(sourceLabel(v))} — ${v.originalDateUnknown ? 'earlier copy' : esc(date(v.time))} — ${esc(v.sourceName)}</option>`).join('')}</select>
      <p>${earlier ? 'An earlier saved version is shown on the map.' : 'The latest saved version is shown on the map.'}</p>
      <dl><dt>Congregation</dt><dd>${esc(version.congregation || 'Not recorded')}</dd><dt>Saved</dt><dd>${version.originalDateUnknown ? 'Original copy; exact save time unavailable' : esc(date(version.time))}</dd><dt>Source</dt><dd>${esc(version.sourceName)}</dd><dt>Territory ID</dt><dd>${esc(version.territory.id || 'Legacy entry without an ID')}</dd><dt>Addresses</dt><dd>${homes.length} homes • ${avoids.length} avoid addresses</dd></dl>
      ${version.error ? `<p role="alert">This saved version is incomplete: ${esc(version.error)}</p>` : ''}
      ${!layers.has(group.key) ? '<p>This version has no usable boundary to display. Other saved versions remain available above.</p>' : ''}
      <div class="button-row"><button type="button" class="btn outline" id="zoomSavedTerritory"${layers.has(group.key) ? '' : ' disabled'}>Zoom to this version</button>${version.pdfRecord ? '<button type="button" class="btn outline" id="openSavedTerritoryPdf">Open saved PDF</button>' : ''}</div>
      ${editTerritory ? `<button type="button" class="btn primary full" id="editSavedTerritory"${version.error || !version.territory.id || !version.houses.some(h => !h.avoid) ? ' disabled' : ''}>Edit this territory</button><p class="section-copy">Open this version's boundary and addresses for editing. Saving creates an updated plan and PDF; the earlier PDF stays available. You will be asked before replacing work already on the map.</p><p id="savedTerritoryEditMessage" role="status"></p>` : ''}
      <p id="savedTerritoryPdfStatus" role="status"></p><div id="savedTerritoryPdfLinks"></div>
      ${!version.pdfRecord ? `<p>${group.versions.some(v => v.pdfRecord) ? 'Choose a PDF snapshot above to open its exact saved PDF.' : 'No saved PDF is associated with this territory ID.'}</p>` : ''}
      <details><summary>Saved addresses (${version.houses.length})</summary><ul class="saved-addresses">${version.houses.map(h => `<li>${esc(h.address || 'Address not recorded')}${h.avoid ? ' — AVOID / DO NOT VISIT' : ''}</li>`).join('')}</ul></details>`;
    el('savedTerritoryVersion').addEventListener('change', event => {
      selectedVersions.set(group.key, group.versions[Number(event.target.value)].id); epoch++;
      renderMap(); renderList(); renderDetail(); summary();
    });
    el('zoomSavedTerritory').addEventListener('click', () => fit(layers.get(group.key)));
    el('editSavedTerritory')?.addEventListener('click', async event => {
      const button = event.currentTarget, message = el('savedTerritoryEditMessage');
      if (!active() || versionFor(group).id !== version.id) return;
      button.disabled = true;
      try {
        const opened = await editTerritory(version);
        if (opened) hideLayer();
        else if (button.isConnected) message.textContent = 'No territory was opened for editing. Your current work is unchanged.';
      } catch (error) {
        if (button.isConnected && active()) message.textContent = `Could not open this territory for editing: ${error.message}`;
      } finally { if (button.isConnected) button.disabled = false; }
    });
    el('openSavedTerritoryPdf')?.addEventListener('click', async event => {
      const button = event.currentTarget, message = el('savedTerritoryPdfStatus'), requestEpoch = epoch;
      button.disabled = true; message.textContent = 'Reading the stored PDF…';
      try {
        const blob = await readPdf(version.pdfRecord);
        if (!active() || epoch !== requestEpoch || selectedKey !== group.key || versionFor(group).id !== version.id || !button.isConnected) return;
        const url = URL.createObjectURL(blob); urls.add(url);
        const links = el('savedTerritoryPdfLinks');
        const open = document.createElement('a'); open.href = url; open.target = '_blank'; open.rel = 'noopener'; open.className = 'btn outline'; open.textContent = 'View PDF in new tab';
        const download = document.createElement('a'); download.href = url; download.download = version.pdfRecord.filename || 'saved-territory.pdf'; download.className = 'btn outline'; download.textContent = 'Download this saved PDF';
        links.replaceChildren(open, document.createTextNode(' '), download);
        message.textContent = 'Exact saved PDF ready. No changes were made to the archive or your workspace.';
      } catch (error) { if (button.isConnected && active()) message.textContent = `Could not open this saved PDF: ${error.message}. Try again.`; }
      finally { if (button.isConnected) button.disabled = false; }
    });
  }
  function fit(target) {
    const bounds = target?.getBounds();
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17 });
  }
  function savedRecordsChanged() {
    if (!active() || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => { refreshQueued = false; if (active()) load(); });
  }
  show.addEventListener('click', showLayer); hide.addEventListener('click', hideLayer);
  autoShow.addEventListener('change', () => {
    try { window.localStorage.setItem(preferenceKey, String(autoShow.checked)); } catch { /* Still works for this page visit. */ }
    if (autoShow.checked && !visible) showLayer();
  });
  refresh.addEventListener('click', () => load()); zoom.addEventListener('click', () => fit(layer));
  latest.addEventListener('click', () => { epoch++; selectedVersions.clear(); renderMap(); renderList(); renderDetail(); summary(); });
  window.addEventListener('territory-planner:data', contextChanged);
  window.addEventListener('territory-planner:saved-records', savedRecordsChanged);
  window.addEventListener('territory-planner:edit-saved', hideLayer);
  contextChanged();
}

import { withSessionTerritories } from './meeting-session-model.js?v=territories-20261022-43';
import { datedWorkName, libraryChoice } from './library-management-model.js?v=territories-20261022-43';
import { paintBeforeWork } from './planner-loading.js?v=territories-20261022-43';
import { createSavedLayerLoader, savedGeometry } from './saved-territories-model.js?v=territories-20261022-43';

import { groupTerritoriesByName } from './backup-merge-model.js?v=territories-20261022-43';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString() : 'Date unavailable';
const sourceLabel = version => version.source === 'session' ? 'Current session — save your work' : version.source === 'plan' ? 'Saved plan' : version.source === 'original' ? 'Original PDF' : 'PDF snapshot';

// Viewing stays isolated from the workspace. Only the explicit Edit action may
// request an editable copy; the host validates it and confirms workspace replacement.
export function mountSavedTerritories({ getWorkspace, sessionManager, map, getHall, isAdmin, getRecords, getStatus, readSnapshot, readPdf, editTerritory, saveNameChoice, libraryManager, versionPdf, getCongregation = () => '', loadSavedSet, L, turf }) {
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
  let allGroups = []; const nameOverrides = new Map();
  let visible = false, groups = [], selectedKey = '', hallId = '', signedIn = false, epoch = 0, loadSequence = 0, refreshQueued = false;
  let issues = [], counts = { planCount: 0, pdfCount: 0 };
  const urls = new Set(); const drawnVersions = new Map(), geometryCache = new WeakMap();
  let libraryBusy = false;
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
    if (active() && getWorkspace) scheduleSessionRefresh();
    else if (!visible) status.textContent = 'Includes every saved plan and PDF snapshot for this meeting place, across all dates and congregations.';
  }
  let sessionRefreshTimer = null;
  function scheduleSessionRefresh() {
    clearTimeout(sessionRefreshTimer);
    sessionRefreshTimer = setTimeout(() => {
      if (!active() || libraryBusy) return;
      regroupNames(); renderMap(); renderList(); renderDetail(); summary();
    }, 180);
  }
  function hideLayer() {
    globalThis.__denverDuplicateReview?.clear();
    clearTimeout(sessionRefreshTimer);
    visible = false; epoch++; loadSequence++; loader.cancel(); revokeUrls();
    map.removeLayer(layer); layer.clearLayers(); layers.clear(); drawnVersions.clear();
    if (!isAdmin()) loader.clearCache?.();
    groups = []; allGroups = []; nameOverrides.clear(); selectedKey = ''; selectedVersions.clear();
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
    await paintBeforeWork();
    if (!active() || sequence !== loadSequence) return;
    try {
      const result = await loader.load({ records: getRecords(), hallId, readSnapshot });
      if (!result || !active() || sequence !== loadSequence) return;
      allGroups = result.groups; regroupNames(); issues = result.issues; counts = result;
      for (const [key, id] of selectedVersions) if (!groups.some(g => g.key === key && g.versions.some(v => v.id === id))) selectedVersions.delete(key);
      if (!groups.some(g => g.key === selectedKey)) selectedKey = '';
      renderMap(); renderList(); renderDetail(); summary();
    } catch (error) {
      if (active() && sequence === loadSequence) status.textContent = `Saved territories could not be read: ${error.message}. Use Refresh to retry. Your current work is unchanged.`;
    } finally { if (sequence === loadSequence) refresh.disabled = false; }
  }
  function summary() {
    const workspace = getWorkspace?.();
    let sessionSummary = el('meetingSessionSummary');
    if (!sessionSummary && workspace) { sessionSummary = document.createElement('p'); sessionSummary.id = 'meetingSessionSummary'; panel.prepend(sessionSummary); }
    if (sessionSummary && workspace) sessionSummary.textContent = `This session: ${workspace.houses.length.toLocaleString()} addresses, including ${workspace.houses.filter(h => h.avoid).length.toLocaleString()} avoid and ${workspace.houses.filter(h => !h.avoid && h.included !== false && !h.territoryId).length.toLocaleString()} unassigned. SAVE YOUR WORK combines these with the chosen library territories into one named location session.`;
    const recordStatus = getStatus();
    const historyCount = groups.reduce((n, g) => n + (versionFor(g) !== g.versions[0] ? 1 : 0), 0);
    status.textContent = `${groups.length} territory names shown once • ${allGroups.length - groups.length} same-name alternatives available for review • ${counts.planCount} plans • ${counts.pdfCount} PDF snapshots. ` +
      (historyCount ? `${historyCount} earlier version(s) displayed; the others show their latest version. ` : 'One territory per name is displayed; review alternatives to save your keep choice. ') +
      (issues.length ? `${issues.length} saved item(s) could not be fully read. See loading details below. ` : '') +
      (recordStatus === 'loading' ? 'Saved records are still loading. ' : recordStatus === 'cached' ? 'Showing cached records; reconnect and Refresh to check for newer saves. ' : recordStatus === 'error' ? 'The saved-record connection failed; this view may be incomplete. Reconnect or refresh the page. ' : '') +
      'Use SAVE YOUR WORK to save the complete meeting-place session.';
    const problems = el('savedTerritoriesProblems');
    problems.hidden = !issues.length;
    problems.innerHTML = issues.length ? `<summary>Loading details (${issues.length})</summary><ul>${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    zoom.disabled = !layers.size; latest.disabled = !historyCount;
  }
  function regroupNames() {
    groups = groupTerritoriesByName(allGroups, getRecords(), hallId, nameOverrides);
    if (getWorkspace && getWorkspace().hallId) groups = withSessionTerritories(groups, getWorkspace(), turf);
  }
  function duplicateReviewHtml(group) {
    if (!group.alternatives || group.alternatives.length < 2) return '';
    return `<details class="same-name-review"><summary>Review ${group.alternatives.length} territories with this name</summary>
      <p>Only one is shown in the saved-territory list and map. Preview the alternatives, then choose which territory to keep visible. This does not delete backups or replace your editable workspace.</p>
      ${group.alternatives.map((candidate, index) => {
        const v = candidate.versions[0];
        return `<article class="same-name-option"><strong>${esc(v.territory.name)}${candidate.key === group.key ? ' — shown now' : ''}</strong>
          <small>${esc(v.congregation)} • ${v.houses.filter(h => !h.avoid).length} homes • ${v.houses.filter(h => h.avoid).length} avoid • ${esc(date(v.time))}</small>
          <small>${esc(v.sourceName)} • ID ${esc(v.territory.id)}</small>
          <button type="button" class="row-action" data-preview-name="${index}">Preview this territory</button>
          <button type="button" class="row-action" data-keep-name="${index}"${v.error ? ' disabled' : ''}>Keep this territory visible</button>
          <details data-compare-addresses="${index}"><summary>Compare addresses (${v.houses.length})</summary><ul class="saved-addresses"></ul></details>
        </article>`;
      }).join('')}<p id="sameNameChoiceStatus" role="status">${group.nameChoiceSaved ? 'Your keep choice is saved for this meeting place.' : 'Showing a recent copy temporarily. Review these alternatives and save your keep choice.'}</p></details>`;
  }
  function wireDuplicateReview(group) {
    detail.querySelectorAll('[data-compare-addresses]').forEach(box => box.addEventListener('toggle', () => {
      if (!box.open || box.dataset.rendered) return;
      const candidate = group.alternatives[Number(box.dataset.compareAddresses)];
      box.querySelector('ul').innerHTML = candidate.versions[0].houses.map(h => `<li>${esc(h.address)}${h.avoid ? ' — AVOID' : ''}</li>`).join(''); box.dataset.rendered = 'true';
    }));
    detail.querySelectorAll('[data-preview-name]').forEach(button => button.addEventListener('click', () => {
      const candidate = group.alternatives[Number(button.dataset.previewName)];
      nameOverrides.set(group.nameBucket, candidate.key); selectedKey = candidate.key; epoch++;
      regroupNames(); renderMap(); renderList(); renderDetail(); summary(); fit(layers.get(candidate.key));
    }));
    detail.querySelectorAll('[data-keep-name]').forEach(button => button.addEventListener('click', async () => {
      const candidate = group.alternatives[Number(button.dataset.keepName)], startingHall = hallId;
      if (!saveNameChoice || !active()) return;
      button.disabled = true;
      const message = detail.querySelector('#sameNameChoiceStatus');
      if (message) message.textContent = 'Saving your keep choice…';
      try {
        if (sessionManager) await sessionManager.keep(candidate.versions[0]);
        else if (libraryManager) await (sessionManager ? sessionManager.keep(candidate.versions[0]) : libraryManager.keep(candidate.versions[0]));
        else await saveNameChoice(candidate.versions[0].territory.name, candidate.key);
        if (!active() || hallId !== startingHall) return;
        nameOverrides.set(group.nameBucket, candidate.key); selectedKey = candidate.key;
        if (libraryManager) { selectedVersions.clear(); nameOverrides.clear(); await load(); }
        else { regroupNames(); renderMap(); renderList(); renderDetail(); summary(); }
      } catch (error) {
        if (message?.isConnected) message.textContent = `Keep choice was not saved: ${error.message}`;
      } finally { if (button.isConnected) button.disabled = false; }
    }));
  }

  function renderMap() {
    const keepKeys = new Set(groups.map(g => g.key));
    for (const [key, saved] of layers) if (!keepKeys.has(key)) { layer.removeLayer(saved); layers.delete(key); drawnVersions.delete(key); }
    for (const group of groups) {
      const version = versionFor(group);
      try {
        if (drawnVersions.get(group.key) === version) { layers.get(group.key)?.setStyle?.({ weight: group.key === selectedKey ? 4 : 2 }); continue; }
        if (layers.has(group.key)) { layer.removeLayer(layers.get(group.key)); layers.delete(group.key); }
        if (!geometryCache.has(version)) geometryCache.set(version, savedGeometry(version, turf));
        const geometry = geometryCache.get(version);
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
        saved.addTo(layer); layers.set(group.key, saved); drawnVersions.set(group.key, version);
      } catch (error) {
        const message = `${version.territory.name || 'Territory'}: boundary could not be displayed (${error.message}).`;
        if (!issues.includes(message)) issues.push(message);
      }
    }
  }
  function renderList() {
    list.innerHTML = groups.length ? groups.map((group, index) => {
      const version = versionFor(group), earlier = version !== group.versions[0];
      return `<button type="button" class="saved-territory-item${selectedKey === group.key ? ' selected' : ''}" data-saved-index="${index}" aria-pressed="${selectedKey === group.key}"><strong>${esc(version.territory.name || 'Unnamed territory')}</strong><span>${esc(version.congregation)} • ${group.versions.length} saved version(s)${group.alternatives?.length > 1 ? ` • Review ${group.alternatives.length} same-name territories` : ''}</span><small>${earlier ? 'Preview' : 'Kept / default'} • ${esc(sourceLabel(version))} • ${esc(date(version.time))}</small><small>${esc(version.sourceName)}${!layers.has(group.key) ? ' • Boundary unavailable' : ''}</small></button>`;
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
    globalThis.__denverDuplicateReview?.selectVersion(version);
    const homes = version.houses.filter(h => !h.avoid), avoids = version.houses.filter(h => h.avoid);
    detail.innerHTML = `<h3>${esc(version.territory.name || 'Unnamed territory')} <span class="saved-readonly-chip">View only</span></h3>
      ${duplicateReviewHtml(group)}
      <label for="savedTerritoryVersion">Preview a version, then save the one to keep</label><select id="savedTerritoryVersion">${group.versions.map((v, i) => `<option value="${i}"${v.id === version.id ? ' selected' : ''}>${i === 0 ? 'Default / kept — ' : ''}${esc(sourceLabel(v))} — ${v.originalDateUnknown ? 'earlier copy' : esc(date(v.time))} — ${esc(v.sourceName)}</option>`).join('')}</select>
      <p>${earlier ? 'An earlier saved version is shown on the map.' : 'The kept or most recent available version is shown on the map.'}</p>
      <dl><dt>Congregation</dt><dd>${esc(version.congregation || 'Not recorded')}</dd><dt>Saved</dt><dd>${version.originalDateUnknown ? 'Original copy; exact save time unavailable' : esc(date(version.time))}</dd><dt>Source</dt><dd>${esc(version.sourceName)}</dd><dt>Territory ID</dt><dd>${esc(version.territory.id || 'Legacy entry without an ID')}</dd><dt>Addresses</dt><dd>${homes.length} homes • ${avoids.length} avoid addresses</dd></dl>
      ${version.error ? `<p role="alert">This saved version is incomplete: ${esc(version.error)}</p>` : ''}
      ${!layers.has(group.key) ? '<p>This version has no usable boundary to display. Other saved versions remain available above.</p>' : ''}
      <div class="button-row"><button type="button" class="btn outline" id="zoomSavedTerritory"${layers.has(group.key) ? '' : ' disabled'}>Zoom to this version</button><button type="button" class="btn outline" id="openSavedTerritoryPdf"${version.error && !version.pdfRecord ? ' disabled' : ''}>View PDF</button></div>
      ${editTerritory ? `<button type="button" class="btn primary full" id="editSavedTerritory"${version.error || !version.territory.id || !version.houses.some(h => !h.avoid) ? ' disabled' : ''}>Edit this territory</button><p class="section-copy">Open this version's boundary and addresses for editing. Saving creates an updated plan and PDF; the earlier PDF stays available. You will be asked before replacing work already on the map.</p><p id="savedTerritoryEditMessage" role="status"></p>` : ''}
      ${libraryManager ? `<div class="button-row"><button class="btn save" id="keepExactVersion" type="button"${version.error ? ' disabled' : ''}>Save this version to keep</button><button class="btn outline" id="deleteOtherVersions" type="button"${group.keptVersionId && group.versions.length > 1 ? '' : ' disabled'}>Delete other versions</button><button class="btn outline" id="deletePreviewVersion" type="button"${group.keptVersionId && group.keptVersionId !== version.id ? '' : ' disabled'}>Delete this previewed version</button>${group.hiddenVersionCount ? '<button class="btn outline" id="restoreLibraryVersions" type="button">Restore removed versions</button>' : ''}</div><p id="libraryVersionStatus" role="status">${group.keptVersionId ? 'Your exact kept version is saved independently. Removing older versions does not delete other territories or the full location plan.' : 'Save the version you want to keep before removing alternatives.'}</p>` : ''}
      ${sessionManager ? '<div class="button-row"><button type="button" class="btn outline" id="checkTerritoryAddresses">Check boundary addresses</button><button type="button" class="btn outline" id="findTerritoryGisHomes">Find missing assessor / GIS homes</button></div><p id="territoryMembershipStatus" role="status"></p>' : ''}
      <p id="savedTerritoryPdfStatus" role="status"></p><div id="savedTerritoryPdfLinks"></div>
      ${!version.pdfRecord ? '<p>View PDF creates a PDF from this exact saved version without changing the editable map.</p>' : ''}
      <details id="savedVersionAddresses"><summary>Saved addresses (${version.houses.length})</summary><ul class="saved-addresses"></ul></details>`;
    wireDuplicateReview(group);
    for (const [buttonId, scan] of [['checkTerritoryAddresses', false], ['findTerritoryGisHomes', true]]) {
      el(buttonId)?.addEventListener('click', async event => {
        if (libraryBusy || !active()) return;
        const message = el('territoryMembershipStatus'); libraryBusy = true; event.currentTarget.disabled = true;
        message.textContent = scan ? 'Searching inside this territory boundary…' : 'Reviewing all loaded and saved session addresses…';
        let failure = '';
        try { await sessionManager.checkAddresses(version, { scan }); }
        catch (error) { failure = error.message; }
        finally { libraryBusy = false; if (active()) { regroupNames(); renderMap(); renderList(); renderDetail(); summary();
          const feedback = el('territoryMembershipStatus'); if (feedback) feedback.textContent = failure || 'Boundary review finished. See the session status above, then SAVE YOUR WORK to retain changes.';
        } }
      });
    }
    const addressBox = el('savedVersionAddresses');
    addressBox?.addEventListener('toggle', () => {
      if (!addressBox.open || addressBox.dataset.rendered) return;
      addressBox.querySelector('ul').innerHTML = version.houses.map(h => `<li>${esc(h.address || 'Address not recorded')}${h.avoid ? ' — AVOID / DO NOT VISIT' : ''}</li>`).join('');
      addressBox.dataset.rendered = 'true';
    });
    const versionAction = async action => {
      if (libraryBusy || !active()) return;
      const actionHall = hallId;
      libraryBusy = true;
      const message = el('libraryVersionStatus');
      const priorControls = [...detail.querySelectorAll('button,select')].map(control => [control, control.disabled]);
      priorControls.forEach(([control]) => { control.disabled = true; });
      if (message) message.textContent = 'Saving your selection…';
      try {
        await action();
        if (!active() || hallId !== actionHall) return;
        selectedVersions.clear(); nameOverrides.clear();
        libraryBusy = false; await load();
      } catch (error) {
        if (message?.isConnected) message.textContent = `The operation was not completed: ${error.message}`;
      } finally {
        libraryBusy = false;
        priorControls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
      }
    };
    el('keepExactVersion')?.addEventListener('click', () => versionAction(() => sessionManager ? sessionManager.keep(version) : libraryManager.keep(version)));
    el('deleteOtherVersions')?.addEventListener('click', () => {
      if (!confirm(`Remove the ${Math.max(0, group.versions.length - 1)} other saved version(s) of ${version.territory.name} from this library? Your kept version has its own saved addresses. Full location backups and unrelated territories are unchanged. Removed versions can be restored.`)) return;
      void versionAction(() => libraryManager.removeOthers(group));
    });
    el('deletePreviewVersion')?.addEventListener('click', () => {
      if (!confirm('Remove this previewed version from the library? The kept version and full backups stay unchanged.')) return;
      void versionAction(() => libraryManager.removeVersion(group, version.id));
    });
    el('restoreLibraryVersions')?.addEventListener('click', () => versionAction(() => libraryManager.removeOthers(group, true)));

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
        if (opened) { status.textContent = 'Editing this territory within the complete meeting-place session. Other territories and uploads are kept.'; scheduleSessionRefresh(); }
        else if (button.isConnected) message.textContent = 'No territory was opened for editing. Your current work is unchanged.';
      } catch (error) {
        if (button.isConnected && active()) message.textContent = `Could not open this territory for editing: ${error.message}`;
      } finally { if (button.isConnected) button.disabled = false; }
    });
    el('openSavedTerritoryPdf')?.addEventListener('click', async event => {
      const button = event.currentTarget, message = el('savedTerritoryPdfStatus'), requestEpoch = epoch;
      button.disabled = true; message.textContent = version.pdfRecord ? 'Reading the stored PDF…' : 'Generating a PDF from the selected saved version…';
      try {
        const built = versionPdf ? await versionPdf(version, message) : { blob: await readPdf(version.pdfRecord), filename: version.pdfRecord.filename };
        const blob = built.blob;
        if (!active() || epoch !== requestEpoch || selectedKey !== group.key || versionFor(group).id !== version.id || !button.isConnected) return;
        const url = URL.createObjectURL(blob); urls.add(url);
        const links = el('savedTerritoryPdfLinks');
        const open = document.createElement('a'); open.href = url; open.target = '_blank'; open.rel = 'noopener'; open.className = 'btn outline'; open.textContent = 'View PDF in new tab';
        const download = document.createElement('a'); download.href = url; download.download = built.filename || version.pdfRecord?.filename || 'saved-territory.pdf'; download.className = 'btn outline'; download.textContent = 'Download this saved PDF';
        links.replaceChildren(open, document.createTextNode(' '), download);
        message.textContent = built.regenerated ? `Fresh PDF ready${built.duplicatesRemoved ? ` — ${built.duplicatesRemoved} confirmed duplicate address row(s) removed` : ''}. ${built.originalArchiveRetained ? 'The original archived PDF is unchanged. ' : ''}Use Address duplicate check and SAVE YOUR WORK to retain address cleanup in the complete location set.` : version.pdfRecord ? 'Exact saved PDF ready. Your workspace is unchanged.' : 'PDF generated from this saved version. Your workspace is unchanged.';
      } catch (error) { if (button.isConnected && active()) message.textContent = `Could not open this saved PDF: ${error.message}. Try again.`; }
      finally { if (button.isConnected) button.disabled = false; }
    });
  }
  function fit(target) {
    const bounds = target?.getBounds();
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17 });
  }
  function savedRecordsChanged() {
    if (!active() || refreshQueued || libraryBusy) return;
    refreshQueued = true;
    setTimeout(() => { refreshQueued = false; if (active() && !libraryBusy) load(); }, 200);
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
  window.addEventListener('territory-planner:duplicates-cleaned', () => {
    selectedVersions.clear(); nameOverrides.clear();
    if (active() && !libraryBusy) { regroupNames(); renderMap(); renderList(); renderDetail(); summary(); }
  });

  if (libraryManager) {
    const saveSetButton = document.createElement('button'); saveSetButton.type = 'button'; saveSetButton.className = 'btn save';
    saveSetButton.id = 'saveChosenLocationSet'; saveSetButton.textContent = 'Save chosen territories as a named location set';
    const setStatus = document.createElement('p'); setStatus.id = 'savedLibrarySetStatus'; setStatus.setAttribute('role', 'status');
    panel.append(saveSetButton, setStatus);
    saveSetButton.textContent = 'SAVE YOUR WORK — complete meeting-place session';
    saveSetButton.addEventListener('click', async () => {
      if (libraryBusy || !active()) return;
      libraryBusy = true; saveSetButton.disabled = true; setStatus.textContent = 'Saving all chosen territories and session addresses…';
      try {
        const id = await sessionManager.save();
        setStatus.textContent = id ? 'Complete session saved under Return to your territories.' : 'Save cancelled. Your current session is unchanged.';
      } catch (error) { setStatus.textContent = `The session was not saved: ${error.message}`; }
      finally { libraryBusy = false; saveSetButton.disabled = false; if (active()) await load(); }
    });
  }

  contextChanged();
}

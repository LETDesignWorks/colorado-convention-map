import { locationKey, savedTime, deletionProblem } from './backup-merge-model.js?v=territories-20261022-45';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = id => document.getElementById(id);
let api, tools, prepared = null, decisions = {}, previewLayer = null, working = false, refreshQueued = false;
const records = () => api.getSavedRecords();
const destination = () => `${api.getSelectedHall()?.name || 'No meeting place'} — ${api.getSelectedCongregation() || 'choose a congregation'}`;
const label = record => record.planName || record.territoryName || record.name || 'Saved backup';
function message(text) { el('backupMergeStatus').textContent = text; }
function clearMapPreview() { if (previewLayer) api.getMap().removeLayer(previewLayer); previewLayer = null; }
function viewBoundary(geometry) {
  clearMapPreview();
  if (!geometry || !globalThis.L) return;
  previewLayer = L.geoJSON(geometry, { style: { color: '#b16b12', weight: 3, dashArray: '5 5', fillOpacity: .08 } }).addTo(api.getMap());
  if (previewLayer.getBounds().isValid()) api.getMap().fitBounds(previewLayer.getBounds(), { padding: [40, 40], maxZoom: 17 });
}
function mount() {
  const backup = el('savedWorkBackup'); if (!backup || el('backupMergeCard')) return;
  const card = document.createElement('section'); card.id = 'backupMergeCard'; card.className = 'backup-merge-card';
  card.innerHTML = `<h3>Merge backups into a location set</h3>
    <p>Load the location set you want to keep first. Adding a backup combines it with the editable map; it does not replace the map or change the original backup.</p>
    <p><strong>Destination:</strong> <span id="backupMergeDestination"></span></p>
    <label for="backupMergeSource">Backup to add</label><select id="backupMergeSource"></select>
    <label class="backup-check"><input id="backupMergeOtherLocations" type="checkbox"> Include backups from other locations or congregations</label>
    <button id="previewBackupMerge" type="button" class="btn outline">Preview adding this backup</button>
    <div id="backupMergeReview" hidden></div>
    <div id="backupMergeApplyWrap" hidden><label class="backup-check" id="backupMergeRelinkLabel" hidden><input id="backupMergeRelink" type="checkbox"> Copy this backup into the destination above; keep the source location unchanged</label>
    <button id="applyBackupMerge" type="button" class="btn primary">Add backup to this location</button></div>
    <p class="backup-merge-note">Add more backups the same way, then save the combined result. The destination boundary stays unchanged; use Review boundary &amp; fill to expand it when needed.</p>
    <label for="mergedBackupName">Name for the new independent backup</label><input id="mergedBackupName" placeholder="Meeting location — merged backup">
    <label class="backup-check"><input id="mergedBackupMakeCurrent" type="checkbox" checked> Also save this as the current location set under Return to your territories</label>
    <button id="saveMergedBackup" type="button" class="btn save">Save merged backup</button>
    <p id="backupMergeStatus" role="status" aria-live="polite">Select the destination location, then choose a backup to preview.</p>`;
  backup.querySelector('summary').after(card);
  const trash = document.createElement('details'); trash.id = 'backupTrash'; trash.className = 'backup-trash';
  trash.innerHTML = '<summary id="backupTrashTitle">Deleted backups — restore</summary><p>Delete backup moves a record here. Its address data and PDF files are retained, so removing an old backup cannot break an independent merged copy.</p><div id="backupTrashList"></div>';
  backup.appendChild(trash);
  const style = document.createElement('style');
  style.textContent = '.backup-merge-card{margin:14px 0;padding:14px;border:1px solid #a9c9dd;border-radius:12px;background:#f5fafe;min-width:0}.backup-merge-card p,.backup-trash p{font-size:12px;line-height:1.5}.backup-merge-card label{display:block;margin:12px 0 5px;font-size:12px;font-weight:700}.backup-merge-card input:not([type=checkbox]),.backup-merge-card select{width:100%;min-width:0;box-sizing:border-box}.backup-check{display:flex!important;align-items:flex-start;gap:7px;font-weight:500!important}.backup-check input{width:auto!important;flex:none}.backup-conflict{margin:12px 0;padding:10px;background:#fff;border:1px solid #d4dce5;border-radius:9px}.backup-conflict select{margin:8px 0}.backup-conflict li{font-size:11px}.backup-trash{margin-top:16px}.backup-merge-actions{display:flex;flex-wrap:wrap;gap:6px}.backup-merge-card button{white-space:normal}.backup-merge-note{color:#536578}.same-name-review{padding:9px;border:1px solid #d3b9e6;border-radius:9px;background:#faf6ff;margin-bottom:12px}.same-name-option{padding:9px 0;border-top:1px solid #dfd5e6}.same-name-option small{display:block;overflow-wrap:anywhere}.same-name-option button{margin:5px 4px 0 0}';
  document.head.appendChild(style);
  backup.addEventListener('toggle', () => { if (backup.open) refresh(); });
  el('previewBackupMerge').addEventListener('click', () => prepare(el('backupMergeSource').value));
  el('backupMergeOtherLocations').addEventListener('change', refresh);
  el('applyBackupMerge').addEventListener('click', apply);
  el('backupMergeRelink').addEventListener('change', () => { if (prepared) showReview(); });
  el('saveMergedBackup').addEventListener('click', save);
  document.addEventListener('click', event => {
    const add = event.target.closest('[data-add-backup]'), remove = event.target.closest('[data-trash-backup]'), restore = event.target.closest('[data-restore-backup]');
    if (add) { event.preventDefault(); prepare(add.dataset.addBackup); }
    if (remove) { event.preventDefault(); trashBackup(remove.dataset.trashBackup, false); }
    if (restore) { event.preventDefault(); trashBackup(restore.dataset.restoreBackup, true); }
  });
}
function rowButtons() {
  const rowRecords = records(), rowState = tools.state();
  for (const [selector, attribute, mergeable] of [['[data-load-plan]', 'loadPlan', true], ['[data-load-territory-pdf]', 'loadTerritoryPdf', true], ['[data-load-boundary]', 'loadBoundary', false]]) {
    document.querySelectorAll(selector).forEach(load => {
      const record = rowRecords.get(load.dataset[attribute]), actions = load.parentElement;
      if (!record || record.deletedAt) return;
      if (mergeable && !actions.querySelector('[data-add-backup]')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'row-action';
        button.dataset.addBackup = record.id; button.textContent = 'Add to this location'; actions.appendChild(button);
      }
      if (!actions.querySelector('[data-trash-backup]')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'row-action danger';
        button.dataset.trashBackup = record.id; button.textContent = 'Delete backup'; actions.appendChild(button);
      }
      const problem = deletionProblem(record, rowRecords, api.getCurrentPlanId(), rowState.pendingSourceIds);
      const remove = actions.querySelector('[data-trash-backup]'); remove.disabled = working || !api.isAdmin() || Boolean(problem); remove.title = problem || 'Move this old backup to recoverable Trash';
      const add = actions.querySelector('[data-add-backup]'); if (add) add.disabled = working || !api.isAdmin() || !api.getSelectedHall();
    });
  }
}
function refresh() {
  if (!el('backupMergeCard')) return;
  const ready = api.isAdmin() && api.getSavedRecordsStatus() === 'ready' && api.getSelectedHall() && api.getSelectedCongregation();
  el('backupMergeDestination').textContent = destination();
  el('mergedBackupName').placeholder = `${api.getSelectedHall()?.name || 'Meeting location'} — merged backup`;
  const source = el('backupMergeSource'), previous = source.value;
  const key = locationKey(api.getSelectedHall()?.id, api.getSelectedCongregation());
  const list = [...records().values()].filter(r => !r.deletedAt && ['territory-plan', 'territory-pdf'].includes(r.recordType) &&
    (el('backupMergeOtherLocations').checked || locationKey(r.hallId, r.congregation) === key)).sort((a, b) => savedTime(b) - savedTime(a));
  const html = list.length ? list.map(r => `<option value="${esc(r.id)}">${esc(label(r))} — ${Number(r.houseCount || 0)} addresses — ${esc(r.hallName)} / ${esc(r.congregation)} — ${savedTime(r) ? esc(new Date(savedTime(r)).toLocaleString()) : 'date unavailable'}</option>`).join('') : '<option value="">No backups for this destination</option>';
  if (source.innerHTML !== html) { source.innerHTML = html; if (list.some(r => r.id === previous)) source.value = previous; }
  el('previewBackupMerge').disabled = working || !ready || !source.value;
  el('saveMergedBackup').disabled = working || !ready || !api.getHouses().length;
  if (!ready) { prepared = null; clearMapPreview(); el('backupMergeReview').hidden = true; el('backupMergeApplyWrap').hidden = true; }
  if (el('savedWorkBackup')?.open) rowButtons();
  const deleted = [...records().values()].filter(r => r.deletedAt && ['territory-plan', 'territory-pdf', 'territory-boundary'].includes(r.recordType));
  el('backupTrashTitle').textContent = `Deleted backups (${deleted.length}) — restore`;
  el('backupTrashList').innerHTML = deleted.map(r => `<article class="saved-row"><div><strong>${esc(label(r))}</strong><small>${esc(r.hallName)} • ${esc(r.congregation)}</small></div><button class="row-action" type="button" data-restore-backup="${esc(r.id)}"${working || !ready ? ' disabled' : ''}>Restore backup</button></article>`).join('') || '<p>No deleted backups.</p>';
}
function scheduleRefresh() { if (refreshQueued) return; refreshQueued = true; queueMicrotask(() => { refreshQueued = false; refresh(); }); }
async function prepare(id) {
  if (working || !id) return;
  working = true; prepared = null; decisions = {}; clearMapPreview(); refresh();
  message('Reading this backup and comparing it with the current editable location set…');
  try {
    prepared = await tools.prepare(id);
    el('backupMergeRelink').checked = false;
    showReview();
    el('savedWorkBackup').open = true; el('backupMergeCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    message('Preview only: your map and all saved records are unchanged. Review any differences, then add the backup.');
  } catch (error) { message(error.message); }
  finally { working = false; refresh(); if (prepared) showReview(); }
}
function showReview() {
  if (!prepared) return;
  try {
    const result = tools.review(prepared.token, decisions); prepared.preview = result;
    const review = el('backupMergeReview'); review.hidden = false;
    review.innerHTML = `<p><strong>${esc(result.sourceLabel)}</strong><br>Combined result: ${result.stats.addresses} addresses • ${result.stats.territories} territories • ${result.stats.avoids} avoid addresses. ${result.stats.duplicates} repeated address records combined. ${result.stats.unassigned} unassigned.</p>${result.notes.map(note => `<p>${esc(note)}</p>`).join('')}
      ${result.conflicts.map((conflict, index) => `<div class="backup-conflict"><strong>${esc(conflict.title)}</strong><select data-merge-decision="${index}"><option value="">Choose before merging…</option>${conflict.options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}</select>${conflict.kind === 'territory' ? conflict.options.map((option, n) => `<details><summary>${esc(option.label)} — review addresses</summary><button type="button" class="row-action" data-merge-geometry="${index}:${n}">Preview boundary on map</button><ul>${option.addresses.map(address => `<li>${esc(address)}</li>`).join('')}</ul></details>`).join('') : ''}</div>`).join('')}
      ${!result.conflicts.length ? '<p>All differences are resolved. No existing addresses will be removed.</p>' : ''}`;
    review.querySelectorAll('[data-merge-decision]').forEach(select => select.addEventListener('change', () => {
      const conflict = result.conflicts[Number(select.dataset.mergeDecision)]; decisions[conflict.key] = select.value; showReview();
    }));
    review.querySelectorAll('[data-merge-geometry]').forEach(button => button.addEventListener('click', () => {
      const [i, n] = button.dataset.mergeGeometry.split(':').map(Number); viewBoundary(result.conflicts[i].options[n].geometry);
    }));
    el('backupMergeApplyWrap').hidden = false; el('backupMergeRelinkLabel').hidden = !result.relink;
    el('applyBackupMerge').disabled = working || result.conflicts.length > 0 || (result.relink && !el('backupMergeRelink').checked);
  } catch (error) {
    prepared = null; clearMapPreview(); el('backupMergeReview').hidden = true; el('backupMergeApplyWrap').hidden = true; message(error.message);
  }
}
function apply() {
  if (working || !prepared) return;
  try {
    const result = tools.apply(prepared.token, decisions, el('backupMergeRelink').checked);
    prepared = null; clearMapPreview(); el('backupMergeReview').hidden = true; el('backupMergeApplyWrap').hidden = true;
    message(`Added to ${destination()}. The workspace now has ${result.stats.addresses} addresses and ${result.stats.territories} territories. Add another backup or select Save merged backup. Nothing has been deleted.`);
    const focus = el('bulkFocus'); if (focus) focus.checked = false;
    api.render();
  } catch (error) { message(error.message); }
  refresh();
}
async function save() {
  if (working) return;
  working = true; refresh(); message('Saving an independent merged backup with its own addresses and territories…');
  try {
    const result = await tools.save(el('mergedBackupName').value, el('mergedBackupMakeCurrent').checked);
    prepared = null; clearMapPreview(); el('backupMergeReview').hidden = true; el('backupMergeApplyWrap').hidden = true;
    message(`Merged backup saved and verified. ${result.currentId ? 'The combined set is also saved under Return to your territories for this location. ' : ''}${result.warning || ''} You may now remove old, unneeded backups using Delete backup; they remain recoverable in Trash.`);
  } catch (error) { message(error.message); }
  finally { working = false; refresh(); }
}
async function trashBackup(id, restore) {
  if (working) return;
  const record = records().get(id); if (!record) return;
  if (!confirm(restore ? `Restore “${label(record)}” to Backup? It will not replace your current workspace.`
    : `Delete old backup “${label(record)}” for ${record.hallName} — ${record.congregation}? It will move to recoverable Trash and disappear from the saved-map history. Independently saved merged copies will not change.`)) return;
  working = true; refresh();
  try { await tools.trash(id, restore); message(restore ? 'Backup restored. Your current editable set is unchanged.' : 'Old backup moved to Trash. Your merged set and other backups are unchanged.'); }
  catch (error) { message(error.message); }
  finally { working = false; refresh(); }
}
async function initialize() {
  for (let i = 0; i < 200; i++) {
    api = globalThis.__denverTerritoryPlannerAPI;
    if (api?.backupTools && el('savedWorkBackup')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!api?.backupTools) return;
  tools = api.backupTools; mount();
  window.addEventListener('territory-planner:data', scheduleRefresh);
  window.addEventListener('territory-planner:saved-records', scheduleRefresh);
  refresh();
}
initialize();

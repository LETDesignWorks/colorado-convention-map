import { deletionProblem } from './backup-merge-model.js?v=territories-20261022-43';
// Backup deletion uses the same recoverable Trash as individual cleanup.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let api, busy = false;
const selected = new Set();
function mount() {
  const host = document.getElementById('savedWorkBackup'); if (!host || document.getElementById('bulkBackupCleanup')) return;
  const box = document.createElement('details'); box.id = 'bulkBackupCleanup';
  box.innerHTML = '<summary>Select old backups to delete</summary><p>Only backups for the selected meeting place and congregation are listed. Current work, kept territory versions, and unsaved merge sources are protected.</p><div class="button-grid"><button type="button" id="selectRemovableBackups" class="btn outline">Select all removable backups</button><button type="button" id="clearBackupSelection" class="btn outline">Clear selection</button><button type="button" id="deleteSelectedBackups" class="btn outline">Delete selected backups</button></div><p id="bulkBackupCleanupStatus" role="status"></p><div id="bulkBackupCleanupList"></div>';
  host.querySelector('summary').after(box);
  box.addEventListener('toggle', () => { if (box.open) render(); });
  box.querySelector('#selectRemovableBackups').onclick = () => { candidates().filter(x => !x.problem).forEach(x => selected.add(x.record.id)); render(); };
  box.querySelector('#clearBackupSelection').onclick = () => { selected.clear(); render(); };
  box.querySelector('#deleteSelectedBackups').onclick = removeSelected;
}
function candidates() {
  const records = api.getSavedRecords(), state = api.backupTools.state(), hallId = String(api.getSelectedHall()?.id || ''), congregation = api.getSelectedCongregation();
  return [...records.values()].filter(r => !r.deletedAt && ['territory-plan', 'territory-pdf', 'territory-boundary'].includes(r.recordType) && String(r.hallId) === hallId && r.congregation === congregation)
    .map(record => ({ record, problem: deletionProblem(record, records, api.getCurrentPlanId(), state.pendingSourceIds) }));
}
function render() {
  mount(); const box = document.getElementById('bulkBackupCleanup'); if (!box?.open || busy) return;
  const ready = api.isAdmin() && api.getSavedRecordsStatus() === 'ready';
  box.querySelector('#selectRemovableBackups').disabled = !ready;
  box.querySelector('#clearBackupSelection').disabled = !ready;
  const rows = ready ? candidates() : [];
  const removable = new Set(rows.filter(x => !x.problem).map(x => x.record.id));
  for (const id of selected) if (!removable.has(id)) selected.delete(id);
  box.querySelector('#bulkBackupCleanupList').innerHTML = rows.map(({record:r, problem}) => `<label style="display:flex;gap:10px;padding:10px;border-bottom:1px solid #ddd"><input type="checkbox" data-backup-check="${esc(r.id)}" ${selected.has(r.id)?'checked':''} ${problem?'disabled':''}><span><strong>${esc(r.planName || r.territoryName || r.name || 'Backup')}</strong><small style="display:block">${Number(r.houseCount || 0)} addresses • ${Number(r.territoryCount || (r.territoryId ? 1 : 0))} territories${problem ? ` • Protected: ${esc(problem)}` : ''}</small></span></label>`).join('') || '<p>No backups for this location.</p>';
  box.querySelectorAll('[data-backup-check]').forEach(input => input.onchange = () => { input.checked ? selected.add(input.dataset.backupCheck) : selected.delete(input.dataset.backupCheck); updateCount(); });
  updateCount();
}
function updateCount() {
  const button = document.getElementById('deleteSelectedBackups');
  if (button) { button.textContent = `Delete selected backups (${selected.size})`; button.disabled = busy || !selected.size || !api.isAdmin() || api.getSavedRecordsStatus() !== 'ready'; }
}
async function removeSelected() {
  if (busy || !selected.size) return;
  const ids = [...selected], hallId = String(api.getSelectedHall()?.id || ''), congregation = api.getSelectedCongregation();
  if (!confirm(`Move ${ids.length} selected backup(s) for ${api.getSelectedHall().name} — ${congregation} to Deleted backups? Current work and kept versions remain protected. You can restore deleted backups later.`)) return;
  busy = true; updateCount();
  document.querySelectorAll('#bulkBackupCleanup input,#bulkBackupCleanup button').forEach(e => e.disabled = true);
  const status = document.getElementById('bulkBackupCleanupStatus'); let removed = 0; const errors = [];
  try {
    for (const [index, id] of ids.entries()) {
      if (!api.isAdmin() || hallId !== String(api.getSelectedHall()?.id || '') || congregation !== api.getSelectedCongregation()) { errors.push('Stopped because the selected location or account changed.'); break; }
      status.textContent = `Removing backup ${index + 1} of ${ids.length}…`;
      try { await api.backupTools.trash(id); selected.delete(id); removed++; }
      catch (error) { errors.push(error.message); }
    }
  } finally {
    busy = false; render();
    status.textContent = `${removed} backup(s) moved to Deleted backups — restore.${errors.length ? ` ${errors.length} item(s) were not removed: ${[...new Set(errors)].join(' ')}` : ''}`;
  }
}
async function initialize() {
  for (let i = 0; i < 200; i++) {
    api = globalThis.__denverTerritoryPlannerAPI;
    if (api?.backupTools && document.getElementById('savedWorkBackup')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!api?.backupTools) return;
  mount();
  let lastContext = '';
  window.addEventListener('territory-planner:data', () => {
    const next = JSON.stringify([api.getSelectedHall()?.id, api.getSelectedCongregation(), api.isAdmin()]);
    if (next !== lastContext) { lastContext = next; selected.clear(); render(); }
  });
  window.addEventListener('territory-planner:saved-records', render);
}
initialize();

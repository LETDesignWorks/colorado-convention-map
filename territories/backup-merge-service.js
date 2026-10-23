import { previewBackupMerge, workspaceStamp, locationKey, stable, deletionProblem, nameKey } from './backup-merge-model.js?v=territories-20261023-50';

// Storage and editable-map access are supplied by the signed-in planner.
export function createBackupTools(host) {
  let serial = 0, session = '', busy = false;
  const previews = new Map(), pending = new Set();
  const scope = () => {
    const w = host.context ? host.context() : host.capture();
    return stable([w.hallId, w.congregation, w.generation, w.currentPlanId]);
  };
  function guard() {
    if (!host.isAdmin()) throw new Error('Sign in as administrator first.');
    if (host.status() !== 'ready') throw new Error('Wait for saved records to reconnect before merging, saving, or removing backups.');
  }
  function sync() {
    if (!busy && session && session !== scope()) { pending.clear(); previews.clear(); }
    if (!busy) session = scope();
  }
  function checked(token) {
    guard();
    const value = previews.get(token);
    if (!value) throw new Error('Preview this backup again before adding it.');
    if (workspaceStamp(host.capture()) !== value.stamp) throw new Error('The current workspace changed. Preview again so no edits are overwritten.');
    const record = host.records().get(value.source.id);
    if (!record || record.deletedAt || stable(record) !== value.recordStamp) throw new Error('The backup changed or was removed. Preview it again.');
    return value;
  }
  async function prepare(id) {
    guard(); sync();
    if (busy) throw new Error('Finish the current backup operation first.');
    const workspace = host.capture(), stamp = workspaceStamp(workspace);
    if (workspace.editing) throw new Error('Finish the current drawing or boundary edit before merging.');
    if (workspace.editId) throw new Error('You are editing an isolated territory. Load the complete location set before adding a backup.');
    if (!workspace.hallId || !workspace.congregation) throw new Error('Select the destination meeting location and congregation.');
    const record = host.records().get(id);
    if (!record || record.deletedAt) throw new Error('This backup is unavailable. Refresh saved records.');
    const recordStamp = stable(record);
    busy = true;
    try {
      const source = await host.readSource(id);
      if (!host.isAdmin() || workspaceStamp(host.capture()) !== stamp || stable(host.records().get(id)) !== recordStamp)
        throw new Error('The workspace or backup changed while reading it. Nothing was added. Preview again.');
      const token = `preview-${++serial}`;
      previews.set(token, { workspace, stamp, source, recordStamp });
      return { token, source, preview: previewBackupMerge(workspace, source) };
    } finally { busy = false; sync(); }
  }
  function review(token, decisions = {}) {
    const value = checked(token);
    return previewBackupMerge(value.workspace, value.source, decisions);
  }
  function apply(token, decisions = {}, allowRelink = false) {
    if (busy) throw new Error('Finish the current backup operation first.');
    const value = checked(token), result = previewBackupMerge(value.workspace, value.source, decisions);
    if (result.conflicts.length) throw new Error('Review each territory or address conflict before adding this backup.');
    if (result.relink && !allowRelink) throw new Error('Confirm copying this backup to the different destination location or congregation.');
    busy = true;
    try {
      host.applyDraft(result.draft, value.stamp);
      pending.add(value.source.id);
      previews.clear(); session = scope();
      return result;
    } finally { busy = false; }
  }
  async function save(name, makeCurrent = true) {
    guard(); sync();
    if (busy) throw new Error('Finish the current backup operation first.');
    const workspace = host.capture();
    if (workspace.editId || !workspace.houses.length) throw new Error('Load or merge a complete location set before saving a merged backup.');
    const expected = workspaceStamp(workspace), sourceIds = [...pending];
    busy = true;
    try {
      const id = await host.savePlan({ forceBackup: true, backupName: String(name || '').trim() || `${workspace.hallName} — merged backup`,
        mergeSourceIds: sourceIds, expectedMergeFingerprint: expected });
      if (!id) throw new Error('The merged backup was not confirmed saved. Your original backups remain unchanged.');
      session = scope(); // Own save may change the open plan ID; retain pending sources until verification.
      // The save owns new address chunks and cannot depend on a source backup.
      await host.verifySaved(id, workspace);
      pending.clear(); previews.clear(); session = scope();
      let currentId = null, warning = '';
      if (makeCurrent) {
        const now = host.capture();
        if (locationKey(now.hallId, now.congregation) !== locationKey(workspace.hallId, workspace.congregation)
          || stable([now.houses, now.territories, now.boundary]) !== stable([workspace.houses, workspace.territories, workspace.boundary])) {
          warning = 'The workspace changed while saving. The independent backup is saved, but the current location set was not replaced.';
        } else {
          currentId = await host.savePlan({ saveYourWork: true, mergeSourceIds: sourceIds, expectedMergeFingerprint: workspaceStamp(now) });
          if (!currentId) warning = 'The independent backup is saved. Saving it as the current location set was canceled or unsuccessful.';
        }
      }
      return { id, currentId, warning };
    } finally { busy = false; sync(); }
  }
  async function trash(id, restore = false) {
    guard(); sync();
    if (busy) throw new Error('Finish the current backup operation first.');
    const record = host.records().get(id);
    if (!record) throw new Error('This backup is no longer available.');
    if (!restore) {
      const problem = deletionProblem(record, host.records(), host.capture().currentPlanId, [...pending]);
      if (problem) throw new Error(problem);
    }
    busy = true;
    try { await host.trashRecord(id, restore, [...pending]); previews.clear(); }
    finally { busy = false; sync(); }
  }
  async function saveNameChoice(name, territoryKey) {
    guard();
    const w = host.capture();
    if (!w.hallId || !nameKey(name) || !territoryKey) throw new Error('Select a meeting place and a named territory first.');
    return host.saveNameChoice(w.hallId, nameKey(name), territoryKey);
  }
  return { prepare, review, apply, save, trash, saveNameChoice,
    state() { sync(); return { busy, pendingSourceIds: [...pending] }; } };
}

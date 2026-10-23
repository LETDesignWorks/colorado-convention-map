import { boundaryMembership, fillBoundaryMembership } from './territory-membership.js?v=territories-20261022-41';
import { assembleMeetingSession, sessionContentStamp } from './meeting-session-model.js?v=territories-20261022-41';
import { collectSavedTerritories } from './saved-territories-model.js?v=territories-20261022-41';
import { groupTerritoriesByName } from './backup-merge-model.js?v=territories-20261022-41';
import { datedWorkName } from './library-management-model.js?v=territories-20261022-41';

export function createMeetingSessionManager(host) {
  let busy = false;
  function guard() {
    if (!host.isAdmin() || host.status() !== 'ready') throw new Error('Sign in and wait for saved records to finish loading. Your session has not been changed.');
  }
  async function prepare(selected = null) {
    guard();
    const workspace = host.capture(), stamp = sessionContentStamp(workspace);
    const records = host.records();
    const startingScope = host.context?.();
    const current = () => host.isAdmin() && (host.context ? JSON.stringify(startingScope) === JSON.stringify(host.context()) : stamp === sessionContentStamp(host.capture()));
    const library = await collectSavedTerritories({ records, hallId: workspace.hallId, readSnapshot: host.readSnapshot, isCurrent: current });
    if (!current() || stamp !== sessionContentStamp(host.capture())) throw new Error('Your session changed while the saved territories were loading. Nothing was replaced; try again.');
    const groups = groupTerritoriesByName(library.groups, records, workspace.hallId);
    const base = host.readBase?.(workspace) || null;
    const draft = assembleMeetingSession(workspace, groups, { base, selected });
    return { draft, stamp, groups, sourceVersionIds: groups.map(g => (g.versions.find(v => v.id === g.keptVersionId) || g.versions[0]).id) };
  }
  async function run(action) {
    if (busy) throw new Error('A session operation is already running.');
    busy = true; host.loading?.(true);
    try { await host.paint?.(); return await action(); }
    finally { busy = false; host.loading?.(false); }
  }
  async function save(name = null) {
    return run(async () => {
      guard();
      if (await host.finishEdit?.() === false) throw new Error('Finish the territory boundary edit first.');
      const prepared = await prepare();
      const chosenName = name || await host.askName(datedWorkName(host.hall()?.name), prepared.draft);
      if (chosenName == null || !String(chosenName).trim()) return null;
      if (prepared.stamp !== sessionContentStamp(host.capture())) throw new Error('The session changed before saving. Review it and save again.');
      const planId = await host.saveSnapshot(prepared.draft, { kind: 'work', sessionScope: 'meeting-place',
        name: String(chosenName).trim(), sourceVersionIds: prepared.sourceVersionIds });
      if (!planId) throw new Error('The complete session was not confirmed saved. Keep this page open and try again.');
      const unchanged = host.isAdmin() && prepared.stamp === sessionContentStamp(host.capture());
      if (unchanged) host.apply(prepared.draft, prepared.stamp, planId);
      host.message?.(unchanged
        ? `Saved “${chosenName}”: ${prepared.draft.territories.length} territories and ${prepared.draft.houses.length.toLocaleString()} addresses, including avoid and unassigned addresses. Reopen this complete session in Return to your territories.`
        : `Saved “${chosenName}” as it was when saving began. Later edits remain on your map and have not been replaced; save again to retain them.`);
      return planId;
    });
  }
  async function edit(version) {
    return run(async () => {
      const prepared = await prepare(version);
      if (version.source !== 'session' && host.confirmVersion && !await host.confirmVersion(version)) return false;
      if (prepared.stamp !== sessionContentStamp(host.capture())) throw new Error('The session changed. Open the territory again.');
      host.apply(prepared.draft, prepared.stamp, null);
      host.editBoundary(String(version.territory.id));
      return true;
    });
  }
  async function keep(version) {
    return run(async () => {
      const prepared = await prepare(version);
      if (version.source !== 'session' && host.confirmVersion && !await host.confirmVersion(version)) return null;
      await host.keepVersion(version);
      if (host.isAdmin() && prepared.stamp === sessionContentStamp(host.capture())) host.apply(prepared.draft, prepared.stamp, null);
      host.message?.('This version is now in the meeting-place session. Use SAVE YOUR WORK to save it with all territories and addresses.');
      return true;
    });
  }

  async function checkAddresses(version, { scan = false } = {}) {
    return run(async () => {
      const prepared = await prepare(version);
      if (version.source !== 'session' && host.confirmVersion && !await host.confirmVersion(version)) return false;
      if (prepared.stamp !== sessionContentStamp(host.capture())) throw new Error('The session changed. Review the territory again.');
      const initial = boundaryMembership(prepared.draft, version.territory.id, host.turf);
      if (scan && !await host.confirm(`Search official assessor/GIS home addresses inside ${version.territory.name}? The meeting-place boundary, existing homes, and other territory assignments will not be replaced.`)) return false;
      host.apply(prepared.draft, prepared.stamp, null);
      let scanResult = null;
      if (scan) {
        scanResult = await host.scanTerritory(initial.geometry);
        if (!['complete', 'partial'].includes(scanResult?.status)) throw new Error('The GIS scan did not finish. Existing work is kept. Retry the territory search.');
      }
      const current = host.capture(), stamp = sessionContentStamp(current);
      if (String(current.hallId) !== String(version.hallId)) throw new Error('The meeting place changed. No assignments were changed.');
      const review = boundaryMembership(current, version.territory.id, host.turf);
      const count = review.assigned.length + review.unassigned.length + review.conflicts.length;
      const summary = `${version.territory.name}: ${count} visitable loaded addresses inside the boundary. ${review.assigned.length} already assigned; ${review.unassigned.length} unassigned; ${review.conflicts.length} assigned to another territory. ${review.avoids.length} avoid and ${review.excluded.length} excluded addresses stay excluded.`;
      if (review.unassigned.length && !await host.confirm(`${summary}

Add the ${review.unassigned.length} unassigned homes to this territory? This does not move any homes from another territory.`)) {
        host.message?.('No assignments changed. Loaded addresses remain available in this session.'); return false;
      }
      const moveConflicts = review.conflicts.length ? await host.confirm(`${summary}

Move the ${review.conflicts.length} overlapping homes from their current territories into ${version.territory.name}? OK moves them; Cancel leaves the existing assignments unchanged.

${review.conflicts.slice(0, 8).map(h => h.address).join('\n')}`) : false;
      const releaseOutside = review.outsideAssigned.length ? await host.confirm(`${review.outsideAssigned.length} homes are assigned to ${version.territory.name} but lie outside its boundary. Return those homes to Unassigned? Their addresses will remain in the session. Cancel keeps their current assignments.`) : false;
      if (stamp !== sessionContentStamp(host.capture())) throw new Error('Your session changed during review. Run the boundary check again.');
      const filled = fillBoundaryMembership(current, version.territory.id, host.turf, { moveConflicts, releaseOutside });
      host.apply(filled.draft, stamp, null);
      const complete = boundaryMembership(filled.draft, version.territory.id, host.turf);
      host.message?.(`${version.territory.name}: ${complete.assigned.length} homes assigned inside the boundary; ${complete.conflicts.length} remain assigned elsewhere; ${complete.avoids.length} avoid addresses retained. ${scanResult?.status === 'partial' ? 'Some GIS requests failed; retry the search. ' : ''}Select SAVE YOUR WORK to retain the complete session.`);
      return filled;
    });
  }
  return { save, edit, keep, prepare, checkAddresses, isBusy: () => busy };

}

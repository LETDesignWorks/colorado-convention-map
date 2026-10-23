import { currentWorkFor, workKey, workTime } from './saved-work-model.js?v=territories-20261022-44';
const text = value => String(value ?? '').trim();
const copy = value => JSON.parse(JSON.stringify(value));
export const geometryValue = value => value?.type === 'Feature' ? value.geometry : value;
export function boundaryFingerprint(value) { return JSON.stringify(geometryValue(value) || null); }
export function mappedHome(home) {
  return home?.lat != null && home?.lng != null && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng))
    && Math.abs(Number(home.lat)) <= 85.05112878 && Math.abs(Number(home.lng)) <= 180
    && !(Math.abs(Number(home.lat)) < 1 && Math.abs(Number(home.lng)) < 1);
}
export function homeFingerprint(home) { return JSON.stringify([String(home.id), Number(home.lat), Number(home.lng)]); }
export function chooseMeetingPlan(records, hallId, congregation) {
  const session = currentWorkFor([...records.values()].filter(r => r.recordType === 'territory-plan'), hallId, congregation);
  if (session?.sessionScope === 'meeting-place') return { plan: session, legacy: false };
  const plans = [...records.values()].filter(record => !record.deletedAt && record.recordType === 'territory-plan'
    && workKey(record.hallId, record.congregation) === workKey(hallId, congregation));
  const current = currentWorkFor(plans, hallId, congregation);
  if (current) return { plan: current, legacy: false }; // Never silently fall back from a damaged current save.
  const legacy = plans.filter(plan => !plan.saveKind && !plan.pdfArchive
    && !/revised territory|saved PDF copy/i.test(text(plan.planName)));
  const sets = legacy.filter(plan => plan.addressSetMode || plan.addressOnlyMode);
  const candidates = sets.length ? sets : legacy;
  candidates.sort((a, b) => workTime(b) - workTime(a) || Number(b.houseCount || 0) - Number(a.houseCount || 0)
    || text(a.id).localeCompare(text(b.id)));
  return candidates.length ? { plan: candidates[0], legacy: true } : null;
}
export function latestMeetingBoundary(records, hallId, congregation) {
  const candidates = [...records.values()].filter(record => !record.deletedAt && record.recordType === 'territory-boundary'
    && record.meetingPlaceBoundary === true && workKey(record.hallId, record.congregation) === workKey(hallId, congregation));
  candidates.sort((a, b) => workTime(b) - workTime(a) || text(b.id).localeCompare(text(a.id)));
  if (!candidates.length) return null;
  const record = candidates[0];
  const geometry = geometryValue(record.boundaryJson ? JSON.parse(record.boundaryJson) : record.boundary);
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error('The saved meeting-place boundary is incomplete.');
  return { record, geometry: copy(geometry) };
}
export function outsideHomes(turf, homes, boundary) {
  const geometry = geometryValue(boundary);
  return homes.filter(mappedHome).filter(home => !geometry || !turf.booleanPointInPolygon(
    turf.point([Number(home.lng), Number(home.lat)]), turf.feature(geometry)));
}
export function proposedBoundary(turf, homes, previous, paddingMiles = .12) {
  const mapped = homes.filter(mappedHome);
  if (!mapped.length) throw new Error('Add a mapped address before suggesting a boundary.');
  const padding = Math.max(.02, Math.min(2, Number(paddingMiles) || .12));
  const points = [...new Map(mapped.map(home => {
    const coordinates = [Number(home.lng), Number(home.lat)]; return [JSON.stringify(coordinates), turf.point(coordinates)];
  })).values()];
  const collection = turf.featureCollection(points);
  let base = points.length === 1 ? points[0] : points.length === 2 ? turf.lineString(points.map(p => p.geometry.coordinates))
    : points.length > 600 ? turf.bboxPolygon(turf.bbox(collection)) : turf.convex(collection);
  if (!base) {
    const ordered = points.map(p => p.geometry.coordinates).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    base = turf.lineString([ordered[0], ordered.at(-1)]);
  }
  const envelope = turf.buffer(base, padding, { units: 'miles', steps: 16 });
  if (!envelope?.geometry) throw new Error('A search boundary could not be created.');
  const old = geometryValue(previous);
  // Expansion retains the whole old area, including corners beyond the homes.
  const merged = old ? turf.union(turf.featureCollection([turf.feature(old), envelope])) : envelope;
  if (!merged?.geometry || outsideHomes(turf, mapped, merged.geometry).length) throw new Error('The suggested boundary did not contain every mapped address.');
  return copy(merged.geometry);
}
export function captureScanScope(api) {
  return { generation: api.getWorkspaceGeneration?.(), hallId: String(api.getSelectedHall?.()?.id || ''),
    congregation: api.getSelectedCongregation?.() || '', boundary: boundaryFingerprint(api.getBoundaryGeometry?.()) };
}
export function scanScopeIsCurrent(api, scope) {
  return Boolean(api.isAdmin?.()) && scope.generation === api.getWorkspaceGeneration?.()
    && scope.hallId === String(api.getSelectedHall?.()?.id || '')
    && workKey(scope.hallId, scope.congregation) === workKey(api.getSelectedHall?.()?.id, api.getSelectedCongregation?.())
    && scope.boundary === boundaryFingerprint(api.getBoundaryGeometry?.());
}
export function createMeetingBoundaryFlow(host) {
  let busy = false;
  const current = scope => host.isCurrent(scope);
  async function fill({ automatic = false } = {}) {
    if (busy) return { status: 'busy' };
    if (!host.isAdmin()) return { status: 'unauthorized' };
    const scope = host.context();
    if (!scope.hallId || !scope.congregation) { host.status('Select a meeting place and congregation first.'); return { status: 'empty' }; }
    busy = true;
    try {
      let boundary = host.getBoundary(), expanded = false;
      const homes = host.getHomes().filter(mappedHome);
      if (!boundary) {
        if (homes.length) boundary = proposedBoundary(host.turf, homes, null, host.padding());
        else {
          if (automatic) return { status: 'empty' };
          if (!await host.confirm(`There are no saved addresses or boundary here yet. Create a ${host.padding()}-mile search area around this meeting place and look up assessor/GIS home addresses? You can review it before using it as the meeting-place boundary.`)) return { status: 'declined' };
          if (!current(scope)) return { status: 'stale' };
          const hall = host.getHall();
          if (!mappedHome(hall)) throw new Error('The meeting place needs a valid map location.');
          boundary = host.turf.buffer(host.turf.point([Number(hall.lng), Number(hall.lat)]), host.padding(), { units: 'miles', steps: 24 }).geometry;
        }
        if (!current(scope)) return { status: 'stale' };
        host.applyBoundary(boundary);
      } else {
        const outside = outsideHomes(host.turf, homes, boundary);
        if (outside.length) {
          const proposed = proposedBoundary(host.turf, homes, boundary, host.padding());
          host.preview?.(proposed);
          let yes;
          try { yes = await host.confirm(`${outside.length} loaded address(es) are outside the current boundary. Expand the meeting-place boundary to include them and automatically fill the larger area with assessor/GIS home addresses? Existing addresses, avoid records and territory assignments will be kept. Cancel keeps the old boundary AND the new addresses.`); }
          finally { host.clearPreview?.(); }
          if (!current(scope)) return { status: 'stale' };
          if (!yes) { host.status('Boundary unchanged. All new addresses remain loaded. Use Review boundary & fill whenever you are ready.'); return { status: 'declined' }; }
          boundary = proposed; expanded = true; host.applyBoundary(boundary);
        } else if (automatic) return { status: 'inside' };
      }
      const signature = boundaryFingerprint(boundary);
      const stillCurrent = () => current(scope) && boundaryFingerprint(host.getBoundary()) === signature;
      host.status('Finding assessor/GIS homes in the search boundary…');
      const result = await host.scan();
      if (!stillCurrent()) return { status: 'stale' };
      if (!result || !['complete', 'partial'].includes(result.status)) {
        host.status('The scan did not finish. Your loaded addresses and territories are kept. Retry Review boundary & fill; the boundary has not been adopted automatically.');
        return result || { status: 'failed' };
      }
      const saved = host.getAcceptedBoundary();
      if (boundaryFingerprint(saved) !== signature) {
        const yes = expanded || await host.confirm(`The address scan ${result.status === 'partial' ? 'returned partial results (some GIS requests failed)' : 'has finished'}. Use this search boundary as the saved boundary for ${host.getHall().name} — ${scope.congregation}? This saves the boundary only. Use SAVE YOUR WORK to retain all loaded addresses and territories.`);
        if (!stillCurrent()) return { status: 'stale' };
        if (yes) {
          await host.saveBoundary(boundary, scope);
          if (!stillCurrent()) return { status: 'stale' };
          host.status(`${expanded ? 'Expanded meeting-place boundary' : 'Meeting-place boundary'} saved. ${result.status === 'partial' ? 'Some GIS batches failed; use Review boundary & fill to retry. ' : ''}Select SAVE YOUR WORK to retain all addresses and territories.`);
        } else host.status('Kept as a temporary search boundary; the saved meeting-place boundary is unchanged. All loaded addresses remain.');
      } else host.status(`Address scan ${result.status === 'partial' ? 'partially finished; retry to check the remaining GIS batches' : 'finished'}. The saved boundary is unchanged. Select SAVE YOUR WORK to retain the new addresses.`);
      return result;
    } catch (error) {
      if (current(scope)) host.status(`The boundary update stopped: ${error.message}. Existing work is kept.`);
      return { status: 'failed', error: error.message };
    } finally { busy = false; }
  }
  return { fill, isBusy: () => busy };
}

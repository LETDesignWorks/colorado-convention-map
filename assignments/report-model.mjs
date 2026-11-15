import {SERVICE_DAYS} from './service-days-model.mjs';

export const DEFAULT_DELEGATES_PER_CONGREGATION = 50;
export const DELEGATE_SETTING_KEY = 'denver-2027-assignment-report-delegates-v1';

export function normalizeDelegateCount(value = DEFAULT_DELEGATES_PER_CONGREGATION) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw Error('Enter a whole number from 0 to 10,000.');
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 10000) throw Error('Enter a whole number from 0 to 10,000.');
  return count;
}

export function readDelegateSetting(storage) {
  try {
    const saved = storage?.getItem(DELEGATE_SETTING_KEY);
    return saved === null || saved === undefined ? DEFAULT_DELEGATES_PER_CONGREGATION : normalizeDelegateCount(saved);
  } catch { return DEFAULT_DELEGATES_PER_CONGREGATION; }
}

export function saveDelegateSetting(value, storage) {
  const count = normalizeDelegateCount(value);
  try { storage?.setItem(DELEGATE_SETTING_KEY, String(count)); } catch { /* The estimate still works for this visit. */ }
  return count;
}

export function buildAssignmentReport({
  congregations = [], locations = [], assignmentFor = () => null, serviceDaysFor = () => [],
  delegatesPerCongregation = DEFAULT_DELEGATES_PER_CONGREGATION, sharedReady = false, now = new Date()
} = {}) {
  const factor = normalizeDelegateCount(delegatesPerCongregation);
  const points = new Map(locations.map(point => [String(point.id), point]));
  const seen = new Set();
  const records = [];
  for (const congregation of congregations) {
    const id = String(congregation.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const assignment = assignmentFor(id);
    const meetingPointId = String(assignment?.meetingPointId ?? '').trim();
    const savedDays = serviceDaysFor(id);
    const days = SERVICE_DAYS.filter(day => Array.isArray(savedDays) && savedDays.includes(day));
    const point = points.get(meetingPointId);
    records.push({
      id, number: congregation.number ?? '', name: congregation.name || id,
      meetingPointId, meetingPointName: meetingPointId ? point?.name || assignment?.meetingPointName || 'Saved meeting location' : '',
      assigned: Boolean(meetingPointId), days
    });
  }
  const assigned = records.filter(record => record.assigned).length;
  const days = SERVICE_DAYS.map(day => {
    const scheduled = records.filter(record => record.days.includes(day));
    const paired = scheduled.filter(record => record.assigned);
    return {
      day, totalCongregations: scheduled.length, assignedCongregations: paired.length,
      unassignedCongregations: scheduled.length - paired.length,
      meetingLocations: new Set(paired.map(record => record.meetingPointId)).size,
      estimatedDelegates: paired.length * factor
    };
  });
  return {
    total: records.length, assigned, unassigned: records.length - assigned,
    assignmentPercent: records.length ? assigned / records.length * 100 : 0,
    delegatesPerCongregation: factor,
    scheduledCongregations: records.filter(record => record.days.length).length,
    assignedWithoutDay: records.filter(record => record.assigned && !record.days.length).length,
    unassignedWithDay: records.filter(record => !record.assigned && record.days.length).length,
    days, records, sharedReady: Boolean(sharedReady), generatedAt: new Date(now).toISOString()
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssignmentReport, normalizeDelegateCount, readDelegateSetting, saveDelegateSetting,
  DEFAULT_DELEGATES_PER_CONGREGATION, DELEGATE_SETTING_KEY
} from '../assignments/report-model.mjs';
import {SERVICE_DAYS} from '../assignments/service-days-model.mjs';

const now = new Date('2026-11-15T18:30:00.000Z');
function fixture(overrides = {}) {
  const congregations = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, index) => ({id, number: index + 1, name: `Congregation ${id}`}));
  const assignments = new Map([
    ['A', {meetingPointId: 'one'}], ['B', {meetingPointId: 'one'}], ['C', {meetingPointId: 'two'}],
    ['D', {meetingPointId: 'unavailable', meetingPointName: 'Saved rail station'}],
    ['F', {meetingPointId: '  '}], ['outside-roster', {meetingPointId: 'one'}]
  ]);
  const schedules = new Map([
    ['A', ['Monday', 'Wednesday']], ['B', ['Monday']], ['D', ['Friday']], ['E', ['Monday', 'Friday']]
  ]);
  const context = {
    congregations, locations: [{id: 'one', name: 'First location'}, {id: 'two', name: 'Second location'}],
    assignmentFor: id => assignments.get(id), serviceDaysFor: id => schedules.get(id), sharedReady: true, now,
    ...overrides
  };
  return {context, congregations, assignments, schedules, report: () => buildAssignmentReport(context)};
}
const onDay = (report, day) => report.days.find(row => row.day === day);

test('progress uses the complete roster and only saved meeting assignments', () => {
  const f = fixture();
  const report = f.report();
  assert.equal(report.total, 6);
  assert.equal(report.assigned, 4);
  assert.equal(report.unassigned, 2);
  assert.equal(report.assignmentPercent, 4 / 6 * 100);
  assert.equal(report.assigned + report.unassigned, report.total);
  assert.equal(report.scheduledCongregations, 4);
  assert.equal(report.assignedWithoutDay, 1);
  assert.equal(report.unassignedWithDay, 1);
  assert.equal(report.generatedAt, now.toISOString());
  assert.equal(report.sharedReady, true);
  assert.equal(report.records.some(row => row.id === 'outside-roster'), false);

  const filtered = buildAssignmentReport({...f.context, visible: [f.congregations[4]], selected: new Set(['E']), point: {id: 'two'}, draftPoint: 'two'});
  assert.deepEqual(filtered, report, 'Directory filters, checkbox selections, and draft destinations never change the all-roster report');
});

test('each scheduled congregation-location pair receives delegates, including shared locations', () => {
  const report = fixture().report();
  assert.equal(report.delegatesPerCongregation, DEFAULT_DELEGATES_PER_CONGREGATION);
  assert.deepEqual(onDay(report, 'Monday'), {
    day: 'Monday', totalCongregations: 3, assignedCongregations: 2, unassignedCongregations: 1,
    meetingLocations: 1, estimatedDelegates: 100
  });
  assert.deepEqual(onDay(report, 'Friday'), {
    day: 'Friday', totalCongregations: 2, assignedCongregations: 1, unassignedCongregations: 1,
    meetingLocations: 1, estimatedDelegates: 50
  });
  assert.equal(onDay(report, 'Wednesday').estimatedDelegates, 50);
  for (const row of report.days) {
    assert.equal(row.assignedCongregations + row.unassignedCongregations, row.totalCongregations);
    assert.equal(row.estimatedDelegates, row.assignedCongregations * report.delegatesPerCongregation);
    assert.ok(row.meetingLocations <= row.assignedCongregations);
  }
});

test('a service day without a location and a location without a service day stay out of delegate estimates', () => {
  const f = fixture();
  const before = f.report();
  assert.equal(onDay(before, 'Monday').totalCongregations, 3);
  assert.equal(onDay(before, 'Monday').estimatedDelegates, 100);
  f.assignments.set('E', {meetingPointId: 'two'});
  const paired = f.report();
  assert.equal(onDay(paired, 'Monday').totalCongregations, 3);
  assert.equal(onDay(paired, 'Monday').estimatedDelegates, 150);
  assert.equal(onDay(paired, 'Friday').estimatedDelegates, 100);
  assert.equal(paired.unassignedWithDay, 0);
  f.schedules.set('C', ['Tuesday']);
  const scheduled = f.report();
  assert.equal(onDay(scheduled, 'Tuesday').estimatedDelegates, 50);
  assert.equal(scheduled.assignedWithoutDay, 0);
  f.assignments.delete('A');
  const unassigned = f.report();
  assert.equal(onDay(unassigned, 'Wednesday').totalCongregations, 1);
  assert.equal(onDay(unassigned, 'Wednesday').estimatedDelegates, 0);
});

test('multiple weekdays count participation on each day without duplicating a day or the unique roster', () => {
  const f = fixture({congregations: [{id: 'A', name: 'One congregation'}]});
  f.schedules.set('A', ['Sunday', 'Monday', 'Sunday', 'Someday', 'monday']);
  const report = f.report();
  assert.equal(report.total, 1);
  assert.equal(report.scheduledCongregations, 1);
  assert.deepEqual(report.records[0].days, ['Monday', 'Sunday']);
  assert.deepEqual(report.days.map(row => row.day), SERVICE_DAYS);
  assert.equal(onDay(report, 'Monday').estimatedDelegates, 50);
  assert.equal(onDay(report, 'Sunday').estimatedDelegates, 50);
  assert.equal(report.days.reduce((sum, row) => sum + row.totalCongregations, 0), 2);
  f.schedules.set('A', 'Monday');
  assert.equal(f.report().scheduledCongregations, 0, 'Malformed schedule strings do not invent participation');
});

test('changing the delegate assumption recalculates every day and preserves a deliberate zero', () => {
  const normal = fixture().report();
  for (const factor of [37, '65', 0, 10000]) {
    const report = fixture({delegatesPerCongregation: factor}).report();
    assert.equal(report.delegatesPerCongregation, Number(factor));
    assert.equal(report.total, normal.total);
    assert.equal(report.assigned, normal.assigned);
    for (let i = 0; i < report.days.length; i++) {
      assert.equal(report.days[i].totalCongregations, normal.days[i].totalCongregations);
      assert.equal(report.days[i].estimatedDelegates, normal.days[i].assignedCongregations * Number(factor));
    }
  }
});

test('saved assignments remain counted when their meeting-location catalog entry is unavailable', () => {
  const f = fixture({locations: []});
  const report = f.report();
  assert.equal(report.assigned, 4);
  assert.equal(onDay(report, 'Friday').estimatedDelegates, 50);
  assert.equal(report.records.find(row => row.id === 'D').meetingPointName, 'Saved rail station');
  assert.equal(report.records.find(row => row.id === 'A').meetingPointName, 'Saved meeting location');
  assert.equal(report.records.find(row => row.id === 'F').assigned, false);
  assert.equal(report.records.find(row => row.id === 'F').meetingPointName, '');
});

test('duplicate or missing congregation IDs cannot inflate the numerator, denominator, or daily counts', () => {
  const f = fixture();
  f.context.congregations = [...f.congregations, {...f.congregations[0]}, {...f.congregations[0], id: ' A '}, {name: 'No ID'}, {id: ' '}];
  const report = f.report();
  assert.equal(report.total, 6);
  assert.equal(report.assigned, 4);
  assert.equal(onDay(report, 'Monday').totalCongregations, 3);
  assert.equal(onDay(report, 'Monday').estimatedDelegates, 100);
  assert.equal(report.records.filter(row => row.id === 'A').length, 1);
});

test('empty and unready datasets keep a finite zero-state and retain the freshness flag', () => {
  const empty = buildAssignmentReport({now});
  assert.equal(empty.total, 0);
  assert.equal(empty.assigned, 0);
  assert.equal(empty.unassigned, 0);
  assert.equal(empty.assignmentPercent, 0);
  assert.equal(empty.sharedReady, false);
  assert.equal(empty.days.length, 7);
  assert.ok(empty.days.every(row => row.totalCongregations === 0 && row.estimatedDelegates === 0));
  const cached = fixture({sharedReady: false}).report();
  assert.equal(cached.sharedReady, false);
  assert.equal(cached.assigned, 4, 'Cached data is retained and labeled, not erased');
});

test('report generation does not modify saved assignments, schedules, or roster data', () => {
  const f = fixture();
  const before = structuredClone({congregations: f.congregations, assignments: f.assignments, schedules: f.schedules});
  const report = f.report();
  report.records[0].days.push('Saturday');
  assert.deepEqual({congregations: f.congregations, assignments: f.assignments, schedules: f.schedules}, before);
});

test('delegate values reject blanks, fractions, negative values, nonnumbers, and out-of-range values', () => {
  assert.equal(normalizeDelegateCount(), 50);
  assert.equal(normalizeDelegateCount(' 75 '), 75);
  for (const value of [null, '', ' ', -1, '-1', 1.25, '50.1', NaN, Infinity, 'abc', 10001,
    true, false, [], [50], {}, {valueOf: () => 50}, new Number(50)]) {
    assert.throws(() => normalizeDelegateCount(value), /whole number/);
    assert.throws(() => fixture({delegatesPerCongregation: value}).report(), /whole number/);
  }
});

test('stored delegate settings retain zero, recover corrupt values, and work when storage is unavailable', () => {
  const entries = new Map();
  const storage = {getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value)};
  assert.equal(readDelegateSetting(storage), 50);
  assert.equal(saveDelegateSetting('65', storage), 65);
  assert.equal(entries.get(DELEGATE_SETTING_KEY), '65');
  assert.equal(readDelegateSetting(storage), 65);
  saveDelegateSetting(0, storage);
  assert.equal(readDelegateSetting(storage), 0);
  for (const corrupt of ['', 'bad', '-2', '2.5', '10001']) {
    entries.set(DELEGATE_SETTING_KEY, corrupt);
    assert.equal(readDelegateSetting(storage), 50);
  }
  const blocked = {getItem() {throw Error('Storage blocked');}, setItem() {throw Error('Storage blocked');}};
  assert.equal(readDelegateSetting(blocked), 50);
  assert.equal(saveDelegateSetting(42, blocked), 42);
  assert.equal(readDelegateSetting(), 50);
  assert.equal(saveDelegateSetting(40), 40);
  assert.throws(() => saveDelegateSetting('bad', storage), /whole number/);
});

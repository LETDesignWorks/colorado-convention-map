import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildAssignmentReport, normalizeDelegateCount} from '../assignments/report-model.mjs';
import {prepareAssignmentDrives} from '../assignments/drive-times.mjs';
import {SERVICE_DAYS_TYPE, readServiceDays} from '../assignments/service-days-model.mjs';

// Exercise the real page callbacks with a small Firestore/document boundary.
// This avoids importing remote Firebase modules or writing to shared data.
const source = readFileSync(new URL('../assignments/app-v3.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const begin = source.indexOf(start), finish = end ? source.indexOf(end, begin) : source.length;
  assert.ok(begin >= 0 && finish > begin, `Missing app section: ${start}`);
  return source.slice(begin, finish);
}

function fixture() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {disabled: true, textContent: '', events: {}, addEventListener(name, callback) {this.events[name] = callback;}});
    return elements.get(id);
  };
  const congregations = ['a', 'b', 'c'].map(id => ({id, name: `Congregation ${id}`}));
  const assignments = new Map(), profiles = new Map(), updates = [], downloads = [], prints = [], toasts = [];
  let value = '50', accepted = 50, onSnapshotData, onSnapshotError, context;
  const isValid = () => {try {normalizeDelegateCount(value); return true;} catch {return false;}};
  const reportUi = {
    getValue: () => accepted, valid: isValid, validatedValue: () => normalizeDelegateCount(value),
    update: (report, options) => updates.push({report, ...options})
  };
  context = vm.createContext({
    document: {getElementById: element}, reportUi, buildAssignmentReport, CONGREGATIONS: congregations,
    locations: [{id: 'point', name: 'Meeting location'}], assignmentFor: id => assignments.get(id),
    serviceDaysFor: id => readServiceDays(profiles.get(id)), assignments, serviceDayProfiles: profiles,
    publicLocationData: new Map(), addressProfiles: new Map(), SERVICE_DAYS_TYPE,
    reportDataLoaded: false, reportDataError: '', publicReady: false, excelExportBusy: false, pdfExportBusy: false,
    assignmentsUnsubscribe: null, selectedMeetingPointId: '', selectedCongregations: new Set(['c']),
    db: {}, collection: (_db, name) => name,
    onSnapshot: (_collection, _options, success, error) => {onSnapshotData = success; onSnapshotError = error; return () => {};},
    withMeetingStatus: (_id, data) => data, rebuildLocations() {}, locationUi: {render() {}},
    renderAll: () => context.renderAssignmentReport(), loadDrives: async () => {}, prepareAssignmentDrives, drives:{ensure:async()=>{}},
    filteredCongregations: () => [congregations[2]], resolveHome: () => ({}), driveState: () => ({}),
    downloadAssignmentWorkbook: options => downloads.push(options),
    printAssignmentReport: report => {prints.push(report); return Promise.resolve();},
    toast: (message, error) => toasts.push({message, error}), friendlyError: error => error.message
  });
  vm.runInContext(section('function currentAssignmentReport(', 'function clean('), context);
  vm.runInContext(section('function subscribeToPublicData(', 'async function loadRailMeetingPoints('), context);
  vm.runInContext(section("document.getElementById('exportAssignments').addEventListener('click'"), context);
  context.subscribeToPublicData();
  context.renderAssignmentReport();
  return {
    context, element, congregations, updates, downloads, prints, toasts,
    current: () => updates.at(-1),
    feed(records, {cached = false} = {}) {
      onSnapshotData({metadata: {fromCache: cached}, empty: records.length === 0,
        forEach(callback) {for (const record of records) callback({id: record.id, data: () => record});}});
    },
    fail: () => onSnapshotError(new Error('Network unavailable')),
    setInput(next) {
      value = next;
      if (isValid()) {accepted = normalizeDelegateCount(next); context.renderAssignmentReport();}
      else context.updateReportExportButtons();
    },
    excel: () => element('exportAssignments').events.click(),
    pdf: () => element('exportAssignmentPdf').events.click()
  };
}

const savedA = [
  {id: 'assignment-a', recordType: 'congregation-assignment', congregationId: 'a', meetingPointId: 'point'},
  {id: 'days-a', recordType: SERVICE_DAYS_TYPE, congregationId: 'a', serviceDays: ['Monday']}
];

test('a cold or empty-cache page cannot export fabricated zero assignments; a confirmed empty dataset can', async () => {
  const f = fixture();
  assert.equal(f.current().available, false);
  assert.equal(f.element('exportAssignments').disabled, true);
  assert.equal(f.element('exportAssignmentPdf').disabled, true);
  await f.excel(); await f.pdf();
  assert.equal(f.downloads.length, 0); assert.equal(f.prints.length, 0);
  f.feed([], {cached: true});
  assert.equal(f.current().available, false);
  f.fail();
  assert.match(f.current().unavailableMessage, /could not load/);
  assert.equal(f.element('exportAssignmentPdf').disabled, true);
  f.feed([]);
  assert.equal(f.current().available, true);
  assert.equal(f.current().report.sharedReady, true);
  assert.equal(f.current().report.total, 3);
  assert.equal(f.current().report.assigned, 0);
  await f.pdf();
  assert.equal(f.prints.length, 1);
  assert.equal(f.prints[0].unassigned, 3);
});

test('cached and fresh snapshots refresh report counts while preserving their freshness and full-roster scope', () => {
  const f = fixture();
  f.feed(savedA, {cached: true});
  assert.equal(f.current().available, true);
  assert.equal(f.current().report.sharedReady, false);
  assert.equal(f.current().report.total, 3);
  assert.equal(f.current().report.assigned, 1);
  assert.equal(f.current().report.days[0].estimatedDelegates, 50);
  assert.equal(f.element('exportAssignments').disabled, false);
  f.feed([...savedA,
    {id: 'assignment-b', recordType: 'congregation-assignment', congregationId: 'b', meetingPointId: 'point'},
    {id: 'days-b', recordType: SERVICE_DAYS_TYPE, congregationId: 'b', serviceDays: ['Monday', 'Friday']}
  ]);
  assert.equal(f.current().report.sharedReady, true);
  assert.equal(f.current().report.assigned, 2);
  assert.equal(f.current().report.days[0].estimatedDelegates, 100);
  assert.equal(f.current().report.days[4].estimatedDelegates, 50);
  f.fail();
  assert.equal(f.current().available, true);
  assert.equal(f.current().report.sharedReady, false);
  assert.equal(f.current().report.assigned, 2, 'A connection error labels retained data instead of replacing it with zeros');
});

test('Excel revalidates the assumption after asynchronous preparation and exports the latest accepted value', async () => {
  const f = fixture(); f.feed(savedA);
  let finish;
  f.context.loadDrives = () => new Promise(resolve => {finish = resolve;});
  const exporting = f.excel();
  assert.equal(f.element('exportAssignments').disabled, true);
  f.setInput('');
  assert.equal(f.element('exportAssignmentPdf').disabled, true);
  finish(); await exporting;
  assert.equal(f.downloads.length, 0);
  assert.equal(f.context.excelExportBusy, false);
  assert.match(f.toasts.at(-1).message, /whole number/);
  f.setInput('75');
  assert.equal(f.element('exportAssignments').disabled, false);
  f.context.loadDrives = async () => {};
  await f.excel();
  assert.equal(f.downloads.length, 1);
  const exported = f.downloads[0];
  assert.equal(exported.delegatesPerCongregation, 75);
  assert.equal(exported.congregations.length, 3);
  assert.equal(exported.visible.length, 1);
  assert.equal(buildAssignmentReport(exported).assigned, 1);
  assert.equal(buildAssignmentReport(exported).days[0].estimatedDelegates, 75);
});

test('PDF validates before opening, preserves a zero assumption, and blocks duplicate preparation', async () => {
  const f = fixture(); f.feed(savedA);
  f.setInput('-1');
  await f.pdf();
  assert.equal(f.prints.length, 0);
  f.setInput('0');
  let finish;
  f.context.printAssignmentReport = report => {f.prints.push(report); return new Promise(resolve => {finish = resolve;});};
  const printing = f.pdf();
  assert.equal(f.prints.length, 1, 'The print entry point runs synchronously while the click still has user activation');
  assert.equal(f.prints[0].delegatesPerCongregation, 0);
  assert.equal(f.prints[0].days[0].estimatedDelegates, 0);
  assert.equal(f.element('exportAssignmentPdf').disabled, true);
  await f.pdf();
  assert.equal(f.prints.length, 1);
  finish(); await printing;
  assert.equal(f.context.pdfExportBusy, false);
  assert.equal(f.element('exportAssignmentPdf').disabled, false);
  f.context.printAssignmentReport = () => {throw Error('Popup blocked');};
  await f.pdf();
  assert.match(f.toasts.at(-1).message, /Popup blocked/);
  assert.equal(f.context.pdfExportBusy, false);
  assert.equal(f.element('exportAssignmentPdf').disabled, false);
});

test('Excel waits for all assigned destination checks before creating the workbook',async()=>{
 const f=fixture();f.feed([...savedA,{id:'assignment-b',recordType:'congregation-assignment',congregationId:'b',meetingPointId:'second'}]);
 f.context.locations.push({id:'second',name:'Second meeting location'});
 const checked=[];let finish;
 f.context.drives.ensure=async(_homes,point,options)=>{checked.push([point.id,options.includeDistance]);if(point.id==='second')await new Promise(resolve=>{finish=resolve;});};
 const exporting=f.excel();await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(checked,[['point',true],['second',true]]);assert.equal(f.downloads.length,0);
 finish();await exporting;assert.equal(f.downloads.length,1);
});

from pathlib import Path
import re
VERSION = 'territories-20261022-38'
def read(path): return Path(path).read_text()
def write(path, data):
    target = Path(path)
    old = target.read_bytes() if target.exists() else b''
    newline = '\r\n' if b'\r\n' in old else '\n'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data.replace('\r\n', '\n').replace('\n', newline).encode())
def once(s, old, new):
    if s.count(old) != 1: raise ValueError(f'Expected one source anchor ({s.count(old)}): {old[:100]}')
    return s.replace(old, new, 1)
def replace_function(s, name, replacement):
    match = re.search(r'^(?:async )?function '+re.escape(name)+r'\(', s, re.M)
    if not match: raise ValueError('Missing function '+name)
    end = re.search(r'^(?:async )?function \w+\(', s[match.end():], re.M)
    if not end: raise ValueError('Missing next function '+name)
    return s[:match.start()] + replacement.rstrip() + '\n\n' + s[match.end()+end.start():]
app = read('territories/app-main.js')
app = once(app, '  getSavedPlans: () => savedPlans().map(item => ({ ...item })),', '''  getSavedPlans: () => savedPlans().map(item => ({ ...item })),
  getSavedRecords: () => new Map(reviewRecords),
  getSavedRecordsStatus: () => savedRecordsStatus,
  getWorkspaceGeneration: () => workspaceGeneration,
  setMeetingSearchBoundary: geometry => {
    if (!requireAdmin()) return false;
    setBoundaryGeometry(geometry, true, true);
    return true;
  },
  saveMeetingPlaceBoundary,''')
app = once(app, 'function serializeHouse(house) {', '''async function saveMeetingPlaceBoundary(geometry, expected) {
  if (!isAdmin() || !selectedHall || !selectedCongregation) throw new Error('Sign in and select a meeting place first.');
  if (savedRecordsStatus !== 'ready') throw new Error('Saved records are not ready. Reconnect before adopting a boundary.');
  const generation = workspaceGeneration, hall = { ...selectedHall }, congregation = selectedCongregation;
  if (!expected || expected.generation !== generation || workKey(expected.hallId, expected.congregation) !== workKey(hall.id, congregation)) {
    throw new Error('The selected workspace changed. No meeting-place boundary was saved.');
  }
  const shape = JSON.parse(JSON.stringify(geometry?.type === 'Feature' ? geometry.geometry : geometry));
  if (!['Polygon', 'MultiPolygon'].includes(shape?.type) || !(turf.area(turf.feature(shape)) > 0)) throw new Error('The boundary is not usable.');
  if (JSON.stringify(shape) !== JSON.stringify(boundaryGeometry)) throw new Error('The search boundary changed before it was confirmed. Review it again.');
  // Each approval is independent; earlier plans, PDFs and boundaries stay intact.
  const ref = doc(collection(db, 'reviews'));
  const record = { recordType: 'territory-boundary', meetingPlaceBoundary: true,
    name: `${hall.name} — ${congregation} meeting-place boundary`, hallId: hall.id,
    hallLabel: markerLabel(hall), hallName: hall.name, hallAddress: hall.address || '', congregation,
    boundaryJson: encodeGeometry(shape), addressSetBoundary: true, sourceHint: currentSourceKey(),
    updatedByEmail: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await setDoc(ref, record);
  if (isAdmin()) {
    reviewRecords.set(ref.id, { ...record, id: ref.id, updatedAt: new Date() });
    renderSavedRecords();
  }
  return ref.id;
}

function serializeHouse(house) {''')
app = once(app, "  const congregations = selectedHall?.congregations?.length ? selectedHall.congregations : [selectedHall?.name || 'Planning group'];", '''  const listed = selectedHall?.congregations?.length ? selectedHall.congregations : [selectedHall?.name || 'Planning group'];
  const saved = savedPlans().filter(plan => String(plan.hallId) === String(selectedHall?.id) && clean(plan.congregation));
  const congregations = [...new Set([...listed, ...saved.map(plan => clean(plan.congregation))])];
  if (!congregations.includes(preferred)) {
    const current = latestWork(saved)[0] || saved.find(plan => plan.addressSetMode || plan.addressOnlyMode);
    if (current) preferred = clean(current.congregation);
  }''')
app = once(app, '''  els.congregationSelect.addEventListener('change', () => {
    selectedCongregation = els.congregationSelect.value;
    if (!clean(els.territoryPrefix.value)) els.territoryPrefix.value = initialPrefix(selectedCongregation);
    updateSummary();
  });''', '''  els.congregationSelect.addEventListener('change', () => {
    const next = els.congregationSelect.value;
    if (next === selectedCongregation) return;
    if ((houses.length || territories.length || boundaryGeometry) && !confirm('Change congregation and load its saved addresses? Unsaved changes in the current workspace will be lost. Choose Cancel to SAVE YOUR WORK first.')) {
      els.congregationSelect.value = selectedCongregation;
      return;
    }
    clearPlanWorkspace(false);
    selectedCongregation = next;
    if (!clean(els.territoryPrefix.value)) els.territoryPrefix.value = initialPrefix(selectedCongregation);
    updateSummary();
    emitPlannerDataChange();
  });''')
app = once(app, "  const duplicatesRemovedOnLoad = plan.saveKind === 'work' ? 0 : dedupeHouseRecords();", "  const duplicatesRemovedOnLoad = 0; // Saved units, excluded homes and avoid records stay exactly as saved.")
app = once(app, "  toast(`Saved ${plan.addressSetMode ? 'Kingdom Hall address-set '", "  if (document.getElementById('bulkFocus')) document.getElementById('bulkFocus').checked = false;\n  globalThis.__denverMeetingPlaceFlow?.reset();\n  toast(`Saved ${plan.addressSetMode ? 'Kingdom Hall address-set '")
app = once(app, "  toast('New territory workspace ready.');", "  globalThis.__denverMeetingPlaceFlow?.reset();\n  toast('New territory workspace ready.');")
app = once(app, '''    if (boundaryGeometry && !pointInsideBoundary(candidate)) {
      toast('That point is outside the congregation boundary.', true);
      return;
    }''', '    // Keep outside manual points and ask whether to expand the meeting-place boundary.')
for name in ['addMissingAddress', 'addAvoidAddress']:
    m = re.search(r'^(?:async )?function '+name+r'\(', app, re.M)
    e = re.search(r'^(?:async )?function \w+\(', app[m.end():], re.M)
    part = app[m.start():m.end()+e.start()]
    part = re.sub(r"  if \(!boundaryGeometry\) \{ toast\('[^']*', true\); return; \}\n", "  if (!selectedHall || !selectedCongregation) { toast('Select the meeting place and congregation first.', true); return; }\n", part)
    part = re.sub(r"    if \(!pointInsideBoundary\(candidate\)\) \{\n      throw new Error\('[^']*'\);\n    \}\n", '    // Retain an outside address for the meeting-boundary expansion prompt.\n', part)
    part = re.sub(r"    if \(!pointInsideBoundary\(candidate\)\) throw new Error\('[^']*'\);\n", '    // Outside addresses are kept for the expansion prompt.\n', part)
    part = part.replace('  try {\n    const result = await geocodeAvoidAddress(address);', '  const requestGeneration = workspaceGeneration;\n  try {\n    const result = await geocodeAvoidAddress(address);\n    if (requestGeneration !== workspaceGeneration || !isAdmin()) return;')
    app = app[:m.start()] + part + app[m.end()+e.start():]
m = app.index('async function importAddressFile(file) {'); e = app.index('\nfunction houseStyle(', m)
p = app[m:e]
p = p.replace("  if (!boundaryGeometry) { toast('Draw or load the congregation boundary before importing addresses.', true); return; }", "  if (!selectedHall || !selectedCongregation) { toast('Select the meeting place and congregation first.', true); return; }")
p = p.replace('  try {\n    const text = await file.text();', '  const requestGeneration = workspaceGeneration;\n  try {\n    const text = await file.text();\n    if (requestGeneration !== workspaceGeneration || !isAdmin()) return;')
p = p.replace('const filtered = dedupeAddressRecords(records);', 'const filtered = records.filter(validMapCoordinates);')
p = p.replace('imported address points added inside the current boundary.', 'imported address points added. Outside addresses will prompt a boundary review.')
app = app[:m] + p + app[e:]
write('territories/app-main.js', app)
s = read('territories/address-source-merge.js')
start = s.index('function syncCardVisibility()'); end = s.index('\nfunction updateCounts()', start)
s = s[:start]+'''function syncCardVisibility() {
  const card = document.getElementById('addressSourceMergeCard');
  if (!card) return;
  const ready = Boolean(planner?.getSelectedHall?.() && planner?.getSelectedCongregation?.());
  card.classList.toggle('territory-workflow-hidden', !ready);
  placeAvoidAfterAssessor();
}
'''+s[end:]
write('territories/address-source-merge.js', s)
bulk = read('territories/bulk-addresses.js')
bulk = once(bulk, "  const batchName=clean(el.name.value)||'Prepared address list';", "  const requestGeneration=api.getWorkspaceGeneration?.(),requestHall=String(api.getSelectedHall()?.id||''),requestCongregation=api.getSelectedCongregation();\n  const batchName=clean(el.name.value)||'Prepared address list';")
bulk = bulk.replace('  for(const result of results){', "  if(requestGeneration!==api.getWorkspaceGeneration?.()||requestHall!==String(api.getSelectedHall()?.id||'')||requestCongregation!==api.getSelectedCongregation()||!api.isAdmin()){el.progress.hidden=true;refresh();return;}\n  for(const result of results){", 1)
write('territories/bulk-addresses.js', bulk)
scanner = read('territories/assessor-full-boundary.js')
scanner = "import { captureScanScope, scanScopeIsCurrent } from './meeting-place-model.js?v="+VERSION+"';\n"+scanner
scanner = scanner.replace("const FULL_BOUNDARY_VERSION = 'territories-20261011-20';", "const FULL_BOUNDARY_VERSION = '"+VERSION+"';")
scanner = replace_function(scanner, 'mergeFeatures', read('.github/patches/meeting-38-merge.txt'))
scanner = replace_function(scanner, 'runEveryAddressInsideBoundary', read('.github/patches/meeting-38-run.txt'))
scanner = scanner.replace('if (plannerApi()?.getHouses?.() && plannerApi()?.getBoundaryGeometry?.()) break;', 'if (plannerApi()?.getHouses?.() && plannerApi()?.getMap?.()) break;')
write('territories/assessor-full-boundary.js', scanner)
one = read('territories/assessor-one-click.js')
one = once(one, "button.disabled = !planner?.isAdmin?.() || !(planner?.getHouses?.() || []).some(house => planner?.validMapCoordinates?.(house));", "button.disabled = !planner?.isAdmin?.() || !planner?.getSelectedHall?.() || !planner?.getSelectedCongregation?.();")
write('territories/assessor-one-click.js', one)
boot = read('territories/bootstrap.js')
boot = boot.replace("const version = 'territories-20261022-37';", "const version = '"+VERSION+"';")
for name in ['app-main', 'bulk-addresses', 'address-source-merge', 'assessor-full-boundary', 'assessor-one-click']:
    boot, count = re.subn(r"('./"+name+r"\.js\?v=)[^']+", r'\g<1>'+VERSION, boot)
    if count != 1: raise ValueError('Bootstrap import '+name)
boot = once(boot, "  await import('./saved-work-ui.js?v=territories-20261022-37');", "  await import('./saved-work-ui.js?v=territories-20261022-37');\n  await import('./meeting-place-ui.js?v="+VERSION+"');")
write('territories/bootstrap.js', boot)
write('territories/index.html', read('territories/index.html').replace('bootstrap.js?v=territories-20261022-37', 'bootstrap.js?v='+VERSION))
test = read('tests/saved-work-integration.test.mjs')
start = test.index("test('assessor-fill panel is hidden until usable addresses are loaded'")
end = test.index("test('return section", start)
test = test[:start]+'''test('assessor-fill panel is available for a selected meeting place even before uploads', () => {
  const source = read('territories/address-source-merge.js');
  const sync = section(source, 'function syncCardVisibility() {', '\\nfunction updateCounts()');
  const card = { classList: fakeClassList() };
  let hall = null, congregation = '';
  const context = { document: { getElementById: () => card }, planner: { getSelectedHall: () => hall, getSelectedCongregation: () => congregation }, placeAvoidAfterAssessor() {} };
  vm.createContext(context); vm.runInContext(sync+'\\nsyncCardVisibility();', context);
  assert.equal(card.classList.contains('territory-workflow-hidden'), true);
  hall = { id: '21' }; congregation = 'Highlands Ranch'; vm.runInContext('syncCardVisibility();', context);
  assert.equal(card.classList.contains('territory-workflow-hidden'), false);
});
'''+test[end:]
test = test.replace("for (const name of ['app-main', 'hall-address-sets', 'territory-workflow-ui', 'address-source-merge', 'assessor-one-click', 'saved-work-ui']) assert.ok(bootstrap.includes(`${name}.js?v=territories-20261022-37`));", "for (const name of ['hall-address-sets', 'territory-workflow-ui', 'saved-work-ui']) assert.ok(bootstrap.includes(`${name}.js?v=territories-20261022-37`));\n  for (const name of ['app-main', 'address-source-merge', 'bulk-addresses', 'assessor-full-boundary', 'assessor-one-click', 'meeting-place-ui']) assert.ok(bootstrap.includes(`${name}.js?v=territories-20261022-38`));")
test = test.replace("assert.match(main, /plan\\.saveKind === 'work' \\? 0 : dedupeHouseRecords\\(\\)/);", "assert.match(main, /const duplicatesRemovedOnLoad = 0;/);")
write('tests/saved-work-integration.test.mjs', test)
print('Applied meeting-place restoration and boundary prompts. No database records read or modified.')

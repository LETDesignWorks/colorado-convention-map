from pathlib import Path

def change(path, old, new):
    target = Path(path)
    source = target.read_text()
    if source.count(old) != 1:
        raise SystemExit(f'Unexpected source in {path}: {old[:70]!r}')
    target.write_text(source.replace(old, new))

# Saving a complete snapshot must not normalize away any of the addresses the
# user currently sees, including separate units and excluded address records.
change('territories/app-main.js',
       "  const duplicatesRemoved = dedupeHouseRecords();\n  if (duplicatesRemoved) renderAllPlanningData();\n  const key = workKey(selectedHall.id, selectedCongregation);",
       "  const key = workKey(selectedHall.id, selectedCongregation);")
change('territories/app-main.js',
       '  const duplicatesRemovedOnLoad = dedupeHouseRecords();',
       "  const duplicatesRemovedOnLoad = plan.saveKind === 'work' ? 0 : dedupeHouseRecords();")
path = Path('tests/saved-work-integration.test.mjs')
source = path.read_text()
source += '''

test('SAVE YOUR WORK keeps every loaded record without silently deduplicating units', async () => {
  const h = harness();
  let dedupeCalls = 0;
  h.context.dedupeHouseRecords = () => { dedupeCalls++; return 0; };
  h.context.houses = [house('unit-a', null, { address: '100 Example St Apt 1', unit: '1' }), house('unit-b', null, { address: '100 Example St Apt 2', unit: '2' }), house('excluded', null, { included: false })];
  const id = await h.save({ saveYourWork: true });
  const saved = model.readPlanAddresses({ ...h.stored.get(id), id }, h.stored);
  assert.equal(saved.length, 3); assert.equal(dedupeCalls, 0);
  assert.equal(saved.find(home => home.id === 'excluded').included, false);
  assert.equal(saved.find(home => home.id === 'unit-b').unit, '2');
});

test('loading protected complete saved work preserves its exact address records', () => {
  assert.match(main, /plan\\.saveKind === 'work' \\? 0 : dedupeHouseRecords\\(\\)/);
});
'''
path.write_text(source)
# Match the existing repository's line endings so code review shows only the
# functional edits instead of a whole-file newline change.
for name in ['app-main.js', 'bootstrap.js', 'template.html', 'index.html']:
    path = Path('territories')/name
    text = path.read_text()
    path.write_bytes(text.replace('\r\n', '\n').replace('\n', '\r\n').encode())
print('Preserved all loaded address records and retained original file line endings.')

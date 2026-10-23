from pathlib import Path
import re, json, gzip, base64, hashlib
encoded = ''.join(p.read_text().strip() for p in sorted(Path('.github/patches').glob('backup-39-part*.txt')))
raw = gzip.decompress(base64.b64decode(encoded))
assert hashlib.sha256(raw).hexdigest() == 'd48aa845697e2373cc34147d2143afaddca012e69d215f701406b7bc2cbaa767', 'Source package checksum failed'
payload = json.loads(raw)
VERSION = 'territories-20261022-39'
updates = {}
original = {}
def read(path):
    if path in updates: return updates[path]
    data = Path(path).read_bytes(); original[path] = data
    return data.decode().replace('\r\n', '\n')
def put(path, value): updates[path] = value

def once(s, old, new, count=1):
    found = s.count(old)
    if found != count: raise RuntimeError(f'Expected {count} occurrences, found {found}: {old[:110]!r}')
    return s.replace(old, new)

main = read('territories/app-main.js')
main = once(main, 'writeBatch, query, where, getDoc\n', 'writeBatch, query, where, getDoc, getDocFromServer, getDocsFromServer, runTransaction\n')
main = once(main, "import { HALLS } from './halls.js';", "import { createBackupTools } from './backup-merge-service.js?v=" + VERSION + "';\nimport { workspaceStamp as mergeWorkspaceStamp, stable as mergeStable, deletionProblem as backupDeletionProblem } from './backup-merge-model.js?v=" + VERSION + "';\nimport { HALLS } from './halls.js';")
main = once(main, 'const saveAsWork = Boolean(options.saveYourWork || activeSavedWorkKey === key || (partialEdit && latest));', 'const saveAsWork = !options.forceBackup && Boolean(options.saveYourWork || activeSavedWorkKey === key || (partialEdit && latest));')
main = once(main, "  if (!houses.length) return unavailable('Load or add addresses before saving your work.');", "  if (!houses.length) return unavailable('Load or add addresses before saving your work.');\n  if (options.expectedMergeFingerprint && options.expectedMergeFingerprint !== mergeWorkspaceStamp(backupWorkspaceSnapshot())) return unavailable('The workspace changed before the merged save began. Review it and save again.');")
main = once(main, "  const planName = base?.planName || clean(els.planName.value) || defaultName;", "  const planName = clean(options.backupName) || base?.planName || clean(els.planName.value) || defaultName;")
main = once(main, "      sourcePlanId: currentPlanId || null,", "      sourcePlanId: currentPlanId || null,\n      mergedFromRecordIds: [...new Set([...(reviewRecords.get(currentPlanId)?.mergedFromRecordIds || []), ...(Array.isArray(options.mergeSourceIds) ? options.mergeSourceIds.map(String) : [])])],")
main = once(main, "['territory-boundary', 'territory-plan', 'territory-plan-chunk', 'territory-pdf']", "['territory-boundary', 'territory-plan', 'territory-plan-chunk', 'territory-pdf', 'territory-name-choice']")
main = once(main, "filter(item => item.recordType === 'territory-boundary')", "filter(item => item.recordType === 'territory-boundary' && !item.deletedAt)")
main = once(main, "filter(item => item.recordType === 'territory-plan')", "filter(item => item.recordType === 'territory-plan' && !item.deletedAt)")
main = once(main, "filter(item => item.recordType === 'territory-pdf')", "filter(item => item.recordType === 'territory-pdf' && !item.deletedAt)")
main = once(main, "record => record.recordType === 'territory-pdf' && Number(record.pdfLayoutVersion", "record => !record.deletedAt && record.recordType === 'territory-pdf' && Number(record.pdfLayoutVersion")
main = once(main, "function loadPlanRecord(id) {\n  const plan = reviewRecords.get(id);\n  if (!plan) return false;", "function loadPlanRecord(id) {\n  const plan = reviewRecords.get(id);\n  if (!plan || plan.deletedAt) return false;")
main = once(main, "function loadBoundaryRecord(id) {\n  const item = reviewRecords.get(id);", "function loadBoundaryRecord(id) {\n  const item = reviewRecords.get(id);\n  if (!item || item.deletedAt) return;")
main = once(main, "  let record = reviewRecords.get(id);\n  if (!record) return;", "  let record = reviewRecords.get(id);\n  if (!record || record.deletedAt) return;")
main = once(main, '    editTerritory: editSavedTerritory,', '    editTerritory: editSavedTerritory,\n    saveNameChoice: (name, key) => backupTools.saveNameChoice(name, key),')
main = once(main, 'globalThis.__denverTerritoryPlannerAPI = Object.freeze({', payload['host'] + '\nglobalThis.__denverTerritoryPlannerAPI = Object.freeze({\n  backupTools,')
main = re.sub(r"(saved-territories-layer|saved-work-model)\.js\?v=territories-\d+-\d+", lambda m: m.group(1)+'.js?v='+VERSION, main)
put('territories/app-main.js', main)

model = read('territories/saved-work-model.js')
model = once(model, "if (plan.recordType !== 'territory-plan' || plan.saveKind !== 'work'", "if (plan.deletedAt || plan.recordType !== 'territory-plan' || plan.saveKind !== 'work'")
put('territories/saved-work-model.js', model)
saved = read('territories/saved-territories-model.js')
saved = once(saved, "filter(r => text(r.hallId) === text(hallId)", "filter(r => !r.deletedAt && text(r.hallId) === text(hallId)")
put('territories/saved-territories-model.js', saved)
meeting = read('territories/meeting-place-model.js')
meeting = once(meeting, "filter(record => record.recordType === 'territory-plan'", "filter(record => !record.deletedAt && record.recordType === 'territory-plan'")
meeting = once(meeting, "filter(record => record.recordType === 'territory-boundary'", "filter(record => !record.deletedAt && record.recordType === 'territory-boundary'")
put('territories/meeting-place-model.js', meeting)

layer = read('territories/saved-territories-layer.js')
layer = once(layer, "const esc = value", "import { groupTerritoriesByName } from './backup-merge-model.js?v="+VERSION+"';\n\nconst esc = value")
layer = once(layer, 'readPdf, editTerritory, L, turf })', 'readPdf, editTerritory, saveNameChoice, L, turf })')
layer = once(layer, "let visible = false, groups = [], selectedKey", "let allGroups = []; const nameOverrides = new Map();\n  let visible = false, groups = [], selectedKey")
layer = once(layer, "    groups = []; selectedKey = ''; selectedVersions.clear();", "    groups = []; allGroups = []; nameOverrides.clear(); selectedKey = ''; selectedVersions.clear();")
layer = once(layer, '      groups = result.groups; issues = result.issues; counts = result;', '      allGroups = result.groups; regroupNames(); issues = result.issues; counts = result;')
layer = once(layer, '`${groups.length} saved territories • ${counts.planCount} plans • ${counts.pdfCount} PDF snapshots. `', '`${groups.length} territory names shown once • ${allGroups.length - groups.length} same-name alternatives available for review • ${counts.planCount} plans • ${counts.pdfCount} PDF snapshots. `')
layer = once(layer, " : 'Latest version of each territory displayed. ')", " : 'One territory per name is displayed; review alternatives to save your keep choice. ')")
layer = once(layer, '<span>${esc(version.congregation)} • ${group.versions.length} saved version(s)</span>', '<span>${esc(version.congregation)} • ${group.versions.length} saved version(s)${group.alternatives?.length > 1 ? ` • Review ${group.alternatives.length} same-name territories` : \'\'}</span>')
layer = once(layer, '      <label for="savedTerritoryVersion">Inspect a saved version</label>', '      ${duplicateReviewHtml(group)}\n      <label for="savedTerritoryVersion">Inspect a saved version</label>')
layer = once(layer, "    el('savedTerritoryVersion').addEventListener('change'", "    wireDuplicateReview(group);\n    el('savedTerritoryVersion').addEventListener('change'")
layer = once(layer, '  function renderMap() {', payload['nameReview'] + '\n  function renderMap() {')
layer = re.sub(r"saved-territories-model\.js\?v=territories-\d+-\d+", 'saved-territories-model.js?v='+VERSION, layer)
put('territories/saved-territories-layer.js', layer)

for path in ['territories/hall-address-sets.js', 'territories/saved-work-ui.js', 'territories/meeting-place-model.js', 'territories/meeting-place-ui.js']:
    source = read(path)
    source = re.sub(r'(saved-work-model|meeting-place-model)\.js\?v=territories-\d+-\d+', lambda m: m.group(1)+'.js?v='+VERSION, source)
    put(path,source)
bootstrap=read('territories/bootstrap.js')
bootstrap=re.sub(r"territories-\d{8}-\d+",VERSION,bootstrap)
bootstrap=once(bootstrap, "  await import('./meeting-place-ui.js?v="+VERSION+"');", "  await import('./meeting-place-ui.js?v="+VERSION+"');\n  await import('./backup-merge-ui.js?v="+VERSION+"');")
put('territories/bootstrap.js',bootstrap)
index=read('territories/index.html')
index=re.sub(r'bootstrap\.js\?v=territories-\d+-\d+', 'bootstrap.js?v='+VERSION,index)
put('territories/index.html',index)
test=read('tests/saved-work-integration.test.mjs')
test=re.sub(r'territories-20261022-(?:37|38)',VERSION,test)
put('tests/saved-work-integration.test.mjs',test)

for path,source in payload['files'].items():
    if not (path.startswith('territories/backup-merge-') or path.startswith('tests/backup-merge-')) or '..' in Path(path).parts:
        raise RuntimeError('Unexpected payload path: '+path)
    if Path(path).exists(): raise RuntimeError('Refusing to overwrite new module: '+path)
    put(path,source)
for path,source in updates.items():
    dest=Path(path);dest.parent.mkdir(parents=True,exist_ok=True)
    if b'\r\n' in original.get(path,b''): source=source.replace('\n','\r\n')
    dest.write_bytes(source.encode())
print(f'Prepared {len(updates)} scoped source/test files. No private records were read, merged or deleted.')

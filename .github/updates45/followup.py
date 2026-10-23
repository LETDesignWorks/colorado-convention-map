from pathlib import Path

def change(path, old, new):
    p=Path(path);s=p.read_text();assert s.count(old)==1, (path,old,s.count(old));p.write_text(s.replace(old,new))

# Legacy UI fixtures strip imports; execute the actual viewer in their VM realm.
change('tests/backup-merge-ui.test.mjs',
    "vm.runInNewContext(code+'\\nmountSavedTerritories(host);',context);",
    "vm.runInNewContext(read('territories/saved-pdf-view.js').replace(/^export /gm,'')+'\\n'+code+'\\nmountSavedTerritories(host);',context);")
change('tests/library-release.test.mjs',
    "vm.runInNewContext(read('territories/saved-territories-layer.js').replace(/^import .*;$/gm,'').replace('export function mountSavedTerritories','function mountSavedTerritories')+'\\nmountSavedTerritories(host);',ctx);",
    "vm.runInNewContext(read('territories/saved-pdf-view.js').replace(/^export /gm,'')+'\\n'+read('territories/saved-territories-layer.js').replace(/^import .*;$/gm,'').replace('export function mountSavedTerritories','function mountSavedTerritories')+'\\nmountSavedTerritories(host);',ctx);")
change('tests/library-management.test.mjs',
    r'assert.match(layer,/versionPdf\(version, message\)/);',
    r'assert.match(layer,/versionPdf\(version, progress, options\)/);assert.match(layer,/pdfView.bind/);')
p=Path('tests/territory-pdf-access.test.mjs');s=p.read_text()
s="import { inflateSync } from 'node:zlib';\n"+s
old='assert.match(bytes.toString(),/REVIEW COPY/);'
assert s.count(old)==1
s=s.replace(old,"const streams=[...bytes.toString('latin1').matchAll(/stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream/g)].map(m=>inflateSync(Buffer.from(m[1],'latin1')).toString('latin1')).join('\\n');assert.match(streams,/REVIEW COPY/);assert.match(streams,/DO NOT VISIT/);")
p.write_text(s)
print('Updated UI integration fixtures to exercise the real PDF controller and validate compressed PDF review text.')

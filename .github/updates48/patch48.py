from pathlib import Path
p=Path('bus-access/traffic-model.mjs');s=p.read_text()
start=s.index('export function arrowheads(projected) {')
end=s.index('export function readLayouts(',start)
old=s[start:end]
assert 'projected.slice(1).flatMap' in old and 'Math.floor(len/75)' in old
new=Path('.github/updates48/arrow-function.mjs').read_text()
p.write_text(s[:start]+new+s[end:])
for name in ['bus-access/app-v2.js','bus-access/app.js','bus-access/index.html','bus-access/traffic-planner.mjs','bus-access/traffic-pdf.mjs','tests/bus-traffic-ui.test.mjs']:
    p=Path(name);s=p.read_text();updated=s.replace('traffic-20261023-47','traffic-20261023-48').replace('traffic-20261023-46','traffic-20261023-48')
    assert s!=updated,name
    p.write_text(updated)
# Keep the previous end-to-end export fixture and add a deliberately uneven
# route: its extra vertices must not introduce extra arrows or alter saving.
p=Path('tests/bus-traffic-pdf-browser.mjs');s=p.read_text()
old="await map.click({position:{x:80,y:110}});await map.click({position:{x:200,y:110}});await map.click({position:{x:230,y:200}});"
assert s.count(old)==1
new="for(const [x,y] of [[80,110],[84,110],[91,110],[101,110],[126,110],[148,110],[167,110],[199,110],[200,110],[203,119],[206,128],[215,155],[230,200]])await map.click({position:{x,y}});"
s=s.replace(old,new)
old="await page.locator('[data-finish]').click();"
pos=s.index(old)+len(old)
s=s[:pos]+"\n assert.equal(await page.locator('.traffic-arrow').count(),2,'Unevenly segmented route has exactly two full-path arrows, not one per segment');"+s[pos:]
s=s.replace('test-results/traffic-pdf','test-results/traffic-arrows')
s=s.replace('click-to-draw route, eight cones','even full-route arrow spacing, branded PDF, eight cones')
Path('tests/bus-traffic-arrows-browser.mjs').write_text(s)
print('Updated one shared arrow-placement function for live maps and branded PDFs; no stored geometry or cloud data changed.')

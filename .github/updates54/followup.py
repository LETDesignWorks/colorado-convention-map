import pathlib,json
root=pathlib.Path('tests/fixtures/ccc-drive-time54');root.mkdir(parents=True,exist_ok=True)
for name in ['auto-45.json','auto-outbound.json','auto-inbound.json','sites.json']:
    data=json.loads((pathlib.Path('drive-time-audit')/name).read_text())
    (root/name).write_text(json.dumps(data,separators=(',',':'))+'\n')
p=pathlib.Path('tests/bus-drive-time-area.test.mjs');p.write_text(p.read_text().replace('drive-time-audit/','tests/fixtures/ccc-drive-time54/'))

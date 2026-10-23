from pathlib import Path
p=Path('tests/bus-traffic-browser.mjs');s=p.read_text();old="await page.waitForSelector('dialog[open] .leaflet-pane');";assert s.count(old)==1
s=s.replace(old,"await page.waitForSelector('dialog[open] [data-map]');\n await page.screenshot({path:`test-results/traffic/${viewport.width}-initial.png`});")
p.write_text(s)
p=Path('bus-access/traffic-planner.css');s=p.read_text();s+='\n/* Keep mobile map messages in normal flow instead of covering the tools. */\n@media(max-width:580px){.traffic-map-area{height:auto;min-height:0}.traffic-map{height:42dvh;min-height:300px;flex:none}}\n@media(min-width:581px) and (max-height:700px){.traffic-map{min-height:180px}}\n';p.write_text(s)

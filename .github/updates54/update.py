import pathlib,json,math
root=pathlib.Path('drive-time-audit')
read=lambda n:json.loads((root/(n+'.json')).read_text())
meta=read('metadata'); assert not meta['errors']
assert meta['origin']=={'lat':39.74248,'lon':-104.99567}
request=read('auto-45-request')['payload']; assert request['contours']==[{'time':45}]
assert request['costing_options']['auto']['speed_types']==['freeflow','constrained']
features=[f for f in read('auto-45')['features'] if f['geometry']['type'] in ['Polygon','MultiPolygon']]
assert len(features)==1
feature=features[0]; assert feature['properties']['contour']==45 and feature['properties']['metric']=='time'
for ring in feature['geometry']['coordinates']:
    assert ring[0]==ring[-1] and len(ring)>3
    assert all(len(c)==2 and -107<c[0]<-103 and 38<c[1]<42 for c in ring)
area=pathlib.Path('bus-access/drive-time');area.mkdir(exist_ok=True)
feature['properties']={'minutes':45,'metric':'time','costing':'auto','origin':meta['origin'],'calculatedAt':meta['queriedAt'],'source':'Valhalla / OpenStreetMap, FOSSGIS public service','liveTraffic':False,'predictiveTraffic':False,'busClearanceVerified':False,'generalizeMeters':100}
compact=lambda value:json.dumps(value,separators=(',',':'),ensure_ascii=False)
(area/'convention-center-45.geojson').write_text(compact(feature)+'\n')
sites=read('sites');ao=read('auto-outbound')['sources_to_targets'][0];ai=read('auto-inbound')['sources_to_targets'];bo=read('bus-outbound')['sources_to_targets'][0];bi=read('bus-inbound')['sources_to_targets']
assert len(sites)==len(ao)==len(ai)==len(bo)==len(bi)
checks=[]
for i,s in enumerate(sites):
    assert ao[i]['to_index']==i and ai[i][0]['from_index']==i
    values=[ao[i]['time'],ai[i][0]['time'],bo[i]['time'],bi[i][0]['time']]
    assert all(isinstance(x,(int,float)) and math.isfinite(x) and x>=0 for x in values)
    checks.append({'id':s['id'],'name':s['name'],'lat':s['lat'],'lng':s['lng'],'outboundSeconds':values[0],'returnSeconds':values[1],'busOutboundSeconds':values[2],'busReturnSeconds':values[3],'distanceMiles':ao[i]['distance'],'referenceOnly':s['id'].startswith('sample-')})
report={'origin':meta['origin'],'calculatedAt':meta['queriedAt'],'engine':read('status'),'request':request,'attribution':'OpenStreetMap contributors; routing by Valhalla/FOSSGIS','limitations':'Static road-network driving estimate. Excludes live/predicted congestion, loading, parking, event controls, and motorcoach clearance verification. Inbound travel can differ; boundary is outbound only. Reference points are not approved venues.','checks':checks}
(area/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
js='// One-time road-network snapshot, not a live traffic or motorcoach-clearance service.\n'
js+='export const DRIVE_TIME_AREA = '+compact(feature)+';\n'
js+='export const DRIVE_TIME_CHECKS = '+compact([s for s in checks if not s['referenceOnly']])+';\n'
js+='''export function driveTimeEstimateFor(location) {
  if (!location || location.customLocation || location.lat == null || location.lng == null) return null;
  const row = DRIVE_TIME_CHECKS.find(item => String(item.id) === String(location.id));
  if (!row || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))
      || Math.abs(Number(location.lat) - row.lat) > 0.000001 || Math.abs(Number(location.lng) - row.lng) > 0.000001) return null;
  return { outboundMinutes: Math.round(row.outboundSeconds / 60), returnMinutes: Math.round(row.returnSeconds / 60) };
}
'''
pathlib.Path('bus-access/drive-time-area.mjs').write_text(js)
(area/'README.md').write_text('''# Colorado Convention Center: 45-minute driving estimate

The former map outline was an illustrative DTC boundary translated to a new center, not a road-network calculation. Bus Review now uses `convention-center-45.geojson`, a one-time 45-minute **outbound** automobile isochrone from 39.74248, -104.99567. The GeoJSON is also embedded in `../drive-time-area.mjs` so opening the site makes no requests to the public routing server.

Source: Valhalla, hosted by FOSSGIS, using OpenStreetMap data. Calculated October 23, 2026. Exact request, engine version, graph timestamp and 26 sample round-trip endpoint checks (22 built-in halls plus four reference points) are in `audit.json`. A separate bus-profile request returned the same endpoint times in this sample; that is NOT a motorcoach-clearance approval. No vehicle dimensions were supplied. The routing origin snapped to a mapped road node approximately 43 metres from the configured center.

Only `freeflow` and `constrained` speed sources were requested. No live or predicted traffic was requested, and there is no departure date/time. The outline is an approximate contour from a routing grid, generalized by 100 metres, with the largest connected contour retained. Do not decide eligibility from the outline alone near its edge. Check the specific route, event departure time, bus access and return journey. Loading, unloading, parking, traffic queues and temporary event closures are not included. Existing bus-access approvals and legacy planning-area labels were not changed.

OpenStreetMap data: https://www.openstreetmap.org/copyright
Service and fair use: https://valhalla.github.io/valhalla/start/introduction/
Method: https://valhalla.github.io/valhalla/api/isochrone/api-reference/

The sample checks are model estimates, not observed travel times. Custom/private meeting locations were not queried. No private review, contact or parking-lot records were read or changed.
''')
old='bus-center-20261023-53';new='bus-drive-time-20261023-54'
p=pathlib.Path('bus-access/app-v2.js');s=p.read_text()
s=s.replace("import { HALLS, DTC_BOUNDARY, DTC } from './data.js';","import { HALLS } from './data.js';")
s=s.replace("import { CONVENTION_CENTER, recenterPlanningBoundary } from './planning-center.mjs?v="+old+"';\nconst PLANNING_BOUNDARY = recenterPlanningBoundary(DTC_BOUNDARY, DTC);", "import { CONVENTION_CENTER } from './planning-center.mjs?v="+old+"';\nimport { DRIVE_TIME_AREA, driveTimeEstimateFor } from './drive-time-area.mjs?v="+new+"';")
s=s.replace("boundaryLayer=L.polygon(PLANNING_BOUNDARY,{color:'#0b4da2',weight:3,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.06,interactive:false}).addTo(map);", "boundaryLayer=L.geoJSON(DRIVE_TIME_AREA,{style:{color:'#0b4da2',weight:2,dashArray:'9 7',fillColor:'#4d9cdb',fillOpacity:.06},interactive:false}).addTo(map);\n  map.attributionControl?.addAttribution('Drive-time estimate: Valhalla / FOSSGIS');")
s=s.replace('45-minute planning center (estimated guide)','45-minute road-network driving estimate; no live traffic')
s=s.replace('updated=data.updatedAt?.toDate?.();','updated=data.updatedAt?.toDate?.(),driveTime=driveTimeEstimateFor(location);')
s=s.replace('</div>${congregationsBlock(location)}', '</div>${driveTime?`<p class="meta"><strong>Driving estimate from Convention Center:</strong> about ${driveTime.outboundMinutes} min out / ${driveTime.returnMinutes} min return.<br>Calculated Oct 23, 2026; no live traffic, loading time, or bus-clearance verification.</p>`:\'\'}${congregationsBlock(location)}',1)
assert 'PLANNING_BOUNDARY' not in s and 'L.geoJSON(DRIVE_TIME_AREA' in s and 'driveTime.outboundMinutes' in s
p.write_text(s)
for file in ['bus-access/app.js','bus-access/index.html','tests/bus-traffic-ui.test.mjs']:
    p=pathlib.Path(file);p.write_text(p.read_text().replace(old,new))
p=pathlib.Path('bus-access/index.html');s=p.read_text()
s=s.replace('The star marks the Colorado Convention Center. The blue dashed line is an approximate 45-minute planning guide recentered here, not a verified drive-time or live-traffic boundary. Confirm actual routes and travel times. Tap a numbered marker to review a location.', 'The blue dashed area is a calculated 45-minute driving estimate FROM the Colorado Convention Center (Oct 23, 2026), using Valhalla / OpenStreetMap roads. No live traffic, loading time, or bus-clearance verification. Check each route and return time. Tap a marker for details.')
s=s.replace('Colorado Convention Center 45-minute planning area (estimated)', 'Colorado Convention Center 45-minute driving estimate (no traffic)')
p.write_text(s)
p=pathlib.Path('tests/bus-convention-center.test.mjs');s=p.read_text()
s=s.replace("import {CONVENTION_CENTER, recenterPlanningBoundary}","import {DRIVE_TIME_AREA} from '../bus-access/drive-time-area.mjs';\nimport {CONVENTION_CENTER, recenterPlanningBoundary}")
s=s.replace('new center, star popup and relocated outline','Convention Center, star popup and road-network outline')
s=s.replace("polygon:(p)=>{events.push(['polygon',p]);return layer;}","geoJSON:(p)=>{events.push(['geoJSON',p]);return layer;}")
s=s.replace('CONVENTION_CENTER,PLANNING_BOUNDARY:boundary','CONVENTION_CENTER,DRIVE_TIME_AREA')
s=s.replace("events.find(e=>e[0]==='polygon')[1],boundary","events.find(e=>e[0]==='geoJSON')[1],DRIVE_TIME_AREA")
s=s.replace('labels explicitly describe an approximate guide and not verified or live travel times','labels distinguish a road-network estimate from live traffic or bus verification')
s=s.replace('/approximate 45-minute planning guide recentered here/','/calculated 45-minute driving estimate FROM the Colorado Convention Center/')
s=s.replace('/not a verified drive-time or live-traffic boundary/','/No live traffic, loading time, or bus-clearance verification/')
s=s.replace('app\\.js\\?v='+old,'app\\.js\\?v='+new).replace('app-v2\\.js\\?v='+old,'app-v2\\.js\\?v='+new)
p.write_text(s)
print('Prepared road-network outline:',len(feature['geometry']['coordinates'][0]),'vertices;',len(checks),'endpoint checks. No private data changed.')

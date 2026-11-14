"""Build public RTD rail reference data from the official GTFS and GIS sources."""
import csv, io, json, zipfile, urllib.request, time, collections, datetime, pathlib, math
BASE="https://services5.arcgis.com/1fZoXlzLW6FCIUcE/ArcGIS/rest/services/RTD_GIS_Current_Runboard/FeatureServer"
URL="https://www.rtd-denver.com/files/gtfs/google_transit.zip"
def download(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"ColoradoConventionPlanner/1.0"}),timeout=90) as r:return r.read()
        except Exception:
            if attempt==2:raise
            time.sleep(2)
z=zipfile.ZipFile(io.BytesIO(download(URL)))
def rows(name):
    paths=[p for p in z.namelist() if p.split("/")[-1]==name+".txt"]
    return list(csv.DictReader(io.TextIOWrapper(z.open(paths[0]),encoding="utf-8-sig"))) if paths else []
routes={r["route_id"]:r for r in rows("routes") if int(r["route_type"]) in (0,2) or 100<=int(r["route_type"])<200 or 900<=int(r["route_type"])<1000}
trips={t["trip_id"]:t for t in rows("trips") if t["route_id"] in routes}
assert routes and trips,"No rail service in GTFS"
stops={s["stop_id"]:s for s in rows("stops")}
times=collections.defaultdict(list)
for t in rows("stop_times"):
    if t["trip_id"] in trips:times[t["trip_id"]].append(t)
def seconds(s):
    if not s:return None
    h,m,s=map(int,s.split(":"));return h*3600+m*60+s
def dist(a,b):
    return math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*85000)
stations={}; mapping={}
gis=json.loads(download(BASE+"/1/query?where=1%3D1&outFields=PID,NAME,ADDRESS,CITY,ZIPCODE,RAIL_LINE&returnGeometry=true&outSR=4326&f=json&resultRecordCount=2000"))
assert gis.get("features") and not gis.get("exceededTransferLimit")
for f in gis["features"]:
    a,g=f["attributes"],f["geometry"];sid="rtd-"+str(a["PID"])
    stations[sid]={"id":sid,"name":a["NAME"],"lat":g["y"],"lng":g["x"],"address":", ".join(str(a.get(k) or "") for k in ("ADDRESS","CITY","ZIPCODE")).strip(", "),"lines":[]}
used={t["stop_id"] for tt in times.values() for t in tt}
for sid in used:
    s=stops[sid];parent=stops.get(s.get("parent_station"),s)
    point=(float(parent["stop_lat"]),float(parent["stop_lon"]))
    nearest=min(stations.values(),key=lambda p:dist(point,(p["lat"],p["lng"])),default=None)
    cid=nearest["id"] if nearest and dist(point,(nearest["lat"],nearest["lng"]))<250 else "gtfs-"+parent["stop_id"]
    mapping[sid]=cid
    if cid not in stations:stations[cid]={"id":cid,"name":parent["stop_name"],"lat":point[0],"lng":point[1],"address":"","lines":[]}
patterns={}; skipped=0
for tid,t in trips.items():
    tt=sorted(times[tid],key=lambda s:int(s["stop_sequence"]))
    if len(tt)<2 or any(not s["arrival_time"] or not s["departure_time"] for s in tt):skipped+=1;continue
    ids=[mapping[s["stop_id"]] for s in tt]
    key=(t["route_id"],t.get("direction_id",""),t.get("shape_id",""),tuple(ids))
    if key not in patterns:patterns[key]={"id":"p"+str(len(patterns)),"route":t["route_id"],"stops":ids,"shapeId":t.get("shape_id",""),"trips":[]}
    patterns[key]["trips"].append([t["service_id"],[seconds(s["arrival_time"]) for s in tt],[seconds(s["departure_time"]) for s in tt],t.get("trip_headsign","")])
    for sid in ids:
        name=routes[t["route_id"]]["route_short_name"]
        if name not in stations[sid]["lines"]:stations[sid]["lines"].append(name)
shapeids={p["shapeId"] for p in patterns.values()};shapes=collections.defaultdict(list)
for s in rows("shapes"):
    if s["shape_id"] in shapeids:shapes[s["shape_id"]].append((int(s["shape_pt_sequence"]),round(float(s["shape_pt_lat"]),6),round(float(s["shape_pt_lon"]),6)))
for key,shape in list(shapes.items()):shapes[key]=[[a,b] for _,a,b in sorted(shape)]
cal=rows("calendar");exceptions=rows("calendar_dates");info=rows("feed_info")
starts=[r["start_date"] for r in cal]+[r["date"] for r in exceptions]
ends=[r["end_date"] for r in cal]+[r["date"] for r in exceptions]
assert starts and ends
out={"schemaVersion":1,"generatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":URL,"stationSource":BASE+"/1","timezone":"America/Denver","coverage":{"start":min(starts),"end":max(ends)},"feedInfo":info,"stations":sorted(stations.values(),key=lambda p:p["name"]),"routes":[{"id":r["route_id"],"name":r["route_short_name"],"longName":r["route_long_name"],"color":r.get("route_color") or "4256A6"} for r in routes.values()],"patterns":list(patterns.values()),"shapes":shapes,"calendar":cal,"exceptions":exceptions,"skippedTrips":skipped}
path=pathlib.Path("data/rtd-rail.json");path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(out,separators=(",",":")),encoding="utf-8")
print(json.dumps({"stations":len(stations),"routes":[r["route_short_name"] for r in routes.values()],"patterns":len(patterns),"trips":sum(len(p["trips"]) for p in patterns.values()),"coverage":out["coverage"],"bytes":path.stat().st_size,"skippedTrips":skipped}))

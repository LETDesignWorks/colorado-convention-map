# Colorado Convention Center: 45-minute driving estimate

The former map outline was an illustrative DTC boundary translated to a new center, not a road-network calculation. Bus Review now uses `convention-center-45.geojson`, a one-time 45-minute **outbound** automobile isochrone from 39.74248, -104.99567. The GeoJSON is also embedded in `../drive-time-area.mjs` so opening the site makes no requests to the public routing server.

Source: Valhalla, hosted by FOSSGIS, using OpenStreetMap data. Calculated October 23, 2026. Exact request, engine version, graph timestamp and 26 sample round-trip endpoint checks (22 built-in halls plus four reference points) are in `audit.json`. A separate bus-profile request returned the same endpoint times in this sample; that is NOT a motorcoach-clearance approval. No vehicle dimensions were supplied. The routing origin snapped to a mapped road node approximately 43 metres from the configured center.

Only `freeflow` and `constrained` speed sources were requested. No live or predicted traffic was requested, and there is no departure date/time. The outline is an approximate contour from a routing grid, generalized by 100 metres, with the largest connected contour retained. Do not decide eligibility from the outline alone near its edge. Check the specific route, event departure time, bus access and return journey. Loading, unloading, parking, traffic queues and temporary event closures are not included. Existing bus-access approvals and legacy planning-area labels were not changed.

OpenStreetMap data: https://www.openstreetmap.org/copyright
Service and fair use: https://valhalla.github.io/valhalla/start/introduction/
Method: https://valhalla.github.io/valhalla/api/isochrone/api-reference/

The sample checks are model estimates, not observed travel times. Custom/private meeting locations were not queried. No private review, contact or parking-lot records were read or changed.

## Rounded planning display
Bus Review now defaults to a solid blue, rounded **approximate guide**. It samples the outer envelope around the Convention Center every two degrees, softens narrow road spikes with a ten-degree Gaussian window, blends 20% toward the mean radius, and adds 3% display padding. This display may include places beyond 45 minutes or omit narrow reachable corridors; it must not determine route eligibility. Use **Map boundary → Detailed driving estimate** for the unchanged road-network snapshot. Neither view uses live traffic, and the original hall estimates, approvals, and saved reviews are unchanged.

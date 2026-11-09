# Rush-hour planning

The page contains two independent tools:

- **Hotel & address trips:** any listed hotel, approved field-service meeting location, activity, convention center, or explicitly selected address-search result can be used at either end. Trips can be reversed. Dates and exact departure times use America/Denver.
- **Convention center rankings:** the existing dated Google forecast snapshots and ranking/PDF controls. These snapshots are not reused for hotel or independent-address trips.

## Traffic connection

The new trip planner works without a traffic account for road previews, basic driving estimates, manually entered Google traffic checks, and PDF/print reports. Basic OSRM estimates exclude traffic and never populate the rush-hour plan automatically.

Automatic single-departure tests and departure comparisons use the TomTom Calculate Route API. In **Automatic traffic tests → Connect traffic estimates**, enter a TomTom key with Routing API access and restrict it to `letdesignworks.github.io` in the TomTom account. The key is retained only in the browser tab's session storage and sent directly to TomTom. It is not written to the repository or Firebase. Account quotas and any billing are controlled in that TomTom account. No key is included with this feature.

Each departure needs one request; a comparison starts with five candidates and supports up to twenty. Tests run sequentially and can be stopped. Results for identical endpoints and departure times are cached for five minutes in memory. Automatic requests require a future date. A single TomTom prediction is displayed as a single time, not an invented low/high range.

Official documentation:
- https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route
- https://docs.tomtom.com/platform/documentation/my-tomtom/how-to-get-a-tomtom-api-key
- https://docs.tomtom.com/platform/documentation/api-best-practices/api-key-management-best-practices

Manual Google links use the documented Maps URLs directions format. They transfer endpoints; the departure date/time must be selected inside Google Maps. A manual range is valid only for the exact endpoints, direction and departure it was checked for. Changing these clears the applied result; changing the bus allowance recalculates the plan. Changing the route also clears its comparisons.

Address searches are user-triggered through Photon, show multiple candidates for selection, and are cached in memory. Road previews use OSRM. Service failures do not invent travel times: the manual traffic check remains usable after a road-routing failure.

## Validation

Run from the repository root:

```sh
node --test tests/rush-hour.test.mjs tests/rush-hour-pdf.test.mjs tests/rush-hour-trips.test.mjs
```

The trip tests cover exact minutes, Denver daylight-saving validation, reversed routes, missing/invalid inputs, stale traffic rejection, traffic-service request parameters and errors using mocked responses, and real branded PDF generation. A live traffic test requires a routing key. Browser interaction was not verified in the implementation environment.

# 2027 Colorado Convention Planning Map

Mobile-friendly planning website showing:

- Kingdom Hall locations in the convention planning areas
- International delegate hotels in Downtown Denver, the Denver Tech Center, and RidgeGate
- Nearby RTD rail stations
- DTC-centered Kingdom Hall bus-access review records
- Team-specific Hall assignment maps
- Hotel-to-field-service bus route planning
- Denver 2027 circular branding throughout the linked map pages

## Website

https://letdesignworks.github.io/colorado-convention-map/

## Main sections

- Full Planning Map: `/`
- Standalone Full Map: `/full-map.html`
- Full-screen Map: `/map-fullscreen.html`
- Bus Access Review: `/bus-access/`
- Team Assignment Maps: `/team/`
- Bus Route Planner: `/routes/`
- Activity Planning: `/activity-planning/` — ordered multi-stop bus routes, territory links, repeated runs, cost per unique delegate, and combined route review.

Activity Planning preserves the existing activity scheduler and field-service routes. New shared routes use private `reviews` records with type `activity-multistop-route`; existing administrator authentication and Firestore permissions apply. Public visitors can calculate and save routes on their own device. JSON export/import provides a backup. Saved territory plans supply meeting-place stops and optional map outlines; custom pickup points are editable without changing territory records. All entered times are Denver wall time. Pricing uses the full occupied bus window and distinguishes repeat rides by the same delegates from new groups.

Run `node tests/activity-planning.mjs` for route timing, cost, capacity, persistence, and conflict checks.

## Planning note

Travel times, drive-time areas, rail proximity, and route estimates are planning aids. Verify current service, live travel conditions, roadway restrictions, and motorcoach access before final assignments.

from pathlib import Path
import re

VERSION = 'territories-20260927-7'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


# Add the route-planning card.
template_path = Path('territories/template.html')
template = template_path.read_text(encoding='utf-8')
if 'id="territoryDirectionsCard"' not in template:
    anchor = '''        <div id="territoryList" class="territory-list"><div class="empty">No territories have been created.</div></div>
      </section>

      <section class="card house-list-card">'''
    route_card = '''        <div id="territoryList" class="territory-list"><div class="empty">No territories have been created.</div></div>
      </section>

      <section class="card territory-directions-card" id="territoryDirectionsCard">
        <div class="card-heading">
          <div><span class="eyebrow">5 — TERRITORY DIRECTIONS</span><h2>Route from a Hall or meeting point</h2></div>
          <span id="territoryRouteStatusChip" class="count-chip">No route</span>
        </div>
        <p class="section-copy">Start at the selected Kingdom Hall or a privately saved meeting point. The planner recommends the assigned home closest to the starting location, but you can choose any address in the territory as the arrival point.</p>
        <div class="territory-route-grid">
          <div class="field">
            <label for="territoryRouteOrigin">Starting location</label>
            <select id="territoryRouteOrigin"><option value="">Select a Hall or meeting point</option></select>
          </div>
          <div class="field">
            <label for="territoryRouteTerritory">Territory</label>
            <select id="territoryRouteTerritory"><option value="">Create a territory first</option></select>
          </div>
          <div class="field territory-route-destination-field">
            <label for="territoryRouteDestination">Territory arrival address</label>
            <select id="territoryRouteDestination"><option value="">Select a territory first</option></select>
            <small id="territoryRouteDestinationNote">The closest assigned home will be recommended as the route destination.</small>
          </div>
          <div class="field">
            <label for="territoryRouteMode">Travel method</label>
            <select id="territoryRouteMode">
              <option value="driving" selected>Driving</option>
              <option value="walking">Walking</option>
              <option value="transit">RTD / transit</option>
            </select>
          </div>
          <div class="field territory-route-departure" id="territoryRouteDepartureWrap" hidden>
            <label for="territoryRouteDeparture">RTD departure date and time</label>
            <input id="territoryRouteDeparture" type="datetime-local"/>
          </div>
        </div>
        <div class="button-grid territory-route-actions">
          <button class="btn primary" id="showTerritoryRouteButton" type="button">Show Route on Streets</button>
          <button class="btn outline" id="clearTerritoryRouteButton" type="button" disabled>Clear Route</button>
          <a class="btn outline disabled" id="territoryRouteGoogleLink" target="_blank" rel="noopener" aria-disabled="true">Google Maps</a>
          <a class="btn outline disabled" id="territoryRouteAppleLink" target="_blank" rel="noopener" aria-disabled="true">Apple Maps</a>
          <button class="btn save" id="printTerritoryRouteButton" type="button" disabled>Print Directions</button>
        </div>
        <div id="territoryRouteMessage" class="territory-route-message">Choose a starting location, territory, arrival address, and travel method, then select <strong>Show Route on Streets</strong>.</div>
        <div id="territoryRouteMetrics" class="territory-route-metrics" hidden>
          <article><span>Mode</span><strong id="territoryRouteMetricMode">—</strong></article>
          <article><span>Distance</span><strong id="territoryRouteMetricDistance">—</strong></article>
          <article><span>Estimated time</span><strong id="territoryRouteMetricTime">—</strong></article>
          <article><span>Route source</span><strong id="territoryRouteMetricProvider">—</strong></article>
        </div>
        <section id="territoryRouteDirections" class="territory-route-directions" hidden>
          <h3>Turn-by-turn directions</h3>
          <ol id="territoryRouteSteps"></ol>
        </section>

        <details class="territory-meeting-builder">
          <summary>Add or manage meeting points</summary>
          <p>Meeting points are private to this Hall and congregation. Enter an address or drop the point at the exact parking lot, entrance, or field-service gathering area.</p>
          <div class="two-col">
            <div class="field"><label for="territoryMeetingPointName">Meeting-point name</label><input id="territoryMeetingPointName" maxlength="120" placeholder="Example: South parking lot meeting point"/></div>
            <div class="field"><label for="territoryMeetingPointAddress">Street address</label><input id="territoryMeetingPointAddress" autocomplete="street-address" placeholder="Enter the complete address"/></div>
          </div>
          <div class="two-col territory-meeting-coordinates">
            <div class="field"><label for="territoryMeetingPointLat">Latitude</label><input id="territoryMeetingPointLat" inputmode="decimal" readonly/></div>
            <div class="field"><label for="territoryMeetingPointLng">Longitude</label><input id="territoryMeetingPointLng" inputmode="decimal" readonly/></div>
          </div>
          <div class="button-grid territory-meeting-buttons">
            <button class="btn outline admin-control" id="locateTerritoryMeetingPointButton" type="button">Locate Address</button>
            <button class="btn outline admin-control" id="dropTerritoryMeetingPointButton" type="button">Drop Meeting Point on Map</button>
            <button class="btn save admin-control" id="saveTerritoryMeetingPointButton" type="button">Save Meeting Point</button>
            <button class="btn outline admin-control" id="clearTerritoryMeetingPointButton" type="button">Clear Form</button>
          </div>
          <small id="territoryMeetingPointMessage" class="territory-meeting-message" data-state="waiting">Enter an address or drop a point on the map. The meeting point will be saved privately for this Hall and congregation.</small>
          <div id="territoryMeetingPointList" class="territory-meeting-list"><div class="empty">Sign in to load saved meeting points.</div></div>
        </details>
        <small class="territory-route-caution">Directions are a planning aid. Confirm the selected arrival address, road access, parking, sidewalks, construction, and RTD service locally before use.</small>
      </section>

      <section class="card house-list-card">'''
    template = replace_once(template, anchor, route_card, 'territory directions card')
    template = template.replace('5 — SAVE / EXPORT', '6 — SAVE / EXPORT', 1)
template_path.write_text(template, encoding='utf-8')


# Add route and meeting-point styles.
styles_path = Path('territories/styles.css')
styles = styles_path.read_text(encoding='utf-8')
if '.territory-directions-card{' not in styles:
    styles += r'''

/* Territory directions from a Hall or saved meeting point */
.territory-directions-card{border-color:#bdd3e4;background:linear-gradient(150deg,#fff,#f7fbff)}
.territory-route-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.territory-route-destination-field{grid-column:1/-1}.territory-route-departure{grid-column:1/-1}
.territory-route-actions{grid-template-columns:repeat(2,1fr)}.territory-route-actions .btn,.territory-route-actions a{min-height:42px}.territory-route-actions a.disabled{pointer-events:none;opacity:.48}
.territory-route-message{border:1px solid #d4e0e9;border-radius:11px;background:#f8fbfd;padding:10px 11px;color:#536478;font-size:10.5px;line-height:1.45;margin:10px 0}.territory-route-message strong{color:#244461}.territory-route-message.loading{border-color:#e8c56c;background:#fff8df;color:#70520b}.territory-route-message.success{border-color:#91cbb6;background:#effaf5;color:#205e49}.territory-route-message.error{border-color:#e0aaa5;background:#fff4f3;color:#873a34}
.count-chip.route-ready{background:#e1f4ea;color:#166942}.territory-route-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0}.territory-route-metrics article{border:1px solid #d8e2ea;border-radius:10px;background:#fff;padding:9px}.territory-route-metrics span{display:block;color:#728196;font-size:8px;text-transform:uppercase;font-weight:850}.territory-route-metrics strong{display:block;color:#203e5d;font-size:10px;margin-top:3px}
.territory-route-directions{margin-top:12px}.territory-route-directions h3{margin:0 0 8px}.territory-route-directions ol{list-style:none;padding:0;margin:0;display:grid;gap:7px;max-height:410px;overflow:auto}.territory-route-step{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:start;border:1px solid #d8e2ea;border-radius:10px;background:#fff;padding:8px}.territory-route-step-number{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#0b5b9f;color:#fff;font-size:9px;font-weight:900}.territory-route-step strong{display:block;color:#263d54;font-size:10px;line-height:1.35}.territory-route-step small{display:block;color:#6a788a;font-size:8px;margin-top:3px}.territory-route-step-distance{text-align:right;color:#58697c;font-size:8px;line-height:1.35;white-space:nowrap}.territory-route-step[data-mode="walking"] .territory-route-step-number{background:#14845f}.territory-route-step[data-mode="transit"] .territory-route-step-number{background:#2f6fb4}.territory-route-step[data-mode="driving"] .territory-route-step-number{background:#d66a17}
.territory-meeting-builder{margin-top:13px;border:1px solid #d7d0ec;border-radius:12px;background:#faf8ff;padding:10px}.territory-meeting-builder>summary{cursor:pointer;color:#563d9c;font-size:11px;font-weight:900}.territory-meeting-builder>p{margin:8px 0 10px!important;font-size:10px!important}.territory-meeting-coordinates input{background:#f1f4f7;color:#56677a}.territory-meeting-buttons{margin-bottom:6px}.territory-meeting-message{display:block;font-size:9px;line-height:1.4;color:#657589;margin-bottom:9px}.territory-meeting-message[data-state="working"]{color:#7a5600}.territory-meeting-message[data-state="success"]{color:#166942}.territory-meeting-message[data-state="error"]{color:#922f28}.territory-meeting-list{display:grid;gap:7px;max-height:300px;overflow:auto}.territory-meeting-row{display:grid;grid-template-columns:36px 1fr;gap:8px;align-items:start;border:1px solid #ddd6ef;border-radius:10px;background:#fff;padding:8px}.territory-meeting-row-pin{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#6b4ec9;color:#fff;font-size:9px;font-weight:900;border:2px solid #fff;box-shadow:0 0 0 1px #8c79c8}.territory-meeting-row strong{display:block;color:#2e4258;font-size:10.5px}.territory-meeting-row small{display:block;color:#6c7a8c;font-size:8.5px;line-height:1.35;margin-top:2px}.territory-meeting-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:6px}.territory-meeting-actions button{border:0;background:transparent;padding:0;color:#0b5b9f;font-size:8.5px;font-weight:850;cursor:pointer}.territory-meeting-actions button.danger{color:#982f29}.territory-route-caution{display:block;margin-top:9px;color:#6b7889!important;font-size:8.5px!important;line-height:1.4}.territory-directions-row-button{color:#563d9c!important;border-color:#c9bdea!important;background:#faf8ff!important}
.territory-meeting-drop-active{cursor:crosshair!important}.territory-meeting-buttons .active{background:#fff0bd!important;color:#684600!important;border-color:#e0b74e!important}
.territory-meeting-pin{width:43px;height:43px;border-radius:13px;background:#f1ecff;color:#5d43a7;border:3px solid #fff;box-shadow:0 1px 8px #0007;display:grid;place-items:center;position:relative;font-size:9px;font-weight:900}.territory-meeting-pin b{position:absolute;right:-7px;bottom:-6px;min-width:24px;height:19px;border-radius:10px;background:#5d43a7;color:#fff;border:2px solid #fff;font-size:7px;display:grid;place-items:center;padding:0 4px}.territory-meeting-pin.selected{outline:4px solid #ffd84f;transform:scale(1.08)}
.territory-route-endpoint{min-width:52px;height:30px;border-radius:15px;background:#083f73;color:#fff;border:3px solid #fff;box-shadow:0 1px 7px #0006;display:grid;place-items:center;padding:0 6px;font-size:8px;font-weight:900;white-space:nowrap}.territory-route-endpoint.end{background:#6b4ec9}.territory-route-arrow{width:30px;height:30px;display:grid;place-items:center;filter:drop-shadow(0 1px 2px #fff) drop-shadow(0 1px 3px #0006);transform-origin:50% 50%}.territory-route-arrow svg{width:27px;height:27px;fill:currentColor;stroke:#fff;stroke-width:2}
@media(max-width:700px){.territory-route-grid,.territory-route-metrics{grid-template-columns:1fr 1fr}.territory-route-destination-field,.territory-route-departure{grid-column:1/-1}.territory-route-actions{grid-template-columns:1fr}.territory-route-step{grid-template-columns:26px 1fr}.territory-route-step-distance{grid-column:2;text-align:left}}
@media(max-width:480px){.territory-route-grid,.territory-route-metrics,.territory-meeting-builder .two-col{grid-template-columns:1fr}.territory-route-destination-field,.territory-route-departure{grid-column:auto}}
@media print{.territory-directions-card{display:none!important}}
'''
styles_path.write_text(styles, encoding='utf-8')


# Expose a read-only planner API and emit data-change events for the directions module.
app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')
if 'function emitPlannerDataChange()' not in app:
    helper_anchor = 'function formatDate(value) {'
    helper = '''function emitPlannerDataChange() {
  try {
    window.dispatchEvent(new CustomEvent('territory-planner:data', {
      detail: {
        hallId: selectedHall?.id || '',
        congregation: selectedCongregation || '',
        planId: currentPlanId || '',
        territoryCount: territories.length,
        houseCount: houses.length,
        isAdmin: isAdmin()
      }
    }));
  } catch { /* no-op */ }
}
'''
    app = replace_once(app, helper_anchor, helper + helper_anchor, 'planner data event helper')

# Add event emission to the selected-Hall update.
select_start = app.index('function selectHall(')
select_end = app.index('\n}\n\nfunction hallIcon', select_start) + 2
select_block = app[select_start:select_end]
if 'emitPlannerDataChange();' not in select_block:
    select_block = replace_once(select_block, '  renderHallMarkers();\n  updateSummary();\n}', '  renderHallMarkers();\n  updateSummary();\n  emitPlannerDataChange();\n}', 'select Hall event')
    app = app[:select_start] + select_block + app[select_end:]

# Emit after all territory/address re-renders.
render_start = app.index('function renderAllPlanningData() {')
render_end = app.index('\n}\nfunction toggleHouseSelection', render_start) + 2
render_block = app[render_start:render_end]
if 'emitPlannerDataChange();' not in render_block:
    render_block = replace_once(render_block, '  updateSummary();\n}', '  updateSummary();\n  emitPlannerDataChange();\n}', 'render planning event')
    app = app[:render_start] + render_block + app[render_end:]

# Emit when sign-in status changes.
auth_start = app.index('function updateAuthUi() {')
auth_end = app.index('\n}\nfunction openLogin', auth_start) + 2
auth_block = app[auth_start:auth_end]
if 'emitPlannerDataChange();' not in auth_block:
    auth_block = auth_block[:-2] + '\n  emitPlannerDataChange();\n}'
    app = app[:auth_start] + auth_block + app[auth_end:]

# Expose the planner state to the dedicated directions module.
if '__denverTerritoryPlannerAPI' not in app:
    api_code = '''

globalThis.__denverTerritoryPlannerAPI = Object.freeze({
  getMap: () => map,
  getDb: () => db,
  getCurrentUser: () => currentUser,
  getSelectedHall: () => selectedHall,
  getSelectedCongregation: () => selectedCongregation,
  getCurrentPlanId: () => currentPlanId,
  getTerritories: () => territories,
  getHouses: () => houses,
  isAdmin,
  requireAdmin,
  toast,
  geocodeAddress: address => geocodeAvoidAddress(address),
  refresh: emitPlannerDataChange
});
'''
    app = replace_once(app, '\ninitialize();', api_code + '\ninitialize();', 'planner API insertion')

# Signal that the map and Firebase initialization attempt have completed.
initialize_start = app.index('async function initialize() {')
initialize_end = app.index('\n}\n\n', initialize_start) + 2
initialize_block = app[initialize_start:initialize_end]
if "territory-planner:ready" not in initialize_block:
    initialize_block = initialize_block[:-2] + "\n  window.dispatchEvent(new CustomEvent('territory-planner:ready'));\n  emitPlannerDataChange();\n}"
    app = app[:initialize_start] + initialize_block + app[initialize_end:]

app_path.write_text(app, encoding='utf-8')


# Load the directions module and bust caches.
bootstrap_path = Path('territories/bootstrap.js')
bootstrap = bootstrap_path.read_text(encoding='utf-8')
bootstrap = re.sub(r"const version = 'territories-\d{8}-\d+';", f"const version = '{VERSION}';", bootstrap)
bootstrap = re.sub(r"app-main\.js\?v=territories-\d{8}-\d+", f"app-main.js?v={VERSION}", bootstrap)
if "./directions.js" not in bootstrap:
    bootstrap = replace_once(
        bootstrap,
        f"  await import('./app-main.js?v={VERSION}');",
        f"  await import('./app-main.js?v={VERSION}');\n  await import('./directions.js?v={VERSION}');",
        'directions module import'
    )
else:
    bootstrap = re.sub(r"directions\.js\?v=territories-\d{8}-\d+", f"directions.js?v={VERSION}", bootstrap)
bootstrap_path.write_text(bootstrap, encoding='utf-8')

index_path = Path('territories/index.html')
index = index_path.read_text(encoding='utf-8')
index = re.sub(r'territories-\d{8}-\d+', VERSION, index)
index_path.write_text(index, encoding='utf-8')

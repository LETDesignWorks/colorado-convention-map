from pathlib import Path
import re

VERSION = 'territories-20260927-6'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


# Add a prominent action bar directly on the map.
template_path = Path('territories/template.html')
template = template_path.read_text(encoding='utf-8')
old_template = '''        <div id="territoryBoundaryLiveCount" class="territory-boundary-live-count" hidden aria-live="polite" aria-atomic="true">
          <span id="territoryBoundaryLiveLabel">Manual territory</span>
          <strong id="territoryBoundaryLiveValue">0 addresses selected</strong>
          <small id="territoryBoundaryLiveDetail">Begin drawing the boundary to count the included addresses.</small>
        </div>
        <div class="map-legend">'''
new_template = '''        <div id="territoryBoundaryLiveCount" class="territory-boundary-live-count" hidden aria-live="polite" aria-atomic="true">
          <span id="territoryBoundaryLiveLabel">Manual territory</span>
          <strong id="territoryBoundaryLiveValue">0 addresses selected</strong>
          <small id="territoryBoundaryLiveDetail">Begin drawing the boundary to count the included addresses.</small>
        </div>
        <div id="territoryEditActions" class="territory-edit-actions" hidden role="group" aria-label="Territory boundary edit actions">
          <div class="territory-edit-action-copy">
            <strong id="territoryEditActionLabel">Editing territory boundary</strong>
            <small>Move the white handles, then save to update both the boundary and its homes.</small>
          </div>
          <div class="territory-edit-action-buttons">
            <button class="btn save" id="saveTerritoryBoundaryEditButton" type="button">Save Boundary &amp; Update Homes</button>
            <button class="btn outline" id="cancelTerritoryBoundaryEditButton" type="button">Cancel Edit</button>
          </div>
        </div>
        <div class="map-legend">'''
template = replace_once(template, old_template, new_template, 'territory edit action markup')
template_path.write_text(template, encoding='utf-8')


# Add the action-bar styles.
styles_path = Path('territories/styles.css')
styles = styles_path.read_text(encoding='utf-8')
if '.territory-edit-actions{' not in styles:
    styles += r'''

/* Visible territory boundary save controls */
.territory-edit-actions{
  position:absolute;
  z-index:945;
  left:50%;
  bottom:14px;
  transform:translateX(-50%);
  width:min(760px,calc(100% - 28px));
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:11px 12px;
  border:1px solid rgba(255,255,255,.88);
  border-radius:15px;
  background:rgba(255,255,255,.97);
  box-shadow:0 8px 26px rgba(0,31,64,.32);
  color:#263d54;
  backdrop-filter:blur(5px);
}
.territory-edit-actions[hidden]{display:none!important}
.territory-edit-action-copy{min-width:0}
.territory-edit-action-copy>strong{display:block;color:#5b359e;font-size:13px;line-height:1.25}
.territory-edit-action-copy>small{display:block;margin-top:3px;color:#5e6e81;font-size:9.5px;line-height:1.35}
.territory-edit-action-buttons{display:flex;gap:8px;flex:0 0 auto}
.territory-edit-action-buttons .btn{min-height:43px}
.map-card.territory-edit-active .map-note{display:none}
@media(max-width:700px){
  .territory-edit-actions{bottom:9px;width:calc(100% - 18px);display:block;padding:10px}
  .territory-edit-action-buttons{margin-top:8px;display:grid;grid-template-columns:1fr 1fr}
  .territory-edit-action-buttons .btn{white-space:normal;line-height:1.2;padding:8px}
}
@media(max-width:430px){
  .territory-edit-action-buttons{grid-template-columns:1fr}
}
@media print{.territory-edit-actions{display:none!important}}
'''
styles_path.write_text(styles, encoding='utf-8')


app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')

old_ids = "'markAvoidButton','restoreAvoidButton','selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryEditMessage','territoryBoundaryLiveCount','territoryBoundaryLiveLabel','territoryBoundaryLiveValue','territoryBoundaryLiveDetail','territoryList','houseSearch','houseList',"
new_ids = "'markAvoidButton','restoreAvoidButton','selectionCount','assignTerritorySelect','assignSelectedButton','newTerritoryButton','territoryEditMessage','territoryBoundaryLiveCount','territoryBoundaryLiveLabel','territoryBoundaryLiveValue','territoryBoundaryLiveDetail','territoryEditActions','territoryEditActionLabel','saveTerritoryBoundaryEditButton','cancelTerritoryBoundaryEditButton','territoryList','houseSearch','houseList',"
app = replace_once(app, old_ids, new_ids, 'element id list')

helper_anchor = '''function initMap() {
'''
helpers = '''function showTerritoryEditActions(territory) {
  if (!els.territoryEditActions) return;
  els.territoryEditActions.hidden = false;
  if (els.territoryEditActionLabel) els.territoryEditActionLabel.textContent = `Editing ${territory?.name || 'territory boundary'}`;
  els.territoryEditActions.closest('.map-card')?.classList.add('territory-edit-active');
}
function hideTerritoryEditActions() {
  if (!els.territoryEditActions) return;
  els.territoryEditActions.hidden = true;
  els.territoryEditActions.closest('.map-card')?.classList.remove('territory-edit-active');
}
async function saveActiveTerritoryBoundaryEdit() {
  if (!requireAdmin()) return;
  const territoryId = activeTerritoryEditId || territoryIdFromLayerGroup(territoryEditGroup);
  if (!territoryId) {
    toast('No territory boundary is currently being edited.', true);
    hideTerritoryEditActions();
    return;
  }
  const geometry = combinedGeometryFromFeatureGroup(territoryEditGroup);
  if (!geometry) {
    toast('The edited boundary could not be read. Move a handle and try Save Boundary & Update Homes again.', true);
    return;
  }

  const result = applyTerritoryBoundaryAssignments(territoryId, geometry);
  if (!result) {
    toast('The edited territory boundary could not be saved. Reopen Edit Boundary and try again.', true);
    return;
  }

  const toolbar = territoryEditToolbar;
  activeTerritoryEditId = null;
  territoryEditToolbar = null;
  hideLiveTerritoryBoundaryCount();
  hideTerritoryEditActions();
  try { toolbar?.disable(); } catch { /* no-op */ }
  territoryEditGroup.clearLayers();
  renderAllPlanningData();
  selectTerritoryHouses(result.territory.id);

  const summary = boundaryChangeSummary(result);
  if (currentPlanId) {
    await savePlan({
      successMessage: `${result.territory.name} saved with ${result.total} address${result.total === 1 ? '' : 'es'}. ${summary}.`
    });
  } else {
    toast(`${result.territory.name} boundary and homes updated in the workspace with ${result.total} address${result.total === 1 ? '' : 'es'}. ${summary}. Select Save Territory Plan to retain the changes.`);
  }
}

function initMap() {
'''
app = replace_once(app, helper_anchor, helpers, 'map initialization helper insertion')

old_cancel = '''function cancelTerritoryBoundaryEdit(showNotice = true) {
  hideLiveTerritoryBoundaryCount();
  if (territoryEditToolbar) {
    try { territoryEditToolbar.disable(); } catch { /* no-op */ }
  }
  const wasEditing = Boolean(activeTerritoryEditId);
  territoryEditToolbar = null;
  activeTerritoryEditId = null;
  territoryEditGroup?.clearLayers();
  if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
  if (wasEditing) renderAllPlanningData();
  if (wasEditing && showNotice) toast('Territory-boundary editing canceled.');
}'''
new_cancel = '''function cancelTerritoryBoundaryEdit(showNotice = true) {
  const wasEditing = Boolean(activeTerritoryEditId);
  hideLiveTerritoryBoundaryCount();
  hideTerritoryEditActions();
  if (territoryEditToolbar) {
    try { territoryEditToolbar.disable(); } catch { /* no-op */ }
  }
  territoryEditToolbar = null;
  activeTerritoryEditId = null;
  territoryEditGroup?.clearLayers();
  if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
  if (wasEditing) renderAllPlanningData();
  if (wasEditing && showNotice) toast('Territory-boundary editing canceled.');
}'''
app = replace_once(app, old_cancel, new_cancel, 'cancel territory edit function')

old_edit_end = '''  territoryEditToolbar = new L.EditToolbar.Edit(map, { featureGroup: territoryEditGroup });
  territoryEditToolbar.enable();
  updateLiveTerritoryBoundaryCount({ mode: 'edit', geometry: geometry.geometry || geometry, territoryId: id });
  toast(`Editing ${territory.name}. The live address count will update as you move the handles; save with the map toolbar checkmark.`);
}'''
new_edit_end = '''  territoryEditToolbar = new L.EditToolbar.Edit(map, { featureGroup: territoryEditGroup });
  territoryEditToolbar.enable();
  updateLiveTerritoryBoundaryCount({ mode: 'edit', geometry: geometry.geometry || geometry, territoryId: id });
  showTerritoryEditActions(territory);
  toast(`Editing ${territory.name}. Move the white handles, then select Save Boundary & Update Homes at the bottom of the map.`);
}'''
app = replace_once(app, old_edit_end, new_edit_end, 'edit territory function ending')

app = replace_once(
    app,
    '''    if (editedTerritoryId) {
      hideLiveTerritoryBoundaryCount();''',
    '''    if (editedTerritoryId) {
      hideLiveTerritoryBoundaryCount();
      hideTerritoryEditActions();''',
    'legacy edited event action hiding'
)

old_editstop = '''  map.on(L.Draw.Event.EDITSTOP, () => {
    if (liveTerritoryCountContext?.mode === 'edit') hideLiveTerritoryBoundaryCount();
    if (!activeTerritoryEditId) return;
    activeTerritoryEditId = null;
    territoryEditToolbar = null;
    territoryEditGroup.clearLayers();
    if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
    renderAllPlanningData();
  });'''
new_editstop = '''  map.on(L.Draw.Event.EDITSTOP, () => {
    if (liveTerritoryCountContext?.mode === 'edit') hideLiveTerritoryBoundaryCount();
    if (!activeTerritoryEditId) {
      hideTerritoryEditActions();
      return;
    }
    activeTerritoryEditId = null;
    territoryEditToolbar = null;
    territoryEditGroup.clearLayers();
    hideTerritoryEditActions();
    if (els.territoryEditMessage) els.territoryEditMessage.hidden = true;
    renderAllPlanningData();
  });'''
app = replace_once(app, old_editstop, new_editstop, 'edit-stop cleanup')

wire_anchor = '''  els.newTerritoryButton.addEventListener('click', newTerritoryFromSelected);
  els.houseSearch.addEventListener('input', renderHouseList);'''
wire_replacement = '''  els.newTerritoryButton.addEventListener('click', newTerritoryFromSelected);
  els.saveTerritoryBoundaryEditButton?.addEventListener('click', saveActiveTerritoryBoundaryEdit);
  els.cancelTerritoryBoundaryEditButton?.addEventListener('click', () => cancelTerritoryBoundaryEdit(true));
  els.houseSearch.addEventListener('input', renderHouseList);'''
app = replace_once(app, wire_anchor, wire_replacement, 'territory edit action event listeners')

app_path.write_text(app, encoding='utf-8')


# Bump all Territory Planner cache versions.
for file_name in ['territories/bootstrap.js', 'territories/index.html']:
    path = Path(file_name)
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'territories-\d{8}-\d+', VERSION, text)
    path.write_text(text, encoding='utf-8')

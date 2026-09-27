from pathlib import Path
import re

VERSION = 'territories-20260927-1'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


# Add the destructive, clearly labeled workspace control under Build Territories.
template_path = Path('territories/template.html')
template = template_path.read_text(encoding='utf-8')
old_buttons = '''          <button class="btn outline admin-control" id="selectAreaButton" type="button">Select Houses by Area</button>
          <button class="btn outline admin-control" id="clearSelectionButton" type="button">Clear Selection</button>
          <button class="btn danger admin-control" id="excludeSelectionButton" type="button">Include / Exclude Selected</button>
        </div>'''
new_buttons = '''          <button class="btn outline admin-control" id="selectAreaButton" type="button">Select Houses by Area</button>
          <button class="btn outline admin-control" id="clearSelectionButton" type="button">Clear Selection</button>
          <button class="btn danger admin-control" id="clearAllTerritoriesButton" type="button">Clear All Territories</button>
          <button class="btn danger admin-control" id="excludeSelectionButton" type="button">Include / Exclude Selected</button>
        </div>
        <small class="clear-territories-note">Clear All Territories removes every automatic and manually drawn territory from the current workspace and returns their homes to Unassigned. It keeps the congregation boundary, loaded addresses, red avoid addresses, and excluded addresses. Select Save Territory Plan afterward when the cleared plan should replace the saved Firebase plan.</small>'''
template = replace_once(template, old_buttons, new_buttons, 'Build Territories buttons')
template_path.write_text(template, encoding='utf-8')


# Add the element, behavior, and event wiring to the territory application.
app_path = Path('territories/app-main.js')
app = app_path.read_text(encoding='utf-8')
old_ids = "'customTarget','groupingMethod','autoGroupButton','drawTerritoryButton','selectAreaButton','clearSelectionButton','excludeSelectionButton',"
new_ids = "'customTarget','groupingMethod','autoGroupButton','drawTerritoryButton','selectAreaButton','clearSelectionButton','clearAllTerritoriesButton','excludeSelectionButton',"
app = replace_once(app, old_ids, new_ids, 'element ID list')

function_anchor = '''function recalculateTerritoryHouseIds() {
'''
clear_function = '''function clearAllTerritories() {
  if (!requireAdmin()) return;
  const territoryCount = territories.length;
  const assignedCount = houses.filter(house => house.territoryId).length;
  if (!territoryCount && !assignedCount) {
    toast('There are no territories to clear.');
    return;
  }
  const territoryLabel = `${territoryCount} territor${territoryCount === 1 ? 'y' : 'ies'}`;
  const addressLabel = `${assignedCount} assigned address${assignedCount === 1 ? '' : 'es'}`;
  const message = `Remove all ${territoryLabel} and return ${addressLabel} to Unassigned? ` +
    'The congregation boundary, loaded addresses, red avoid addresses, and excluded addresses will remain. ' +
    'This changes the current workspace only until you select Save Territory Plan.';
  if (!confirm(message)) return;

  cancelTerritoryBoundaryEdit(false);
  territories = [];
  for (const house of houses) house.territoryId = null;
  pendingTerritoryName = '';
  clearSelection(true);
  renderAllPlanningData();
  els.addressMessage.textContent = `All ${territoryLabel} cleared. Loaded addresses remain and are ready to regroup.`;
  toast(`All ${territoryLabel} cleared; ${addressLabel} returned to Unassigned.`);
}

'''
if 'function clearAllTerritories()' not in app:
    app = replace_once(app, function_anchor, clear_function + function_anchor, 'recalculateTerritoryHouseIds function')

old_event = "  els.clearSelectionButton.addEventListener('click', () => clearSelection(true));\n  els.excludeSelectionButton.addEventListener('click', includeExcludeSelected);"
new_event = "  els.clearSelectionButton.addEventListener('click', () => clearSelection(true));\n  els.clearAllTerritoriesButton.addEventListener('click', clearAllTerritories);\n  els.excludeSelectionButton.addEventListener('click', includeExcludeSelected);"
app = replace_once(app, old_event, new_event, 'Build Territories event wiring')
app_path.write_text(app, encoding='utf-8')


# Add a small note style and refresh all Territory Planner cache keys.
styles_path = Path('territories/styles.css')
styles = styles_path.read_text(encoding='utf-8')
style_block = '''

/* Clear-all territory workspace control */
.clear-territories-note {
  display: block;
  margin: -1px 0 11px;
  padding: 9px 10px;
  border: 1px solid #e7c3be;
  border-left: 4px solid #a53b34;
  border-radius: 10px;
  background: #fff8f7;
  color: #6f4b48;
  font-size: 9.5px;
  line-height: 1.42;
}
'''
if '/* Clear-all territory workspace control */' not in styles:
    styles += style_block
styles_path.write_text(styles, encoding='utf-8')

for path in [Path('territories/bootstrap.js'), Path('territories/index.html')]:
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'territories-\d{8}-\d+', VERSION, text)
    path.write_text(text, encoding='utf-8')

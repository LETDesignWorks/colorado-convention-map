from pathlib import Path

VERSION_OLD = 'territories-20261010-5'
VERSION_NEW = 'territories-20261010-6'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor was not found')
    return text.replace(old, new, 1)


workflow_path = Path('territories/territory-workflow-ui.js')
text = workflow_path.read_text(encoding='utf-8')

text = replace_once(
    text,
    f"const VERSION = '{VERSION_OLD}';",
    f"const VERSION = '{VERSION_NEW}';",
    'workflow module version',
)

text = replace_once(
    text,
    "  const hallEyebrow = document.querySelector('#hallAddressSetCard .eyebrow');\n  if (hallEyebrow) hallEyebrow.textContent = '3D — KINGDOM HALL ADDRESS SET';",
    "  const hallEyebrow = document.querySelector('#hallAddressSetCard .eyebrow');\n  if (hallEyebrow && hallEyebrow.textContent !== '3D — KINGDOM HALL ADDRESS SET') {\n    hallEyebrow.textContent = '3D — KINGDOM HALL ADDRESS SET';\n  }",
    'Hall address-set heading guard',
)

text = replace_once(
    text,
    "  const chip = document.getElementById('territoryWorkflowChip');\n  if (chip) chip.textContent = activeMode === MODE_BOUNDARY ? 'Boundary workflow' : activeMode === MODE_UPLOAD ? 'Address-list workflow' : 'All tools';\n  const showAll = document.getElementById('territoryWorkflowShowAll');\n  if (showAll) showAll.textContent = activeMode === MODE_ALL ? 'All Tools Are Showing' : 'Show All Planning Tools';",
    "  const chip = document.getElementById('territoryWorkflowChip');\n  const chipText = activeMode === MODE_BOUNDARY ? 'Boundary workflow' : activeMode === MODE_UPLOAD ? 'Address-list workflow' : 'All tools';\n  if (chip && chip.textContent !== chipText) chip.textContent = chipText;\n  const showAll = document.getElementById('territoryWorkflowShowAll');\n  const showAllText = activeMode === MODE_ALL ? 'All Tools Are Showing' : 'Show All Planning Tools';\n  if (showAll && showAll.textContent !== showAllText) showAll.textContent = showAllText;",
    'workflow status text guards',
)

text = replace_once(
    text,
    "  window.addEventListener('territory-planner:data', () => setTimeout(refreshEnhancements, 0));\n  new MutationObserver(() => refreshEnhancements()).observe(document.querySelector('.side-panel') || document.body, { childList: true, subtree: true });\n  refreshEnhancements();",
    "  let refreshTimer = null;\n  const scheduleRefresh = () => {\n    clearTimeout(refreshTimer);\n    refreshTimer = setTimeout(refreshEnhancements, 90);\n  };\n  window.addEventListener('territory-planner:data', scheduleRefresh);\n\n  // Watch only during startup while the asynchronously initialized upload and\n  // avoid-address cards are being inserted. A permanent subtree observer caused\n  // a feedback loop because this module also updates headings and status labels.\n  const sidePanel = document.querySelector('.side-panel');\n  if (sidePanel) {\n    const startupObserver = new MutationObserver(() => {\n      scheduleRefresh();\n      if (document.getElementById('bulkAddressCard') &&\n          document.getElementById('avoidWorkflowCard') &&\n          document.getElementById('hallAddressSetCard')) {\n        startupObserver.disconnect();\n      }\n    });\n    startupObserver.observe(sidePanel, { childList: true, subtree: true });\n    setTimeout(() => startupObserver.disconnect(), 8000);\n  }\n\n  [0, 120, 350, 800, 1600, 3200].forEach(delay => setTimeout(refreshEnhancements, delay));",
    'permanent mutation observer',
)

workflow_path.write_text(text, encoding='utf-8')

bootstrap_path = Path('territories/bootstrap.js')
bootstrap = bootstrap_path.read_text(encoding='utf-8').replace(VERSION_OLD, VERSION_NEW)
if VERSION_NEW not in bootstrap:
    raise RuntimeError('bootstrap version was not updated')
bootstrap_path.write_text(bootstrap, encoding='utf-8')

index_path = Path('territories/index.html')
index = index_path.read_text(encoding='utf-8').replace(VERSION_OLD, VERSION_NEW)
if VERSION_NEW not in index:
    raise RuntimeError('index version was not updated')
index_path.write_text(index, encoding='utf-8')

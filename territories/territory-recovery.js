// Recovery files contain editable territories and the original PDF bytes.
// Validate the complete file before any private database write is attempted.
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
const fail = message => { throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length < 1000;
function validGeometry(geometry) {
  if (geometry === null) return true;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.length > 0 && polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(point => Array.isArray(point) && point.length === 2 &&
      point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85) &&
    ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]));
}
export function recoveryPdf(original) {
  return new Blob([Uint8Array.from(atob(original.pdfBase64), character => character.charCodeAt(0))], { type: 'application/pdf' });
}
export async function validateRecoveryPackage(source) {
  if (typeof source !== 'string' || source.length > 80_000_000) fail('Choose a recovery file smaller than 80 MB.');
  const data = JSON.parse(source), plan = data.plan;
  if (data.format !== 'denver-territory-recovery' || data.version !== 1) fail('This is not a supported territory recovery file.');
  if (!text(plan?.name) || !text(plan?.hall?.id) || !text(plan?.hall?.name) || !text(plan?.congregation)) fail('The recovery file needs a plan name, Hall, and congregation.');
  if (!Array.isArray(plan.houses) || !plan.houses.length || plan.houses.length > 25000 ||
      !Array.isArray(plan.territories) || !plan.territories.length || plan.territories.length > 200 || !validGeometry(plan.geometry)) fail('The recovery plan has invalid addresses or boundaries.');
  const homes = new Map(), territories = new Map();
  for (const territory of plan.territories) {
    if (!text(territory.id) || !text(territory.name) || territories.has(territory.id) || !validGeometry(territory.geometry) || !Array.isArray(territory.houseIds)) fail('A recovered territory is incomplete or repeated.');
    territories.set(territory.id, territory);
  }
  for (const house of plan.houses) {
    if (!text(house.id) || !text(house.address) || homes.has(house.id) || !Number.isFinite(house.lat) || !Number.isFinite(house.lng) ||
        Math.abs(house.lat) > 85 || Math.abs(house.lng) > 180 || typeof house.avoid !== 'boolean' || typeof house.included !== 'boolean') fail('A recovered address is invalid or repeated.');
    if (house.avoid ? (house.included || house.territoryId) : (!house.included || !territories.has(house.territoryId))) fail('A recovered address has an invalid territory or Do Not Visit marking.');
    homes.set(house.id, house);
  }
  for (const territory of plan.territories) {
    const expected = plan.houses.filter(house => !house.avoid && house.territoryId === territory.id).map(house => house.id).sort();
    if (!expected.length || JSON.stringify(expected) !== JSON.stringify([...territory.houseIds].sort())) fail('A recovered territory has an incorrect address list.');
  }
  if (!Array.isArray(data.originals) || data.originals.length !== territories.size) fail('Each recovered territory needs its original PDF.');
  const seen = new Set(), pdfHashes = new Set();
  for (const original of data.originals) {
    const snapshot = original.snapshot, territory = territories.get(snapshot?.territory?.id);
    if (!territory || seen.has(territory.id) || snapshot.hall?.id !== plan.hall.id || snapshot.congregation !== plan.congregation ||
        JSON.stringify(snapshot.territory) !== JSON.stringify(territory) || !Array.isArray(snapshot.houses)) fail('A PDF does not match its recovered territory.');
    seen.add(territory.id);
    const snapshotIds = new Set();
    for (const house of snapshot.houses) {
      const saved = homes.get(house.id);
      if (!saved || snapshotIds.has(house.id) || house.address !== saved.address || house.lat !== saved.lat || house.lng !== saved.lng ||
          house.avoid !== saved.avoid || house.included !== saved.included || house.territoryId !== saved.territoryId ||
          (!house.avoid && house.territoryId !== territory.id)) fail('A PDF has inconsistent recovered addresses.');
      snapshotIds.add(house.id);
    }
    if (territory.houseIds.some(id => !snapshotIds.has(id))) fail('A PDF is missing recovered homes.');
    if (!text(original.filename) || !/^[^/\\]+\.pdf$/i.test(original.filename) || typeof original.pdfBase64 !== 'string' ||
        original.pdfBase64.length > 20_000_000 || !/^[a-f0-9]{64}$/.test(original.sha256)) fail('An original PDF is invalid.');
    if (pdfHashes.has(original.sha256)) fail('The same PDF is listed for more than one territory.');
    pdfHashes.add(original.sha256);
    const bytes = new Uint8Array(await recoveryPdf(original).arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-' || await sha256(bytes) !== original.sha256) fail(`The original PDF ${original.filename} is damaged or incomplete.`);
  }
  return { ...data, recoveryId: await sha256(new TextEncoder().encode(source)) };
}

export function setupRecoveryImport({ requireAdmin, restore }) {
  const file = document.getElementById('territoryRecoveryFile'), button = document.getElementById('restoreRecoveryButton'), status = document.getElementById('territoryRecoveryStatus');
  if (!file || !button || !status) return;
  let pending = null, selection = 0;
  const show = (message, state) => { status.textContent = message; status.dataset.state = state; };
  file.addEventListener('change', async () => {
    const selected = ++selection;
    pending = null; button.disabled = true;
    if (!requireAdmin() || !file.files?.[0]) return;
    show('Checking recovered addresses and original PDFs…', 'working');
    try {
      const checked = await validateRecoveryPackage(await file.files[0].text());
      if (selected !== selection) return;
      pending = checked; button.disabled = false;
      show(`Ready: ${checked.plan.name} — ${checked.plan.territories.length} territories, ${checked.plan.houses.filter(h => !h.avoid).length} homes, ${checked.plan.houses.filter(h => h.avoid).length} Do Not Visit addresses, and ${checked.originals.length} original PDFs. These will be saved as a separate plan.`, 'waiting');
    } catch (error) { if (selected === selection) show(error.message, 'error'); }
  });
  button.addEventListener('click', async () => {
    if (!pending || !requireAdmin()) return;
    button.disabled = true; file.disabled = true;
    try {
      await restore(pending, message => show(message, 'working'));
      show(`Saved ${pending.plan.territories.length} recovered territories and ${pending.originals.length} original PDFs. Choose Load beside “${pending.plan.name}” in Saved plans.`, 'success');
      pending = null; file.value = '';
    } catch (error) { show(`Recovery stopped: ${error.message} You can retry this file; confirmed copies will be kept.`, 'error'); }
    finally { file.disabled = false; button.disabled = !pending; }
  });
}

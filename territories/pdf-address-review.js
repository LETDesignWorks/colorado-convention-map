import { scanDuplicateAddresses, cleanDuplicateAddresses } from './address-duplicates.js?v=territories-20261022-45';

// Operate on a detached print snapshot, never the live map or original archive.
export function preparePdfAddressSnapshot(sourceSnapshot) {
  const snapshot = JSON.parse(JSON.stringify(sourceSnapshot));
  if (!snapshot.territory?.id || !Array.isArray(snapshot.houses)) throw new Error('The saved PDF address data is incomplete.');
  const territory = snapshot.territory;
  for (const house of snapshot.houses) {
    if (!house.avoid && !house.territoryId && house.included !== false) house.territoryId = territory.id;
  }
  const draft = { houses: snapshot.houses, territories: [territory] };
  const report = scanDuplicateAddresses(draft.houses, draft.territories);
  const result = report.safe ? cleanDuplicateAddresses(draft) : { draft, removed: 0, remaining: report };
  snapshot.houses = result.draft.houses;
  snapshot.territory = result.draft.territories[0];
  return { snapshot, removed: result.removed, unresolved: result.remaining.groups.length, unresolvedGroups: result.remaining.groups };
}

// Historical PDFs can contain duplicate rows even after the matching code changes.
// A fresh render uses the selected snapshot; the archived file remains recoverable.
export async function buildReviewedVersionPdf(version, hall, progress, { readPdf, buildPdf, allowReviewCopy = false }) {
  const report = scanDuplicateAddresses(version.houses || [], [version.territory]);
  let archiveReadFailed = false;
  if (version.pdfRecord && !report.groups.length) {
    try { return { blob: await readPdf(version.pdfRecord), filename: version.pdfRecord.filename || 'territory.pdf', regenerated: false }; }
    catch { archiveReadFailed = true; if (progress) progress.textContent = 'The archived file could not be read. Rebuilding from the saved territory data…'; }
  }
  if (version.error || !version.houses?.length) throw new Error('This saved version is incomplete. Review its address data first.');
  const reviewed = preparePdfAddressSnapshot({ hall, congregation: version.congregation, territory: version.territory, houses: version.houses });
  if (reviewed.unresolved && !allowReviewCopy) throw Object.assign(new Error(`${reviewed.unresolved} possible duplicate address group(s) need review before creating a clean PDF. Use Address duplicate check, or create a clearly marked review PDF without combining uncertain matches. The original archive is unchanged.`), { code: 'PDF_REVIEW_REQUIRED' });
  reviewed.snapshot.pdfReviewCopy = Boolean(allowReviewCopy && reviewed.unresolved);
  if (progress) progress.textContent = reviewed.removed ? `Removing ${reviewed.removed} confirmed repeated PDF address rows and building a fresh PDF…` : 'Building a PDF from this saved version…';
  const built = await buildPdf(reviewed.snapshot, progress);
  return { ...built, regenerated: true, archiveReadFailed, duplicatesRemoved: reviewed.removed,
    originalArchiveRetained: Boolean(version.pdfRecord) };
}

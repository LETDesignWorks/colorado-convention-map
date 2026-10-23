// A trimmed boundary can leave older address assignments behind. Report those
// records in a review appendix rather than preventing the whole PDF from opening.
export function scopePdfAddresses(snapshot, geometry, { isMapped, contains, houseNumber }) {
  const homes = [], avoids = [], issues = [];
  for (const house of snapshot.houses) {
    let reason = '';
    if (!isMapped(house)) reason = 'Map location is missing or invalid; not plotted.';
    else if (house.avoid) {
      if (contains(house, geometry)) { avoids.push(house); continue; }
      reason = 'AVOID / DO NOT VISIT record outside the selected boundary; not plotted.';
    } else if (house.included === false) reason = 'Excluded address; not included in the territory work list.';
    else if (String(house.territoryId) !== String(snapshot.territory.id)) reason = 'Assignment does not match this territory; not included in the work list.';
    else if (!contains(house, geometry)) reason = 'Saved assignment outside the selected boundary; not included in the work list.';
    else if (!houseNumber(house)) reason = 'Street house number is missing; not plotted.';
    else { homes.push(house); continue; }
    issues.push({ address: String(house.address || house.baseAddress || 'Address not recorded'), avoid: Boolean(house.avoid), reason });
  }
  return { homes, avoids, issues };
}
export function duplicatePdfIssues(groups) {
  return groups.flatMap(group => group.entries.map(({ house }) => ({
    address: String(house.address || house.baseAddress || 'Address not recorded'), avoid: Boolean(house.avoid),
    reason: `Possible duplicate retained for review: ${group.reasons.join('; ') || 'address identity requires a decision'}.`
  })));
}
export function addPdfReviewPages(doc, issues, header) {
  if (!issues.length) return;
  let y = 0;
  function newPage() {
    doc.addPage('letter', 'landscape'); header();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 38, 30);
    doc.text('REVIEW COPY - resolve these address issues before ministry use.', 0.48, 1.27);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 70, 85);
    doc.text('No saved addresses, assignments, boundaries, or earlier PDFs were changed.', 0.48, 1.49);
    doc.text('Outside and unmapped records are not on the maps or work list. Possible duplicates remain until reviewed.', 0.48, 1.69);
    y = 2.05;
  }
  newPage();
  for (let index = 0; index < issues.length; index++) {
    const issue = issues[index];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(`${index + 1}. ${issue.address}${issue.avoid ? ' [AVOID / DO NOT VISIT]' : ''} - ${issue.reason}`, 9.95);
    for (const line of lines) {
      if (y > 7.70) newPage();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 55, 72);
      doc.text(line, 0.48, y); y += 0.17;
    }
    y += 0.10;
  }
}
export function stampPdfReview(doc, pageCount) {
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(150, 38, 30);
    doc.text('REVIEW COPY - address issues listed at the end; resolve before ministry use.', 2.15, 0.91);
  }
}

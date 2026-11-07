import {ribbonLayout} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';

// All territory exports use landscape US Letter. Artwork keeps its native
// proportions; text, maps and appendices use the clear area between the ribbons.
const ribbons = ribbonLayout(792, 612);
const top = ribbons.top / 72, bottom = ribbons.bottom / 72;
const footerLine = 8.5 - bottom - .30;
export const TERRITORY_PDF_LAYOUT = Object.freeze({
  top, bottom, contentTop: top + 1.00, contentBottom: footerLine - .15,
  headerLine: top + .77, headerTitle: top + .28, headerSubtitle: top + .50, headerReview: top + .67,
  footerLine, footerWarning: footerLine + .13, footerNote: footerLine + .28,
  legendY: footerLine - .13
});
export function territoryPdfMapBox(width = 1200, height = 775) {
  const y = top + .85;
  const scale = Math.min(10.14 / width, (footerLine - .25 - y) / height);
  const mapWidth = width * scale;
  return {x: (11 - mapWidth) / 2, y, width: mapWidth, height: height * scale};
}

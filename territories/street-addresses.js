const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const numberPrefix = /^(\d+(?:\s+\d+\/\d+|[¼½¾])?[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?)(?=\s|,|$)/;
const aliases = { STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', ROAD: 'RD',
  COURT: 'CT', CIRCLE: 'CIR', LANE: 'LN', PLACE: 'PL', PARKWAY: 'PKWY', TERRACE: 'TER',
  TRAIL: 'TRL', HIGHWAY: 'HWY', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const directions = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

export function streetAddressInfo(house) {
  const address = String(house.address || house.baseAddress || '').trim();
  const match = address.match(numberPrefix);
  const number = match?.[1] || '';
  const street = (match ? address.slice(match[0].length) : address).split(',')[0]
    .replace(/\s+(?:(?:APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING)\s+|#\s*)\S+.*$/i, '').trim();
  const tokens = street.replace(/\./g, '').toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    tokens[0] = directions.has(aliases[tokens[0]]) ? aliases[tokens[0]] : tokens[0];
    const last = tokens.length - 1;
    tokens[last] = aliases[tokens[last]] || tokens[last];
    if (directions.has(tokens[last]) && last > 0) tokens[last - 1] = aliases[tokens[last - 1]] || tokens[last - 1];
  }
  const key = number && tokens.length ? tokens.join(' ') : '';
  const name = key ? tokens.map(token => directions.has(token) ? token : token[0] + token.slice(1).toLowerCase()).join(' ') : 'Other addresses';
  const fraction = number.match(/(\d+)\/(\d+)/);
  const fractional = fraction ? Number(fraction[1]) / Number(fraction[2]) : /½/.test(number) ? .5 : /¼/.test(number) ? .25 : /¾/.test(number) ? .75 : 0;
  const numberValue = number ? parseInt(number, 10) + fractional : Infinity;
  const unit = address.match(/(?:\b(?:APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING)\s+|#\s*)([^,]+)/i)?.[1]?.trim() || '';
  return { key, name, number, numberValue, unit, address };
}

export function compareStreetAddresses(a, b) {
  const aa = streetAddressInfo(a), bb = streetAddressInfo(b);
  return Number(!aa.key) - Number(!bb.key) || natural.compare(aa.key, bb.key)
    || (aa.numberValue === bb.numberValue ? 0 : aa.numberValue - bb.numberValue)
    || natural.compare(aa.number, bb.number) || natural.compare(aa.unit, bb.unit) || natural.compare(aa.address, bb.address);
}

export function groupAddressesByStreet(items) {
  const groups = new Map();
  for (const house of [...items].sort(compareStreetAddresses)) {
    const info = streetAddressInfo(house);
    if (!groups.has(info.key)) groups.set(info.key, { key: info.key, name: info.name, houses: [] });
    groups.get(info.key).houses.push(house);
  }
  return [...groups.values()];
}

// Draw one PDF page of a sorted list. Repeat the street heading on a new column
// or page, and never leave a heading without its first address underneath it.
export function drawStreetAddressColumns(doc, houses, startIndex, options = {}) {
  const { columns = [0.48, 5.55], startY = 1.27, bottomY = 7.91, width = 4.55, avoid = false } = options;
  let index = startIndex;
  const color = avoid ? [151, 45, 37] : [40, 55, 72];
  for (const x of columns) {
    let y = startY, previousKey = null;
    while (index < houses.length) {
      const info = streetAddressInfo(houses[index]);
      const newStreet = previousKey !== info.key;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3);
      const lines = doc.splitTextToSize(`${index + 1}. ${houses[index].address}`, width - (avoid ? .2 : 0));
      const needed = Math.max(.23, lines.length * .17 + .07);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      const continued = newStreet && index > 0 && streetAddressInfo(houses[index - 1]).key === info.key;
      const heading = doc.splitTextToSize(info.name + (continued ? ' (continued)' : ''), width);
      const headingHeight = newStreet ? heading.length * .18 + .16 : 0;
      if (y + needed + headingHeight > bottomY) break;
      if (newStreet) {
        doc.setTextColor(...(avoid ? color : [11, 68, 126]));
        doc.text(heading, x, y);
        y += headingHeight;
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...color);
      if (avoid) { doc.setFillColor(201, 54, 43); doc.circle(x + .06, y - .025, .045, 'F'); }
      doc.text(lines, x + (avoid ? .2 : 0), y);
      y += needed; previousKey = info.key; index += 1;
    }
  }
  if (index === startIndex && index < houses.length) throw new Error('An address is too long to fit on a PDF page. Shorten that address before exporting.');
  return index;
}

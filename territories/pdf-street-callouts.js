import { groupAddressesByStreet } from './street-addresses.js?v=territories-20261017-31';

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const contains = (b, p) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
function lineHits(line, box) {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[line.start.x, line.end.x - line.start.x, box.left, box.right],
    [line.start.y, line.end.y - line.start.y, box.top, box.bottom]]) {
    if (Math.abs(delta) < 1e-8) { if (start < min || start > max) return false; }
    else { const a = (min - start) / delta, b = (max - start) / delta; low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b)); }
  }
  return low <= high;
}
const padded = (b, n) => ({ left: b.left - n, right: b.right + n, top: b.top - n, bottom: b.bottom + n });

export function layoutStreetCallouts(context, points, houseLayout, viewport) {
  const byId = new Map(points.map(point => [point.item, point]));
  const groups = groupAddressesByStreet(points.map(point => point.item)).filter(group => group.key);
  const fixed = [...houseLayout.labels, ...houseLayout.avoidMarkers].map(label => padded(label.bounds, 5));
  fixed.push({ left: viewport.width - 50, right: viewport.width, top: 0, bottom: 50 },
    { left: 0, right: viewport.width, top: viewport.height - 36, bottom: viewport.height });
  const houseLeaders = houseLayout.labels.map(label => label.leader).filter(Boolean);
  const placed = [], unplaced = [];
  context.save(); context.font = 'bold 16px Arial';
  for (const group of groups.sort((a, b) => b.name.length - a.name.length || a.key.localeCompare(b.key))) {
    const locations = group.houses.map(house => byId.get(house));
    const center = { x: locations.reduce((sum, point) => sum + point.x, 0) / locations.length,
      y: locations.reduce((sum, point) => sum + point.y, 0) / locations.length };
    // These anchors identify the address cluster, not a guessed road centreline.
    // Include individual homes so dense streets can use an unobstructed end of
    // their address cluster rather than forcing a leader through its middle.
    const anchors = [center, ...locations.map(({ x, y }) => ({ x, y }))];
    const ordered = [...locations].sort((a, b) => a.x - b.x || a.y - b.y);
    const stride = Math.max(1, Math.ceil(ordered.length / 8));
    for (let i = 0; i < ordered.length; i += stride) {
      const a = ordered[i], b = ordered[Math.min(i + 1, ordered.length - 1)];
      anchors.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    const lines = [''];
    for (const word of group.name.split(' ')) {
      const next = (lines.at(-1) + ' ' + word).trim();
      if (context.measureText(next).width > 210 && lines.at(-1)) lines.push(word);
      else lines[lines.length - 1] = next;
    }
    const width = Math.max(...lines.map(line => context.measureText(line).width)) + 18, height = lines.length * 19 + 10;
    const obstacles = [...fixed, ...placed.map(label => padded(label.bounds, 6))];
    let best = null, bestCost = Infinity;
    const consider = (x, y, anchor) => {
      const bounds = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
      if (bounds.left < 8 || bounds.right > viewport.width - 8 || bounds.top < 8 || bounds.bottom > viewport.height - 38) return;
      if (obstacles.some(box => overlaps(bounds, box)) || houseLeaders.some(line => lineHits(line, bounds))) return;
      const dx = anchor.x - x, dy = anchor.y - y;
      const scale = Math.min(1, 1 / Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2)));
      const leader = { start: anchor, end: { x: x + dx * scale, y: y + dy * scale } };
      // Never run a street callout through a house number or another callout.
      const obstructed = obstacles.filter(box => !contains(box, anchor)).some(box => lineHits(leader, box));
      if (obstructed) return;
      const cost = Math.hypot(dx, dy) + Math.hypot(anchor.x - center.x, anchor.y - center.y) * .35;
      if (cost < bestCost) { best = { key: group.key, name: group.name, lines, fontSize: 16, x, y, bounds, leader }; bestCost = cost; }
    };
    for (const anchor of anchors) {
      for (const distance of [40, 65, 95, 135, 190, 260]) for (let angle = 0; angle < 16; angle += 1) {
        consider(anchor.x + Math.cos(angle * Math.PI / 8) * distance,
          anchor.y + Math.sin(angle * Math.PI / 8) * distance, anchor);
      }
    }
    // Margins usually remain available even for a dense walking territory.
    if (!best) for (const anchor of anchors) {
      for (let x = width / 2 + 8; x <= viewport.width - width / 2 - 8; x += 30) {
        consider(x, height / 2 + 8, anchor); consider(x, viewport.height - 39 - height / 2, anchor);
      }
    }
    if (best) {
      // Trim the beginning if the address-cluster anchor sits under a number.
      const blockers = fixed.filter(box => contains(box, best.leader.start));
      if (blockers.length) {
        const { start, end } = best.leader;
        for (let t = .01; t <= 1; t += .01) {
          const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
          if (!blockers.some(box => contains(box, point))) { best.leader = { start: point, end }; break; }
        }
      }
      placed.push(best);
    } else unplaced.push(group.name);
  }
  context.restore();
  return { labels: placed, unplaced };
}

export function drawStreetCallouts(doc, layout, viewport, map = { x: .43, y: 1.17, width: 10.14, height: 6.55 }) {
  const sx = map.width / viewport.width, sy = map.height / viewport.height;
  const x = value => map.x + value * sx, y = value => map.y + value * sy;
  doc.saveGraphicsState();
  for (const halo of [true, false]) {
    doc.setDrawColor(...(halo ? [255, 255, 255] : [52, 99, 132])); doc.setLineWidth((halo ? 3 : 1) * sx);
    for (const label of layout.labels) doc.line(x(label.leader.start.x), y(label.leader.start.y), x(label.leader.end.x), y(label.leader.end.y));
  }
  for (const label of layout.labels) {
    doc.setFillColor(255, 255, 255); doc.setDrawColor(126, 157, 178); doc.setLineWidth(.7 * sx);
    doc.roundedRect(x(label.bounds.left), y(label.bounds.top), (label.bounds.right - label.bounds.left) * sx,
      (label.bounds.bottom - label.bounds.top) * sy, 4 * sx, 4 * sy, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(label.fontSize * sx * 72); doc.setTextColor(24, 76, 112);
    label.lines.forEach((line, i) => doc.text(line, x(label.x), y(label.y + (i - (label.lines.length - 1) / 2) * 19), { align: 'center', baseline: 'middle' }));
  }
  doc.restoreGraphicsState();
}

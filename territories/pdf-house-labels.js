// Layout is in map pixels; the final labels are printed as sharp PDF text.
export function pdfHouseNumber(house) {
  const address = String(house.address ?? '').trim();
  const match = address.match(/^(\d+(?:\s+\d+\/\d+|[¼½¾])?[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?)(?=\s|,|$)/);
  return match ? match[1].replace(/\s*[-–]\s*/g, '-').replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4') : '';
}

function rectangle(x, y, width, height, angle = 0) {
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const axes = [{ x: c, y: s }, { x: -s, y: c }];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({
    x: x + dx * width / 2 * c - dy * height / 2 * s,
    y: y + dx * width / 2 * s + dy * height / 2 * c
  }));
  return { axes, corners, halfWidth: width / 2, halfHeight: height / 2, bounds: {
    left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
    top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y))
  } };
}

function overlap(a, b) {
  if (a.bounds.right <= b.bounds.left || a.bounds.left >= b.bounds.right || a.bounds.bottom <= b.bounds.top || a.bounds.top >= b.bounds.bottom) return 0;
  if (b.radius) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const x = Math.max(0, Math.abs(dx * a.axes[0].x + dy * a.axes[0].y) - a.halfWidth);
    const y = Math.max(0, Math.abs(dx * a.axes[1].x + dy * a.axes[1].y) - a.halfHeight);
    return Math.max(0, b.radius + 2 - Math.hypot(x, y));
  }
  let depth = Infinity;
  for (const axis of [...a.axes, ...b.axes]) {
    const ap = a.corners.map(p => p.x * axis.x + p.y * axis.y);
    const bp = b.corners.map(p => p.x * axis.x + p.y * axis.y);
    const intersection = Math.min(Math.max(...ap), Math.max(...bp)) - Math.max(Math.min(...ap), Math.min(...bp));
    if (intersection <= 0) return 0;
    depth = Math.min(depth, intersection);
  }
  return depth;
}

export function layoutHouseLabels(context, homes, avoids, viewport, options = {}) {
  // 20 map pixels print at 12.2 pt; even crowded labels stay at least 8.5 pt.
  const baseFont = 20, minimumFont = 14, halo = 2.4;
  const locations = new Map();
  homes.forEach(home => {
    const key = `${Number(home.item.lng)},${Number(home.item.lat)}`;
    if (!locations.has(key)) locations.set(key, { x: home.x, y: home.y, houses: [], numbers: new Set() });
    const label = locations.get(key);
    label.houses.push(home.item);
    const number = pdfHouseNumber(home.item);
    if (!number) throw new Error('Every mapped home needs a street house number before exporting.');
    label.numbers.add(number);
  });
  let labels = [...locations.values()].map(label => ({ ...label,
    lines: [...label.numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    fontSize: baseFont, angle: 0, halo
  }));
  const avoidMarkers = avoids.map(avoid => {
    const radius = options.view === 'closer' ? 13 : 9;
    return { ...avoid, radius, ...rectangle(avoid.x, avoid.y, (radius + 2) * 2, (radius + 2) * 2) };
  });
  context.save();
  const measure = (label, fontSize, angle) => {
    context.font = `bold ${fontSize}px Arial`;
    const metrics = label.lines.map(line => context.measureText(line));
    const width = Math.max(...metrics.map(m => m.width)) + halo + 2;
    const inkHeight = Math.max(...metrics.map(m => m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
    const height = (inkHeight || fontSize) + (label.lines.length - 1) * fontSize * 1.15 + halo + 2;
    return { ...label, fontSize, angle, ...rectangle(label.x, label.y, width, height, angle) };
  };
  const candidates = labels.map(label => {
    const variants = [];
    for (let fontSize = baseFont; fontSize >= minimumFont; fontSize -= 1) {
      for (const angle of [0, -90, -45, 45]) variants.push(measure(label, fontSize, angle));
    }
    return variants;
  });
  labels = candidates.map(variants => variants[0]);
  const score = (candidate, index) => {
    let cost = 0;
    labels.forEach((label, other) => { if (other !== index) { const depth = overlap(candidate, label); if (depth) cost += 1000 + depth; } });
    avoidMarkers.forEach(marker => { const depth = overlap(candidate, marker); if (depth) cost += 1000 + depth; });
    const b = candidate.bounds;
    if (b.left < 4 || b.right > viewport.width - 4 || b.top < 4 || b.bottom > viewport.height - 36) cost += 100000;
    return cost;
  };
  // Try the largest number first. Rotation uses the house itself as the pivot;
  // labels never drift onto a neighbour, disappear, or become list indexes.
  const optimize = startAngle => {
    labels = candidates.map(variants => variants.find(label => label.angle === startAngle));
    for (let pass = 0; pass < 5; pass += 1) {
      let changed = false;
      const order = labels.map((label, i) => ({ i, cost: score(label, i) })).sort((a, b) => b.cost - a.cost);
      for (const { i } of order) {
        const current = labels[i];
        if (!score(current, i) && current.fontSize === baseFont && current.angle === 0) continue;
        let best = current, bestCost = score(current, i);
        for (const candidate of candidates[i]) {
          const cost = score(candidate, i);
          if (cost === 0) { best = candidate; bestCost = cost; break; }
          if (cost < bestCost) { best = candidate; bestCost = cost; }
        }
        if (best.angle !== current.angle || best.fontSize !== current.fontSize) changed = true;
        labels[i] = best;
      }
      if (!changed) break;
    }
    return { labels, cost: labels.reduce((sum, label, i) => sum + score(label, i) * 100 + (baseFont - label.fontSize) * 4 + Math.abs(label.angle) / 90, 0) };
  };
  const horizontal = optimize(0);
  if (horizontal.cost > 0) {
    // A whole row sometimes must turn together; a local move alone cannot fit.
    const vertical = optimize(-90);
    labels = horizontal.cost <= vertical.cost ? horizontal.labels : vertical.labels;
  }
  const overlapPairs = [];
  labels.forEach((label, i) => {
    labels.slice(i + 1).forEach(other => { if (overlap(label, other)) overlapPairs.push([label, other]); });
    avoidMarkers.forEach(marker => { if (overlap(label, marker)) overlapPairs.push([label, marker]); });
  });
  context.restore();
  return { labels, avoidMarkers, overlapPairs };
}

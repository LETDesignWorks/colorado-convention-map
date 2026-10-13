// Layout is in map pixels; the final labels are printed as sharp PDF text.
export function pdfHouseNumber(house) {
  const address = String(house.address ?? '').trim();
  const match = address.match(/^(\d+(?:\s+\d+\/\d+|[¼½¾])?[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?)(?=\s|,|$)/);
  return match ? match[1].replace(/\s*[-–]\s*/g, '-').replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4') : '';
}

function rectangle(x, y, width, height) {
  return { x, y, halfWidth: width / 2, halfHeight: height / 2,
    bounds: { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 } };
}
function overlaps(a, b) {
  return a.bounds.left < b.bounds.right && a.bounds.right > b.bounds.left
    && a.bounds.top < b.bounds.bottom && a.bounds.bottom > b.bounds.top;
}
function pointInBox(point, box) {
  return point.x >= box.bounds.left && point.x <= box.bounds.right
    && point.y >= box.bounds.top && point.y <= box.bounds.bottom;
}
function crosses(a, b) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a.start, a.end, b.start) * cross(a.start, a.end, b.end) < -0.01
    && cross(b.start, b.end, a.start) * cross(b.start, b.end, a.end) < -0.01;
}
function lineHitsBox(line, box) {
  if (!line) return false;
  if (pointInBox(line.start, box) || pointInBox(line.end, box)) return true;
  const b = box.bounds, corners = [{ x: b.left, y: b.top }, { x: b.right, y: b.top },
    { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom }];
  return corners.some((point, index) => crosses(line, { start: point, end: corners[(index + 1) % 4] }));
}
function leaderFor(label) {
  const dx = label.anchorX - label.x, dy = label.anchorY - label.y;
  if (Math.hypot(dx, dy) < 1) return null;
  const scale = 1 / Math.max(Math.abs(dx) / label.halfWidth, Math.abs(dy) / label.halfHeight);
  return { start: { x: label.anchorX, y: label.anchorY },
    end: { x: label.x + dx * Math.min(1, scale), y: label.y + dy * Math.min(1, scale) } };
}

export function layoutHouseLabels(context, homes, avoids, viewport, options = {}) {
  // All numbers remain horizontal and print at 13.4 pt. Move crowded labels
  // into clear space with leaders instead of rotating or shrinking the text.
  const fontSize = 22, halo = 2.4;
  const locations = new Map();
  homes.forEach(home => {
    const key = `${Number(home.item.lng)},${Number(home.item.lat)}`;
    if (!locations.has(key)) locations.set(key, { anchorX: home.x, anchorY: home.y, houses: [], numbers: new Set() });
    const label = locations.get(key);
    label.houses.push(home.item);
    const number = pdfHouseNumber(home.item);
    if (!number) throw new Error('Every mapped home needs a street house number before exporting.');
    label.numbers.add(number);
  });
  context.save();
  context.font = `bold ${fontSize}px Arial`;
  const originals = [...locations.values()].map(label => {
    const lines = [...label.numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const width = Math.max(...lines.map(line => context.measureText(line).width)) + 10;
    const height = fontSize * 0.76 + (lines.length - 1) * fontSize * 1.15 + 8;
    return { ...label, lines, fontSize, angle: 0, halo, ...rectangle(label.anchorX, label.anchorY, width, height), leader: null };
  });
  context.restore();
  const avoidMarkers = avoids.map(avoid => {
    const radius = options.view === 'closer' ? 13 : 9;
    return { ...avoid, radius, ...rectangle(avoid.x, avoid.y, (radius + 3) * 2, (radius + 3) * 2) };
  });
  const homePoints = originals.map(label => rectangle(label.anchorX, label.anchorY, 6, 6));
  const inside = label => label.bounds.left >= 8 && label.bounds.right <= viewport.width - 8
    && label.bounds.top >= 8 && label.bounds.bottom <= viewport.height - 38
    && !(label.bounds.right > viewport.width - 46 && label.bounds.top < 46);
  const candidateAt = (label, x, y) => {
    const candidate = { ...label, ...rectangle(x, y, label.halfWidth * 2, label.halfHeight * 2) };
    candidate.leader = leaderFor(candidate);
    return candidate;
  };
  const candidates = originals.map(label => {
    const variants = [label];
    const stepX = label.halfWidth * 2 + 5, stepY = label.halfHeight * 2 + 5;
    for (let row = -9; row <= 9; row += 1) {
      for (let column = -7; column <= 7; column += 1) {
        if (row || column) variants.push(candidateAt(label, label.anchorX + column * stepX, label.anchorY + row * stepY));
      }
    }
    for (const distance of [25, 40, 60, 90, 130, 180, 250, 340]) {
      for (let angle = 0; angle < 16; angle += 1) {
        const radians = angle * Math.PI / 8;
        variants.push(candidateAt(label, label.anchorX + Math.cos(radians) * distance, label.anchorY + Math.sin(radians) * distance));
      }
    }
    return variants.filter(inside).filter(candidate => !candidate.leader || !pointInBox(candidate.leader.start, candidate))
      .filter(candidate => !homePoints.some((point, i) =>
      originals[i] !== label && overlaps(candidate, point))).sort((a, b) =>
      Math.hypot(a.x - label.anchorX, a.y - label.anchorY) - Math.hypot(b.x - label.anchorX, b.y - label.anchorY));
  });
  const cost = (candidate, index, placed) => {
    let penalty = Math.hypot(candidate.x - candidate.anchorX, candidate.y - candidate.anchorY);
    if (candidate.leader) penalty += 12;
    for (const marker of avoidMarkers) {
      if (overlaps(candidate, marker)) penalty += 1000000;
      if (lineHitsBox(candidate.leader, marker)) penalty += 10000;
    }
    for (let other = 0; other < placed.length; other += 1) {
      const label = placed[other];
      if (!label || index === other) continue;
      if (overlaps(candidate, label)) penalty += 1000000;
      if (lineHitsBox(candidate.leader, label) || lineHitsBox(label.leader, candidate)) penalty += 100000;
      if (candidate.leader && label.leader && crosses(candidate.leader, label.leader)) penalty += 1000;
    }
    return penalty;
  };
  const place = order => {
    const placed = new Array(originals.length);
    for (const index of order) {
      let best = null, bestCost = Infinity;
      for (const candidate of candidates[index]) {
        const distance = Math.hypot(candidate.x - candidate.anchorX, candidate.y - candidate.anchorY);
        if (distance > bestCost) break;
        const penalty = cost(candidate, index, placed);
        if (penalty < bestCost) { best = candidate; bestCost = penalty; }
      }
      // Extremely large coincident groups still retain every number.
      placed[index] = best || originals[index];
    }
    return { labels: placed, cost: placed.reduce((sum, label, i) => sum + cost(label, i, placed), 0) };
  };
  const indexes = originals.map((_, i) => i);
  const byRow = [...indexes].sort((a, b) => originals[a].anchorY - originals[b].anchorY || originals[a].anchorX - originals[b].anchorX);
  const layouts = [place(byRow), place([...byRow].reverse())];
  // Nearby homes on one street can fan into an ordered row. Moving them as a
  // group keeps the leaders from crisscrossing or chasing distant empty spots.
  const rows = [];
  byRow.forEach(index => {
    const last = rows.at(-1);
    if (last && originals[index].anchorY - originals[last[0]].anchorY < 10) last.push(index);
    else rows.push([index]);
  });
  const placeRows = direction => {
    const placed = new Array(originals.length);
    for (const row of rows) {
      const ordered = [...row].sort((a, b) => originals[a].anchorX - originals[b].anchorX);
      const groups = [];
      for (const index of ordered) {
        const group = groups.at(-1);
        if (group && originals[index].bounds.left < originals[group.at(-1)].bounds.right + 6) group.push(index);
        else groups.push([index]);
      }
      for (const group of groups) {
        const widths = group.map(i => originals[i].halfWidth * 2);
        const totalWidth = widths.reduce((a, b) => a + b, 0) + (group.length - 1) * 7;
        if (totalWidth > viewport.width - 16) return null;
        const center = group.reduce((sum, i) => sum + originals[i].anchorX, 0) / group.length;
        const rowY = group.reduce((sum, i) => sum + originals[i].anchorY, 0) / group.length;
        const height = Math.max(...group.map(i => originals[i].halfHeight * 2));
        const step = height / 2 + 10 + Math.max(...group.map(i => Math.abs(originals[i].anchorY - rowY)));
        let left = Math.max(8, Math.min(viewport.width - 8 - totalWidth, center - totalWidth / 2));
        const centers = widths.map(width => { const x = left + width / 2; left += width + 7; return x; });
        let best = null, bestCost = Infinity;
        for (const offset of [0, direction * step, -direction * step, direction * step * 2, -direction * step * 2]) {
          const next = [...placed];
          group.forEach((index, i) => {
            const candidate = candidateAt(originals[index], centers[i], rowY + offset);
            if (offset && candidate.leader) {
              // Connect to the near edge of the entire row, so a long fan line
              // cannot run through the white backing of its neighbour.
              candidate.leader.end = { x: candidate.x, y: candidate.y - Math.sign(offset) * candidate.halfHeight };
            }
            next[index] = candidate;
          });
          const invalid = group.some(index => !inside(next[index]) || (next[index].leader && pointInBox(next[index].leader.start, next[index]))
            || homePoints.some((point, other) => other !== index && overlaps(next[index], point)));
          if (invalid) continue;
          const penalty = group.reduce((sum, i) => sum + cost(next[i], i, next), 0);
          if (penalty < bestCost) { best = next; bestCost = penalty; }
        }
        if (!best) return null;
        group.forEach(index => { placed[index] = best[index]; });
      }
    }
    return { labels: placed, cost: placed.reduce((sum, label, i) => sum + cost(label, i, placed), 0) };
  };
  for (const direction of [1, -1]) {
    const layout = placeRows(direction);
    if (layout) layouts.push(layout);
  }
  const centerX = originals.reduce((sum, label) => sum + label.anchorX, 0) / (originals.length || 1);
  const centerY = originals.reduce((sum, label) => sum + label.anchorY, 0) / (originals.length || 1);
  layouts.push(place([...indexes].sort((a, b) => Math.hypot(originals[b].anchorX - centerX, originals[b].anchorY - centerY)
    - Math.hypot(originals[a].anchorX - centerX, originals[a].anchorY - centerY))));
  const labels = layouts.sort((a, b) => a.cost - b.cost)[0].labels;
  const overlapPairs = [];
  labels.forEach((label, i) => {
    labels.slice(i + 1).forEach(other => { if (overlaps(label, other)) overlapPairs.push([label, other]); });
    avoidMarkers.forEach(marker => { if (overlaps(label, marker)) overlapPairs.push([label, marker]); });
  });
  const leaderCrossings = [];
  labels.forEach((label, i) => {
    if (!label.leader) return;
    labels.slice(i + 1).forEach(other => { if (other.leader && crosses(label.leader, other.leader)) leaderCrossings.push([label, other]); });
  });
  return { labels, avoidMarkers, overlapPairs, leaderCrossings };
}

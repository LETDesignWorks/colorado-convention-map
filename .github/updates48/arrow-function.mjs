// Measure the complete projected route once. Added editing points must not
// change the arrow count or restart spacing at each line segment.
export function arrowheads(projected) {
  if (!Array.isArray(projected) || projected.length < 2 ||
      projected.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  const segments = [];
  let total = 0;
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1], b = projected[i];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length <= 1e-8) continue; // Repeated clicks have no travel distance.
    segments.push({a, dx, dy, length, start: total, end: total + length});
    total += length;
  }
  if (!Number.isFinite(total) || total < 12 || !segments.length) return [];
  // One global count, equal arc-length intervals, and half an interval at
  // each end. Bound the count even when most of a route is off screen.
  const count = Math.min(400, Math.max(1, Math.floor(total / 75)));
  const spacing = total / count;
  function sample(distance) {
    const target = Math.max(0, Math.min(total, distance));
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].end < target) lo = mid + 1;
      else hi = mid;
    }
    const segment = segments[lo];
    const t = Math.max(0, Math.min(1, (target - segment.start) / segment.length));
    return {x: segment.a.x + segment.dx * t, y: segment.a.y + segment.dy * t, segment};
  }
  return Array.from({length: count}, (_, i) => {
    const distance = spacing * (i + 0.5), anchor = sample(distance);
    // Blend the heading across a small neighborhood of a bend. Only the
    // arrow rotates: its anchor stays on the original, unmodified route.
    const radius = Math.min(8, spacing / 8, distance, total - distance);
    const before = sample(distance - radius), after = sample(distance + radius);
    let dx = after.x - before.x, dy = after.y - before.y;
    if (Math.hypot(dx, dy) < 1e-8) { dx = anchor.segment.dx; dy = anchor.segment.dy; }
    return {x: anchor.x, y: anchor.y, angle: Math.atan2(dy, dx) * 180 / Math.PI};
  });
}

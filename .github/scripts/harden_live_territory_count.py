from pathlib import Path

path = Path('territories/app-main.js')
text = path.read_text(encoding='utf-8')

old_segment = """function pointOnCountSegment(lng, lat, a, b) {
  const ax = Number(a?.[0]), ay = Number(a?.[1]), bx = Number(b?.[0]), by = Number(b?.[1]);
  if (![ax, ay, bx, by, lng, lat].every(Number.isFinite)) return false;
  const cross = ((lng - ax) * (by - ay)) - ((lat - ay) * (bx - ax));
  const tolerance = 1e-9 * Math.max(1, Math.abs(bx - ax) + Math.abs(by - ay));
  if (Math.abs(cross) > tolerance) return false;
  const dot = ((lng - ax) * (bx - ax)) + ((lat - ay) * (by - ay));
  if (dot < -tolerance) return false;
  const squaredLength = ((bx - ax) ** 2) + ((by - ay) ** 2);
  return dot <= squaredLength + tolerance;
}
"""
new_segment = """function pointOnCountSegment(lng, lat, a, b) {
  const ax = Number(a?.[0]), ay = Number(a?.[1]), bx = Number(b?.[0]), by = Number(b?.[1]);
  if (![ax, ay, bx, by, lng, lat].every(Number.isFinite)) return false;
  const tolerance = 1e-9 * Math.max(1, Math.abs(bx - ax) + Math.abs(by - ay));
  const squaredLength = ((bx - ax) ** 2) + ((by - ay) ** 2);
  if (squaredLength <= Number.EPSILON) {
    const squaredDistance = ((lng - ax) ** 2) + ((lat - ay) ** 2);
    return squaredDistance <= tolerance ** 2;
  }
  const cross = ((lng - ax) * (by - ay)) - ((lat - ay) * (bx - ax));
  if (Math.abs(cross) > tolerance) return false;
  const dot = ((lng - ax) * (bx - ax)) + ((lat - ay) * (by - ay));
  if (dot < -tolerance) return false;
  return dot <= squaredLength + tolerance;
}
"""
if old_segment not in text:
    raise RuntimeError('pointOnCountSegment anchor was not found')
text = text.replace(old_segment, new_segment, 1)

old_schedule = """function scheduleLiveTerritoryBoundaryCount(payload, immediate = false) {
  pendingLiveTerritoryCount = payload;
  clearTimeout(liveTerritoryCountTimer);
  liveTerritoryCountTimer = setTimeout(() => {
    liveTerritoryCountTimer = null;
    const next = pendingLiveTerritoryCount;
    pendingLiveTerritoryCount = null;
    if (next) updateLiveTerritoryBoundaryCount(next);
  }, immediate ? 0 : 90);
}
"""
new_schedule = """function scheduleLiveTerritoryBoundaryCount(payload, immediate = false) {
  clearTimeout(liveTerritoryCountTimer);
  liveTerritoryCountTimer = null;
  if (immediate) {
    pendingLiveTerritoryCount = null;
    updateLiveTerritoryBoundaryCount(payload);
    return;
  }
  pendingLiveTerritoryCount = payload;
  liveTerritoryCountTimer = setTimeout(() => {
    liveTerritoryCountTimer = null;
    const next = pendingLiveTerritoryCount;
    pendingLiveTerritoryCount = null;
    if (next) updateLiveTerritoryBoundaryCount(next);
  }, 75);
}
"""
if old_schedule not in text:
    raise RuntimeError('scheduleLiveTerritoryBoundaryCount anchor was not found')
text = text.replace(old_schedule, new_schedule, 1)

path.write_text(text, encoding='utf-8')

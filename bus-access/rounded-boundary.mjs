// Display-only smoothing. The source road-network contour and travel times are
// never changed and must be used for any detailed route review.
export function roundedPlanningArea(feature, center) {
  const ring = feature?.geometry?.type === 'Polygon' && feature.geometry.coordinates?.[0];
  const valid = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(valid) || !valid(center)
      || Math.abs(center[0]) >= 85 || Math.abs(center[1]) > 180
      || ring.some(p => Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)
      || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw Error('Invalid planning boundary coordinates.');
  const lon = center[1], lat = center[0], scaleX = Math.cos(lat * Math.PI / 180);
  const points = ring.map(p => [(p[0] - lon) * scaleX, p[1] - lat]);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const count = 180, radii = [];
  // Sample the outer road envelope every two degrees, then soften road-shaped
  // spikes over a ten-degree window and blend gently toward a rounded shape.
  for (let i = 0; i < count; i++) {
    const angle = i * 2 * Math.PI / count, ray = [Math.cos(angle), Math.sin(angle)];
    let radius = 0;
    for (let j = 0; j < points.length - 1; j++) {
      const a = points[j], b = points[j + 1], edge = [b[0] - a[0], b[1] - a[1]];
      const divisor = cross(ray, edge);
      if (Math.abs(divisor) < 1e-12) continue;
      const distance = cross(a, edge) / divisor, fraction = cross(a, ray) / divisor;
      if (distance > 0 && fraction >= -1e-9 && fraction <= 1 + 1e-9) radius = Math.max(radius, distance);
    }
    if (!radius) throw Error('The reference point must be inside a closed planning area.');
    radii.push(radius);
  }
  const mean = radii.reduce((sum, r) => sum + r, 0) / count;
  const output = radii.map((_, i) => {
    let total = 0, weightSum = 0;
    for (let offset = -15; offset <= 15; offset++) {
      const weight = Math.exp(-(offset * offset) / 50);
      total += radii[(i + offset + count) % count] * weight; weightSum += weight;
    }
    // Small visual padding; this is explicitly not a new travel-time calculation.
    const r = (0.8 * total / weightSum + 0.2 * mean) * 1.03, angle = i * 2 * Math.PI / count;
    return [Number((lon + r * Math.cos(angle) / scaleX).toFixed(6)), Number((lat + r * Math.sin(angle)).toFixed(6))];
  });
  output.push([...output[0]]);
  return {type: 'Feature', properties: {displayOnly: true, approximate: true,
    sourceMinutes: feature.properties?.minutes || 45, sourceCalculatedAt: feature.properties?.calculatedAt,
    method: 'Rounded radial envelope; not a route-eligibility boundary'}, geometry: {type: 'Polygon', coordinates: [output]}};
}

export const ROUNDED_BOUNDARY_NOTE = 'The solid blue outline is a rounded, approximate 45-minute planning guide around the Colorado Convention Center. Some places inside may take longer; some outside may be quicker. Switch to Detailed driving estimate for the road-shaped boundary. No live traffic, loading time, or bus-clearance verification.';
export const DETAILED_BOUNDARY_NOTE = 'The blue dashed area is a calculated 45-minute driving estimate FROM the Colorado Convention Center (Oct 23, 2026), using Valhalla / OpenStreetMap roads. No live traffic, loading time, or bus-clearance verification. Check each route and return time. Tap a marker for details.';
const styles = {
  rounded: {color: '#164b8b', weight: 5, opacity: 1, dashArray: null, lineCap: 'round', lineJoin: 'round', fillColor: '#4d9cdb', fillOpacity: 0.09},
  detailed: {color: '#0b4da2', weight: 3, opacity: 1, dashArray: '9 7', lineCap: 'round', lineJoin: 'round', fillColor: '#4d9cdb', fillOpacity: 0.06}
};
export function mountPlanningBoundary(L, map, source, center, {selector, note} = {}) {
  let rounded = null;
  try { rounded = roundedPlanningArea(source, center); } catch (error) { console.warn('Using the detailed planning boundary:', error.message); }
  let mode = rounded ? 'rounded' : 'detailed';
  const layer = L.geoJSON(mode === 'rounded' ? rounded : source, {style: styles[mode], interactive: false}).addTo(map);
  function label() {
    if (selector) selector.value = mode;
    if (note) note.textContent = mode === 'rounded' ? ROUNDED_BOUNDARY_NOTE : DETAILED_BOUNDARY_NOTE;
  }
  function change() {
    mode = selector?.value === 'detailed' || !rounded ? 'detailed' : 'rounded';
    // Update only this overlay; never rebuild markers, forms, or saved layouts.
    layer.clearLayers(); layer.addData(mode === 'rounded' ? rounded : source); layer.setStyle(styles[mode]);
    label(); map.fitBounds(layer.getBounds(), {padding: [18, 18]});
  }
  if (selector) {
    const option = selector.querySelector('option[value="rounded"]');
    if (option) option.disabled = !rounded;
    selector.addEventListener('change', change);
  }
  label(); return layer;
}

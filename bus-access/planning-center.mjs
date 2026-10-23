// Bus Review's reference point matches the existing Territory and Route Planners.
// This relocates the existing planning SKETCH, not a measured travel-time isochrone.
// Do not change the legacy DTC exports: other planning pages still use them.
export const CONVENTION_CENTER = Object.freeze({
  name: 'Colorado Convention Center',
  address: '700 14th St, Denver, CO 80202',
  point: Object.freeze([39.74248, -104.99567]),
  planningArea: 'ccc-45'
});

const radians = degrees => degrees * Math.PI / 180;
const degrees = radians => radians * 180 / Math.PI;
function validPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180;
}
export function recenterPlanningBoundary(boundary, originalCenter, center = CONVENTION_CENTER.point) {
  if (!Array.isArray(boundary) || boundary.length < 4 || !validPoint(originalCenter)
      || !validPoint(center) || !boundary.every(validPoint)) {
    throw new Error('The estimated planning boundary has invalid coordinates.');
  }
  const [oldLat, oldLng] = originalCenter.map(radians), [newLat, newLng] = center.map(radians);
  // Preserve each point's distance and bearing from the reference center.
  return boundary.map(([lat, lng]) => {
    const phi = radians(lat), delta = radians(lng) - oldLng;
    const haversine = Math.sin((phi - oldLat) / 2) ** 2
      + Math.cos(oldLat) * Math.cos(phi) * Math.sin(delta / 2) ** 2;
    const distance = 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
    const bearing = Math.atan2(Math.sin(delta) * Math.cos(phi),
      Math.cos(oldLat) * Math.sin(phi) - Math.sin(oldLat) * Math.cos(phi) * Math.cos(delta));
    const nextLat = Math.asin(Math.max(-1, Math.min(1, Math.sin(newLat) * Math.cos(distance)
      + Math.cos(newLat) * Math.sin(distance) * Math.cos(bearing))));
    const nextLng = newLng + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(newLat),
      Math.cos(distance) - Math.sin(newLat) * Math.sin(nextLat));
    return [Number(degrees(nextLat).toFixed(6)), Number((((degrees(nextLng) + 540) % 360) - 180).toFixed(6))];
  });
}

export const OWNER_UID = 'jPTl6zfkjaTbbCJMI7A7xXE2BN93';
export const OWNER_EMAIL = 'michaeltarin@hotmail.com';
export const ACCESS_VERSION = 1;
export const SECTIONS = [
  ['assignments', 'Congregation Assignments', 'Addresses, pins and meeting assignments are public.'],
  ['busAccess', 'Bus Access & Meeting Locations', 'Private reviews and contacts; shared location details and approval status. Photo storage remains owner-only.'],
  ['territories', 'Territories', 'Saved territory boundaries, plans, addresses and PDFs.'],
  ['routes', 'Travel Routes', 'Saved car, bus, rail and walking trips, start times and custom stops.'],
  ['activities', 'Delegate Activities', 'Saved activity bus schedules.'],
  ['activityPlanning', 'Activity Planning', 'Shared activity routes. Other schedules require access to their own sections.'],
  ['rail', 'South DTC Rail', 'Preferred rail connections are public.'],
  ['smpw', 'SMPW', 'Cart locations are public.']
].map(([id, label, description]) => ({id, label, description}));
export const LEVELS = ['none', 'view', 'edit'];
export function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
export function validEmail(value) { return /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(value) && value.length <= 254; }
export function policyId(email) {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw Error('Enter a valid email address.');
  return 'site-access-' + normalized;
}
export function owner(user) { return user?.uid === OWNER_UID; }
export function permission(user, policy, section, ready = true) {
  if (owner(user)) return 'edit';
  if (!ready || !user?.emailVerified || policy?.enabled !== true || policy.schemaVersion !== ACCESS_VERSION || normalizeEmail(policy.email) !== normalizeEmail(user.email) || !SECTIONS.some(item => item.id === section)) return 'none';
  const level = policy.permissions?.[section];
  return LEVELS.includes(level) ? level : 'none';
}
export function cleanPermissions(input = {}) {
  return Object.fromEntries(SECTIONS.map(({id}) => [id, LEVELS.includes(input[id]) ? input[id] : 'none']));
}
export const REVIEW_TYPES = {
  territories: ['territory-boundary', 'territory-plan', 'territory-plan-chunk', 'territory-pdf', 'territory-pdf-part', 'territory-name-choice'],
  routes: ['bus-route', 'route-plan', 'rtd-station'],
  activities: ['activity-bus-plan'],
  activityPlanning: ['activity-multistop-route']
};

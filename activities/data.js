export const ACTIVITY_POINTS = [
  {
    id: 'douglas-fairgrounds',
    marker: 'A1',
    activityId: 'douglas-fairgrounds',
    name: 'Douglas County Fairgrounds',
    role: 'venue',
    address: '500 Fairgrounds Rd, Castle Rock, CO 80104',
    lat: 39.365110,
    lng: -104.856079,
    note: 'Primary arrival and pickup point for the fairgrounds activity.'
  },
  {
    id: 'georgetown-loop-devils-gate',
    marker: 'A2',
    activityId: 'georgetown-loop',
    name: "Georgetown Loop Railroad — Devil's Gate Depot",
    role: 'venue',
    address: '646 Loop Dr, Georgetown, CO 80444',
    lat: 39.701619,
    lng: -105.706719,
    note: "Planning point uses the Devil's Gate Depot in Georgetown. Confirm the final depot before assigning buses."
  },
  {
    id: 'four-mile-historic-park',
    marker: 'A3',
    activityId: 'four-mile-house',
    name: 'Four Mile Historic Park / Four Mile House',
    role: 'venue',
    address: '715 S Forest St, Denver, CO 80246',
    lat: 39.703113,
    lng: -104.927312,
    note: 'Primary arrival and pickup point. Final bus entrance and staging should be confirmed with the venue.'
  },
  {
    id: 'commons-park-dropoff',
    marker: 'A4-D',
    activityId: 'platte-street-food-tour',
    name: 'Platte Street Food Tour — Commons Park Drop-off',
    role: 'dropoff',
    address: '1600 Little Raven St, Denver, CO 80202',
    lat: 39.757240,
    lng: -105.005220,
    note: 'Proposed drop-off planning point near 16th Street and Little Raven Street. Final curb location requires verification.'
  },
  {
    id: 'confluence-park-pickup',
    marker: 'A4-P',
    activityId: 'platte-street-food-tour',
    name: 'Platte Street Food Tour — Confluence Park Pickup',
    role: 'pickup',
    address: '2250 15th St, Denver, CO 80202',
    lat: 39.754654,
    lng: -105.007346,
    note: 'Proposed pickup planning point near 15th Street and Little Raven Street. Final curb location requires verification.'
  }
];

export const ACTIVITIES = [
  {
    id: 'douglas-fairgrounds',
    marker: 'A1',
    name: 'Douglas County Fairgrounds',
    outboundPointId: 'douglas-fairgrounds',
    returnPointId: 'douglas-fairgrounds',
    description: 'Castle Rock non-service delegate activity.'
  },
  {
    id: 'georgetown-loop',
    marker: 'A2',
    name: 'Georgetown Loop Railroad',
    outboundPointId: 'georgetown-loop-devils-gate',
    returnPointId: 'georgetown-loop-devils-gate',
    description: "The current planning point is Devil's Gate Depot in Georgetown."
  },
  {
    id: 'four-mile-house',
    marker: 'A3',
    name: 'Four Mile Historic Park / Four Mile House',
    outboundPointId: 'four-mile-historic-park',
    returnPointId: 'four-mile-historic-park',
    description: 'Denver non-service delegate activity.'
  },
  {
    id: 'platte-street-food-tour',
    marker: 'A4',
    name: 'Platte Street Food Tour',
    outboundPointId: 'commons-park-dropoff',
    returnPointId: 'confluence-park-pickup',
    description: 'Drop-off at Commons Park and pickup at Confluence Park.'
  }
];

export function getActivity(id) {
  return ACTIVITIES.find(activity => activity.id === id) || null;
}

export function getActivityPoint(id) {
  return ACTIVITY_POINTS.find(point => point.id === id) || null;
}

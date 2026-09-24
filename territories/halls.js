import {
  HALLS as BASE_HALLS,
  DTC_BOUNDARY,
  DTC
} from '../bus-access/data.js?v=territories-20260923-4';

const CCC_ONLY_ADDITIONS = [
  {
    id: '12',
    number: 12,
    name: 'Westminster - Sheridan Blvd',
    address: '11580 Sheridan Blvd, Westminster CO 80020',
    congregationCount: 3,
    congregations: [
      'Coal Creek - Broomfield',
      'North - Westminster',
      'Spanish - Broomfield'
    ],
    lat: 39.90666,
    lng: -105.05271,
    cccDriveMinutes: 25,
    cccDriveGroup: 'Within 45 minutes'
  },
  {
    id: '22',
    number: 22,
    name: 'Brighton - Jennifer Ct',
    address: '1955 Jennifer Ct, Brighton CO 80601',
    congregationCount: 4,
    congregations: [
      'North Spanish - Brighton',
      'Platte Valley - Brighton',
      'South Spanish - Brighton',
      'South Spanish - Fort Lupton'
    ],
    lat: 39.9582,
    lng: -104.81,
    cccDriveMinutes: 38,
    cccDriveGroup: 'Within 45 minutes'
  }
];

const byId = new Map(BASE_HALLS.map(hall => [String(hall.id), { ...hall, id: String(hall.id) }]));
for (const hall of CCC_ONLY_ADDITIONS) byId.set(String(hall.id), hall);

/**
 * Current Colorado Convention Center planning set:
 * 24 physical Kingdom Hall locations categorized within 45 minutes.
 * Hall numbers 1 through 23, plus Hall 26.
 */
export const HALLS = [...byId.values()]
  .filter(hall => (Number(hall.number) >= 1 && Number(hall.number) <= 23) || Number(hall.number) === 26)
  .sort((a, b) => Number(a.number) - Number(b.number));

export const CCC_WITHIN_45_HALL_IDS = HALLS.map(hall => String(hall.id));
export { DTC_BOUNDARY, DTC };

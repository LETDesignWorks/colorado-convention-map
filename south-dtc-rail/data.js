export const DTC_HOTEL_IDS = ['H17', 'H19', 'H18'];

export const SOUTH_BASE_IDS = new Set(['11', '16', '20', '21', '23', '26']);

export const RAIL_STATIONS = [
  {
    id: 'belleview', marker: 'R1', order: 1, corridor: 'southeast',
    name: 'Belleview Station', address: '4855 S Quebec St, Denver, CO 80237',
    lat: 39.62790, lng: -104.90460, lines: ['E', 'R', 'T'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/belleview-station'
  },
  {
    id: 'orchard', marker: 'R2', order: 2, corridor: 'southeast',
    name: 'Orchard Station', address: '5652 Greenwood Plaza Blvd, Greenwood Village, CO 80111',
    lat: 39.61340, lng: -104.89620, lines: ['E', 'R', 'T'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/orchard-station'
  },
  {
    id: 'arapahoe', marker: 'R3', order: 3, corridor: 'southeast',
    name: 'Arapahoe at Village Center Station', address: '8800 E Caley Ave, Greenwood Village, CO 80111',
    lat: 39.60050, lng: -104.88860, lines: ['E', 'R', 'T'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/arapahoe-at-village-center-station'
  },
  {
    id: 'dry-creek', marker: 'R4', order: 4, corridor: 'southeast',
    name: 'Dry Creek Station', address: '9450 E Dry Creek Rd, Centennial, CO 80112',
    lat: 39.57860, lng: -104.87630, lines: ['E', 'R', 'T'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/dry-creek-station'
  },
  {
    id: 'county-line', marker: 'R5', order: 5, corridor: 'southeast',
    name: 'County Line Station', address: '8340 S Valley Hwy, Lone Tree, CO 80124',
    lat: 39.56200, lng: -104.87220, lines: ['E', 'R', 'T'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/county-line-station'
  },
  {
    id: 'lincoln', marker: 'R6', order: 6, corridor: 'southeast',
    name: 'Lincoln Station', address: '10185 Park Meadows Dr, Lone Tree, CO 80124',
    lat: 39.54599, lng: -104.86962, lines: ['E', 'R', 'T'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/lincoln-station'
  },
  {
    id: 'sky-ridge', marker: 'R7', order: 7, corridor: 'southeast',
    name: 'Sky Ridge Station', address: '9941 Trainstation Cir, Lone Tree, CO 80124',
    lat: 39.53212, lng: -104.87022, lines: ['E', 'R'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/sky-ridge-station'
  },
  {
    id: 'lone-tree-city-center', marker: 'R8', order: 8, corridor: 'southeast',
    name: 'Lone Tree City Center Station', address: '11023 RidgeGate Pkwy, Lone Tree, CO 80134',
    lat: 39.52762, lng: -104.86321, lines: ['E', 'R'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/lone-tree-city-center-station'
  },
  {
    id: 'ridgegate', marker: 'R9', order: 9, corridor: 'southeast',
    name: 'RidgeGate Parkway Station', address: '10791 S Havana St, Lone Tree, CO 80134',
    lat: 39.52056, lng: -104.86544, lines: ['E', 'R'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/ridgegate-parkway-station'
  },
  {
    id: 'littleton-mineral', marker: 'R10', order: 1, corridor: 'southwest',
    name: 'Littleton / Mineral Station', address: '3203 W Mineral Ave, Littleton, CO 80120',
    lat: 39.58019, lng: -105.02499, lines: ['C'],
    rtdUrl: 'https://app.rtd-denver.com/facilities/littleton-mineral-station'
  }
];

export const RTD_SYSTEM_MAP_URL = 'https://www.rtd-denver.com/system-map';
export const RTD_E_SCHEDULE_URL = 'https://app.rtd-denver.com/route/E/schedule';
export const RTD_R_SCHEDULE_URL = 'https://app.rtd-denver.com/route/R/schedule';
export const RTD_C_SCHEDULE_URL = 'https://app.rtd-denver.com/route/C/schedule';

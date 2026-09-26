import { HOTELS } from '../routes/hotels.js';

export { HOTELS };

export const JW_CART_REFERENCE_URL = 'https://www.jw.org/en/jehovahs-witnesses/activities/ministry/literature-display-carts';
export const RTD_SYSTEM_MAP_URL = 'https://www.rtd-denver.com/system-map';

export const RAIL_STATIONS = [
  { id:'union', marker:'R1', name:'Union Station Transit Center', address:'1700 Wewatta St, Denver, CO 80202', lat:39.75267, lng:-105.00085, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/union-station-transit-center' },
  { id:'ball-arena', marker:'R2', name:'Ball Arena / Elitch Gardens Station', address:'1000 Chopper Cir, Denver, CO 80204', lat:39.74865, lng:-105.00765, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/ball-arena-elitch-gardens-station' },
  { id:'auraria-west', marker:'R3', name:'Auraria West Campus Station', address:'1250 5th St, Denver, CO 80204', lat:39.74066, lng:-105.00955, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/auraria-west-campus-station' },
  { id:'empower-field', marker:'R4', name:'Empower Field at Mile High Station', address:'1499 4th St, Denver, CO 80204', lat:39.74376, lng:-105.02063, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/empower-field-at-mile-high' },
  { id:'colfax-auraria', marker:'R5', name:'Colfax at Auraria Station', address:'1301 W Colfax Ave, Denver, CO 80204', lat:39.73969, lng:-105.00384, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/colfax-at-auraria-station' },
  { id:'theatre-district', marker:'R6', name:'Theatre District / Convention Center', address:'1325 Stout St, Denver, CO 80204', lat:39.74205, lng:-104.99636, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/theatre-district-convention-center' },
  { id:'16-california', marker:'R7', name:'16th Street / California Station', address:'1516 California St, Denver, CO 80202', lat:39.74544, lng:-104.98977, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/16th-street-california-station' },
  { id:'16-stout', marker:'R8', name:'16th Street / Stout Station', address:'1617 Stout St, Denver, CO 80202', lat:39.74663, lng:-104.99228, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/16th-street-stout-station' },
  { id:'18-california', marker:'R9', name:'18th St / California Station', address:'1776 California St, Denver, CO 80202', lat:39.74831, lng:-104.98722, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/18th-st-california-station' },
  { id:'18-stout', marker:'R10', name:'18th St / Stout Station', address:'1816 Stout St, Denver, CO 80202', lat:39.74955, lng:-104.98972, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/18th-st-stout-station' },
  { id:'20-welton', marker:'R11', name:'20th St / Welton Station', address:'1960 Welton St, Denver, CO 80202', lat:39.75118, lng:-104.98504, corridor:'downtown', rtdUrl:'https://app.rtd-denver.com/facilities/20th-st-welton-station' },
  { id:'10-osage', marker:'R12', name:'10th / Osage Station', address:'1003 N Osage St, Denver, CO 80204', lat:39.73289, lng:-105.00577, corridor:'central', rtdUrl:'https://app.rtd-denver.com/facilities/10th-osage-station' },
  { id:'alameda', marker:'R13', name:'Alameda Station', address:'499 S Cherokee St, Denver, CO 80223', lat:39.70862, lng:-104.99913, corridor:'central', rtdUrl:'https://app.rtd-denver.com/facilities/alameda-station' },
  { id:'i25-broadway', marker:'R14', name:'I-25 / Broadway Station', address:'901 S Broadway, Denver, CO 80209', lat:39.70146, lng:-104.98765, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/i-25-broadway-station' },
  { id:'louisiana-pearl', marker:'R15', name:'Louisiana / Pearl Station', address:'1350 S Louisiana St, Denver, CO 80210', lat:39.69353, lng:-104.98037, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/louisiana-pearl-station' },
  { id:'university-denver', marker:'R16', name:'University of Denver Station', address:'1901 Buchtel Blvd, Denver, CO 80210', lat:39.68101, lng:-104.95913, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/university-of-denver-station' },
  { id:'colorado', marker:'R17', name:'Colorado Station', address:'4300 E Colorado Center Dr, Denver, CO 80222', lat:39.68352, lng:-104.94045, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/colorado-station' },
  { id:'yale', marker:'R18', name:'Yale Station', address:'5315 E Yale Ave, Denver, CO 80222', lat:39.66757, lng:-104.95106, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/yale-station' },
  { id:'southmoor', marker:'R19', name:'Southmoor Station', address:'3737 S Monaco St Pkwy, Denver, CO 80237', lat:39.64995, lng:-104.90746, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/southmoor-station' },
  { id:'belleview', marker:'R20', name:'Belleview Station', address:'4855 S Quebec St, Denver, CO 80237', lat:39.62790, lng:-104.90460, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/belleview-station' },
  { id:'orchard', marker:'R21', name:'Orchard Station', address:'5652 Greenwood Plaza Blvd, Greenwood Village, CO 80111', lat:39.61340, lng:-104.89620, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/orchard-station' },
  { id:'arapahoe', marker:'R22', name:'Arapahoe at Village Center Station', address:'8800 E Caley Ave, Greenwood Village, CO 80111', lat:39.60050, lng:-104.88860, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/arapahoe-at-village-center-station' },
  { id:'dry-creek', marker:'R23', name:'Dry Creek Station', address:'9450 E Dry Creek Rd, Centennial, CO 80112', lat:39.57860, lng:-104.87630, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/dry-creek-station' },
  { id:'county-line', marker:'R24', name:'County Line Station', address:'8340 S Valley Hwy, Lone Tree, CO 80124', lat:39.56200, lng:-104.87220, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/county-line-station' },
  { id:'lincoln', marker:'R25', name:'Lincoln Station', address:'10185 Park Meadows Dr, Lone Tree, CO 80124', lat:39.54599, lng:-104.86962, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/lincoln-station' },
  { id:'sky-ridge', marker:'R26', name:'Sky Ridge Station', address:'9941 Trainstation Cir, Lone Tree, CO 80124', lat:39.53212, lng:-104.87022, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/sky-ridge-station' },
  { id:'lone-tree-city-center', marker:'R27', name:'Lone Tree City Center Station', address:'11023 RidgeGate Pkwy, Lone Tree, CO 80134', lat:39.52762, lng:-104.86321, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/lone-tree-city-center-station' },
  { id:'ridgegate', marker:'R28', name:'RidgeGate Parkway Station', address:'10791 S Havana St, Lone Tree, CO 80134', lat:39.52056, lng:-104.86544, corridor:'southeast', rtdUrl:'https://app.rtd-denver.com/facilities/ridgegate-parkway-station' },
  { id:'littleton-mineral', marker:'R29', name:'Littleton / Mineral Station', address:'3203 W Mineral Ave, Littleton, CO 80120', lat:39.58019, lng:-105.02499, corridor:'southwest', rtdUrl:'https://app.rtd-denver.com/facilities/littleton-mineral-station' }
];

export const RAIL_CORRIDORS = [
  { id:'downtown-loop', points:['union','ball-arena','auraria-west','colfax-auraria','theatre-district','16-stout','18-stout','20-welton'], color:'#087b63' },
  { id:'southeast', points:['10-osage','alameda','i25-broadway','louisiana-pearl','university-denver','colorado','yale','southmoor','belleview','orchard','arapahoe','dry-creek','county-line','lincoln','sky-ridge','lone-tree-city-center','ridgegate'], color:'#087b63' },
  { id:'southwest', points:['10-osage','littleton-mineral'], color:'#3f7f9f' }
];

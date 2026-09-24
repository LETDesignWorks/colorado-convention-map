export const CCC = [39.74248, -104.99567];

export const TERRITORY_COLORS = [
  '#2f6fbb', '#a9578b', '#1f8a70', '#d17a22', '#7159b8', '#bc4b51',
  '#3b8d99', '#8a6d3b', '#5e8c3a', '#c45d9a', '#4977a8', '#9a5f38'
];

// Current planning list: source selection is based on the county containing the Hall's likely service area.
export const SOURCE_HINT_BY_HALL = {
  // Denver County
  '1': 'denver', '2': 'denver', '3': 'denver', '4': 'denver', '13': 'denver',

  // Jefferson County
  '6': 'jefferson', '7': 'jefferson', '14': 'jefferson', '16': 'jefferson', '18': 'jefferson',

  // Douglas County
  '21': 'douglas', '23': 'douglas', '26': 'douglas',

  // Statewide authoritative address composite for Adams, Arapahoe, Broomfield,
  // Aurora, Commerce City, Brighton, Greenwood Village, Foxfield, and other
  // locations in the Convention Center's current 45-minute planning list.
  '5': 'colorado', '8': 'colorado', '9': 'colorado', '10': 'colorado',
  '11': 'colorado', '12': 'colorado', '15': 'colorado', '17': 'colorado',
  '19': 'colorado', '20': 'colorado', '22': 'colorado'
};

const compact = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const joinParts = (...parts) => parts.map(compact).filter(Boolean).join(' ');

function featurePoint(feature) {
  const centroid = feature?.centroid;
  if (Number.isFinite(Number(centroid?.y)) && Number.isFinite(Number(centroid?.x))) {
    return { lat: Number(centroid.y), lng: Number(centroid.x) };
  }
  const geometry = feature?.geometry;
  if (Number.isFinite(Number(geometry?.y)) && Number.isFinite(Number(geometry?.x))) {
    return { lat: Number(geometry.y), lng: Number(geometry.x) };
  }
  if (Array.isArray(geometry?.coordinates) && geometry.coordinates.length >= 2 && !Array.isArray(geometry.coordinates[0])) {
    return { lat: Number(geometry.coordinates[1]), lng: Number(geometry.coordinates[0]) };
  }
  const rings = geometry?.rings || (geometry?.type === 'Polygon' ? geometry.coordinates : null);
  if (Array.isArray(rings) && rings.length) {
    const points = rings.flat(2).filter(value => Number.isFinite(Number(value)));
    const coords = [];
    for (let index = 0; index < points.length - 1; index += 2) coords.push([Number(points[index]), Number(points[index + 1])]);
    if (coords.length) {
      const lngs = coords.map(item => item[0]);
      const lats = coords.map(item => item[1]);
      return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    }
  }
  return null;
}

function residentialClassification(text) {
  const value = compact(text).toUpperCase();
  if (!value) return { residential: true, classification: 'Unclassified' };
  const excluded = /(COMMERCIAL|INDUSTRIAL|OFFICE|RETAIL|WAREHOUSE|SCHOOL|CHURCH|GOVERNMENT|MUNICIPAL|UTILITY|VACANT|PARKING|PARK\b|OPEN SPACE|AGRICULT|EXEMPT|MIXED USE|HOTEL|MOTEL|HOSPITAL|NURSING|FIRE STATION|POLICE)/;
  const included = /(RESIDENTIAL|SINGLE|MULTI|FAMILY|HOUSE|CONDO|TOWN|DUPLEX|TRIPLEX|FOURPLEX|APARTMENT|MOBILE HOME|DWELLING|SFR|RES\b)/;
  if (excluded.test(value)) return { residential: false, classification: value };
  if (included.test(value)) return { residential: true, classification: value };
  return { residential: true, classification: value };
}

function douglasParser(feature) {
  const a = feature?.attributes || feature?.properties || {};
  const point = featurePoint(feature);
  if (!point) return null;
  const number = joinParts(a.ADDRESS_NUMBER, a.ADDRESS_NUMBER_SUFFIX);
  const street = compact(a.STREET_NAME_FULL || a.STREET_NAME || a.FULL_STREET_NAME);
  const unit = compact(a.UNIT_NO || a.UNIT_NUMBER || a.SUBADDRESS);
  const baseAddress = joinParts(number, street);
  const address = joinParts(baseAddress, unit ? `Unit ${unit}` : '', a.POSTAL_NAME, 'CO', a.ZIP_CODE);
  const status = compact(a.ADDRESS_STATUS_DESCRIPTION || a.ADDRESS_STATUS);
  if (/(RETIRED|INACTIVE|DELETED|TEMPORARY)/i.test(status)) return null;
  const classification = residentialClassification(joinParts(a.LAND_USE, a.ADDRESS_USE));
  return {
    id: `douglas-${a.ADDRESS_ID ?? a.OBJECTID ?? `${point.lat}-${point.lng}`}`,
    address: address || joinParts(baseAddress, a.POSTAL_NAME, 'CO', a.ZIP_CODE),
    baseAddress: joinParts(baseAddress, a.POSTAL_NAME, 'CO', a.ZIP_CODE),
    unit,
    lat: point.lat,
    lng: point.lng,
    source: 'Douglas County Address Points',
    residential: classification.residential,
    classification: classification.classification,
    rawId: a.ADDRESS_ID ?? a.OBJECTID ?? null
  };
}

function jeffersonParser(feature) {
  const a = feature?.attributes || feature?.properties || {};
  const point = featurePoint(feature) || {
    lat: Number(a.ADR_LATITUDE),
    lng: Number(a.ADR_LONGITUDE)
  };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const unit = compact(a.SUBADRUNIT);
  const base = compact(a.ADDRESS);
  const address = joinParts(base, unit && !base.toUpperCase().includes(unit.toUpperCase()) ? `Unit ${unit}` : '', a.CITY_POSTAL, 'CO', a.ZIP);
  const classification = residentialClassification(a.ADDRESS_TYPE);
  return {
    id: `jefferson-${a.OBJECTID ?? `${point.lat}-${point.lng}`}`,
    address,
    baseAddress: joinParts(base, a.CITY_POSTAL, 'CO', a.ZIP),
    unit,
    lat: point.lat,
    lng: point.lng,
    source: 'Jefferson County Master Address',
    residential: classification.residential,
    classification: classification.classification,
    rawId: a.OBJECTID ?? null
  };
}

function denverParser(feature) {
  const a = feature?.attributes || feature?.properties || {};
  const point = featurePoint(feature);
  if (!point) return null;
  const line1 = compact(a.SITUS_ADDRESS_LINE1 || a.SITUS_ADDRESS || a.SITE_ADDRESS);
  const line2 = compact(a.SITUS_ADDRESS_LINE2);
  const city = compact(a.SITUS_CITY || 'Denver');
  const zip = compact(a.SITUS_ZIP || a.ZIP_CODE);
  const address = joinParts(line1, line2, city, 'CO', zip);
  const classification = residentialClassification(joinParts(a.D_CLASS_CN, a.PROP_CLASS));
  const unitCount = Math.max(1, Number(a.TOT_UNITS) || 1);
  return {
    id: `denver-${a.SCHEDNUM ?? a.OBJECTID ?? `${point.lat}-${point.lng}`}`,
    address,
    baseAddress: joinParts(line1, city, 'CO', zip),
    unit: line2,
    unitCount,
    lat: point.lat,
    lng: point.lng,
    source: 'Denver Assessor Parcels',
    residential: classification.residential,
    classification: classification.classification,
    rawId: a.SCHEDNUM ?? a.OBJECTID ?? null
  };
}


function coloradoParser(feature) {
  const a = feature?.attributes || feature?.properties || {};
  const point = featurePoint(feature) || {
    lat: Number(a.Latitude),
    lng: Number(a.Longitude)
  };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;

  const status = compact(a.ACT_STAT);
  if (/(RETIRED|INACTIVE|DELETED|TEMPORARY)/i.test(status)) return null;

  const number = joinParts(a.AddrNum, a.NumSuf);
  const street = joinParts(
    a.St_PreMod, a.PreDir, a.PreType, a.St_PreSep, a.StreetName,
    a.PostType, a.PostDir, a.St_PosMod
  );
  const baseAddress = compact(a.AddrFull) || joinParts(number, street);
  const unit = compact(a.Unit);
  const city = compact(a.PlaceName);
  const zip = compact(a.Zipcode);
  const address = joinParts(
    baseAddress,
    unit && !baseAddress.toUpperCase().includes(unit.toUpperCase()) ? `Unit ${unit}` : '',
    city,
    'CO',
    zip
  );

  const classification = residentialClassification(joinParts(
    a.Place_Type,
    a.Addtl_Loc,
    a.Building,
    a.Nbrhd_Comm
  ));
  const isCommunityAnchor = /^(?:Y|YES|1|TRUE)$/i.test(compact(a.lsCAI));

  return {
    id: `colorado-${a.SAUID ?? a.OBJECTID ?? `${point.lat}-${point.lng}`}`,
    address,
    baseAddress: joinParts(baseAddress, city, 'CO', zip),
    unit,
    lat: point.lat,
    lng: point.lng,
    source: 'Colorado Public Address Composite',
    residential: isCommunityAnchor ? false : classification.residential,
    classification: isCommunityAnchor
      ? joinParts('Community Anchor Institution', classification.classification)
      : (classification.classification || 'Unclassified address point'),
    rawId: a.SAUID ?? a.OBJECTID ?? null,
    county: compact(a.County),
    parcelId: compact(a.ParcelID),
    neighborhood: compact(a.Nbrhd_Comm)
  };
}

export const ASSESSOR_SOURCES = {
  colorado: {
    key: 'colorado',
    label: 'Colorado Public Address Composite',
    description: 'Official statewide address-point composite maintained by the Colorado Governor\'s Office of Information Technology from county, regional, and municipal sources. This provides a common starting source for every Hall in the Convention Center 45-minute planning list.',
    endpoint: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Addresses/FeatureServer/0/query',
    infoUrl: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Addresses/FeatureServer/0',
    outFields: [
      'OBJECTID','SAUID','County','AddrNum','NumSuf','St_PreMod','PreDir','PreType','St_PreSep',
      'StreetName','PostType','PostDir','St_PosMod','Building','Floor','Unit','AddrFull',
      'PlaceName','Zipcode','Latitude','Longitude','Nbrhd_Comm','Addtl_Loc','Place_Type',
      'lsCAI','ParcelID','MOD_DATE','ACT_STAT'
    ],
    returnGeometry: true,
    returnCentroid: false,
    parser: coloradoParser
  },
  douglas: {
    key: 'douglas',
    label: 'Douglas County Address Points',
    description: 'Official addressed-location point layer. Appropriate starting source for Highlands Ranch, Castle Rock, and portions of Parker.',
    endpoint: 'https://apps.douglas.co.us/gisod/rest/services/POSSE_Address/MapServer/0/query',
    infoUrl: 'https://apps.douglas.co.us/gisod/rest/services/POSSE_Address/MapServer/0',
    outFields: [
      'OBJECTID','ADDRESS_ID','ADDRESS_NUMBER','ADDRESS_NUMBER_SUFFIX','STREET_NAME_FULL','UNIT_NO',
      'POSTAL_NAME','ZIP_CODE','ADDRESS_STATUS_DESCRIPTION','ADDRESS_USE','LAND_USE'
    ],
    returnGeometry: true,
    returnCentroid: false,
    parser: douglasParser
  },
  jefferson: {
    key: 'jefferson',
    label: 'Jefferson County Master Address',
    description: 'Official county-maintained point layer of known addresses.',
    endpoint: 'https://gisportal.jeffco.us/server/rest/services/MasterAddress_Public/FeatureServer/1/query',
    infoUrl: 'https://gisportal.jeffco.us/server/rest/services/MasterAddress_Public/FeatureServer/1',
    outFields: ['OBJECTID','ADDRESS','SUBADRUNIT','CITY_POSTAL','ZIP','ADDRESS_TYPE','ADR_LONGITUDE','ADR_LATITUDE'],
    returnGeometry: true,
    returnCentroid: false,
    parser: jeffersonParser
  },
  denver: {
    key: 'denver',
    label: 'Denver Assessor Parcels',
    description: 'Official parcel polygons. The parcel centroid is used as an initial ministry stop and should be reviewed locally.',
    endpoint: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PROP_PARCELS_A/FeatureServer/245/query',
    infoUrl: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PROP_PARCELS_A/FeatureServer/245',
    outFields: ['OBJECTID','SCHEDNUM','SITUS_ADDRESS_LINE1','SITUS_ADDRESS_LINE2','SITUS_CITY','SITUS_ZIP','PROP_CLASS','D_CLASS_CN','TOT_UNITS'],
    returnGeometry: false,
    returnCentroid: true,
    parser: denverParser
  }
};

export function inferSourceForHall(hallId) {
  return SOURCE_HINT_BY_HALL[String(hallId)] || 'colorado';
}

export function parseSourceFeature(sourceKey, feature) {
  return ASSESSOR_SOURCES[sourceKey]?.parser(feature) || null;
}

export function normalizeAddressKey(value, includeUnit = true) {
  let text = compact(value).toUpperCase();
  if (!includeUnit) {
    text = text.replace(/\b(?:UNIT|APT|APARTMENT|STE|SUITE|#)\s*[A-Z0-9-]+\b.*$/i, '').trim();
  }
  return text.replace(/[^A-Z0-9]/g, '');
}

export function splitStreetSort(address) {
  const text = compact(address);
  const numberMatch = text.match(/^\s*(\d+[A-Za-z-]?)/);
  const number = numberMatch ? Number.parseInt(numberMatch[1], 10) || 0 : Number.MAX_SAFE_INTEGER;
  const street = text
    .replace(/^\s*\d+[A-Za-z-]?\s+/, '')
    .replace(/\b(?:UNIT|APT|APARTMENT|STE|SUITE|#)\s*[A-Z0-9-]+\b.*$/i, '')
    .replace(/,.*$/, '')
    .toUpperCase();
  return { street, number };
}

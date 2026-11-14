export const TIME_ZONE = 'America/Denver';
const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(date).map(p => [p.type, p.value]));

export function denverInput(date) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function parseDenver(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid meeting date and time.');
  // Denver is UTC-6 or UTC-7. Validate by round trip so spring-forward gaps
  // and invalid dates are rejected. The first occurrence wins in the fall fold.
  const wall = Date.parse(`${value}:00Z`);
  const matches = [6, 7].map(offset => new Date(wall + offset * 3600000))
    .filter(date => !Number.isNaN(date.getTime()) && denverInput(date) === value);
  if (!matches.length) throw new Error('That time does not exist in Denver. Choose another time (check the daylight-saving change).');
  return matches[0];
}

export function formatDenver(value) {
  try {
    const date = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? parseDenver(value) : new Date(value);
    return new Intl.DateTimeFormat(undefined, {timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(date);
  } catch { return '—'; }
}

export function buildTravelSchedule({meetingLocal, baseMinutes, travelAllowance = 15, arrivalBuffer = 15, boardingBuffer = 15, reminderLeadMinutes = 30}) {
  const meeting = parseDenver(meetingLocal);
  const values = [baseMinutes, travelAllowance, arrivalBuffer, boardingBuffer, reminderLeadMinutes].map(Number);
  if (values.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Travel times and buffers must be zero or positive numbers.');
  [baseMinutes, travelAllowance, arrivalBuffer, boardingBuffer, reminderLeadMinutes] = values;
  const plannedTravel = Math.ceil(baseMinutes + travelAllowance);
  const arrival = new Date(+meeting - arrivalBuffer * 60000);
  const departure = new Date(+arrival - plannedTravel * 60000);
  const report = new Date(+departure - boardingBuffer * 60000);
  const reminder = new Date(+report - reminderLeadMinutes * 60000);
  return {meeting, travelAllowance, arrivalBuffer, boardingBuffer, reminderLeadMinutes, plannedTravel, arrival, departure, report, reminder, totalLead: plannedTravel + arrivalBuffer + boardingBuffer};
}

export function validPoint(lat, lng) {
  return [lat,lng].every(v => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v))) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

export function safeWebUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

export const TICKETS = {
  mobile: {label: 'RTD NextRide mobile ticket / MyRide', text: 'Get RTD NextRide and choose the correct fare. Activate a mobile ticket before boarding; if using MyRide stored value, scan at the rail validator before boarding. Keep your phone charged and proof of fare available.', url: 'https://www.rtd-denver.com/fares-passes/myride'},
  machine: {label: 'Buy at a station ticket machine', text: 'Use a station ticket machine before boarding. Machines accept cash and debit or credit cards; keep the issued ticket for fare inspection. Allow extra time for a queue.', url: 'https://www.rtd-denver.com/how-to-ride/bus-rail-system/rail'},
  contactless: {label: 'Tap-n-Ride contactless payment', text: 'Tap a supported Visa, Mastercard or Discover card or mobile wallet at the rail validator before boarding. Each rider needs a separate card or device. Use the same card or device for every ride.', url: 'https://www.rtd-denver.com/fares-passes/tap-n-ride'},
  pass: {label: 'Already have a pass / ticket', text: 'Check that your pass or ticket covers the trip and date. Follow RTD activation or validation instructions before boarding, and carry proof of fare.', url: 'https://www.rtd-denver.com/fares-passes/fares'}
};

export function parkingAdvice(station) {
  if (station.parkingSpaces === 0) return 'RTD lists no parking at this station. Arrange a drop-off at a permitted location, or choose RidgeGate Parkway or Lincoln for a Park-n-Ride. Do not assume nearby private lots allow transit parking.';
  if (Number.isFinite(station.parkingSpaces)) return `Use the signed RTD Park-n-Ride at this station. RTD lists ${station.parkingSpaces.toLocaleString()} total spaces (not live availability). ${station.parkingSpaces < 100 ? 'This is a small lot; consider Arapahoe, Lincoln or RidgeGate Parkway if it is full. ' : ''}Check the posted entrance, parking restrictions and payment requirements.`;
  return 'Confirm the designated public parking or drop-off area with the station before travel. Parking availability and permission have not been verified for this added station.';
}

import type { FlightOption, HotelOption } from '../types';

const AIRLINES = ['IndiGo', 'Air India', 'Akasa Air', 'Vistara', 'SpiceJet'];

// A pool much bigger than any one city needs — mockHotels deterministically
// shuffles and picks a subset per destination, so different cities land on
// different hotel sets instead of everyone seeing the same first 4 names.
const HOTEL_NAME_POOL = [
  'Sea Breeze Resort', 'The Palm Grove', 'Heritage Inn', 'Bayview Suites', 'Coral Sands',
  'Mountain Vista Lodge', 'The Grand Meridian', 'Sunset Bay Hotel', 'Silver Oak Residency',
  'The Regency Palace', 'Emerald Hills Resort', 'Lakeside Retreat', 'The Orchid Suites',
  'Riverside Manor', 'Golden Sands Hotel', 'The Whispering Pines', 'Azure Waters Resort',
  'Cedar Point Inn', 'The Maple Court', 'Skyline Towers Hotel',
];
const AREA_POOL = [
  'Old Town', 'Beachfront', 'City Centre', 'North District', 'Harbourside',
  'Hillside', 'Lake View', 'Market District', 'Riverside', 'Downtown',
];
// Bigger and more varied than a fixed Standard/Deluxe/Suite triple — each
// hotel draws its own subset, so room lineups differ hotel to hotel too.
const ROOM_TYPE_POOL = [
  { name: 'Standard Room', mult: 1, cap: 2 },
  { name: 'Twin Room', mult: 1.1, cap: 2 },
  { name: 'Garden View Room', mult: 1.2, cap: 2 },
  { name: 'Deluxe Room', mult: 1.35, cap: 2 },
  { name: 'Executive Room', mult: 1.7, cap: 2 },
  { name: 'Family Room', mult: 1.9, cap: 4 },
  { name: 'Suite', mult: 2.1, cap: 4 },
  { name: 'Premier Suite', mult: 2.5, cap: 4 },
];

/** Small deterministic PRNG so the same query always returns the same mock data. */
function seeded(seedStr: string) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return (h % 10000) / 10000;
  };
}

/** Deterministic partial shuffle — same seed always returns the same subset
 * (and order), but different seeds land on different picks. */
function pickN<T>(pool: T[], n: number, rand: () => number): T[] {
  const indices = pool.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, n).map((i) => pool[i]);
}

// `date` isn't generated here — every caller stamps it on afterward (one
// search only ever covers a single requested date; see `getFlightOptions`).
export function mockFlights(origin: string, destination: string): Omit<FlightOption, 'date'>[] {
  const rand = seeded(`${origin}->${destination}`);
  return Array.from({ length: 4 }, (_, i) => {
    const depHour = 5 + Math.floor(rand() * 17);
    const durationMins = 75 + Math.floor(rand() * 180);
    const arriveHour = (depHour + Math.floor(durationMins / 60)) % 24;
    const stops = rand() > 0.7 ? 1 : 0;
    return {
      id: `FL${i}${Math.floor(rand() * 900 + 100)}`,
      airline: AIRLINES[i % AIRLINES.length],
      flightNumber: `${AIRLINES[i % AIRLINES.length].slice(0, 2).toUpperCase()}-${100 + i}`,
      from: origin,
      to: destination,
      departTime: `${String(depHour).padStart(2, '0')}:${rand() > 0.5 ? '00' : '30'}`,
      arriveTime: `${String(arriveHour).padStart(2, '0')}:${rand() > 0.5 ? '00' : '30'}`,
      durationMins,
      stops,
      price: Math.round(2800 + rand() * 6500),
    };
  }).sort((a, b) => a.price - b.price);
}

export function mockHotels(destination: string): HotelOption[] {
  const rand = seeded(destination);
  const names = pickN(HOTEL_NAME_POOL, 6, rand);

  return names.map((name, i) => {
    const base = Math.round(2200 + rand() * 7500);
    const seed = `${destination}-${name}`.replace(/\s+/g, '-').toLowerCase();
    const area = AREA_POOL[Math.floor(rand() * AREA_POOL.length)];
    const roomTypes = pickN(ROOM_TYPE_POOL, 5, rand).sort((a, b) => a.mult - b.mult);
    return {
      id: `HT${i}${Math.floor(rand() * 900 + 100)}`,
      name,
      area,
      rating: Math.round((3.6 + rand() * 1.4) * 10) / 10,
      price: base,
      imageSeed: seed,
      rooms: roomTypes.map((rt, j) => ({
        id: `RM${i}${j}`,
        name: rt.name,
        price: Math.round(base * rt.mult),
        imageSeed: `${seed}-room-${j}`,
        capacity: rt.cap,
      })),
    };
  }).sort((a, b) => a.price - b.price);
}

import type { FlightOption, HotelOption, RoomOption } from '../types';

/** Minutes-of-day distance between two "HH:MM" strings — used to find the
 * flight whose departure is closest to a time the user asked for. */
function timeDistance(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return Math.abs((ah * 60 + am) - (bh * 60 + bm));
}

/** Picks one flight to preselect: a named-flight/airline match first (most
 * specific — the user said exactly which one), else the flight whose
 * departure is closest to a requested clock time, else — only when the
 * message used booking language at all (`fallbackToCheapest`) — the
 * cheapest, same default hotel picks already use. Returns undefined when
 * nothing was given at all — a bare "plan a trip" query should keep showing
 * the plain list, not silently auto-pick one. */
export function pickRecommendedFlight(
  flights: FlightOption[],
  criteria: { targetTime?: string; query?: string; fallbackToCheapest?: boolean }
): FlightOption | undefined {
  const { targetTime, query, fallbackToCheapest } = criteria;
  if (query) {
    const q = query.trim().toLowerCase();
    const compact = q.replace(/\s|-/g, '');
    const named = flights.find(
      (f) => f.airline.toLowerCase().includes(q) || q.includes(f.airline.toLowerCase())
        || f.flightNumber.toLowerCase().replace(/\s|-/g, '') === compact
    );
    if (named) return named;
  }
  if (targetTime) {
    return [...flights].sort(
      (a, b) => timeDistance(a.departTime, targetTime) - timeDistance(b.departTime, targetTime)
    )[0];
  }
  if (fallbackToCheapest && flights.length) {
    return [...flights].sort((a, b) => a.price - b.price)[0];
  }
  return undefined;
}

/** Picks one hotel to preselect once a flight has been confirmed: a
 * named-hotel match first, else the cheapest (consistent with the app's
 * existing "Cheapest" flight badge language). Unlike `pickRecommendedFlight`,
 * this always returns something when the list is non-empty — it's only
 * called once we've already decided to auto-advance to a room booking. */
export function pickRecommendedHotel(
  hotels: HotelOption[],
  criteria: { query?: string }
): HotelOption | undefined {
  if (!hotels.length) return undefined;
  const { query } = criteria;
  if (query) {
    const q = query.trim().toLowerCase();
    const named = hotels.find((h) => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase()));
    if (named) return named;
  }
  return [...hotels].sort((a, b) => a.price - b.price)[0];
}

/** Picks one room within an already-picked hotel — cheapest, same default
 * `pickRecommendedHotel` uses when no name was given. Rooms aren't named by
 * the user in these queries, so there's no name-match tier here. */
export function pickRecommendedRoom(rooms: RoomOption[]): RoomOption | undefined {
  if (!rooms.length) return undefined;
  return [...rooms].sort((a, b) => a.price - b.price)[0];
}

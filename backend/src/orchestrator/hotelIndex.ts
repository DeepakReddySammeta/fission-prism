import type { HotelOption } from '../types';

/**
 * A lightweight, process-lifetime index of every hotel this server has
 * generated for anyone, across all sessions — not persisted, not per-user.
 * It exists for exactly one purpose: letting a follow-up message like "give
 * me the details of sunset bay hotel" (which names a hotel, not a city)
 * resolve to a hotel that was already shown earlier in the same run, instead
 * of failing to find any destination at all. Hotel names aren't a stable
 * global identity (the same name can be regenerated differently for a
 * different destination later), so this is deliberately a best-effort,
 * last-one-wins lookup, not a database.
 */
interface HotelIndexEntry {
  hotel: HotelOption;
  destination: string;
}

const byId = new Map<string, HotelIndexEntry>();

export function indexHotels(hotels: HotelOption[], destination: string) {
  for (const hotel of hotels) byId.set(hotel.id, { hotel, destination });
}

/** Exact name match first, then substring match in either direction (so
 * "sunset bay" matches "Sunset Bay Hotel" and vice versa). Returns the most
 * recently indexed match on a tie, since that's most likely what a "give me
 * the details of X" follow-up is referring to. */
export function findHotelByName(query: string): HotelIndexEntry | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  const entries = [...byId.values()].reverse();
  const exact = entries.find((e) => e.hotel.name.toLowerCase() === q);
  if (exact) return exact;

  return entries.find((e) => {
    const name = e.hotel.name.toLowerCase();
    return name.includes(q) || q.includes(name);
  });
}

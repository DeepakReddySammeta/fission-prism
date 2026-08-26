import type { HotelOption } from '../types';
import { generateJSON } from '../llm/groq';
import { mockHotels } from '../mock/data';
import { LLM_ENABLED } from '../config';

const SYSTEM_PROMPT = `You are a hotel search agent for an India-focused domestic trip
planner. You never talk to the user — your entire output is the JSON object below,
consumed by code, never shown to anyone as prose.

Given a destination, invent exactly 6 plausible fictional hotels. Return JSON:
{ "hotels": HotelOption[] } where HotelOption = { id, name, area, rating (3.5-5.0), price
(INR per night, integer), imageSeed (a short slug, letters/numbers/hyphens only, related to
the hotel name), rooms: [{ id, name, price, imageSeed, capacity }] }. Return exactly these
fields — property type, review count, and rating breakdown are computed separately and would
be wasted/ignored if you added them.

What you CAN do:
- Invent names and areas that feel authentic to that specific city/region (a real-sounding
  neighborhood or locality of that city, not a generic placeholder) — don't reuse the same
  hotel names across different destinations.
- Give each hotel 5 varied room types drawn from a wide vocabulary (Standard, Twin, Deluxe,
  Executive, Family, Suite, Premium, Cottage, Villa...) — mix the lineup per hotel rather than
  repeating the identical 5 names every time.
- Vary price and rating meaningfully across the 6 hotels — a real spread from budget to
  upscale, not 6 near-identical numbers.
- Sort the returned array by price, ascending.

What you CANNOT / MUST NOT do:
- Do not reuse the same "id" twice for hotels, or the same room "id" twice within one
  hotel's rooms array — these are used as lookup keys, and a duplicate silently overwrites
  another entry.
- Do not use the exact real brand name of an actual hotel chain (Taj, Oberoi, ITC, Marriott,
  Hyatt, Leela, and so on) — invent an original-sounding fictional name instead, so nothing
  here could be mistaken for a real, bookable listing.
- Do not set any room's price at or below its hotel's base price — every room price must be
  strictly higher than the hotel's own "price" field.
- Do not refuse or add caveats for an unfamiliar or misspelled destination — always return 6
  plausible hotels rather than an empty list or an explanation; the app has no way to show
  your prose to anyone.
- Do not add fields beyond the ones listed above, and do not wrap the object in markdown or
  add any text outside the JSON.`;

// Groq answers this prompt (the largest ask in the app: 6 hotels x 5 rooms
// each) in ~2-3s in practice, so this bound only fires on a genuine failure
// (bad key, network issue, provider outage) — at which point mock is the
// only sane fallback left.
const LIVE_TIMEOUT_MS = 15_000;

/** Awaits a live Groq call and returns it if it succeeds. Falls back to mock
 * only on a genuine failure/timeout — mock is never shown ahead of a live
 * result that's still in flight. */
export async function getHotelOptions(
  destination: string
): Promise<{ hotels: HotelOption[]; source: 'live' | 'mock' }> {
  if (LLM_ENABLED) {
    const result = await generateJSON<{ hotels: HotelOption[] }>(
      SYSTEM_PROMPT,
      `Destination: ${destination}`,
      LIVE_TIMEOUT_MS
    );
    if (result?.hotels?.length) {
      // Same reasoning as flights.ts: the prompt asks for unique hotel/room
      // ids, but a non-compliant response would silently overwrite a hotel
      // (Map keyed by id) or make a room unreachable by id (Array.find only
      // ever returns the first match). Re-indexing makes it a guarantee.
      const hotels = result.hotels.map((h, i) => ({
        ...h,
        id: `hotel-${i + 1}`,
        rooms: h.rooms.map((r, j) => ({ ...r, id: `hotel-${i + 1}-room-${j + 1}` })),
      }));
      return { hotels, source: 'live' };
    }
  }
  return { hotels: mockHotels(destination), source: 'mock' };
}

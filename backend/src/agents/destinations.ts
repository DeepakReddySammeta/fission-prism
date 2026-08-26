import type { DestinationSuggestion } from '../types';
import { generateJSON } from '../llm/groq';
import { LLM_ENABLED } from '../config';

const SYSTEM_PROMPT = `You are a travel inspiration agent for an India-focused trip planner.
You never talk to the user — your entire output is the JSON object below, consumed by code,
never shown to anyone as prose.

Given a region (a country, a state, or a specific place someone might drill further into)
and optionally a season/month, suggest exactly 6 destinations. Return JSON:
{ "destinations": DestinationSuggestion[] } where DestinationSuggestion = { id, name, blurb,
bestFor, imageSeed }. Return exactly these fields — nothing else.

What you CAN do:
- Suggest well-known places WITHIN the given region (e.g. region "Kerala" -> Munnar,
  Alleppey, Kochi, Wayanad...), or, if the region is already a specific city/small place with
  nothing sensible to subdivide, other real destinations near or comparable to it.
- When a season/month is given, prefer destinations genuinely good to visit then, and say why
  in the blurb (weather, festivals, off-season prices, crowd levels).
- Write "blurb" as exactly one concrete, specific sentence — a real detail about that place,
  never generic marketing copy that could describe anywhere ("a beautiful destination with
  much to offer" is not acceptable).
- Write "imageSeed" as a short slug (letters/numbers/hyphens only) related to the place name.
- Write "bestFor" as a short 2-4 word tag that leads with (or clearly includes) one of these
  themes, picking whichever genuinely fits best, paired with one specific detail: "Beach" /
  "Coastal" / "Island" for coastal places; "Hill station" / "Mountain" for hill/mountain
  places; "Heritage" / "Culture" / "Fort" / "Palace" for historical places; "Backwaters" /
  "Houseboats" / "Lake" for water-based places; "Wildlife" / "Nature" / "Forest" for
  sanctuaries and nature reserves. Example: "Hill station & tea gardens", "Backwaters &
  houseboats", "Heritage & palaces". This wording is read by simple keyword matching to pick
  a photo, so leading with one of these exact theme words matters more than being clever.

What you CANNOT / MUST NOT do:
- Do not invent a fictional destination — every place named must be real.
- Do not refuse or add caveats for an unfamiliar region name — do your best with real,
  genuinely comparable places rather than returning an empty list or an explanation; the app
  has no way to show your prose to anyone.
- Do not add fields beyond the ones listed above, and do not wrap the object in markdown or
  add any text outside the JSON.`;

const LIVE_TIMEOUT_MS = 15_000;

/** A small curated fallback so the feature still works with no LLM key —
 * intentionally not exhaustive (this is a safety net, not the primary path;
 * LLM_ENABLED is the expected normal case). Keyed by lowercased region name;
 * anything unrecognized falls back to the generic pan-India pool. */
const MOCK_POOL: Record<string, Omit<DestinationSuggestion, 'id'>[]> = {
  india: [
    { name: 'Kerala', blurb: 'Backwaters, houseboats, and misty tea hills in Munnar.', bestFor: 'Backwaters & houseboats', imageSeed: 'kerala-backwaters' },
    { name: 'Goa', blurb: 'Beaches, Portuguese old-town streets, and an easy pace.', bestFor: 'Beaches & nightlife', imageSeed: 'goa-beach' },
    { name: 'Rajasthan', blurb: 'Desert forts, palaces, and Jaipur’s pink-city bazaars.', bestFor: 'Forts & palaces', imageSeed: 'rajasthan-fort' },
    { name: 'Himachal Pradesh', blurb: 'Snow-capped valleys around Manali and quiet hill towns.', bestFor: 'Mountains & trekking', imageSeed: 'himachal-mountains' },
    { name: 'Andaman Islands', blurb: 'Clear-water beaches and coral reefs far from the mainland crowds.', bestFor: 'Islands & diving', imageSeed: 'andaman-beach' },
    { name: 'Coorg', blurb: 'Coffee plantations and waterfalls in Karnataka’s Western Ghats.', bestFor: 'Coffee & hills', imageSeed: 'coorg-coffee' },
  ],
  kerala: [
    { name: 'Munnar', blurb: 'Rolling tea estates and cool hill-station air.', bestFor: 'Tea gardens & hills', imageSeed: 'munnar-tea' },
    { name: 'Alleppey', blurb: 'Overnight houseboats gliding through the backwaters.', bestFor: 'Houseboats', imageSeed: 'alleppey-houseboat' },
    { name: 'Kochi', blurb: 'Colonial Fort Kochi streets and Chinese fishing nets at sunset.', bestFor: 'History & culture', imageSeed: 'kochi-fort' },
    { name: 'Wayanad', blurb: 'Wildlife sanctuaries and waterfalls in dense forest hills.', bestFor: 'Wildlife & nature', imageSeed: 'wayanad-forest' },
    { name: 'Thekkady', blurb: 'Spice plantations and boat safaris in Periyar Tiger Reserve.', bestFor: 'Spice tours & safaris', imageSeed: 'thekkady-periyar' },
    { name: 'Varkala', blurb: 'Cliffside beaches with cafes perched right on the edge.', bestFor: 'Cliffs & beaches', imageSeed: 'varkala-cliff' },
  ],
  goa: [
    { name: 'Baga', blurb: 'The busiest beach strip, full of shacks and nightlife.', bestFor: 'Nightlife', imageSeed: 'baga-beach' },
    { name: 'Palolem', blurb: 'A quieter, palm-lined cove in South Goa.', bestFor: 'Quiet beaches', imageSeed: 'palolem-cove' },
    { name: 'Old Goa', blurb: 'UNESCO-listed Portuguese churches and colonial architecture.', bestFor: 'History', imageSeed: 'old-goa-church' },
    { name: 'Anjuna', blurb: 'Flea markets and a laid-back, bohemian beach scene.', bestFor: 'Markets & cafes', imageSeed: 'anjuna-market' },
    { name: 'Dudhsagar Falls', blurb: 'A four-tiered waterfall reachable by jeep safari.', bestFor: 'Waterfalls', imageSeed: 'dudhsagar-falls' },
    { name: 'Fontainhas', blurb: 'Panaji’s pastel-painted Latin quarter, best explored on foot.', bestFor: 'Old town walks', imageSeed: 'fontainhas-panaji' },
  ],
};
const GENERIC_POOL = MOCK_POOL.india;

function seededPick<T>(pool: T[], seed: string, n: number): T[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const shuffled = [...pool].sort((a, b) => {
    const ai = pool.indexOf(a), bi = pool.indexOf(b);
    return ((h + ai * 7) % pool.length) - ((h + bi * 7) % pool.length);
  });
  return shuffled.slice(0, n);
}

function mockDestinations(region: string): DestinationSuggestion[] {
  const pool = MOCK_POOL[region.trim().toLowerCase()] || GENERIC_POOL;
  return seededPick(pool, region, Math.min(6, pool.length)).map((d, i) => ({ id: `dest-${i}`, ...d }));
}

export async function getDestinationSuggestions(
  region: string,
  season?: string
): Promise<{ destinations: DestinationSuggestion[]; source: 'live' | 'mock' }> {
  if (LLM_ENABLED) {
    const userContent = season ? `Region: ${region}\nSeason/month: ${season}` : `Region: ${region}`;
    const result = await generateJSON<{ destinations: DestinationSuggestion[] }>(SYSTEM_PROMPT, userContent, LIVE_TIMEOUT_MS);
    if (result?.destinations?.length) return { destinations: result.destinations, source: 'live' };
  }
  return { destinations: mockDestinations(region), source: 'mock' };
}

import type {
  ComponentDef, DestinationSuggestion, Envelope, FlightOption, HotelOption, RoomOption, TripSummary,
} from '../types';
import type { PlanRecordSummary } from './sessions';
import { A2UI_VERSION, CATALOG_ID } from '../types';

/* ---------------- Curated imagery ----------------
 * Real, on-topic, hand-picked Unsplash photos (verified reachable) instead of
 * random picsum.photos seeds — the old approach could hand a "Standard Room"
 * a photo of a mountain. Selection is deterministic off imageSeed/id so the
 * same hotel/room always renders the same correct-looking photo. */

const unsplash = (id: string, w = 640, h = 420) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&q=80&auto=format&fit=crop`;

const HOTEL_EXTERIOR_IDS = [
  '1590490360182-c33d57733427', '1445019980597-93fa8acb246c',
  '1560448204-e02f11c3d0e2', '1551882547-ff40c63fe5fa', '1571003123894-1f0594d2b5d9',
];
const ROOM_TIER_IDS = [
  // tier 0: standard
  ['1520250497591-112f2f40a3f4', '1596394516093-501ba68a0ba6', '1568084680786-a84f91d1153c', '1584132967334-10e028bd69f7'],
  // tier 1: deluxe
  ['1566073771259-6a8506099945', '1611892440504-42a792e24d32', '1582719508461-905c673771fd', '1522708323590-d24dbb6b0267'],
  // tier 2+: suite
  ['1618773928121-c32242e63f39', '1631049307264-da0ec9d70304', '1512918728675-ed5a9ecdebfd', '1595576508898-0ad5c879a061'],
];
/** Generic wanderlust imagery — used when a saved plan has no hotel to draw
 * a photo from (e.g. a flights-only booking), so "My Plans" cards never end
 * up with a blank/placeholder thumbnail. */
const DESTINATION_IDS = [
  '1488646953014-85cb44e25828', '1476514525535-07fb3b4ae5f1', '1502602898657-3e91760cbb34',
  '1503220317375-aaad61436b1b', '1469854523086-cc02fe5d8800', '1436491865332-7a61a109cc05',
  '1530521954074-e64f6810b32d', '1524231757912-21f4fe3a7200', '1500835556837-99ac94a94552',
];
/** Aircraft/airport photos — the PDF and trip data embed one of these
 * alongside the flight section, separate from the hotel/room photo. */
const FLIGHT_IDS = [
  '1569154941061-e231b4725ef1', '1517479149777-5f3b1511d5ad', '1436491865332-7a61a109cc05',
  '1483375801503-374c5f660610', '1530545124313-ce5e8eae55af', '1474302770737-173ee21bab63',
  '1517400508447-f8dd518b86db', '1549106765-3d312a9425e1',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export const hotelImage = (seed: string) => unsplash(HOTEL_EXTERIOR_IDS[hashStr(seed) % HOTEL_EXTERIOR_IDS.length], 800, 520);

/** `tier` is the room's price rank within its hotel (0 = cheapest), robust to
 * LLM-generated room names that don't literally say "Standard"/"Deluxe". */
export const roomImage = (seed: string, tier: number) => {
  const pool = ROOM_TIER_IDS[Math.min(tier, ROOM_TIER_IDS.length - 1)];
  return unsplash(pool[hashStr(seed) % pool.length], 640, 420);
};

export const destinationImage = (seed: string) => unsplash(DESTINATION_IDS[hashStr(seed) % DESTINATION_IDS.length], 800, 520);

/* Category-matched imagery for "explore destinations" suggestions — the
 * generic DESTINATION_IDS pool above (built as a last-resort fallback
 * thumbnail for a saved plan with no real photo) includes plainly wrong
 * content for this use, like the Eiffel Tower, so a Kerala/Rajasthan/hill-
 * station suggestion needs its own verified-on-topic pool instead, matched
 * by the LLM's own `bestFor` tag rather than the free-text place name (which
 * the LLM invents from an open set and can't be pre-matched against). */
const DEST_BEACH_IDS = ['1519046904884-53103b34b206', '1570789210967-2cac24afeb00'];
const DEST_WATER_IDS = ['1590050752117-238cb0fb12b1'];
const DEST_HERITAGE_IDS = ['1524230507669-5ff97982bb5e'];
const DEST_HILL_IDS = ['1544735716-392fe2489ffa'];
const DEST_WILDLIFE_IDS = ['1516426122078-c23e76319801', '1440581572325-0bea30075d9d'];
const DEST_GENERIC_IDS = [...DEST_BEACH_IDS, ...DEST_HERITAGE_IDS, ...DEST_HILL_IDS];

function destinationCategoryPool(bestFor: string): string[] {
  const s = bestFor.toLowerCase();
  if (/beach|coast|island|surf|nightlife/.test(s)) return DEST_BEACH_IDS;
  if (/hill|mountain|trek|snow|valley|tea/.test(s)) return DEST_HILL_IDS;
  if (/fort|palace|heritage|cultur|histor|temple|old town/.test(s)) return DEST_HERITAGE_IDS;
  if (/backwater|houseboat|lake|river|canal/.test(s)) return DEST_WATER_IDS;
  if (/wildlife|forest|nature|safari|sanctuary|jungle/.test(s)) return DEST_WILDLIFE_IDS;
  return DEST_GENERIC_IDS;
}

export const destinationSuggestionImage = (bestFor: string, seed: string) => {
  const pool = destinationCategoryPool(bestFor);
  return unsplash(pool[hashStr(seed) % pool.length], 800, 520);
};

export const flightImage = (seed: string) => unsplash(FLIGHT_IDS[hashStr(seed) % FLIGHT_IDS.length], 800, 520);

const env = (msg: Envelope) => msg;

export function createSurface(surfaceId: string, agentName: string, color: string, sendDataModel = false): Envelope {
  return env({
    version: A2UI_VERSION,
    createSurface: { surfaceId, catalogId: CATALOG_ID, theme: { primaryColor: color, agentDisplayName: agentName }, sendDataModel },
  });
}

export function updateData(surfaceId: string, path: string, value: any): Envelope {
  return env({ version: A2UI_VERSION, updateDataModel: { surfaceId, path, value } });
}

export function deleteSurface(surfaceId: string): Envelope {
  return env({ version: A2UI_VERSION, deleteSurface: { surfaceId } });
}

/* ---------------- Flights ---------------- */

const AIRCRAFT_POOL = ['Airbus A320', 'Airbus A321neo', 'Boeing 737 MAX', 'ATR 72', 'Airbus A319'];
const HUB_CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata'];

export const CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'] as const;
export type CabinClass = typeof CABIN_CLASSES[number];

/** The listed fare is the Economy price — picking a higher cabin at booking
 * time multiplies it, same as a real airline upsell, rather than needing a
 * separate stored price per cabin per flight. */
const CABIN_PRICE_MULTIPLIER: Record<CabinClass, number> = {
  Economy: 1, 'Premium Economy': 1.35, Business: 2.2, First: 3.6,
};
const CABIN_BAGGAGE_KG: Record<CabinClass, number> = {
  Economy: 15, 'Premium Economy': 20, Business: 30, First: 40,
};

export function cabinPriceMultiplier(cabinClass?: string | null): number {
  return CABIN_PRICE_MULTIPLIER[(cabinClass as CabinClass) || 'Economy'] ?? 1;
}

/** Realistic-feeling flight detail fields the underlying FlightOption
 * doesn't carry (cabin, baggage, aircraft, layover city). Aircraft/layover
 * are derived deterministically from fields that already exist, so the same
 * flight always shows the same detail; cabin is whatever the traveler
 * picked when booking (defaulting to Economy, the listed fare's own cabin,
 * before a choice has been made). */
export function flightDetails(f: FlightOption, cabinClass?: string | null) {
  const h = hashStr(f.id);
  const cabin: CabinClass = (cabinClass as CabinClass) || 'Economy';
  const baggageKg = CABIN_BAGGAGE_KG[cabin];
  const aircraft = AIRCRAFT_POOL[h % AIRCRAFT_POOL.length];
  const hubs = HUB_CITIES.filter((c) => c !== f.from && c !== f.to);
  const layoverCity = f.stops > 0 ? hubs[h % hubs.length] : undefined;
  return { cabin, baggageKg, aircraft, layoverCity: layoverCity || null };
}

export function flightsSurface(surfaceId: string, flights: FlightOption[]): Envelope[] {
  const minPrice = Math.min(...flights.map((f) => f.price));
  const minDuration = Math.min(...flights.map((f) => f.durationMins));
  const rows = flights.map((f) => ({
    ...f,
    ...flightDetails(f),
    code: f.airline.slice(0, 2).toUpperCase(),
    // Recommended (auto-picked from a date/time or named-flight request)
    // takes priority over the cosmetic Cheapest/Fastest badges — it's the
    // one row the traveler actually asked for.
    tag: f.recommended ? 'Recommended' : f.price === minPrice ? 'Cheapest' : f.durationMins === minDuration ? 'Fastest' : '',
    stopsLabel: f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`,
    stopsTone: f.stops === 0 ? 'success' : 'neutral',
  }));

  return [
    createSurface(surfaceId, 'Flight Finder', '#0fa4af'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Flights' },
          { id: 'list', component: 'List', children: { path: '/flights', componentId: 'flight_row' } },

          { id: 'flight_row', component: 'Row', align: 'center', gap: 16, children: ['fr_logo', 'fr_info', 'fr_price_col'] },
          { id: 'fr_logo', component: 'Icon', label: { path: 'code' } },
          { id: 'fr_info', component: 'Column', weight: 1, gap: 4, children: ['fr_top', 'fr_times'] },
          { id: 'fr_top', component: 'Row', align: 'center', gap: 8, children: ['fr_airline', 'fr_tag'] },
          { id: 'fr_airline', component: 'Text', variant: 'h3', text: { path: 'airline' } },
          { id: 'fr_tag', component: 'Badge', tone: 'brand', text: { path: 'tag' } },
          { id: 'fr_times', component: 'Row', align: 'center', gap: 8, children: ['fr_depart', 'fr_arrow', 'fr_arrive', 'fr_duration', 'fr_stops'] },
          { id: 'fr_depart', component: 'Text', variant: 'mono', text: { path: 'departTime' } },
          { id: 'fr_arrow', component: 'Text', variant: 'mono', text: '→' },
          { id: 'fr_arrive', component: 'Text', variant: 'mono', text: { path: 'arriveTime' } },
          { id: 'fr_duration', component: 'Text', variant: 'caption', text: { call: 'formatDuration', args: { value: { path: 'durationMins' } } } },
          { id: 'fr_stops', component: 'Badge', tone: { path: 'stopsTone' }, text: { path: 'stopsLabel' } },

          { id: 'fr_price_col', component: 'Column', align: 'end', gap: 8, children: ['fr_price', 'fr_btn'] },
          { id: 'fr_price', component: 'Text', variant: 'h3', text: { call: 'formatCurrency', args: { value: { path: 'price' }, currency: 'INR' } } },
          { id: 'fr_btn_label', component: 'Text', text: 'Select' },
          {
            id: 'fr_btn', component: 'Button', variant: 'primary', child: 'fr_btn_label',
            action: { event: { name: 'selectFlight', context: { flightId: { path: 'id' } } } },
          },
        ],
      },
    },
    updateData(surfaceId, '/flights', rows),
  ];
}

/* ---------------- Explore destinations ---------------- */

/** "Best places to visit in X" / "where should I go" — inspiration, not a
 * flights/hotels search yet. Each row's "Explore" drills further into that
 * place (a fresh chat turn asking the same question scoped to it — see
 * App.tsx's exploreDestination interception); the bottom button is the exit
 * into the normal booking flow once the traveler has picked somewhere. */
export function destinationsSurface(
  surfaceId: string, region: string, season: string | undefined,
  durationNights: number | undefined, destinations: DestinationSuggestion[]
): Envelope[] {
  const rows = destinations.map((d) => ({ ...d, imageUrl: destinationSuggestionImage(d.bestFor, d.imageSeed) }));
  // "India" (this app's own default region when no place is named) isn't
  // itself a bookable destination — there's no flight/hotel search for a
  // whole country — so it gets no "Schedule a trip" exit, only the list to
  // explore further. Every drilled-down region is a real, specific place
  // (Kerala, Munnar, ...), so this only ever excludes the one top-level case.
  const isCountryLevel = region.trim().toLowerCase() === 'india';
  const subhead = isCountryLevel
    ? (season ? `Good picks for ${season.toLowerCase()} — tap one to explore further.` : 'Tap one to explore further.')
    : (season ? `Good picks for ${season.toLowerCase()} — tap one to explore further, or schedule a trip now.` : 'Tap one to explore further, or schedule a trip now.');
  const scheduleLabel = `Schedule a trip to ${region}`;
  const bodyChildren = isCountryLevel ? ['head', 'subhead', 'list'] : ['head', 'subhead', 'list', 'schedule_row'];

  return [
    createSurface(surfaceId, 'Trip Inspiration', '#0fa4af'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', gap: 12, children: bodyChildren },
          { id: 'head', component: 'Text', variant: 'h2', text: `Explore ${region}` },
          { id: 'subhead', component: 'Text', variant: 'caption', text: subhead },
          { id: 'list', component: 'List', children: { path: '/destinations', componentId: 'dest_row' } },

          { id: 'dest_row', component: 'Row', gap: 16, align: 'stretch', children: ['dr_img', 'dr_body'] },
          { id: 'dr_img', component: 'Image', url: { path: 'imageUrl' } },
          { id: 'dr_body', component: 'Column', weight: 1, gap: 6, children: ['dr_top', 'dr_blurb', 'dr_bottom'] },
          { id: 'dr_top', component: 'Row', align: 'center', gap: 8, children: ['dr_name', 'dr_tag'] },
          { id: 'dr_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
          { id: 'dr_tag', component: 'Badge', tone: 'brand', text: { path: 'bestFor' } },
          { id: 'dr_blurb', component: 'Text', variant: 'body', text: { path: 'blurb' } },
          { id: 'dr_bottom', component: 'Row', justify: 'end', children: ['dr_btn'] },
          { id: 'dr_btn_label', component: 'Text', text: 'Explore' },
          {
            id: 'dr_btn', component: 'Button', variant: 'outline', child: 'dr_btn_label',
            action: { event: { name: 'exploreDestination', context: { name: { path: 'name' } } } },
          },

          ...(isCountryLevel ? [] : [
          { id: 'schedule_row', component: 'Row' as const, justify: 'center', children: ['schedule_btn'] },
          { id: 'schedule_btn_label', component: 'Text' as const, text: scheduleLabel },
          {
            id: 'schedule_btn', component: 'Button' as const, variant: 'primary', child: 'schedule_btn_label',
            action: { event: { name: 'scheduleTrip', context: { region, durationNights: durationNights ?? null } } },
          },
          ]),
        ],
      },
    },
    updateData(surfaceId, '/destinations', rows),
  ];
}

/* ---------------- Hotels ---------------- */

const PROPERTY_TYPES = ['Hotel', 'Resort', 'Boutique Hotel', 'Guesthouse', 'Villa', 'Apartment'];

/** Realistic-feeling hotel detail fields the underlying HotelOption doesn't
 * carry (property type, review count, category sub-scores) — derived
 * deterministically from fields that already exist, same approach as
 * flightDetails, so the same hotel always shows the same detail whether it
 * came from mock data or the LLM. */
export function hotelDetails(h: HotelOption) {
  const seed = hashStr(h.id);
  const propertyType = PROPERTY_TYPES[seed % PROPERTY_TYPES.length];
  const reviewCount = 40 + (seed % 460); // 40-499, deterministic
  const subScore = (salt: string) => {
    const delta = ((hashStr(h.id + salt) % 7) - 3) / 10; // -0.3 .. +0.3
    return Math.min(5, Math.max(3.5, Math.round((h.rating + delta) * 10) / 10));
  };
  const ratingBreakdown = {
    facilities: subScore('facilities'), cleanliness: subScore('cleanliness'),
    service: subScore('service'), location: subScore('location'),
  };
  return { propertyType, reviewCount, ratingBreakdown };
}

export function hotelsSurface(surfaceId: string, hotels: HotelOption[]): Envelope[] {
  const withImages = hotels.map((h) => {
    const details = hotelDetails(h);
    return {
      ...h,
      imageUrl: hotelImage(h.imageSeed),
      ratingLabel: `${h.rating.toFixed(1)}★ (${details.reviewCount})`,
      propertyType: details.propertyType,
    };
  });
  return [
    createSurface(surfaceId, 'Stay Finder', '#964734'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Hotels' },
          { id: 'list', component: 'List', children: { path: '/hotels', componentId: 'hotel_row' } },

          { id: 'hotel_row', component: 'Row', gap: 16, align: 'stretch', children: ['hr_img', 'hr_body'] },
          { id: 'hr_img', component: 'Image', url: { path: 'imageUrl' } },
          { id: 'hr_body', component: 'Column', weight: 1, gap: 6, children: ['hr_top', 'hr_area', 'hr_meta', 'hr_bottom'] },
          { id: 'hr_top', component: 'Row', align: 'center', gap: 8, children: ['hr_name', 'hr_rating'] },
          { id: 'hr_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
          { id: 'hr_rating', component: 'Badge', tone: 'success', text: { path: 'ratingLabel' } },
          { id: 'hr_area', component: 'Text', variant: 'caption', text: { path: 'area' } },
          { id: 'hr_meta', component: 'Row', gap: 6, children: ['hr_type', 'hr_free_cancel'] },
          { id: 'hr_type', component: 'Badge', tone: 'neutral', text: { path: 'propertyType' } },
          { id: 'hr_free_cancel', component: 'Badge', tone: 'success', text: 'Free cancellation' },
          { id: 'hr_bottom', component: 'Row', justify: 'between', align: 'center', children: ['hr_price_col', 'hr_btn'] },
          { id: 'hr_price_col', component: 'Column', gap: 0, children: ['hr_price', 'hr_pernight'] },
          { id: 'hr_price', component: 'Text', variant: 'h3', text: { call: 'formatCurrency', args: { value: { path: 'price' }, currency: 'INR' } } },
          { id: 'hr_pernight', component: 'Text', variant: 'caption', text: '/ night' },
          { id: 'hr_btn_label', component: 'Text', text: 'View rooms' },
          {
            id: 'hr_btn', component: 'Button', variant: 'primary', child: 'hr_btn_label',
            action: { event: { name: 'selectHotel', context: { hotelId: { path: 'id' } } } },
          },
        ],
      },
    },
    updateData(surfaceId, '/hotels', withImages),
  ];
}

const AMENITY_POOL = [
  'Free WiFi', 'Parking', '24-hr front desk', 'Swimming pool', 'Fitness centre',
  'Restaurant', 'Room service', 'Air conditioning', 'Spa', 'Airport shuttle',
];

function pickAmenities(seed: string): string[] {
  const h = hashStr(seed);
  const picked = new Set<string>();
  for (let i = 0; picked.size < 5 && i < AMENITY_POOL.length; i++) {
    picked.add(AMENITY_POOL[(h + i * 7) % AMENITY_POOL.length]);
  }
  return [...picked];
}

function highlightBadges(rating: number): string[] {
  const badges: string[] = [];
  badges.push(rating >= 4.5 ? 'Exceptional cleanliness' : 'Great cleanliness');
  if (rating >= 4.3) badges.push('Excellent location');
  badges.push('Guest favourite');
  return badges;
}

function isoPlusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RoomBooking {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

export function roomsSurface(surfaceId: string, hotel: HotelOption, booking?: RoomBooking, recommendedRoomId?: string): Envelope[] {
  const byPrice = [...hotel.rooms].sort((a, b) => a.price - b.price);
  const tierOf = new Map(byPrice.map((r, i) => [r.id, i]));
  const withImages = hotel.rooms.map((r) => ({
    ...r,
    imageUrl: roomImage(r.imageSeed, tierOf.get(r.id) ?? 0),
    sleepsLabel: `Sleeps ${r.capacity}`,
    recommended: r.id === recommendedRoomId,
  }));
  const todayIso = new Date().toISOString().slice(0, 10);
  const checkIn = booking?.checkIn || todayIso;
  const checkOut = booking?.checkOut || isoPlusDays(checkIn, 1);
  const adults = booking?.adults ?? 2;
  const children = booking?.children ?? 0;
  const details = hotelDetails(hotel);
  // A few more angles of the same property (deterministic per-hotel salt),
  // alongside the single hero image — a bare one-photo listing looked thin
  // next to how much detail the rest of the overview already shows.
  const galleryUrls = [1, 2, 3].map((n) =>
    unsplash(HOTEL_EXTERIOR_IDS[hashStr(`${hotel.id}-gallery-${n}`) % HOTEL_EXTERIOR_IDS.length], 300, 200)
  );

  const amenities = pickAmenities(hotel.imageSeed);
  const highlights = highlightBadges(hotel.rating);
  const amenityIds = amenities.map((_, i) => `am_${i}`);
  const highlightIds = highlights.map((_, i) => `hl_${i}`);

  return [
    createSurface(surfaceId, 'Stay Finder', '#964734'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', gap: 14, children: ['back_row', 'hero_img', 'gallery_row', 'head', 'rating_row', 'rating_breakdown', 'tabs'] },
          { id: 'back_row', component: 'Row', children: ['back_btn'] },
          { id: 'back_btn', component: 'Button', child: 'back_btn_label', action: { event: { name: 'backToHotels', context: {} } } },
          { id: 'back_btn_label', component: 'Text', text: '← Back to hotels' },
          { id: 'hero_img', component: 'Image', url: { path: 'hotel/imageUrl' }, fit: 'cover' },
          { id: 'gallery_row', component: 'Row', gap: 8, children: ['gal_0', 'gal_1', 'gal_2'] },
          ...galleryUrls.map((url, i): ComponentDef => ({ id: `gal_${i}`, component: 'Image', url, fit: 'cover' })),
          { id: 'head', component: 'Column', gap: 2, children: ['hotel_name', 'hotel_area'] },
          { id: 'hotel_name', component: 'Text', variant: 'h2', text: { path: 'hotel/name' } },
          { id: 'hotel_area', component: 'Text', variant: 'caption', text: { path: 'hotel/area' } },
          { id: 'rating_row', component: 'Row', gap: 8, align: 'center', children: ['rating_badge', 'rating_caption', 'rating_type'] },
          { id: 'rating_badge', component: 'Badge', tone: 'success', text: { path: 'hotel/ratingLabel' } },
          { id: 'rating_caption', component: 'Text', variant: 'caption', text: 'Guest rating' },
          { id: 'rating_type', component: 'Badge', tone: 'neutral', text: { path: 'hotel/propertyType' } },
          { id: 'rating_breakdown', component: 'Text', variant: 'caption', text: { path: 'hotel/ratingBreakdownLabel' } },

          {
            id: 'tabs', component: 'Tabs',
            tabs: [{ id: 'overview', label: 'Overview' }, { id: 'rooms', label: 'Rooms' }],
            panels: { overview: 'panel_overview', rooms: 'panel_rooms' },
          },

          {
            id: 'panel_overview', component: 'Column', gap: 12,
            children: ['overview_text', 'highlight_label', 'highlight_row', 'amenity_label', 'amenity_row', 'policy_row'],
          },
          { id: 'overview_text', component: 'Text', variant: 'body', text: { path: 'hotel/blurb' } },
          { id: 'highlight_label', component: 'Text', variant: 'caption', text: 'Highlights' },
          { id: 'highlight_row', component: 'Row', gap: 8, wrap: true, children: highlightIds },
          ...highlights.map((text, i): ComponentDef => ({ id: `hl_${i}`, component: 'Badge', tone: 'brand', text })),
          { id: 'amenity_label', component: 'Text', variant: 'caption', text: 'Amenities' },
          { id: 'amenity_row', component: 'Row', gap: 8, wrap: true, children: amenityIds },
          ...amenities.map((text, i): ComponentDef => ({ id: `am_${i}`, component: 'Badge', tone: 'neutral', text })),
          {
            id: 'policy_row', component: 'Column', gap: 4,
            children: ['policy_checkin', 'policy_cancel'],
          },
          { id: 'policy_checkin', component: 'Text', variant: 'caption', text: 'Check-in from 2:00 PM · Check-out until 11:00 AM' },
          { id: 'policy_cancel', component: 'Text', variant: 'caption', text: 'Free cancellation available on every room up to 24 hours before check-in' },

          { id: 'panel_rooms', component: 'Column', gap: 14, children: ['stay_form', 'room_list'] },
          { id: 'stay_form', component: 'Row', gap: 12, align: 'end', wrap: true, children: ['stay_checkin', 'stay_checkout', 'stay_adults', 'stay_children'] },
          {
            id: 'stay_checkin', component: 'TextField', label: 'Check-in', inputType: 'date', path: '/booking/checkIn',
            min: { path: '/booking/checkInMin' },
          },
          {
            id: 'stay_checkout', component: 'TextField', label: 'Check-out', inputType: 'date', path: '/booking/checkOut',
            min: { path: '/booking/checkOutMin' },
          },
          { id: 'stay_adults', component: 'ChoicePicker', label: 'Adults', options: [1, 2, 3, 4], path: '/booking/adults' },
          { id: 'stay_children', component: 'ChoicePicker', label: 'Children', options: [0, 1, 2, 3], path: '/booking/children' },

          { id: 'room_list', component: 'List', children: { path: '/rooms', componentId: 'room_row' } },
          { id: 'room_row', component: 'Row', gap: 16, align: 'stretch', children: ['rr_img', 'rr_meta'] },
          { id: 'rr_img', component: 'Image', url: { path: 'imageUrl' } },
          { id: 'rr_meta', component: 'Column', weight: 1, gap: 6, children: ['rr_top', 'rr_amenities', 'rr_bottom'] },
          { id: 'rr_top', component: 'Row', align: 'center', gap: 8, children: ['rr_name', 'rr_sleeps'] },
          { id: 'rr_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
          { id: 'rr_sleeps', component: 'Badge', tone: 'neutral', text: { path: 'sleepsLabel' } },
          { id: 'rr_amenities', component: 'Row', gap: 6, children: ['rr_cancel'] },
          { id: 'rr_cancel', component: 'Badge', tone: 'success', text: 'Free cancellation' },
          { id: 'rr_bottom', component: 'Row', justify: 'between', align: 'center', children: ['rr_price_col', 'rr_btn'] },
          { id: 'rr_price_col', component: 'Column', gap: 0, children: ['rr_price', 'rr_pernight'] },
          { id: 'rr_price', component: 'Text', variant: 'h3', text: { call: 'formatCurrency', args: { value: { path: 'price' }, currency: 'INR' } } },
          { id: 'rr_pernight', component: 'Text', variant: 'caption', text: '/ night' },
          { id: 'rr_btn_label', component: 'Text', text: 'Book this room' },
          {
            id: 'rr_btn', component: 'Button', variant: 'primary', child: 'rr_btn_label',
            action: {
              event: {
                name: 'selectRoom',
                context: {
                  roomId: { path: 'id' },
                  checkIn: { path: '/booking/checkIn' },
                  checkOut: { path: '/booking/checkOut' },
                  adults: { path: '/booking/adults' },
                  children: { path: '/booking/children' },
                },
              },
            },
          },
        ],
      },
    },
    updateData(surfaceId, '/hotel', {
      name: hotel.name, area: hotel.area, imageUrl: hotelImage(hotel.imageSeed),
      ratingLabel: `${hotel.rating.toFixed(1)}★ (${details.reviewCount} reviews)`,
      propertyType: details.propertyType,
      ratingBreakdownLabel: `Facilities ${details.ratingBreakdown.facilities} · Cleanliness ${details.ratingBreakdown.cleanliness} · `
        + `Service ${details.ratingBreakdown.service} · Location ${details.ratingBreakdown.location}`,
      blurb: `${hotel.name} is a ${hotel.rating >= 4.3 ? 'highly-rated' : 'well-rated'} stay in ${hotel.area}, ` +
        `popular for its comfort, service and location. Guests consistently call out the ${hotel.rating >= 4.3 ? 'attentive staff and spotless rooms' : 'friendly staff and convenient location'} ` +
        `as reasons to book again.`,
    }),
    updateData(surfaceId, '/rooms', withImages),
    updateData(surfaceId, '/booking', {
      checkIn, checkOut, adults, children,
      checkInMin: todayIso,
      checkOutMin: isoPlusDays(checkIn, 1),
    }),
  ];
}

/* ---------------- Trip summary ---------------- */

export function tripSummarySurface(surfaceId: string, trip: TripSummary): Envelope[] {
  const children = ['head'];
  const components: any[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 10, children },
    { id: 'head', component: 'Text', variant: 'h2', text: 'Your trip' },
  ];

  if (trip.flight) {
    children.push('flight_line');
    const label = trip.returnFlight ? 'Outbound' : '✈';
    components.push({
      id: 'flight_line', component: 'Text', variant: 'body',
      text: `${label} ${trip.flight.airline} ${trip.flight.flightNumber} · ${trip.flight.departTime}→${trip.flight.arriveTime} · ₹${trip.flight.price}`,
    });
  }
  if (trip.returnFlight) {
    children.push('return_flight_line');
    components.push({
      id: 'return_flight_line', component: 'Text', variant: 'body',
      text: `Return ${trip.returnFlight.airline} ${trip.returnFlight.flightNumber} · ${trip.returnFlight.departTime}→${trip.returnFlight.arriveTime} · ₹${trip.returnFlight.price}`,
    });
  }
  if (trip.passengerName) {
    children.push('passenger_line');
    components.push({
      id: 'passenger_line', component: 'Text', variant: 'caption',
      text: `Traveler: ${trip.passengerName}`,
    });
  }
  if (trip.hotel) {
    children.push('hotel_line');
    components.push({
      id: 'hotel_line', component: 'Text', variant: 'body',
      text: `🏨 ${trip.hotel.name} · ${trip.hotel.area}`,
    });
  }
  if (trip.room) {
    children.push('room_line');
    const stay = trip.checkIn && trip.checkOut ? ` · ${trip.checkIn} → ${trip.checkOut}` : '';
    const occupancy = trip.adults
      ? ` · ${trip.adults} adult${trip.adults > 1 ? 's' : ''}${trip.children ? `, ${trip.children} child${trip.children > 1 ? 'ren' : ''}` : ''}`
      : '';
    components.push({
      id: 'room_line', component: 'Text', variant: 'body',
      text: `🛏 ${trip.room.name} · ₹${trip.room.price}/night${stay}${occupancy}`,
    });
  }
  // Price breakdown — the fare/room-night total was never the real final
  // amount; taxes & fees are a normal part of any real booking, shown as
  // their own line rather than silently folded into a single number.
  if (trip.totalPrice) {
    const subtotal = trip.totalPrice - (trip.taxesAndFees || 0);
    children.push('divider_1', 'subtotal_line');
    components.push(
      { id: 'divider_1', component: 'Divider' },
      { id: 'subtotal_line', component: 'Row', justify: 'between', children: ['subtotal_label', 'subtotal_value'] },
      { id: 'subtotal_label', component: 'Text', variant: 'caption', text: 'Subtotal' },
      { id: 'subtotal_value', component: 'Text', variant: 'caption', text: `₹${subtotal}` },
    );
    if (trip.taxesAndFees) {
      children.push('taxes_line');
      components.push(
        { id: 'taxes_line', component: 'Row', justify: 'between', children: ['taxes_label', 'taxes_value'] },
        { id: 'taxes_label', component: 'Text', variant: 'caption', text: 'Taxes & fees' },
        { id: 'taxes_value', component: 'Text', variant: 'caption', text: `₹${trip.taxesAndFees}` },
      );
    }
    children.push('total_line');
    components.push({
      id: 'total_line', component: 'Row', justify: 'between',
      children: ['total_label', 'total_value'],
    });
    components.push(
      { id: 'total_label', component: 'Text', variant: 'h3', text: 'Total' },
      { id: 'total_value', component: 'Text', variant: 'h3', text: `₹${trip.totalPrice}` },
    );
  }

  // Either a room or a flight is a real, independently bookable thing — a
  // traveler who already booked their flight elsewhere and only wants a room
  // here (or vice versa) should still reach a real confirmed booking, not be
  // stuck because the *other* leg was never added to this trip.
  if (trip.bookingRef) {
    if (trip.guestName) {
      children.push('guest_line');
      components.push({ id: 'guest_line', component: 'Text', variant: 'caption', text: `Guest: ${trip.guestName}` });
    }
    children.push('ref_line');
    components.push({
      id: 'ref_line', component: 'Badge', tone: 'success',
      text: `Booked · ${trip.bookingRef}`,
    });
  } else if (trip.room || trip.flight) {
    // A room needs its own lead-guest name captured here; a flight already
    // has a traveler from the passenger-details form, so no extra field.
    if (trip.room) {
      children.push('guest_input');
      components.push({
        id: 'guest_input', component: 'TextField', label: 'Lead guest name', path: '/guestName',
        placeholder: 'Required to confirm this booking',
      });
    }
    children.push('book_btn');
    components.push(
      { id: 'book_btn_label', component: 'Text', text: 'Confirm booking' },
      {
        id: 'book_btn', component: 'Button', variant: 'primary', child: 'book_btn_label',
        checks: trip.room ? [{
          call: 'required', args: { value: { path: '/guestName' } },
          message: 'Enter the lead guest’s name above to confirm this booking.',
        }] : [],
        action: { event: { name: 'bookTrip', context: { guestName: { path: '/guestName' } } } },
      },
    );
  }

  return [
    createSurface(surfaceId, 'Trip Summary', '#024950'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    updateData(surfaceId, '/guestName', trip.guestName || ''),
  ];
}

/* ---------------- My plans / My bookings (chat-asked) ---------------- */

/** A chat-typed "my plans"/"my upcoming bookings" query renders this — the
 * same card list "My Plans"/"My Bookings" already show, right inline in the
 * conversation instead of navigating away. Each row's "View details" button
 * fires `viewRecordDetail`, resolved against `session.myRecords` (already
 * scoped to the asking user — see server.ts). */
export function myRecordsSurface(surfaceId: string, label: string, records: PlanRecordSummary[]): Envelope[] {
  const rows = records.map((r) => ({
    ...r,
    priceLabel: r.totalPrice ? `Rs. ${r.totalPrice}`.replace('Rs. ', '₹') : '',
    dateLabel: r.travelDate ? r.travelDate : `Saved ${new Date(r.createdAt).toLocaleDateString()}`,
    statusLabel: r.bookingRef ? 'Booked' : '',
  }));

  return [
    createSurface(surfaceId, 'My Trips', '#024950'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: label },
          { id: 'list', component: 'List', children: { path: '/records', componentId: 'record_row' } },

          { id: 'record_row', component: 'Row', gap: 16, align: 'stretch', children: ['rec_img', 'rec_body'] },
          { id: 'rec_img', component: 'Image', url: { path: 'imageUrl' } },
          { id: 'rec_body', component: 'Column', weight: 1, gap: 6, children: ['rec_top', 'rec_meta', 'rec_bottom'] },
          { id: 'rec_top', component: 'Row', align: 'center', gap: 8, children: ['rec_title', 'rec_status'] },
          { id: 'rec_title', component: 'Text', variant: 'h3', text: { path: 'title' } },
          { id: 'rec_status', component: 'Badge', tone: 'success', text: { path: 'statusLabel' } },
          { id: 'rec_meta', component: 'Text', variant: 'caption', text: { path: 'dateLabel' } },
          { id: 'rec_bottom', component: 'Row', justify: 'between', align: 'center', children: ['rec_price', 'rec_btn'] },
          { id: 'rec_price', component: 'Text', variant: 'h3', text: { path: 'priceLabel' } },
          { id: 'rec_btn_label', component: 'Text', text: 'View details' },
          {
            id: 'rec_btn', component: 'Button', variant: 'primary', child: 'rec_btn_label',
            action: { event: { name: 'viewRecordDetail', context: { recordId: { path: 'id' } } } },
          },
        ],
      },
    },
    updateData(surfaceId, '/records', rows),
  ];
}

/** The full breakdown behind one "View details" click — deliberately its
 * own function rather than reusing tripSummarySurface (which the live "your
 * trip" rail also uses, mid-booking): a saved record has its own title and
 * benefits from the same richer flight/hotel detail (cabin/aircraft,
 * property type/reviews) the search views show, none of which the live
 * rail needs to repeat while a booking is still in progress. */
export function recordDetailSurface(surfaceId: string, record: PlanRecordSummary, trip: TripSummary): Envelope[] {
  const children: string[] = ['head', 'meta'];
  const components: any[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 10, children },
    { id: 'head', component: 'Text', variant: 'h2', text: record.title },
    {
      id: 'meta', component: 'Text', variant: 'caption',
      text: `${record.destination} · Saved ${new Date(record.createdAt).toLocaleDateString()}`,
    },
  ];

  if (trip.flight) {
    const fd = flightDetails(trip.flight, trip.cabinClass);
    children.push('flight_line', 'flight_detail_line');
    components.push(
      {
        id: 'flight_line', component: 'Text', variant: 'body',
        text: `✈ ${trip.flight.airline} ${trip.flight.flightNumber} · ${trip.flight.from} → ${trip.flight.to} · `
          + `${trip.flight.departTime}→${trip.flight.arriveTime} · ₹${trip.flight.price}`,
      },
      {
        id: 'flight_detail_line', component: 'Text', variant: 'caption',
        text: `${fd.cabin} class · ${fd.aircraft}${trip.flight.date ? ` · ${trip.flight.date}` : ''}`,
      },
    );
  }
  if (trip.returnFlight) {
    children.push('return_flight_line');
    components.push({
      id: 'return_flight_line', component: 'Text', variant: 'body',
      text: `✈ Return ${trip.returnFlight.airline} ${trip.returnFlight.flightNumber} · `
        + `${trip.returnFlight.departTime}→${trip.returnFlight.arriveTime} · ₹${trip.returnFlight.price}`
        + (trip.returnDate ? ` · ${trip.returnDate}` : ''),
    });
  }
  if (trip.passengerNames?.length) {
    children.push('passengers_line');
    components.push({
      id: 'passengers_line', component: 'Text', variant: 'caption',
      text: trip.passengerNames.length > 1 ? `Travelers: ${trip.passengerNames.join(', ')}` : `Traveler: ${trip.passengerNames[0]}`,
    });
  } else if (trip.passengerName) {
    children.push('passenger_line');
    components.push({
      id: 'passenger_line', component: 'Text', variant: 'caption',
      text: `Traveler: ${trip.passengerName}${trip.passengerEmail ? ` · ${trip.passengerEmail}` : ''}`,
    });
  }
  if (trip.hotel) {
    const hd = hotelDetails(trip.hotel);
    children.push('hotel_line', 'hotel_detail_line');
    components.push(
      { id: 'hotel_line', component: 'Text', variant: 'body', text: `🏨 ${trip.hotel.name} · ${trip.hotel.area}` },
      {
        id: 'hotel_detail_line', component: 'Text', variant: 'caption',
        text: `${hd.propertyType} · ${trip.hotel.rating.toFixed(1)}★ (${hd.reviewCount} reviews)`,
      },
    );
  }
  if (trip.room) {
    const stay = trip.checkIn && trip.checkOut ? ` · ${trip.checkIn} → ${trip.checkOut}` : '';
    const occupancy = trip.adults
      ? ` · ${trip.adults} adult${trip.adults > 1 ? 's' : ''}${trip.children ? `, ${trip.children} child${trip.children > 1 ? 'ren' : ''}` : ''}`
      : '';
    children.push('room_line');
    components.push({
      id: 'room_line', component: 'Text', variant: 'body',
      text: `🛏 ${trip.room.name} · Sleeps ${trip.room.capacity} · ₹${trip.room.price}/night${stay}${occupancy}`,
    });
  }
  if (trip.guestName) {
    children.push('guest_line');
    components.push({ id: 'guest_line', component: 'Text', variant: 'caption', text: `Guest: ${trip.guestName}` });
  }

  if (trip.totalPrice) {
    const subtotal = trip.totalPrice - (trip.taxesAndFees || 0);
    children.push('divider_1', 'subtotal_line');
    components.push(
      { id: 'divider_1', component: 'Divider' },
      { id: 'subtotal_line', component: 'Row', justify: 'between', children: ['subtotal_label', 'subtotal_value'] },
      { id: 'subtotal_label', component: 'Text', variant: 'caption', text: 'Subtotal' },
      { id: 'subtotal_value', component: 'Text', variant: 'caption', text: `₹${subtotal}` },
    );
    if (trip.taxesAndFees) {
      children.push('taxes_line');
      components.push(
        { id: 'taxes_line', component: 'Row', justify: 'between', children: ['taxes_label', 'taxes_value'] },
        { id: 'taxes_label', component: 'Text', variant: 'caption', text: 'Taxes & fees' },
        { id: 'taxes_value', component: 'Text', variant: 'caption', text: `₹${trip.taxesAndFees}` },
      );
    }
    children.push('total_line');
    components.push(
      { id: 'total_line', component: 'Row', justify: 'between', children: ['total_label', 'total_value'] },
      { id: 'total_label', component: 'Text', variant: 'h3', text: 'Total' },
      { id: 'total_value', component: 'Text', variant: 'h3', text: `₹${trip.totalPrice}` },
    );
  }

  if (record.bookingRef) {
    children.push('ref_line');
    components.push({ id: 'ref_line', component: 'Badge', tone: 'success', text: `Booked · ${record.bookingRef}` });
  }

  return [
    createSurface(surfaceId, 'Trip Details', '#024950'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

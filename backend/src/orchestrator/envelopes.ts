import type {
  ComponentDef, DestinationSuggestion, DoctorOption, Envelope, FlightOption, HospitalOption, HotelOption, RoomOption, TripSummary,
} from '../types';
import type { DoctorMatch, BookingHints } from '../agents/health';
import { APPOINTMENT_TIME_SLOTS } from '../agents/health';
import type {
  PlanRecordSummary, AppointmentSummary, CategoryStatus, GoalSummary, GoalPlanItem,
  CashFlowPoint, RecentExpenseRow,
} from './sessions';
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
  if (/wildlife|forest|nature|safari|sanctuary|jungle|waterfall/.test(s)) return DEST_WILDLIFE_IDS;
  return DEST_GENERIC_IDS;
}

export const destinationSuggestionImage = (bestFor: string, seed: string) => {
  const pool = destinationCategoryPool(bestFor);
  return unsplash(pool[hashStr(seed) % pool.length], 800, 520);
};

export const flightImage = (seed: string) => unsplash(FLIGHT_IDS[hashStr(seed) % FLIGHT_IDS.length], 800, 520);

/** Doctor photos are NOT hashed/pooled like the ones above — each doctor in
 * mock/doctors.ts carries its own specific, individually-verified,
 * gender-matched photoSeed, fixed at curation time (see that file). This
 * just resolves that exact seed to a URL, deterministically, with no
 * selection logic of its own. */
export const doctorPhoto = (photoSeed: string) => unsplash(photoSeed, 400, 400);

/** A few real hospital names already end in their own area ("Apollo
 * Hospitals, Jubilee Hills", "CARE Hospitals, Banjara Hills") — appending
 * "· <area>" unconditionally then repeats it ("...Jubilee Hills · Jubilee
 * Hills"). Only appends the area when it isn't already part of the name. */
function hospitalLine(hospital: HospitalOption): string {
  return hospital.name.toLowerCase().includes(hospital.area.toLowerCase())
    ? `🏥 ${hospital.name}`
    : `🏥 ${hospital.name} · ${hospital.area}`;
}

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
    timeBlock: `${f.departTime} → ${f.arriveTime}`,
    stopsLabel: f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`,
    stopsTone: f.stops === 0 ? 'success' : 'neutral',
  }));

  return [
    createSurface(surfaceId, 'Flight Finder', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Flights' },
          { id: 'list', component: 'List', children: { path: '/flights', componentId: 'flight_row' } },

          { id: 'flight_row', component: 'Row', align: 'center', gap: 16, children: ['fr_logo', 'fr_body', 'fr_action'] },
          { id: 'fr_logo', component: 'Icon', label: { path: 'code' } },
          { id: 'fr_body', component: 'Column', weight: 1, gap: 6, children: ['fr_top', 'fr_bottom'] },
          { id: 'fr_top', component: 'Row', align: 'center', gap: 8, children: ['fr_airline', 'fr_tag'] },
          { id: 'fr_airline', component: 'Text', variant: 'h3', text: { path: 'airline' } },
          { id: 'fr_tag', component: 'Badge', tone: 'brand', text: { path: 'tag' } },
          { id: 'fr_bottom', component: 'Row', align: 'center', gap: 10, children: ['fr_times', 'fr_duration', 'fr_stops'] },
          { id: 'fr_times', component: 'Text', variant: 'mono', text: { path: 'timeBlock' } },
          { id: 'fr_duration', component: 'Text', variant: 'caption', text: { call: 'formatDuration', args: { value: { path: 'durationMins' } } } },
          { id: 'fr_stops', component: 'Badge', tone: { path: 'stopsTone' }, text: { path: 'stopsLabel' } },

          { id: 'fr_action', component: 'Column', align: 'end', gap: 4, children: ['fr_price', 'fr_btn'] },
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
    createSurface(surfaceId, 'Trip Inspiration', '#f25011'),
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
    createSurface(surfaceId, 'Stay Finder', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Hotels' },
          { id: 'list', component: 'List', children: { path: '/hotels', componentId: 'hotel_row' } },

          { id: 'hotel_row', component: 'Row', gap: 14, align: 'stretch', children: ['hr_img', 'hr_body'] },
          { id: 'hr_img', component: 'Image', url: { path: 'imageUrl' } },
          { id: 'hr_body', component: 'Column', weight: 1, gap: 4, children: ['hr_top', 'hr_mid', 'hr_bottom'] },
          { id: 'hr_top', component: 'Row', align: 'start', justify: 'between', children: ['hr_name_col', 'hr_price_col'] },
          { id: 'hr_name_col', component: 'Column', weight: 1, gap: 2, children: ['hr_name', 'hr_rating_text'] },
          { id: 'hr_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
          { id: 'hr_rating_text', component: 'Text', variant: 'caption', text: { path: 'ratingLabel' } },
          { id: 'hr_price_col', component: 'Column', align: 'end', gap: 0, children: ['hr_price', 'hr_pernight'] },
          { id: 'hr_price', component: 'Text', variant: 'h3', text: { call: 'formatCurrency', args: { value: { path: 'price' }, currency: 'INR' } } },
          { id: 'hr_pernight', component: 'Text', variant: 'caption', text: '/ night' },
          { id: 'hr_mid', component: 'Text', variant: 'caption', text: { path: 'area' } },
          { id: 'hr_bottom', component: 'Row', align: 'center', justify: 'between', children: ['hr_tags', 'hr_btn'] },
          { id: 'hr_tags', component: 'Row', gap: 6, children: ['hr_type', 'hr_free_cancel'] },
          { id: 'hr_type', component: 'Badge', tone: 'neutral', text: { path: 'propertyType' } },
          { id: 'hr_free_cancel', component: 'Badge', tone: 'success', text: 'Free cancellation' },
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

export function roomsSurface(surfaceId: string, hotel: HotelOption, booking?: RoomBooking, recommendedRoomId?: string, showBack = true): Envelope[] {
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
    createSurface(surfaceId, 'Stay Finder', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', gap: 14, children: [...(showBack ? ['back_row'] : []), 'hero_img', 'gallery_row', 'head', 'rating_row', 'rating_breakdown', 'tabs'] },
          // Only referenced by `body` above when showBack — an unreferenced
          // component def is simply never rendered, so leaving these in place
          // for the non-back case is harmless.
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
          condition: { call: 'required', args: { value: { path: '/guestName' } } },
          message: 'Enter the lead guest’s name above to confirm this booking.',
        }] : [],
        action: { event: { name: 'bookTrip', context: { guestName: { path: '/guestName' } } } },
      },
    );
  }

  return [
    createSurface(surfaceId, 'Trip Summary', '#1c1e2e'),
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
    createSurface(surfaceId, 'My Trips', '#1c1e2e'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: label },
          // Same layout:'grid' two-up card pattern the goals widgets use
          // (see goalsBlock) — matches the My Bookings *page*'s own card
          // grid instead of the plain stacked rows this used to render as.
          { id: 'list', component: 'List', layout: 'grid', children: { path: '/records', componentId: 'record_row' } },

          { id: 'record_row', component: 'Column', gap: 8, panel: true, children: ['rec_img', 'rec_top', 'rec_meta', 'rec_bottom'] },
          { id: 'rec_img', component: 'Image', url: { path: 'imageUrl' } },
          { id: 'rec_top', component: 'Row', justify: 'between', align: 'center', gap: 8, children: ['rec_title', 'rec_status'] },
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
    createSurface(surfaceId, 'Trip Details', '#1c1e2e'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/* ---------------- My appointments (chat-asked) ---------------- */

/** A chat-typed "my upcoming appointments"/"past appointments with Dr. X"
 * query renders this — one row per booked appointment, doctor-first (same
 * emphasis as the doctor list/profile cards) with the hospital, patient,
 * date/time and reference all visible without a further "view details"
 * click, since unlike a saved trip there's no richer breakdown behind it.
 * `formatAppointmentDate` (defined below, hoisted) keeps the date reading
 * "Fri 28 August" here too, matching the confirmation card. */
export function appointmentsSurface(surfaceId: string, label: string, appts: AppointmentSummary[]): Envelope[] {
  const rows = appts.map((a) => ({
    ...a,
    patientLabel: `Patient: ${a.patientName}`,
    dateLabel: `${formatAppointmentDate(a.preferredDate)} · ${a.preferredTime}`,
    refLabel: `Booked · ${a.appointmentRef}`,
  }));

  return [
    createSurface(surfaceId, 'My Appointments', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: label },
          { id: 'list', component: 'List', children: { path: '/appointments', componentId: 'appt_row' } },

          { id: 'appt_row', component: 'Row', gap: 16, justify: 'between', wrap: true, children: ['appt_left', 'appt_right'] },
          { id: 'appt_left', component: 'Column', gap: 4, children: ['appt_top', 'appt_hospital', 'appt_patient'] },
          { id: 'appt_top', component: 'Row', gap: 8, align: 'center', wrap: true, children: ['appt_doctor', 'appt_specialty'] },
          { id: 'appt_doctor', component: 'Text', variant: 'h3', text: { path: 'doctorName' } },
          { id: 'appt_specialty', component: 'Badge', tone: 'brand', text: { path: 'specialty' } },
          { id: 'appt_hospital', component: 'Text', variant: 'caption', text: { path: 'hospitalName' } },
          { id: 'appt_patient', component: 'Text', variant: 'caption', text: { path: 'patientLabel' } },

          // align: 'end' — a Column's children default to stretching full
          // width; right-aligning keeps the date and badge compact instead
          // of the badge stretching the same way earlier health cards' did
          // before that fix (see doctorProfileSurface's book_btn_row).
          { id: 'appt_right', component: 'Column', gap: 4, align: 'end', children: ['appt_date', 'appt_ref'] },
          { id: 'appt_date', component: 'Text', variant: 'body', text: { path: 'dateLabel' } },
          { id: 'appt_ref', component: 'Badge', tone: 'success', text: { path: 'refLabel' } },
        ],
      },
    },
    updateData(surfaceId, '/appointments', rows),
  ];
}

/* ---------------- Find a doctor ---------------- */

/** The doctor-first list — hospital shown, deliberately secondary (a
 * caption line under the doctor's own name/rating, never its own heading)
 * per the explicit "highlight the doctor, mention the hospital" design. */
export function doctorsSurface(surfaceId: string, specialty: string, doctors: DoctorMatch[]): Envelope[] {
  const rows = doctors.map((d) => ({
    ...d,
    photoUrl: doctorPhoto(d.photoSeed),
    expertiseLabel: d.expertise.slice(0, 2).join(' · '),
    languagesLabel: d.languages.join(', '),
    hospitalLine: hospitalLine(d.hospital),
    ratingLabel: `${d.rating.toFixed(1)}★`,
    feeLabel: `₹${d.consultationFee} consultation`,
  }));

  return [
    createSurface(surfaceId, 'Find a Doctor', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', gap: 12, children: ['head', 'subhead', 'disclaimer', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: `${specialty} specialists` },
          { id: 'subhead', component: 'Text', variant: 'caption', text: 'Best-rated doctors for this, with the hospital they practice at.' },
          {
            id: 'disclaimer', component: 'Text', variant: 'caption',
            text: 'Illustrative profiles for this demo — always confirm directly with the hospital.',
          },
          // A grid, not a vertical list — see the `.surface-health .a2-list`
          // rule in styles.css, scoped so only this surface's list turns
          // into a 2-column grid of cards; flights/hotels/destinations keep
          // their normal full-width rows.
          { id: 'list', component: 'List', children: { path: '/doctors', componentId: 'doc_row' } },

          // A Column, not a Row: a vertical card (photo on top) reads far
          // better at half-width in a 2-up grid than a wide horizontal row
          // would — the same content that worked full-width for one hotel
          // per line would wrap awkwardly at half that width.
          { id: 'doc_row', component: 'Column', gap: 6, children: ['dr_img', 'dr_top', 'dr_qual', 'dr_expertise', 'dr_languages', 'dr_hospital', 'dr_fee', 'dr_actions'] },
          { id: 'dr_img', component: 'Image', url: { path: 'photoUrl' } },
          { id: 'dr_top', component: 'Row', align: 'center', gap: 8, wrap: true, children: ['dr_name', 'dr_rating'] },
          { id: 'dr_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
          { id: 'dr_rating', component: 'Badge', tone: 'success', text: { path: 'ratingLabel' } },
          { id: 'dr_qual', component: 'Text', variant: 'caption', text: { path: 'qualifications' } },
          { id: 'dr_expertise', component: 'Text', variant: 'caption', text: { path: 'expertiseLabel' } },
          { id: 'dr_languages', component: 'Text', variant: 'caption', text: { path: 'languagesLabel' } },
          { id: 'dr_hospital', component: 'Text', variant: 'caption', text: { path: 'hospitalLine' } },
          { id: 'dr_fee', component: 'Text', variant: 'caption', text: { path: 'feeLabel' } },
          { id: 'dr_actions', component: 'Row', gap: 8, wrap: true, children: ['view_btn', 'book_btn'] },
          { id: 'view_btn_label', component: 'Text', text: 'View Profile' },
          {
            // Handled entirely client-side (App.tsx intercepts this action
            // name before it would otherwise POST to the backend) — it
            // synthesizes "View profile for Dr. X" as a genuinely new chat
            // message, the same client-side-synthesis pattern already
            // proven for exploreDestination/viewRecordDetail, rather than
            // this same card silently swapping its own content in place.
            id: 'view_btn', component: 'Button', variant: 'outline', child: 'view_btn_label',
            action: { event: { name: 'viewDoctorProfile', context: { name: { path: 'name' } } } },
          },
          { id: 'book_btn_label', component: 'Text', text: 'Book Appointment' },
          {
            id: 'book_btn', component: 'Button', variant: 'primary', child: 'book_btn_label',
            action: { event: { name: 'startDoctorBooking', context: { name: { path: 'name' } } } },
          },
        ],
      },
    },
    updateData(surfaceId, '/doctors', rows),
  ];
}

function doctorDataModel(doctor: DoctorMatch) {
  return {
    id: doctor.id, name: doctor.name, qualifications: doctor.qualifications, specialty: doctor.specialty,
    photoUrl: doctorPhoto(doctor.photoSeed), ratingLabel: `${doctor.rating.toFixed(1)}★`,
    experienceLabel: `${doctor.yearsExperience} yrs experience`, bio: doctor.bio,
    hospitalLine: hospitalLine(doctor.hospital),
    // Single "Label: value" lines rather than a label above its own value —
    // the profile card's read-only facts don't need two lines' worth of
    // vertical room and a whole row of leftover horizontal space each.
    opdLine: `OPD timings: ${doctor.opdTimings}`,
    feeLine: `Consultation fee: ₹${doctor.consultationFee}`,
    addressLine: `Hospital: ${doctor.hospital.name}, ${doctor.hospital.address}`,
  };
}

/** The drill-down: full profile, read-only, laid out as a horizontal card
 * (photo left, everything else right) so it actually fills the width a
 * chat-turn card gets instead of leaving a large empty gutter next to a
 * narrow vertical stack. Ends in a single "Book Appointment" button —
 * handled client-side (App.tsx intercepts this action name), which
 * synthesizes a fresh "Book an appointment with Dr. X" chat turn rather
 * than swapping this card's own content in place, so booking always gets
 * its own dedicated form/card (see doctorBookingFormSurface) instead of
 * being a second tab bolted onto this one. */
export function doctorProfileSurface(surfaceId: string, doctor: DoctorMatch): Envelope[] {
  const expertiseIds = doctor.expertise.map((_, i) => `exp_${i}`);

  return [
    createSurface(surfaceId, 'Find a Doctor', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          // No back button: this card is always its own chat turn now (a
          // fresh "View profile" message and response, same as the
          // destinations drill-down), never an in-place replacement of a
          // still-visible list — there's nothing to go "back" to here.
          // align: 'start' — a Row's default cross-axis behavior stretches
          // both children to the same height, which was stretching the
          // photo column down to match the much-taller info column and
          // leaving all of that extra height as blank space below the
          // (fixed-size) photo itself.
          { id: 'body', component: 'Row', gap: 20, align: 'start', wrap: true, children: ['photo_col', 'info_col'] },
          { id: 'photo_col', component: 'Column', gap: 0, children: ['hero_img'] },
          { id: 'hero_img', component: 'Image', url: { path: 'doctor/photoUrl' } },

          {
            id: 'info_col', component: 'Column', gap: 10, weight: 1,
            children: [
              'head', 'meta_row', 'hospital_line', 'bio_text',
              'expertise_label', 'expertise_row', 'opd_line', 'fee_line', 'address_line', 'book_btn_row',
            ],
          },
          { id: 'head', component: 'Column', gap: 2, children: ['doc_name', 'doc_qual'] },
          { id: 'doc_name', component: 'Text', variant: 'h2', text: { path: 'doctor/name' } },
          { id: 'doc_qual', component: 'Text', variant: 'caption', text: { path: 'doctor/qualifications' } },
          { id: 'meta_row', component: 'Row', gap: 8, align: 'center', wrap: true, children: ['rating_badge', 'specialty_badge', 'exp_badge'] },
          { id: 'rating_badge', component: 'Badge', tone: 'success', text: { path: 'doctor/ratingLabel' } },
          { id: 'specialty_badge', component: 'Badge', tone: 'brand', text: { path: 'doctor/specialty' } },
          { id: 'exp_badge', component: 'Badge', tone: 'neutral', text: { path: 'doctor/experienceLabel' } },
          { id: 'hospital_line', component: 'Text', variant: 'caption', text: { path: 'doctor/hospitalLine' } },
          { id: 'bio_text', component: 'Text', variant: 'body', text: { path: 'doctor/bio' } },
          { id: 'expertise_label', component: 'Text', variant: 'caption', text: 'Areas of expertise' },
          { id: 'expertise_row', component: 'Row', gap: 8, wrap: true, children: expertiseIds },
          ...doctor.expertise.map((text, i): ComponentDef => ({ id: `exp_${i}`, component: 'Badge', tone: 'neutral', text })),
          // Single "Label: value" lines instead of a caption label stacked
          // above its own value — half the vertical space, and no more
          // short lines leaving a wide empty margin to their right.
          { id: 'opd_line', component: 'Text', variant: 'caption', text: { path: 'doctor/opdLine' } },
          { id: 'fee_line', component: 'Text', variant: 'caption', text: { path: 'doctor/feeLine' } },
          { id: 'address_line', component: 'Text', variant: 'caption', text: { path: 'doctor/addressLine' } },

          // Wrapped in its own Row so the button takes its natural width
          // instead of stretching to fill the info column — a Column's
          // children stretch to full cross-axis width by default, which
          // was making this single CTA look like an oversized banner.
          { id: 'book_btn_row', component: 'Row', children: ['book_btn'] },
          { id: 'book_btn_label', component: 'Text', text: 'Book Appointment' },
          {
            id: 'book_btn', component: 'Button', variant: 'primary', child: 'book_btn_label',
            action: { event: { name: 'startDoctorBooking', context: { name: { path: 'doctor/name' } } } },
          },
        ],
      },
    },
    updateData(surfaceId, '/doctor', doctorDataModel(doctor)),
  ];
}

/** A dedicated card for booking, reached only via the "Book Appointment"
 * button (list or profile) or a chat request that already reads as a
 * booking ask — never bundled into the profile card as a tab, so it's
 * always a fresh, focused form rather than one more thing sharing space
 * on an already-busy card. Prefills whatever the request already told us
 * (a symptom becomes the visit reason; a named date/time — "tomorrow
 * morning", "on Friday at 3pm" — becomes the date/time picks) so the
 * patient isn't re-typing what they already said. */
export function doctorBookingFormSurface(
  surfaceId: string, doctor: DoctorMatch, symptom?: string, hints?: BookingHints
): Envelope[] {
  return [
    createSurface(surfaceId, 'Find a Doctor', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          {
            id: 'body', component: 'Column', gap: 14,
            children: ['head', 'doctor_line', 'patient_row', 'contact_row', 'reason_field', 'date_row', 'time_label', 'time_row', 'book_error', 'confirm_btn_row'],
          },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Book an appointment' },
          { id: 'doctor_line', component: 'Text', variant: 'caption', text: { path: 'doctor/summaryLine' } },
          { id: 'patient_row', component: 'Row', gap: 12, wrap: true, children: ['name_field', 'age_field', 'gender_field'] },
          { id: 'name_field', component: 'TextField', label: 'Patient name', path: '/booking/patientName', placeholder: 'Full name' },
          { id: 'age_field', component: 'TextField', label: 'Age', inputType: 'number', path: '/booking/patientAge' },
          { id: 'gender_field', component: 'ChoicePicker', label: 'Gender', options: ['Male', 'Female', 'Other'], path: '/booking/patientGender' },
          { id: 'contact_row', component: 'Row', gap: 12, wrap: true, children: ['phone_field', 'email_field'] },
          { id: 'phone_field', component: 'TextField', label: 'Phone', path: '/booking/patientPhone', placeholder: '10-digit mobile number' },
          { id: 'email_field', component: 'TextField', label: 'Email (optional)', path: '/booking/patientEmail', placeholder: 'you@example.com' },
          { id: 'reason_field', component: 'TextField', label: 'Reason for visit', path: '/booking/reason' },
          { id: 'date_row', component: 'Row', gap: 12, children: ['date_field'] },
          {
            id: 'date_field', component: 'TextField', label: 'Preferred date', inputType: 'date',
            path: '/booking/preferredDate', min: { path: '/booking/dateMin' },
          },
          { id: 'time_label', component: 'Text', variant: 'caption', text: 'Preferred time' },
          { id: 'time_row', component: 'ChoicePicker', options: APPOINTMENT_TIME_SLOTS, path: '/booking/preferredTime' },
          { id: 'book_error', component: 'Text', variant: 'caption', text: { path: '/booking/error' } },
          // Wrapped in its own Row — same fix as doctorProfileSurface's
          // book_btn_row — so the button takes its natural width instead
          // of a Column's default full-width stretch.
          { id: 'confirm_btn_row', component: 'Row', children: ['confirm_btn'] },
          {
            id: 'confirm_btn', component: 'Button', variant: 'primary', child: 'confirm_btn_label',
            checks: [
              { condition: { call: 'required', args: { value: { path: '/booking/patientName' } } }, message: 'Enter the patient name.' },
              { condition: { call: 'required', args: { value: { path: '/booking/patientPhone' } } }, message: 'Enter a contact phone number.' },
              { condition: { call: 'required', args: { value: { path: '/booking/preferredDate' } } }, message: 'Pick a preferred date.' },
              { condition: { call: 'required', args: { value: { path: '/booking/preferredTime' } } }, message: 'Pick a preferred time.' },
            ],
            action: {
              event: {
                name: 'confirmAppointment',
                context: {
                  doctorId: { path: 'doctor/id' },
                  patientName: { path: '/booking/patientName' },
                  patientAge: { path: '/booking/patientAge' },
                  patientGender: { path: '/booking/patientGender' },
                  patientPhone: { path: '/booking/patientPhone' },
                  patientEmail: { path: '/booking/patientEmail' },
                  reason: { path: '/booking/reason' },
                  preferredDate: { path: '/booking/preferredDate' },
                  preferredTime: { path: '/booking/preferredTime' },
                },
              },
            },
          },
          { id: 'confirm_btn_label', component: 'Text', text: 'Confirm Appointment' },
        ],
      },
    },
    updateData(surfaceId, '/doctor', {
      ...doctorDataModel(doctor),
      summaryLine: `${doctor.name} · ${doctor.specialty} — ${hospitalLine(doctor.hospital)}`,
    }),
    updateData(surfaceId, '/booking', {
      patientName: '', patientAge: '', patientGender: '', patientPhone: '', patientEmail: '',
      reason: symptom || '', preferredDate: hints?.preferredDate || '', preferredTime: hints?.preferredTime || '',
      error: '', dateMin: new Date().toISOString().slice(0, 10),
    }),
  ];
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-08-28" -> "Fri 28 August" — the raw ISO date the <input type=date>
 * gives us reads fine in a form field but not in a confirmation someone
 * actually has to remember; spelling out the weekday and month makes it
 * unambiguous at a glance. Built manually (not toLocaleDateString) so the
 * exact wording doesn't drift with server locale. */
export function formatAppointmentDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

/** Replaces the booking form with a plain confirmation once
 * confirmAppointment succeeds — same surfaceId, so it's the natural next
 * screen rather than a separate surface the user has to find. */
export function appointmentConfirmationSurface(
  surfaceId: string, doctor: DoctorOption, hospital: HospitalOption,
  patientName: string, preferredDate: string, preferredTime: string, appointmentRef: string
): Envelope[] {
  return [
    createSurface(surfaceId, 'Find a Doctor', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          // 'confirm_body' (not the generic 'body' every other health card
          // uses) so styles.css can size just this card narrower — a
          // 4-line receipt doesn't need the same width the photo+details
          // profile card does.
          { id: 'root', component: 'Card', child: 'confirm_body' },
          { id: 'confirm_body', component: 'Column', gap: 10, children: ['head', 'line1', 'line2', 'line3', 'ref_row'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Appointment confirmed' },
          { id: 'line1', component: 'Text', variant: 'body', text: `${patientName}, with ${doctor.name} (${doctor.specialty})` },
          { id: 'line2', component: 'Text', variant: 'body', text: `${hospital.name} · ${hospital.area}` },
          { id: 'line3', component: 'Text', variant: 'body', text: `${formatAppointmentDate(preferredDate)} at ${preferredTime}` },
          // Wrapped in a Row so the badge stays a compact pill instead of
          // stretching to the column's full width (see book_btn_row in
          // doctorProfileSurface for the same fix).
          { id: 'ref_row', component: 'Row', children: ['ref_badge'] },
          { id: 'ref_badge', component: 'Badge', tone: 'success', text: `Booked · ${appointmentRef}` },
        ],
      },
    },
  ];
}

/* ---------------- Personal Finance / Budget ----------------
 * Purely conversation-driven — no buttons, no directory to search, no
 * booking flow. Each of these renders whatever the current message added
 * (a budget, a logged expense, a goal, a summary), always as a compact
 * single-column card (see the .surface-finance width cap in styles.css) —
 * a bar chart needs the same "don't stretch it wider than its content"
 * care a lone button did in the doctor agent, just applied to a track
 * instead of a button. */

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function toneForSpend(status: CategoryStatus): string {
  if (!status.limit) return 'brand';
  if (status.spent > status.limit) return 'danger';
  if (status.spent / status.limit >= 0.8) return 'warning';
  return 'success';
}

/** A "I earn X, rent is Y, food is Z..." statement renders this — one bar
 * per category (limit-aware: green under 80%, amber near the limit, red
 * over it), plus how much of the stated income is still unallocated. */
export function budgetBreakdownSurface(
  surfaceId: string, income: number | undefined, categories: CategoryStatus[], allocatedTotal: number
): Envelope[] {
  const rows = categories.map((c) => ({
    category: c.category,
    amountLabel: c.limit ? `${inr(c.spent)} / ${inr(c.limit)}` : inr(c.spent),
    pct: c.limit ? Math.min(100, Math.round((c.spent / c.limit) * 100)) : 0,
    tone: toneForSpend(c),
  }));

  const children = ['head'];
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children },
    { id: 'head', component: 'Text', variant: 'h2', text: 'Your Budget' },
  ];
  if (income !== undefined) {
    children.push('income_line');
    components.push({ id: 'income_line', component: 'Text', variant: 'body', text: `Monthly income: ${inr(income)}` });
  }
  children.push('list');
  components.push(
    { id: 'list', component: 'List', children: { path: '/categories', componentId: 'cat_row' } },
    { id: 'cat_row', component: 'Column', gap: 4, children: ['cat_top', 'cat_bar'] },
    { id: 'cat_top', component: 'Row', justify: 'between', children: ['cat_name', 'cat_amount'] },
    { id: 'cat_name', component: 'Text', variant: 'body', text: { path: 'category' } },
    { id: 'cat_amount', component: 'Text', variant: 'caption', text: { path: 'amountLabel' } },
    { id: 'cat_bar', component: 'Bar', value: { path: 'pct' }, tone: { path: 'tone' } },
  );
  if (income !== undefined) {
    const remaining = income - allocatedTotal;
    children.push('divider_1', 'remaining_row');
    components.push(
      { id: 'divider_1', component: 'Divider' },
      { id: 'remaining_row', component: 'Row', justify: 'between', children: ['remaining_label', 'remaining_value'] },
      { id: 'remaining_label', component: 'Text', variant: 'h3', text: remaining >= 0 ? 'Unallocated' : 'Over your income' },
      { id: 'remaining_value', component: 'Text', variant: 'h3', text: inr(Math.abs(remaining)) },
    );
  }

  return [
    createSurface(surfaceId, 'Budget', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    updateData(surfaceId, '/categories', rows),
  ];
}

/** A single logged expense — confirms what was recorded and shows that
 * category's updated month-to-date status, so the effect of the message is
 * immediately visible without a separate "show my budget" follow-up. */
export function expenseLoggedSurface(
  surfaceId: string, amount: number, category: string, note: string | undefined, status: CategoryStatus
): Envelope[] {
  const pct = status.limit ? Math.min(100, Math.round((status.spent / status.limit) * 100)) : 0;
  return [
    createSurface(surfaceId, 'Expense Logged', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', gap: 12, children: ['head', 'line', 'cat_top', 'cat_bar'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Expense logged' },
          { id: 'line', component: 'Text', variant: 'body', text: `${inr(amount)} · ${category}${note ? ` · ${note}` : ''}` },
          { id: 'cat_top', component: 'Row', justify: 'between', children: ['cat_label', 'cat_amount'] },
          { id: 'cat_label', component: 'Text', variant: 'caption', text: `${category} this month` },
          {
            id: 'cat_amount', component: 'Text', variant: 'caption',
            text: status.limit ? `${inr(status.spent)} / ${inr(status.limit)}` : inr(status.spent),
          },
          { id: 'cat_bar', component: 'Bar', value: pct, tone: toneForSpend(status) },
        ],
      },
    },
  ];
}

/** One savings goal's progress — reached via "save X for Y" or a follow-up
 * "add X to my Y fund" contribution. */
export function savingsGoalSurface(surfaceId: string, goal: GoalSummary): Envelope[] {
  const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((goal.savedAmount / goal.targetAmount) * 100)) : 0;
  const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);

  const children = ['head', 'goal_bar', 'goal_meta'];
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 12, children },
    { id: 'head', component: 'Text', variant: 'h2', text: goal.name },
    {
      id: 'goal_bar', component: 'Bar', value: pct, tone: pct >= 100 ? 'success' : 'brand',
      label: `${inr(goal.savedAmount)} of ${inr(goal.targetAmount)} (${pct}%)`,
    },
    {
      id: 'goal_meta', component: 'Text', variant: 'caption',
      text: pct >= 100 ? 'Goal reached! 🎉' : `${inr(remaining)} left to go`,
    },
  ];
  if (goal.targetDate) {
    children.push('goal_date');
    components.push({ id: 'goal_date', component: 'Text', variant: 'caption', text: `Target date: ${formatAppointmentDate(goal.targetDate)}` });
  }

  return [
    createSurface(surfaceId, 'Savings Goal', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** "Show my savings goals" — every goal at once, each with its own bar. */
export function savingsGoalsListSurface(surfaceId: string, goals: GoalSummary[]): Envelope[] {
  const rows = goals.map((g) => {
    const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100)) : 0;
    return {
      name: g.name, pct, tone: pct >= 100 ? 'success' : 'brand',
      metaLabel: `${inr(g.savedAmount)} of ${inr(g.targetAmount)} (${pct}%)`,
    };
  });

  return [
    createSurface(surfaceId, 'Savings Goals', '#f25011'),
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['head', 'list'] },
          { id: 'head', component: 'Text', variant: 'h2', text: 'Savings Goals' },
          { id: 'list', component: 'List', layout: 'grid', children: { path: '/goals', componentId: 'goal_row' } },
          { id: 'goal_row', component: 'Column', gap: 4, panel: true, children: ['goal_name', 'goal_bar_row', 'goal_meta'] },
          { id: 'goal_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
          { id: 'goal_bar_row', component: 'Bar', value: { path: 'pct' }, tone: { path: 'tone' } },
          { id: 'goal_meta', component: 'Text', variant: 'caption', text: { path: 'metaLabel' } },
        ],
      },
    },
    updateData(surfaceId, '/goals', rows),
  ];
}

/** "How much have I spent this month" / "biggest category" / "compare this
 * month vs last month" — a ranked breakdown (biggest category naturally
 * sorts to the top, answering that question just by looking), with an
 * optional vs-last-month delta line. */
export function financeSummarySurface(
  surfaceId: string, periodLabel: string, categories: CategoryStatus[], totalSpent: number,
  compare?: { current: number; previous: number }
): Envelope[] {
  const rows = [...categories]
    .sort((a, b) => b.spent - a.spent)
    .map((c) => ({
      category: c.category, amountLabel: inr(c.spent),
      pct: totalSpent > 0 ? Math.round((c.spent / totalSpent) * 100) : 0,
    }));

  const children = ['head'];
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children },
    { id: 'head', component: 'Text', variant: 'h2', text: periodLabel },
  ];
  if (compare) {
    const diff = compare.current - compare.previous;
    const diffLabel = diff === 0 ? 'Same total as last month' : `${diff > 0 ? '+' : '-'}${inr(Math.abs(diff))} vs last month`;
    children.push('compare_line');
    components.push({ id: 'compare_line', component: 'Text', variant: 'caption', text: diffLabel });
  }
  children.push('total_row');
  components.push(
    { id: 'total_row', component: 'Row', justify: 'between', children: ['total_label', 'total_value'] },
    { id: 'total_label', component: 'Text', variant: 'h3', text: 'Total spent' },
    { id: 'total_value', component: 'Text', variant: 'h3', text: inr(totalSpent) },
  );
  if (rows.length) {
    children.push('divider_1', 'list');
    components.push(
      { id: 'divider_1', component: 'Divider' },
      { id: 'list', component: 'List', children: { path: '/categories', componentId: 'sum_row' } },
      { id: 'sum_row', component: 'Column', gap: 4, children: ['sum_top', 'sum_bar'] },
      { id: 'sum_top', component: 'Row', justify: 'between', children: ['sum_name', 'sum_amount'] },
      { id: 'sum_name', component: 'Text', variant: 'body', text: { path: 'category' } },
      { id: 'sum_amount', component: 'Text', variant: 'caption', text: { path: 'amountLabel' } },
      { id: 'sum_bar', component: 'Bar', value: { path: 'pct' }, tone: 'brand' },
    );
  }

  return [
    createSurface(surfaceId, 'Spending Summary', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    ...(rows.length ? [updateData(surfaceId, '/categories', rows)] : []),
  ];
}

/* ---- Dashboard widget "blocks" ----
 * Each builder below returns the ids/components (and, for List-driven
 * ones, the data rows) for ONE self-contained widget — reused both by
 * portfolioSurface (which strings several together in one Card) and by
 * the standalone single-widget surfaces further down, so "give me my
 * portfolio" and "give me my expenses breakdown" render the identical
 * pie, not two different implementations that could drift apart. */

interface Block {
  ids: string[];
  components: ComponentDef[];
}

function statsTilesBlock(
  income: number | undefined, expenseTotal: number, expenseSource: 'budget' | 'actual', savingsRate: number | undefined
): Block {
  if (income === undefined) {
    return {
      ids: ['no_income_line'],
      components: [{ id: 'no_income_line', component: 'Text', variant: 'body', text: `Spent so far this month: ${inr(expenseTotal)}` }],
    };
  }
  const disposable = income - expenseTotal;
  const statChildren = ['stat_income', 'stat_expense', 'stat_disposable'];
  const components: ComponentDef[] = [
    { id: 'stats_row', component: 'Row', gap: 10, justify: 'between', children: statChildren },
    { id: 'stat_income', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_income_label', 'stat_income_value'] },
    { id: 'stat_income_label', component: 'Text', variant: 'caption', text: 'Income' },
    { id: 'stat_income_value', component: 'Text', variant: 'h3', text: inr(income) },
    { id: 'stat_expense', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_expense_label', 'stat_expense_value'] },
    { id: 'stat_expense_label', component: 'Text', variant: 'caption', text: expenseSource === 'budget' ? 'Budgeted' : 'Spent' },
    { id: 'stat_expense_value', component: 'Text', variant: 'h3', text: inr(expenseTotal) },
    { id: 'stat_disposable', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_disposable_label', 'stat_disposable_value'] },
    { id: 'stat_disposable_label', component: 'Text', variant: 'caption', text: disposable >= 0 ? 'Net savings' : 'Over budget' },
    { id: 'stat_disposable_value', component: 'Text', variant: 'h3', text: inr(Math.abs(disposable)) },
  ];
  if (savingsRate !== undefined) {
    statChildren.push('stat_rate');
    components.push(
      { id: 'stat_rate', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_rate_label', 'stat_rate_value'] },
      { id: 'stat_rate_label', component: 'Text', variant: 'caption', text: 'Savings rate' },
      { id: 'stat_rate_value', component: 'Text', variant: 'h3', text: `${savingsRate}%` },
    );
  }
  return { ids: ['stats_row'], components };
}

/** "Income vs Expenses" — supersedes an expenses-only bar chart with a
 * real two-series comparison; income is the current figure repeated
 * across months (see CashFlowPoint's own comment), expenses are real. */
function cashFlowBlock(cashFlow: CashFlowPoint[], title: string): Block | null {
  if (!cashFlow.some((c) => c.income > 0 || c.expenses > 0)) return null;
  return {
    ids: ['cashflow_label', 'cashflow'],
    components: [
      { id: 'cashflow_label', component: 'Text', variant: 'h3', text: title },
      {
        id: 'cashflow', component: 'AreaChart', data: cashFlow, index: 'label', categories: ['income', 'expenses'],
        config: { income: { label: 'Income' }, expenses: { label: 'Expenses' } },
      },
    ],
  };
}

/** "Where it went" — falls back to the budget allocation itself when
 * there's no logged spend yet (see the usingBudgetForPie flag), so a
 * brand-new budget doesn't render an empty pie. */
function expensesBreakdownBlock(categories: CategoryStatus[], titleOverride?: string): (Block & { usingBudgetForPie: boolean }) | null {
  const spentRows = categories.filter((c) => c.spent > 0);
  const usingBudgetForPie = spentRows.length === 0 && categories.some((c) => c.limit);
  const pieSourceRows = usingBudgetForPie ? categories.filter((c) => c.limit) : spentRows;
  if (!pieSourceRows.length) return null;
  const pieRows = pieSourceRows.map((c) => {
    const amount = usingBudgetForPie ? c.limit! : c.spent;
    return { label: c.category, value: amount, amountLabel: inr(amount) };
  });
  return {
    ids: ['pie_label', 'pie'],
    components: [
      { id: 'pie_label', component: 'Text', variant: 'h3', text: titleOverride ?? (usingBudgetForPie ? 'Budget allocation' : 'Where it went') },
      { id: 'pie', component: 'Pie', data: pieRows },
    ],
    usingBudgetForPie,
  };
}

/** A single-ring gauge — "62% of this month's budget used." Nothing to
 * show without an actual limit to measure spend against. */
function budgetUtilizationBlock(pct: number, spent: number, limit: number, title: string): Block | null {
  if (limit <= 0) return null;
  return {
    ids: ['gauge_label', 'gauge', 'gauge_caption'],
    components: [
      { id: 'gauge_label', component: 'Text', variant: 'h3', text: title },
      { id: 'gauge', component: 'Gauge', value: pct, label: 'Used' },
      { id: 'gauge_caption', component: 'Text', variant: 'caption', text: `${inr(spent)} of ${inr(limit)} this month` },
    ],
  };
}


/** The last few logged expenses, newest first. */
/** Each row reads name/amount + a thin bar, the same compact pattern the
 * "This Month" summary card already uses for categories — bar length is
 * this transaction's amount relative to the largest one in the list, so
 * even without a budget limit to measure against, size differences are
 * still visible at a glance. The list itself scrolls past a fixed height
 * (see the surface-finance CSS) instead of growing the whole card taller
 * as more transactions come in. */
function recentExpensesBlock(expenses: RecentExpenseRow[], title: string): (Block & { rows: Record<string, unknown>[] }) | null {
  if (!expenses.length) return null;
  const maxAmount = Math.max(...expenses.map((e) => e.amount), 1);
  const rows = expenses.map((e) => ({
    category: e.category,
    amountLabel: inr(e.amount),
    pct: Math.max(4, Math.round((e.amount / maxAmount) * 100)),
    meta: `${formatAppointmentDate(e.date)}${e.note ? ` · ${e.note}` : ''}`,
  }));
  return {
    ids: ['recent_label', 'recent_list'],
    components: [
      { id: 'recent_label', component: 'Text', variant: 'h3', text: title },
      { id: 'recent_list', component: 'List', scroll: true, children: { path: '/recent', componentId: 'recent_row' } },
      { id: 'recent_row', component: 'Column', gap: 4, children: ['recent_top', 'recent_bar', 'recent_meta'] },
      { id: 'recent_top', component: 'Row', justify: 'between', children: ['recent_name', 'recent_amount'] },
      { id: 'recent_name', component: 'Text', variant: 'body', text: { path: 'category' } },
      { id: 'recent_amount', component: 'Text', variant: 'caption', text: { path: 'amountLabel' } },
      { id: 'recent_bar', component: 'Bar', value: { path: 'pct' }, tone: 'brand' },
      { id: 'recent_meta', component: 'Text', variant: 'caption', text: { path: 'meta' } },
    ],
    rows,
  };
}

/** Every goal's progress bar. */
function goalsBlock(goals: GoalSummary[], title: string): (Block & { rows: Record<string, unknown>[] }) | null {
  if (!goals.length) return null;
  const rows = goals.map((g) => {
    const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100)) : 0;
    return { name: g.name, pct, tone: pct >= 100 ? 'success' : 'brand', metaLabel: `${inr(g.savedAmount)} of ${inr(g.targetAmount)} (${pct}%)` };
  });
  return {
    ids: ['goals_label', 'goals_list'],
    components: [
      { id: 'goals_label', component: 'Text', variant: 'h3', text: title },
      { id: 'goals_list', component: 'List', layout: 'grid', children: { path: '/goals', componentId: 'pf_goal_row' } },
      { id: 'pf_goal_row', component: 'Column', gap: 4, panel: true, children: ['pf_goal_name', 'pf_goal_bar', 'pf_goal_meta'] },
      { id: 'pf_goal_name', component: 'Text', variant: 'body', text: { path: 'name' } },
      { id: 'pf_goal_bar', component: 'Bar', value: { path: 'pct' }, tone: { path: 'tone' } },
      { id: 'pf_goal_meta', component: 'Text', variant: 'caption', text: { path: 'metaLabel' } },
    ],
    rows,
  };
}

export interface PortfolioData {
  income?: number;
  expenseTotal: number;
  expenseSource: 'budget' | 'actual';
  categories: CategoryStatus[];
  goals: GoalSummary[];
  savingsRate?: number;
  cashFlow: CashFlowPoint[];
  recentExpenses: RecentExpenseRow[];
}

/** "Give me my portfolio" — a real dashboard grid: a full-width stat-tile
 * row, then every other widget paired two-to-a-row (Cash Flow + Breakdown,
 * Radar + Recent Expenses, Goals on its own), each its own bordered card.
 * Built from the same block builders the standalone single-widget
 * surfaces use below, so "give me my portfolio" and "give me my expenses
 * breakdown" render the identical pie rather than two implementations
 * that could drift apart — only the composition (grid vs. one card)
 * differs here. Budget Utilization stays available as its own standalone
 * widget (see budgetUtilizationSurface) but sat out of the dashboard grid
 * itself, same as the since-removed Budget vs Actual radar — both cut at
 * the user's request in favor of a leaner grid. */
export function portfolioSurface(surfaceId: string, data: PortfolioData): Envelope[] {
  const { income, expenseTotal, expenseSource, categories, goals, savingsRate, cashFlow, recentExpenses } = data;

  const stats = statsTilesBlock(income, expenseTotal, expenseSource, savingsRate);
  const flow = cashFlowBlock(cashFlow, 'Income vs Expenses — last 6 months');
  const pie = expensesBreakdownBlock(categories);
  const recent = recentExpensesBlock(recentExpenses, 'Recent Expenses');
  const goalsW = goalsBlock(goals, 'Goals');

  const children = ['head', ...stats.ids];
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 16, children },
    { id: 'head', component: 'Text', variant: 'h2', text: 'Your Portfolio' },
    ...stats.components,
  ];

  const panels = [
    flow && { id: 'panel_flow', block: flow },
    pie && { id: 'panel_pie', block: pie },
    recent && { id: 'panel_recent', block: recent },
    goalsW && { id: 'panel_goals', block: goalsW },
  ].filter((p): p is { id: string; block: Block } => Boolean(p));

  for (let i = 0; i < panels.length; i += 2) {
    const pair = panels.slice(i, i + 2);
    const rowId = `grid_row_${i}`;
    children.push(rowId);
    // Recent Expenses caps its own list height and scrolls past it (see
    // the surface-finance CSS) — stretching it to match Goals' height
    // anyway would just pad it with empty space below that cap, defeating
    // the point of scrolling instead of growing. Every other pairing still
    // stretches so its two cards read as one even row.
    const align = pair.some((p) => p.id === 'panel_recent') ? 'start' : 'stretch';
    components.push({ id: rowId, component: 'Row', gap: 16, align, grid: true, children: pair.map((p) => p.id) });
    for (const p of pair) {
      components.push({ id: p.id, component: 'Column', gap: 10, panel: true, weight: 1, children: p.block.ids });
      components.push(...p.block.components);
    }
  }

  if (!flow && !pie) {
    children.push('no_spend_hint');
    components.push({
      id: 'no_spend_hint', component: 'Text', variant: 'caption',
      text: 'Log an expense (e.g. "spent 500 on groceries") to see a spending trend and category breakdown here.',
    });
  }

  const dataEnvelopes: Envelope[] = [];
  if (recent) dataEnvelopes.push(updateData(surfaceId, '/recent', recent.rows));
  if (goalsW) dataEnvelopes.push(updateData(surfaceId, '/goals', goalsW.rows));

  return [
    createSurface(surfaceId, 'Portfolio', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    ...dataEnvelopes,
  ];
}

/** "Give me my expenses breakdown" — the category pie alone. The block's
 * own sub-label ("Where it went" vs "Budget allocation") stays under the
 * screen's own "Expenses Breakdown" heading — it says which data source
 * is shown, not a repeat of the same title. */
export function expensesBreakdownSurface(surfaceId: string, categories: CategoryStatus[], _expenseSource: 'budget' | 'actual'): Envelope[] {
  const pie = expensesBreakdownBlock(categories);
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children: ['head', ...(pie ? pie.ids : ['no_data'])] },
    { id: 'head', component: 'Text', variant: 'h2', text: 'Expenses Breakdown' },
    ...(pie ? pie.components : [{ id: 'no_data', component: 'Text', variant: 'body', text: "You don't have any budget or spending logged yet." } as ComponentDef]),
  ];
  return [
    createSurface(surfaceId, 'Expenses Breakdown', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** "Show my income vs expenses trend" / "cash flow" — the area chart alone. */
export function cashFlowSurface(surfaceId: string, cashFlow: CashFlowPoint[]): Envelope[] {
  const flow = cashFlowBlock(cashFlow, 'Cash Flow');
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children: flow ? flow.ids : ['no_data'] },
    ...(flow ? flow.components : [{ id: 'no_data', component: 'Text', variant: 'body', text: "I don't have enough history yet." } as ComponentDef]),
  ];
  return [
    createSurface(surfaceId, 'Cash Flow', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** "How much of my budget have I used" — the gauge alone. */
export function budgetUtilizationSurface(surfaceId: string, pct: number, spent: number, limit: number): Envelope[] {
  const gauge = budgetUtilizationBlock(pct, spent, limit, 'Budget Utilization');
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children: gauge ? gauge.ids : ['no_data'] },
    ...(gauge ? gauge.components : [{ id: 'no_data', component: 'Text', variant: 'body', text: "You haven't set a budget yet." } as ComponentDef]),
  ];
  return [
    createSurface(surfaceId, 'Budget Utilization', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** "Give me my recent expenses" / "show my transactions" — the list alone. */
export function recentExpensesSurface(surfaceId: string, expenses: RecentExpenseRow[]): Envelope[] {
  const recent = recentExpensesBlock(expenses, 'Recent Expenses');
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children: recent ? recent.ids : ['no_data'] },
    ...(recent ? recent.components : [{ id: 'no_data', component: 'Text', variant: 'body', text: "You haven't logged any expenses yet." } as ComponentDef]),
  ];
  return [
    createSurface(surfaceId, 'Recent Expenses', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    ...(recent ? [updateData(surfaceId, '/recent', recent.rows)] : []),
  ];
}

/** "Give me my goals analysis" / "how do I achieve my emergency fund goal"
 * — per-goal required-monthly-savings math (server.ts does the actual
 * arithmetic; this only renders it), plus, when the goals don't jointly
 * fit inside disposable income, both an expense-cut suggestion and a
 * timeline-extension suggestion side by side — never applied automatically,
 * just shown, matching the rest of this agent's read-only-analysis stance. */
export function goalsAnalysisSurface(
  surfaceId: string,
  income: number | undefined, expenseTotal: number, expenseSource: 'budget' | 'actual', disposable: number | undefined,
  goals: GoalPlanItem[], totalRequired: number, feasible: boolean | undefined, shortfall: number | undefined, surplus: number | undefined,
  cuts: { category: string; cutBy: number }[] | undefined, extensions: { name: string; newMonths: number; newDate: string }[] | undefined,
  singleGoalName: string | undefined, notFoundName: string | undefined
): Envelope[] {
  const title = singleGoalName ? `Achieving: ${singleGoalName}` : 'Goals Analysis';

  if (notFoundName) {
    return [
      createSurface(surfaceId, 'Goals Analysis', '#f25011'),
      {
        version: A2UI_VERSION,
        updateComponents: {
          surfaceId,
          components: [
            { id: 'root', component: 'Card', child: 'body' },
            { id: 'body', component: 'Column', gap: 8, children: ['head', 'line'] },
            { id: 'head', component: 'Text', variant: 'h2', text: 'Goal not found' },
            { id: 'line', component: 'Text', variant: 'body', text: `You don't have a goal called "${notFoundName}" yet.` },
          ],
        },
      },
    ];
  }

  const goalRows = goals.map((g) => ({
    name: g.name,
    remainingLabel: `${inr(g.remaining)} left of ${inr(g.targetAmount)}`,
    dateLabel: g.assumedTimeline
      ? `Assuming ${g.monthsRemaining} months (no date set)`
      : g.targetDate ? `By ${formatAppointmentDate(g.targetDate)}` : 'No target date set',
    requiredLabel: g.requiredMonthly !== null ? `${inr(g.requiredMonthly)}/month needed` : 'Set a target date to calculate a monthly figure',
  }));

  const children = ['head'];
  const components: ComponentDef[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', gap: 14, children },
    { id: 'head', component: 'Text', variant: 'h2', text: title },
  ];

  if (income !== undefined && disposable !== undefined) {
    children.push('stats_row');
    components.push(
      { id: 'stats_row', component: 'Row', gap: 10, justify: 'between', children: ['stat_income', 'stat_expense', 'stat_disposable'] },
      { id: 'stat_income', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_income_label', 'stat_income_value'] },
      { id: 'stat_income_label', component: 'Text', variant: 'caption', text: 'Income' },
      { id: 'stat_income_value', component: 'Text', variant: 'h3', text: inr(income) },
      { id: 'stat_expense', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_expense_label', 'stat_expense_value'] },
      { id: 'stat_expense_label', component: 'Text', variant: 'caption', text: expenseSource === 'budget' ? 'Budgeted' : 'Spent' },
      { id: 'stat_expense_value', component: 'Text', variant: 'h3', text: inr(expenseTotal) },
      { id: 'stat_disposable', component: 'Column', gap: 2, panel: true, weight: 1, children: ['stat_disposable_label', 'stat_disposable_value'] },
      { id: 'stat_disposable_label', component: 'Text', variant: 'caption', text: 'Available to save' },
      { id: 'stat_disposable_value', component: 'Text', variant: 'h3', text: inr(disposable) },
      { id: 'divider_stats', component: 'Divider' },
    );
    children.push('divider_stats');
  } else {
    children.push('no_income_line');
    components.push({ id: 'no_income_line', component: 'Text', variant: 'body', text: "Tell me your monthly income too so I can check what's achievable." });
  }

  if (goalRows.length) {
    children.push('list');
    components.push(
      { id: 'list', component: 'List', layout: 'grid', children: { path: '/goals', componentId: 'ga_row' } },
      { id: 'ga_row', component: 'Column', gap: 3, panel: true, children: ['ga_name', 'ga_remaining', 'ga_date', 'ga_required'] },
      { id: 'ga_name', component: 'Text', variant: 'h3', text: { path: 'name' } },
      { id: 'ga_remaining', component: 'Text', variant: 'caption', text: { path: 'remainingLabel' } },
      { id: 'ga_date', component: 'Text', variant: 'caption', text: { path: 'dateLabel' } },
      { id: 'ga_required', component: 'Text', variant: 'body', text: { path: 'requiredLabel' } },
    );
  } else {
    children.push('no_goals_line');
    components.push({ id: 'no_goals_line', component: 'Text', variant: 'body', text: 'You don\'t have any savings goals yet — try "save 50000 for a laptop by December".' });
  }

  if (feasible !== undefined && goalRows.length) {
    children.push('divider_verdict', 'verdict_row');
    components.push(
      { id: 'divider_verdict', component: 'Divider' },
      { id: 'verdict_row', component: 'Row', justify: 'between', children: ['verdict_label', 'verdict_value'] },
      { id: 'verdict_label', component: 'Text', variant: 'h3', text: feasible ? 'On track' : 'Short by (per month)' },
      {
        id: 'verdict_value', component: 'Text', variant: 'h3',
        text: feasible ? `+${inr(surplus || 0)} spare` : inr(shortfall || 0),
      },
    );

    if (!feasible && ((cuts && cuts.length) || (extensions && extensions.length))) {
      // Both suggestions used to always render inline, stacked one under
      // the other — a lot of vertical space spent on something the user
      // hasn't asked to see yet. Gated behind a click (DisclosureNode,
      // pure client-side reveal — the content is already in this same
      // envelope) and, once opened, laid out side by side instead of
      // stacked.
      children.push('options_disclosure');
      components.push({ id: 'options_disclosure', component: 'Disclosure', label: 'Show ways to close the gap', child: 'options_grid' });

      const optionCols: string[] = [];
      if (cuts && cuts.length) {
        optionCols.push('cuts_panel');
        components.push(
          { id: 'cuts_panel', component: 'Column', gap: 8, panel: true, weight: 1, children: ['cuts_label', 'cuts_list'] },
          { id: 'cuts_label', component: 'Text', variant: 'h3', text: 'Option 1 — trim expenses' },
          { id: 'cuts_list', component: 'List', children: { path: '/cuts', componentId: 'cut_row' } },
          { id: 'cut_row', component: 'Text', variant: 'body', text: { path: 'line' } },
        );
      }
      if (extensions && extensions.length) {
        optionCols.push('ext_panel');
        components.push(
          { id: 'ext_panel', component: 'Column', gap: 8, panel: true, weight: 1, children: ['ext_label', 'ext_list'] },
          { id: 'ext_label', component: 'Text', variant: 'h3', text: 'Option 2 — extend the timeline' },
          { id: 'ext_list', component: 'List', children: { path: '/extensions', componentId: 'ext_row' } },
          { id: 'ext_row', component: 'Text', variant: 'body', text: { path: 'line' } },
        );
      }
      components.push({ id: 'options_grid', component: 'Row', gap: 16, align: 'stretch', children: optionCols });
    }
  }

  const dataEnvelopes: Envelope[] = [];
  if (goalRows.length) dataEnvelopes.push(updateData(surfaceId, '/goals', goalRows));
  if (!feasible && cuts && cuts.length) dataEnvelopes.push(updateData(surfaceId, '/cuts', cuts.map((c) => ({ line: `Cut ${c.category} by ${inr(c.cutBy)}/month` }))));
  if (!feasible && extensions && extensions.length) {
    dataEnvelopes.push(updateData(surfaceId, '/extensions', extensions.map((e) => ({ line: `${e.name}: push the date to ${formatAppointmentDate(e.newDate)} (${e.newMonths} months)` }))));
  }

  return [
    createSurface(surfaceId, 'Goals Analysis', '#f25011'),
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    ...dataEnvelopes,
  ];
}

/**
 * Phase 0 baseline: dumps every canonical surface's hand-written envelope
 * tree to goldens/*.json, from fixed mock data.
 *
 * These files are the yardstick the LLM-generated layouts (uiAgent) get
 * scored against — structural similarity, binding validity, component mix.
 * Regenerate only when a golden layout deliberately changes; a surprise
 * diff here means a hand-written screen moved under our feet.
 *
 * Run: npx tsx src/tools/golden.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  flightsSurface, hotelsSurface, roomsSurface, tripSummarySurface,
  doctorsSurface, doctorBookingFormSurface, portfolioSurface,
  myRecordsSurface, appointmentsSurface,
} from '../orchestrator/envelopes';
import { mockFlights, mockHotels } from '../mock/data';
import { getDoctorMatches } from '../agents/health';
import type { FlightOption } from '../types';

const DATE = '2026-09-10';
const flights: FlightOption[] = mockFlights('Hyderabad', 'Goa')
  .map((f, i) => ({ ...f, date: DATE, recommended: i === 0 }));
const hotels = mockHotels('Goa');
const doctors = getDoctorMatches('cardiologist');

const SURFACES: Record<string, unknown> = {
  flights: flightsSurface('flights', flights),
  hotels: hotelsSurface('hotels', hotels),
  rooms: roomsSurface('hotels', hotels[0], {
    checkIn: DATE, checkOut: '2026-09-13', adults: 2, children: 0,
  }, hotels[0].rooms[1].id),
  trip: tripSummarySurface('trip', {
    destination: 'Goa', origin: 'Hyderabad', nights: 3,
    flight: flights[0], hotel: hotels[0], room: hotels[0].rooms[1],
    checkIn: DATE, checkOut: '2026-09-13', adults: 2, children: 0,
    taxesAndFees: 1840, totalPrice: 24_500, bookingRef: 'PRZ-4821',
    passengerNames: ['Asha Rao', 'Vikram Rao'], guestName: 'Asha Rao',
  }),
  doctors: doctorsSurface('health', 'Cardiologist', doctors),
  doctorBookingForm: doctorBookingFormSurface('health', doctors[0], 'chest tightness'),
  portfolio: portfolioSurface('finance', {
    income: 180_000, expenseTotal: 96_400, expenseSource: 'actual', savingsRate: 46,
    categories: [
      { category: 'Rent', spent: 38_000, limit: 40_000 },
      { category: 'Food', spent: 21_400, limit: 18_000 },
      { category: 'Travel', spent: 19_000, limit: 25_000 },
      { category: 'Utilities', spent: 11_000, limit: 12_000 },
      { category: 'Health', spent: 7_000, limit: 10_000 },
    ],
    goals: [
      { name: 'Emergency fund', targetAmount: 300_000, savedAmount: 145_000, targetDate: '2027-03-01' },
      { name: 'Japan trip', targetAmount: 250_000, savedAmount: 40_000, targetDate: '2027-10-01' },
    ],
    cashFlow: [
      { label: 'Apr', income: 180_000, expenses: 91_000 },
      { label: 'May', income: 180_000, expenses: 104_000 },
      { label: 'Jun', income: 186_000, expenses: 88_000 },
      { label: 'Jul', income: 180_000, expenses: 99_500 },
      { label: 'Aug', income: 180_000, expenses: 93_200 },
      { label: 'Sep', income: 192_000, expenses: 96_400 },
    ],
    recentExpenses: [
      { category: 'Food', amount: 1_240, note: 'Groceries', date: '2026-09-02' },
      { category: 'Travel', amount: 3_400, note: 'Cab to airport', date: '2026-09-01' },
      { category: 'Health', amount: 900, note: null, date: '2026-08-29' },
    ],
  }),
  myRecords: myRecordsSurface('records', 'Your saved plans', [
    {
      id: 'p1', title: 'Goa long weekend', destination: 'Goa', imageUrl: null,
      createdAt: '2026-08-20T10:00:00Z', totalPrice: 24_500, bookingRef: 'PRZ-4821',
      travelDate: DATE, hasFlight: true, hasRoom: true,
    },
    {
      id: 'p2', title: 'Jaipur heritage run', destination: 'Jaipur', imageUrl: null,
      createdAt: '2026-07-11T09:30:00Z', totalPrice: 18_200, travelDate: null,
      hasFlight: true, hasRoom: false,
    },
  ]),
  appointments: appointmentsSurface('appointments', 'Your upcoming appointments', [
    {
      id: 'a1', doctorName: doctors[0].name, specialty: doctors[0].specialty,
      hospitalName: doctors[0].hospital.name, patientName: 'Asha Rao',
      preferredDate: '2026-09-18', preferredTime: '11:30 AM',
      appointmentRef: 'APT-2261', createdAt: '2026-09-01T08:00:00Z',
    },
  ]),
};

const dir = join(__dirname, '../../goldens');
mkdirSync(dir, { recursive: true });
for (const [name, envelopes] of Object.entries(SURFACES)) {
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(envelopes, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(SURFACES).length} goldens to ${dir}`);

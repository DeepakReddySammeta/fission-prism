import jsPDF from 'jspdf';
import type { TripSummary } from './types';

/** jsPDF's default fonts (WinAnsi-encoded Helvetica/Times/Courier) can't
 * render ₹ or → — they come out as garbled tofu glyphs and throw off the
 * whole line's kerning. Swap them for safe ASCII before anything hits the
 * PDF; strip emoji the same way the old version did. */
function sanitize(s: string): string {
  return s
    .replace(/₹/g, 'Rs. ')
    .replace(/→/g, ' to ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function imageToDataUrl(url: string): Promise<string | null> {
  try {
    const withFormat = `${url}${url.includes('?') ? '&' : '?'}fm=jpg`;
    const res = await fetch(withFormat);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null; // the embedded photo is a nice-to-have, never block the PDF on it
  }
}

function fmtOccupancy(trip: TripSummary): string {
  const adults = trip.adults ?? 2;
  const bits = [`${adults} adult${adults > 1 ? 's' : ''}`];
  if (trip.children) bits.push(`${trip.children} child${trip.children > 1 ? 'ren' : ''}`);
  return bits.join(', ');
}

/** Fetches the session's structured trip data directly (the live 'trip'
 * A2UI surface only carries pre-rendered display strings, not the
 * underlying FlightOption/HotelOption/RoomOption objects) and builds a
 * branded multi-section summary: header banner, a trip overview line, then
 * flights (with a flight-themed photo) followed by the stay (with a photo of
 * the actual room/hotel booked) — always in that order, since a room can't
 * be reached without picking a flight first — and a prominent total. */
export async function downloadTripPdf(sessionId: string, apiBase: string) {
  const res = await fetch(`${apiBase}/api/trip/${sessionId}`);
  if (!res.ok) throw new Error('Could not load trip details');
  const trip: TripSummary & {
    imageUrl?: string | null;
    flightImageUrl?: string | null;
    flightDetails?: { cabin: string; baggageKg: number; aircraft: string; layoverCity: string | null } | null;
    returnFlightDetails?: { cabin: string; baggageKg: number; aircraft: string; layoverCity: string | null } | null;
    hotelDetails?: { propertyType: string; reviewCount: number; ratingBreakdown: Record<string, number> } | null;
  } = await res.json();

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const footerReserve = 24;
  let y: number;

  // A round trip + hotel + room summary (two photos, several sections) can
  // run past a single A4 page — jsPDF never paginates on its own, so without
  // this a long itinerary would silently overlap or run under the footer.
  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - footerReserve) {
      doc.addPage();
      y = margin + 6;
    }
  };

  // ---- Header banner ---- ("Cool and Collected" palette: deep teal + rust accent)
  doc.setFillColor(2, 73, 80);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFillColor(150, 71, 52);
  doc.rect(0, 34, pageWidth, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(19);
  doc.text('Prism', margin, 17);
  doc.setFontSize(10);
  doc.setTextColor(175, 221, 229);
  doc.text('Trip Summary', margin, 25);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleDateString()}`, pageWidth - margin, 17, { align: 'right' });

  // ---- Trip overview ----
  y = 48;
  doc.setFontSize(18);
  doc.setTextColor(18, 41, 44);
  doc.text(sanitize(`Trip to ${trip.destination || ''}`), margin, y);
  y += 8;

  const overviewBits = [
    trip.origin ? `${trip.origin} to ${trip.destination}` : trip.destination,
    trip.nights ? `${trip.nights} night${trip.nights > 1 ? 's' : ''}` : '',
    trip.checkIn && trip.checkOut ? `${fmtDate(trip.checkIn)} - ${fmtDate(trip.checkOut)}` : '',
    trip.adults ? fmtOccupancy(trip) : '',
  ].filter(Boolean);
  if (overviewBits.length) {
    doc.setFontSize(11);
    doc.setTextColor(92, 125, 129);
    doc.text(sanitize(overviewBits.join('  ·  ')), margin, y);
    y += 10;
  } else {
    y += 2;
  }

  const divider = () => {
    doc.setDrawColor(207, 230, 233);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;
  };

  // Capped by height (not stretched full-width) — a full-bleed width-derived
  // image ran far too tall on an A4 page, pushing later sections + the total
  // banner down far enough to collide with the fixed-position footer. 78mm
  // (up from the original 50mm) is the tallest that still leaves room for a
  // flight + hotel photo plus every section on one page in the common case;
  // ensureSpace/addPage below still cover the case where it doesn't.
  // Space for the photo AND its immediately-following section is reserved
  // together (see photoSection below) so a page break can never land between
  // a picture and the caption it belongs to.
  const addPhoto = async (url: string) => {
    const dataUrl = await imageToDataUrl(url);
    if (!dataUrl) return;
    const maxContentW = pageWidth - margin * 2;
    let imgH = 78;
    let imgW = imgH * (800 / 520);
    if (imgW > maxContentW) { imgW = maxContentW; imgH = imgW * (520 / 800); }
    const imgX = margin + (maxContentW - imgW) / 2;
    try {
      doc.addImage(dataUrl, 'JPEG', imgX, y, imgW, imgH, undefined, 'FAST');
      y += imgH + 10;
    } catch {
      // malformed image data — skip it rather than break the whole export
    }
  };

  const section = (label: string, lines: string[]) => {
    if (!lines.length) return;
    ensureSpace(10 + 7 + lines.length * 7);
    divider();
    doc.setFillColor(150, 71, 52);
    doc.circle(margin + 1, y - 3, 1.2, 'F');
    doc.setFontSize(10);
    doc.setTextColor(92, 125, 129);
    doc.text(label.toUpperCase(), margin + 6, y);
    y += 7;
    doc.setFontSize(12);
    doc.setTextColor(18, 41, 44);
    for (const line of lines) {
      doc.text(sanitize(line), margin, y);
      y += 7;
    }
  };

  const photoSection = async (url: string | null | undefined, label: string, lines: string[]) => {
    if (!lines.length) return;
    ensureSpace((url ? 88 : 0) + 10 + 7 + lines.length * 7);
    if (url) await addPhoto(url);
    section(label, lines);
  };

  // Flights always come before rooms — a room can't be reached in the app
  // without first picking (and confirming) a flight, so the summary mirrors
  // that order rather than showing whichever the API happened to return first.
  if (trip.flight) {
    const f = trip.flight;
    const fd = trip.flightDetails;
    await photoSection(trip.flightImageUrl, 'Outbound flight', [
      `${f.airline} ${f.flightNumber}${f.date ? `  |  ${fmtDate(f.date)}` : ''}`,
      `${f.from} to ${f.to}  |  ${f.departTime} to ${f.arriveTime}  |  ${fmtDuration(f.durationMins)}`,
      `${f.stops === 0 ? 'Direct' : `${f.stops} stop(s)`}${fd?.layoverCity ? ` via ${fd.layoverCity}` : ''}  |  Rs. ${f.price}`,
      fd ? `${fd.cabin} class  |  ${fd.aircraft}  |  ${fd.baggageKg}kg baggage` : '',
    ].filter(Boolean));
    if (trip.returnFlight) {
      const rf = trip.returnFlight;
      const rfd = trip.returnFlightDetails;
      section('Return flight', [
        `${rf.airline} ${rf.flightNumber}${trip.returnDate ? `  |  ${fmtDate(trip.returnDate)}` : ''}`,
        `${rf.from} to ${rf.to}  |  ${rf.departTime} to ${rf.arriveTime}  |  ${fmtDuration(rf.durationMins)}`,
        `${rf.stops === 0 ? 'Direct' : `${rf.stops} stop(s)`}${rfd?.layoverCity ? ` via ${rfd.layoverCity}` : ''}  |  Rs. ${rf.price}`,
        rfd ? `${rfd.cabin} class  |  ${rfd.aircraft}  |  ${rfd.baggageKg}kg baggage` : '',
      ].filter(Boolean));
    }
    if (trip.passengerNames?.length) {
      section(trip.passengerNames.length > 1 ? 'Travelers' : 'Traveler', trip.passengerNames);
    } else if (trip.passengerName) {
      section('Traveler', [
        trip.passengerName + (trip.passengerEmail ? `  |  ${trip.passengerEmail}` : ''),
      ]);
    }
  }

  if (trip.hotel) {
    const hd = trip.hotelDetails;
    await photoSection(trip.imageUrl, 'Hotel', [
      trip.hotel.name,
      `${trip.hotel.area}  |  ${trip.hotel.rating.toFixed(1)} star rating${hd ? ` (${hd.reviewCount} reviews)` : ''}`,
      hd ? `${hd.propertyType}  |  Facilities ${hd.ratingBreakdown.facilities}, Cleanliness ${hd.ratingBreakdown.cleanliness}, Service ${hd.ratingBreakdown.service}` : '',
    ].filter(Boolean));
  }

  if (trip.room) {
    const stay = trip.checkIn && trip.checkOut ? `  |  ${fmtDate(trip.checkIn)} - ${fmtDate(trip.checkOut)}` : '';
    section('Room', [
      `${trip.room.name}  |  Sleeps ${trip.room.capacity}`,
      `Rs. ${trip.room.price} / night${stay}  |  ${fmtOccupancy(trip)}`,
    ]);
    if (trip.guestName) section('Guest', [trip.guestName]);
  }

  if (trip.totalPrice && trip.taxesAndFees) {
    const subtotal = trip.totalPrice - trip.taxesAndFees;
    section('Price breakdown', [
      `Subtotal  |  Rs. ${subtotal}`,
      `Taxes & fees  |  Rs. ${trip.taxesAndFees}`,
    ]);
  }

  // ---- Total + booking reference ----
  if (trip.totalPrice) {
    ensureSpace(12 + (trip.bookingRef ? 26 : 14));
    y += 12;
    doc.setFillColor(223, 244, 246);
    doc.roundedRect(margin, y - 8, pageWidth - margin * 2, trip.bookingRef ? 26 : 14, 3, 3, 'F');
    doc.setFontSize(15);
    doc.setTextColor(2, 73, 80);
    doc.text(`Total: Rs. ${trip.totalPrice}`, margin + 8, y + 2);
    if (trip.bookingRef) {
      doc.setFontSize(10);
      doc.setTextColor(26, 138, 95);
      doc.text(sanitize(`Booked - confirmation ${trip.bookingRef}`), margin + 8, y + 12);
    }
    y += trip.bookingRef ? 26 : 14;
  }

  // ---- Footer ----
  doc.setDrawColor(207, 230, 233);
  doc.setLineWidth(0.3);
  doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18);
  doc.setFontSize(9);
  doc.setTextColor(92, 125, 129);
  doc.text('Thank you for planning with Prism.', margin, pageHeight - 11);

  doc.save('prism-trip.pdf');
}

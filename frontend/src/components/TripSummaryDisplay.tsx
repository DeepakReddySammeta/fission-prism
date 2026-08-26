import React from 'react';
import type { TripSummary } from '../types';
import { Badge } from '@/components/ui/badge';

/** Static, read-only rendering of a saved/booked TripSummary — shared by
 * PlanDetail (one saved plan) and MyBookings (a list of confirmed ones), so
 * both stay in sync when a field is added or the layout changes. */
interface Props {
  trip: TripSummary;
  hotelDetails?: { propertyType: string; reviewCount: number } | null;
  flightDetails?: { cabin: string; aircraft: string } | null;
}

export function TripSummaryDisplay({ trip, hotelDetails, flightDetails }: Props) {
  return (
    <div className="a2-column" style={{ gap: 12 }}>
      {trip.flight && (
        <p className="a2-body">
          ✈ {trip.flight.airline} {trip.flight.flightNumber} · {trip.flight.departTime}→{trip.flight.arriveTime} · ₹{trip.flight.price}
          {flightDetails ? ` · ${flightDetails.cabin} · ${flightDetails.aircraft}` : ''}
        </p>
      )}
      {trip.returnFlight && (
        <p className="a2-body">
          ✈ Return: {trip.returnFlight.airline} {trip.returnFlight.flightNumber} · {trip.returnFlight.departTime}→{trip.returnFlight.arriveTime} · ₹{trip.returnFlight.price}
          {trip.returnDate ? ` · ${trip.returnDate}` : ''}
        </p>
      )}
      {trip.passengerName && (
        <p className="a2-caption">Traveler: {trip.passengerName}{trip.passengerEmail ? ` · ${trip.passengerEmail}` : ''}</p>
      )}
      {trip.hotel && (
        <p className="a2-body">
          🏨 {trip.hotel.name} · {trip.hotel.area}
          {hotelDetails ? ` · ${hotelDetails.propertyType} · ${trip.hotel.rating.toFixed(1)}★ (${hotelDetails.reviewCount} reviews)` : ''}
        </p>
      )}
      {trip.room && (
        <p className="a2-body">
          🛏 {trip.room.name} · ₹{trip.room.price}/night
          {trip.checkIn && trip.checkOut ? ` · ${trip.checkIn} → ${trip.checkOut}` : ''}
          {` · ${trip.adults ?? 2} adult${(trip.adults ?? 2) > 1 ? 's' : ''}`}
          {trip.children ? `, ${trip.children} child${trip.children > 1 ? 'ren' : ''}` : ''}
        </p>
      )}
      {trip.guestName && <p className="a2-caption">Guest: {trip.guestName}</p>}
      {trip.taxesAndFees ? (
        <p className="a2-caption">
          Subtotal ₹{(trip.totalPrice || 0) - trip.taxesAndFees} + Taxes &amp; fees ₹{trip.taxesAndFees}
        </p>
      ) : null}
      {trip.totalPrice ? <p className="a2-h3">Total: ₹{trip.totalPrice}</p> : null}
      {trip.bookingRef && <Badge variant="success">Booked · {trip.bookingRef}</Badge>}
    </div>
  );
}

import React from 'react';

/** A +/- traveler-count control — shared between the trip-builder card and
 * the solo flight-confirm form, so adults/children selection looks and
 * behaves identically wherever a booking asks for it. */
export function Stepper({
  label, value, onChange, min = 0,
}: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="stepper">
      <span className="a2-field-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" className="stepper-btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
        <span className="stepper-value">{value}</span>
        <button type="button" className="stepper-btn" onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

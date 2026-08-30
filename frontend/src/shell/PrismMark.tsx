/** The Prism icon — a prism splitting white light into the app's four domains.
 *  Circle ring uses currentColor so it inherits from `.brand-mark`. */
export function PrismMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="38" stroke="currentColor" strokeWidth="3" />
      <line x1="21" y1="28" x2="42" y2="49" stroke="#7F77DD" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="16" y1="49" x2="42" y2="49" stroke="#378ADD" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="20" y1="70" x2="42" y2="49" stroke="#1D9E75" strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="50,32 34,66 66,66" fill="#F25111" />
      <line x1="58" y1="49" x2="84" y2="49" stroke="#F25111" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

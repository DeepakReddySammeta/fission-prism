/**
 * A UUID v4 that works everywhere the app is served, not just in a secure
 * context.
 *
 * `crypto.randomUUID()` is only defined on HTTPS pages or on
 * localhost/127.0.0.1 — served over plain HTTP from an IP or hostname it is
 * `undefined`, and calling it throws, which was blanking the whole app.
 * `crypto.getRandomValues()` has no such restriction, so we build the v4
 * value from it when `randomUUID` is missing; `Math.random` is a last-ditch
 * fallback for environments with no Web Crypto at all (it is not
 * cryptographically strong, but an ID collision here is harmless).
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

import 'server-only';

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Loose but sufficient: rejects obviously-bogus values (empty, non-hex garbage, a bare hostname)
// without reimplementing full RFC 4291 IPv6 validation -- this only needs to bound what can be used
// as a rate-limit bucket identifier, not fully validate a routable address.
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

function isPlausibleIpAddress(value: string): boolean {
  const ipv4Match = value.match(IPV4_PATTERN);
  if (ipv4Match) return ipv4Match.slice(1).every((octet) => Number(octet) <= 255);
  return value.includes(':') && IPV6_PATTERN.test(value);
}

/** Pure resolution logic behind requestOrigin() (lib/security/rate-limit.ts), kept in its own
 * module with no `next/headers` import so it's directly unit-testable without a Next.js request
 * context. isVercelDeployment gates whether X-Forwarded-For/X-Real-IP are trusted at all: Vercel's
 * edge network is this application's only documented deployment topology (docs/07 SS15) and is the
 * sole trusted hop that sets these headers itself, stripping any client-supplied value before it
 * reaches this process. Outside that topology -- local development, a self-hosted instance, or any
 * misconfigured deployment without a trusted proxy in front -- these headers are ordinary,
 * client-controllable request headers with no proxy verifying them, so trusting them would let an
 * attacker forge an arbitrary origin identifier to evade the origin-keyed rate-limit bucket
 * (AUTH-RATE-004). A real browser never sets either header on its own requests, so this only
 * changes behavior for a client that deliberately injects one. */
export function resolveRequestOrigin(forwardedForHeader: string | null, realIpHeader: string | null, isVercelDeployment: boolean): string {
  if (!isVercelDeployment) return 'unknown';
  const candidate = forwardedForHeader?.split(',')[0]?.trim() || realIpHeader?.trim() || null;
  return candidate && isPlausibleIpAddress(candidate) ? candidate : 'unknown';
}

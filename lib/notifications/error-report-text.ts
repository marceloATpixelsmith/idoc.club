// Dependency-free helpers for administrator error notifications (kept apart from the database-backed sender so they can be unit tested).

// A burst of the same failure (a broken page hit by many visitors) must produce one email, not hundreds. The window
// is per server instance, so the worst case is one email per instance per signature per window -- never a flood.
const ERROR_WINDOW_MS = 15 * 60_000;
const ERROR_MAX_PER_HOUR = 20;
const recentErrors = new Map<string, number>();
let hourStart = 0;
let hourCount = 0;

export function shouldSendErrorNotification(signature: string, now = Date.now()): boolean {
  if (now - hourStart > 3_600_000) { hourStart = now; hourCount = 0; }
  for (const [key, at] of recentErrors) if (now - at > ERROR_WINDOW_MS) recentErrors.delete(key);
  if (recentErrors.has(signature) || hourCount >= ERROR_MAX_PER_HOUR) return false;
  recentErrors.set(signature, now);
  hourCount += 1;
  return true;
}
export function resetErrorNotificationThrottleForTests() { recentErrors.clear(); hourStart = 0; hourCount = 0; }

/** Removes query strings and anything that looks like a bearer token, a long hex/base64 secret or an email address from free text. */
export function scrubErrorText(value: string): string {
  return value
    .replace(/(authorization|cookie|set-cookie)\s*[:=]\s*[^\n]+/gi, '$1: [redacted]')
    .replace(/\b(sk|pk|rk|whsec)_(live|test)?_?[A-Za-z0-9]{8,}/g, '[redacted-key]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-token]')
    .replace(/([?&][^=\s&]+)=([^&\s)]+)/g, '$1=[redacted]');
}

export function pathWithoutQuery(value: string | null | undefined): string | null {
  return value ? value.split(/[?#]/)[0].slice(0, 300) : null;
}


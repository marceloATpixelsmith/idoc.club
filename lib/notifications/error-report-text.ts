// Dependency-free helpers for administrator error notifications (kept apart from the database-backed sender so they can be unit tested).

// A burst of the same failure (a broken page hit by many visitors) must produce one email, not hundreds. The window
// is per server instance, so the worst case is one email per instance per signature per window -- never a flood.
// Browser reports come from an anonymous endpoint, so they have their own smaller hourly budget: no volume of them can
// use up the capacity reserved for genuine server exceptions.
const ERROR_WINDOW_MS = 15 * 60_000;
export type ErrorBudget = 'browser' | 'server';
const MAX_PER_HOUR: Record<ErrorBudget, number> = { browser: 5, server: 20 };
const recentErrors = new Map<string, number>();
const hours: Record<ErrorBudget, { count: number; start: number }> = { browser: { count: 0, start: 0 }, server: { count: 0, start: 0 } };

export function shouldSendErrorNotification(signature: string, now = Date.now(), budget: ErrorBudget = 'server'): boolean {
  const hour = hours[budget];
  if (now - hour.start > 3_600_000) { hour.start = now; hour.count = 0; }
  for (const [key, at] of recentErrors) if (now - at > ERROR_WINDOW_MS) recentErrors.delete(key);
  const key = `${budget}|${signature}`;
  if (recentErrors.has(key) || hour.count >= MAX_PER_HOUR[budget]) return false;
  recentErrors.set(key, now);
  hour.count += 1;
  return true;
}
export function resetErrorNotificationThrottleForTests() {
  recentErrors.clear();
  for (const hour of Object.values(hours)) { hour.count = 0; hour.start = 0; }
}

/** Removes what must never reach an administrator mailbox from free-text error output: query strings, bearer
 * tokens, API keys and JWTs, bound SQL parameters, row values echoed by Postgres, password hashes, long hex
 * digests and email addresses. */
export function scrubErrorText(value: string): string {
  return value
    .replace(/(authorization|cookie|set-cookie)\s*[:=]\s*[^\n]+/gi, '$1: [redacted]')
    // Drizzle's query error message is "Failed query: <sql>" followed by a "params: <bound values>" line, and
    // those values can be OTP digests, password hashes or member emails. Placeholders in the SQL stay; values go.
    .replace(/^([ \t]*params[ \t]*:).*$/gim, '$1 [redacted]')
    // Postgres DETAIL lines echo the offending row, e.g. `Key (email)=(someone@example.org) already exists.`
    .replace(/(\([A-Za-z0-9_, ]+\))=\([^\n]*?\)(?=[\s.,]|$)/g, '$1=([redacted])')
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk|pk|rk|whsec)_(live|test)?_?[A-Za-z0-9]{8,}/g, '[redacted-key]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-token]')
    // Stored password hashes: lib/auth/password-hash.ts writes argon2id$v=19$m=..,t=..,p=..$salt$hash; legacy bcrypt ($2b$..) remains.
    .replace(/\$?argon2[a-z]*\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+/gi, '[redacted-hash]')
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[redacted-hash]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-hex]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/([?&][^=\s&]+)=([^&\s)]+)/g, '$1=[redacted]');
}

export function pathWithoutQuery(value: string | null | undefined): string | null {
  return value ? value.split(/[?#]/)[0].slice(0, 300) : null;
}

/** The page a browser error report came from, taken from the anonymous caller's Referer header. That header is free text to the server,
 * so only a same-site path made of plain path characters is accepted: no host, query, fragment, colon or doubled slash, which is what a
 * lure sentence or a spoofed URL needs. Anything else is dropped and the alert simply names no page. */
export function reportedPagePath(referer: string | null | undefined, requestHost: string | null | undefined): string | null {
  if (!referer || !requestHost) return null;
  let url: URL;
  try { url = new URL(referer); } catch { return null; }
  if (url.host.toLowerCase() !== requestHost.toLowerCase()) return null;
  return /^\/[A-Za-z0-9_\-./]{0,199}$/.test(url.pathname) && !url.pathname.includes('//') ? url.pathname : null;
}

/** A browser's User-Agent is also caller-chosen text. Keep only the characters a real one uses, and cut it short. */
export function reportedUserAgent(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/[^A-Za-z0-9 ./;,()_-]/g, '').slice(0, 150).trim();
  return cleaned || null;
}

const PLAIN_PATH = /^\/[A-Za-z0-9_\-./]{0,199}$/;

/** The path of a failed request, which a caller also chooses (a request to any URL it likes can raise an error). Shown in a staff alert only
 * when it is a plain path; otherwise the alert names no path and the server-derived route pattern carries the location. */
export function reportedRequestPath(path: string | null | undefined): string | null {
  return path && PLAIN_PATH.test(path) && !path.includes('//') ? path : null;
}

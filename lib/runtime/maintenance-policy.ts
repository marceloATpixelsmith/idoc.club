/** Which requests stay reachable while maintenance mode is on. Pure and import-free so middleware, the maintenance page and tests
 * share one rule. Everything not listed is answered with the branded 503 page (pages) or a JSON 503 (APIs, Server Actions,
 * Stripe webhooks, cron and queue endpoints -- providers retry a 503 later instead of writing during the window). */
export type MaintenanceDecision = 'allow' | 'page' | 'api';

// Exactly what a Super Admin needs to sign in (password + MFA, or Google). Google *linking* (/api/auth/google/link/*) is deliberately not listed.
const ALLOWED_EXACT = ['/api/health', '/api/auth/google/start', '/api/auth/google/callback', '/api/auth/session-expired'] as const;
const ALLOWED_SEGMENTS = ['/sign-in', '/mfa'] as const;

export function maintenanceDecision(pathname: string, method: string): MaintenanceDecision {
  // Static files (icons, images, documents) never need the database.
  if (/\.[A-Za-z0-9]+$/.test(pathname)) return 'allow';
  // Sign-in stays reachable so the Super Admin can get in and turn maintenance off.
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if ((ALLOWED_EXACT as readonly string[]).includes(path) || ALLOWED_SEGMENTS.some((segment) => path === segment || path.startsWith(`${segment}/`))) return 'allow';
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  const isRead = method === 'GET' || method === 'HEAD';
  return isApi || !isRead ? 'api' : 'page';
}

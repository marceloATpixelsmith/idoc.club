/** Which requests stay reachable while maintenance mode is on. Pure and import-free so middleware, the maintenance page and tests
 * share one rule. Everything not listed is answered with the branded 503 page (pages) or a JSON 503 (APIs, Server Actions,
 * Stripe webhooks, cron and queue endpoints -- providers retry a 503 later instead of writing during the window). */
export type MaintenanceDecision = 'allow' | 'page' | 'api';

const ALLOWED_PREFIXES = ['/api/health', '/sign-in', '/mfa', '/api/auth/google/', '/api/auth/session-expired'] as const;

export function maintenanceDecision(pathname: string, method: string): MaintenanceDecision {
  // Static files (icons, images, documents) never need the database.
  if (/\.[A-Za-z0-9]+$/.test(pathname)) return 'allow';
  // Sign-in stays reachable so the Super Admin can get in and turn maintenance off.
  if (ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) return 'allow';
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  const isRead = method === 'GET' || method === 'HEAD';
  return isApi || !isRead ? 'api' : 'page';
}

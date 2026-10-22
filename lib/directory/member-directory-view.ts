import 'server-only';

import { normalizeDirectoryFilters, type MemberDirectoryFilters } from './member-directory';

/** The member's last directory search/filter/sort/page, kept in a cookie instead of the URL so the
 * listing never depends on (or breaks from) hand-edited or stale query parameters. The cookie is
 * untrusted input: it is always re-validated through `normalizeDirectoryFilters` on read and write. */
export const DIRECTORY_VIEW_COOKIE = 'idoc-directory-view';
export const DIRECTORY_VIEW_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function directoryViewCookieOptions() {
  return {
    httpOnly: true, maxAge: DIRECTORY_VIEW_MAX_AGE_SECONDS, path: '/',
    sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production',
  };
}

/** The cookie is browser-wide and outlives sign-out, so it carries the owning user id and is ignored
 * for anyone else: a shared browser never shows member A's search text to member B. */
export function parseDirectoryView(raw: string | undefined, userId: number): MemberDirectoryFilters {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const { userId: owner, view } = parsed as { userId?: unknown; view?: unknown };
    return owner === userId && view && typeof view === 'object' && !Array.isArray(view)
      ? normalizedView(view as MemberDirectoryFilters) : {};
  } catch {
    return {};
  }
}

function normalizedView(input: MemberDirectoryFilters): MemberDirectoryFilters {
  const { federation, membershipType, page, pageSize, q, region, sort } = normalizeDirectoryFilters(input);
  return { federation, membershipType, page, pageSize, q, region, sort: JSON.stringify(sort) };
}

export function serializeDirectoryView(input: unknown, userId: number): string {
  return JSON.stringify({ userId, view: normalizedView(input && typeof input === 'object' ? input as MemberDirectoryFilters : {}) });
}

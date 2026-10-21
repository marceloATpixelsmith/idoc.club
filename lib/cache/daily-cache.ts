import 'server-only';

import { unstable_cache } from 'next/cache';

/** Public/member aggregates that only need to be current to the day: the member map and the member
 * directory listing. Next's data cache keeps each distinct set of arguments for this long, then the
 * next request recomputes it (a rolling 24 hours per key, not a calendar-day boundary). */
export const DAILY_REVALIDATE_SECONDS = 24 * 60 * 60;
export const MEMBER_DIRECTORY_CACHE_TAG = 'member-directory';

/** Caches `compute` for a day. `compute` must throw on failure (a thrown error is never cached) and
 * return only JSON-serializable data; its arguments are part of the cache key. Outside a Next
 * runtime (the node:test integration suites) there is no data cache, so it runs uncached. */
export function dailyCache<Args extends unknown[], Result>(
  compute: (...args: Args) => Promise<Result>,
  keyParts: string[],
): (...args: Args) => Promise<Result> {
  if (process.env.NODE_ENV === 'test') return compute;
  return unstable_cache(compute, keyParts, { revalidate: DAILY_REVALIDATE_SECONDS, tags: [MEMBER_DIRECTORY_CACHE_TAG] });
}

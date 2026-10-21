import 'server-only';

import { unstable_cache } from 'next/cache';

/** Public/member aggregates that only need to be current to the day: the member map and the member
 * directory listing. Next's data cache keeps each distinct set of arguments for this long, then the
 * next request recomputes it (a rolling 24 hours per key, not a calendar-day boundary). */
export const DAILY_REVALIDATE_SECONDS = 24 * 60 * 60;
export const MEMBER_DIRECTORY_CACHE_TAG = 'member-directory';

let testCacheEnabled = false;
const testMemo = new Map<string, Promise<unknown>>();
/** Test-only: the integration suites have no Next data cache, so they can switch on an in-memory
 * stand-in (keyed like the real one) to prove what a cached result can and cannot go stale on. */
export function useTestDailyCache(enabled: boolean) {
  testCacheEnabled = enabled;
  testMemo.clear();
}

/** Caches `compute` for a day. `compute` must throw on failure (a thrown error is never cached) and
 * return only JSON-serializable data; its arguments are part of the cache key. Outside a Next
 * runtime (the node:test integration suites) there is no data cache, so it runs uncached. */
export function dailyCache<Args extends unknown[], Result>(
  compute: (...args: Args) => Promise<Result>,
  keyParts: string[],
): (...args: Args) => Promise<Result> {
  if (process.env.NODE_ENV === 'test') {
    return async (...args: Args) => {
      if (!testCacheEnabled) return compute(...args);
      const key = JSON.stringify([keyParts, args]);
      if (!testMemo.has(key)) testMemo.set(key, compute(...args));
      return testMemo.get(key) as Promise<Result>;
    };
  }
  return unstable_cache(compute, keyParts, { revalidate: DAILY_REVALIDATE_SECONDS, tags: [MEMBER_DIRECTORY_CACHE_TAG] });
}

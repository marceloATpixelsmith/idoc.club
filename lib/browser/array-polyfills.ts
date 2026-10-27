/** Sentry (IDOC-21, 13 events on /sign-in, 2026-10-27): "TypeError: W.findLast is not a function". Array.prototype.findLast and findLastIndex
 * arrived in browsers in 2022, and a bundled dependency calls them, so visitors on older Safari/Chrome/Firefox hit an uncaught error as the
 * sign-in page hydrated. Defined here only when missing; loaded first by instrumentation-client.ts so it runs before any application code. */
type Predicate<T> = (value: T, index: number, array: T[]) => unknown;

if (typeof Array.prototype.findLast !== 'function') {
  Object.defineProperty(Array.prototype, 'findLast', {
    configurable: true, writable: true,
    value: function findLast<T>(this: T[], predicate: Predicate<T>, thisArg?: unknown): T | undefined {
      for (let index = this.length - 1; index >= 0; index -= 1) if (predicate.call(thisArg, this[index], index, this)) return this[index];
      return undefined;
    },
  });
}

if (typeof Array.prototype.findLastIndex !== 'function') {
  Object.defineProperty(Array.prototype, 'findLastIndex', {
    configurable: true, writable: true,
    value: function findLastIndex<T>(this: T[], predicate: Predicate<T>, thisArg?: unknown): number {
      for (let index = this.length - 1; index >= 0; index -= 1) if (predicate.call(thisArg, this[index], index, this)) return index;
      return -1;
    },
  });
}

export {};

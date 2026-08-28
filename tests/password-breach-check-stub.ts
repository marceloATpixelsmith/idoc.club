const originalFetch = globalThis.fetch;

/** Installs a global fetch stub that makes every call to the HaveIBeenPwned Pwned Passwords range
 * API resolve as "not breached" (an empty range body), so integration tests that exercise real
 * password-creation/change code paths never make a live call to that external provider -- matching
 * this repository's existing no-live-dependence convention for Turnstile/Google/email. Any other
 * host still reaches the real global fetch, so this can coexist with tests that mock other things.
 * Call once at module scope in any test file that (directly or indirectly) calls
 * checkPasswordBreached, and call the returned restore function from a top-level `after`. */
export function stubPasswordBreachCheckAsClean(): () => void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://api.pwnedpasswords.com/')) {
      return new Response('', { headers: { 'content-type': 'text/plain' }, status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

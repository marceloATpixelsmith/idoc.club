'use client';

const STORAGE_KEY = 'idoc-turnstile-retry-restore';

/** Saves the current value of every visible text/email input inside `form` to sessionStorage,
 * keyed by each input's `name` -- never a hidden field (the CSRF token, the Turnstile token
 * itself), since those are excluded by the type selector below and must never be restored from a
 * stale value on the next load. Used immediately before a forced page reload (the only safe way
 * to retry a Turnstile script that never loaded at all -- see turnstile-widget.tsx) so the reload
 * doesn't cost the member whatever they had already typed. Best-effort: a full private-browsing
 * sessionStorage block must never prevent the retry itself. */
export function saveFormValuesForRetryReload(form: HTMLFormElement | null): void {
  if (!form) return;
  const values: Record<string, string> = {};
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="email"], input[type="text"]')) {
    if (input.name) values[input.name] = input.value;
  }
  if (Object.keys(values).length === 0) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* best-effort only */
  }
}

/** Reads and clears the values saved by saveFormValuesForRetryReload(), if any -- single-use, so a
 * later ordinary page load never sees a stale restore. Returns an empty object (never throws) when
 * there is nothing to restore, which is the common case: an ordinary fresh page load. */
export function consumeRestoredFormValues(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

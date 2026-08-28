import 'server-only';

import { createHash } from 'node:crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const REQUEST_TIMEOUT_MS = 3000;

export interface PasswordBreachResult {
  breached: boolean;
  /** false when the provider could not be reached or returned an unusable response -- callers
   * must treat this as "unknown," never as "safe." See docs/21 AUTH-PASSWORD-006: this check fails
   * open (never blocks account creation/password change) on provider unavailability, since it is a
   * defense-in-depth advisory layered on top of the mandatory composition policy, not the primary
   * authentication control -- blocking signup/reset on an unrelated third-party outage would be a
   * worse outcome than occasionally missing a breach match. */
  checked: boolean;
}

/** k-anonymity range query against the HaveIBeenPwned Pwned Passwords API: only a 5-character
 * SHA-1 prefix of the password ever leaves this server -- never the password, never its full hash,
 * never persisted anywhere. The range endpoint is free, public, and deliberately keyless by design
 * (https://haveibeenpwned.com/API/v3#PwnedPasswords), so no account or secret configuration is
 * required to use it. */
export async function checkPasswordBreached(password: string): Promise<PasswordBreachResult> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn('password_breach_check_unavailable', { category: 'external-provider', status: response.status });
      return { breached: false, checked: false };
    }
    const body = await response.text();
    for (const line of body.split('\n')) {
      const [lineSuffix] = line.trim().split(':');
      if (lineSuffix && lineSuffix.toUpperCase() === suffix) return { breached: true, checked: true };
    }
    return { breached: false, checked: true };
  } catch {
    console.warn('password_breach_check_unavailable', { category: 'external-provider' });
    return { breached: false, checked: false };
  } finally {
    clearTimeout(timer);
  }
}

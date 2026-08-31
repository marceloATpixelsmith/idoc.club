import { z } from 'zod';

/** Canonical password creation policy. Do not trim or normalize passwords; spaces and Unicode are allowed. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Canonical password length is measured in Unicode code points, not UTF-16 code units (matching
 * pixelsmith-auth-reference's own `countPasswordCharacters`), so client and server length behavior
 * agree with each other and with how a person counting characters would see the password. Astral-
 * plane characters (many emoji, some scripts) are represented as UTF-16 surrogate pairs, so
 * `String.prototype.length` counts them as 2 -- that would let some under-length passwords through
 * the minimum check (each astral character inflates the count) and reject some legitimate ones at
 * the maximum (the same inflation works against the password there). */
export function countPasswordCharacters(value: string): number {
  return Array.from(value).length;
}

export const PASSWORD_REQUIREMENTS = [
  { key: 'length', label: 'At least 12 characters', test: (value: string) => countPasswordCharacters(value) >= MIN_PASSWORD_LENGTH },
  { key: 'uppercase', label: 'At least one uppercase letter', test: (value: string) => /\p{Lu}/u.test(value) },
  { key: 'lowercase', label: 'At least one lowercase letter', test: (value: string) => /\p{Ll}/u.test(value) },
  { key: 'number', label: 'At least one number', test: (value: string) => /\p{N}/u.test(value) },
  { key: 'special', label: 'At least one special character', test: (value: string) => /[^\p{L}\p{N}\s]/u.test(value) },
] as const;

export const passwordSchema = z.string()
  .refine((value) => countPasswordCharacters(value) >= MIN_PASSWORD_LENGTH, 'Use at least 12 characters.')
  .refine((value) => countPasswordCharacters(value) <= MAX_PASSWORD_LENGTH, 'Use no more than 128 characters.')
  .refine((value) => /\p{Lu}/u.test(value), 'Include at least one uppercase letter.')
  .refine((value) => /\p{Ll}/u.test(value), 'Include at least one lowercase letter.')
  .refine((value) => /\p{N}/u.test(value), 'Include at least one number.')
  .refine((value) => /[^\p{L}\p{N}\s]/u.test(value), 'Include at least one special character.');

/** For verifying a password against an existing hash (login, current-password re-verification,
 * account-deletion confirmation) rather than creating one -- deliberately not `passwordSchema`,
 * since login must accept the existing credential exactly as it was created, including a password
 * that predates a since-tightened composition policy. Still bounded at the same `MAX_PASSWORD_LENGTH`
 * (in code points, matching `passwordSchema`, not raw `.length`) as a defensive input-size cap
 * against comparePasswords/bcrypt -- anything ever accepted by passwordSchema at creation already
 * satisfies this bound, so it can never strand a legitimately-created credential in either direction:
 * a plain `.max(128)` (UTF-16 units) would wrongly reject a legitimately-created ≤128-code-point
 * password containing astral-plane characters before comparePasswords is ever reached. */
export const passwordEntrySchema = z.string()
  .min(1)
  .refine((value) => countPasswordCharacters(value) <= MAX_PASSWORD_LENGTH, 'Use no more than 128 characters.');

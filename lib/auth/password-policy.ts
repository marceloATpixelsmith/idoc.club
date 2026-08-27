import { z } from 'zod';

/** Canonical password creation policy: favor length and compromised-password screening over
 * composition rules. Do not trim or normalize passwords; spaces and Unicode are allowed. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const passwordSchema = z.string()
  .min(MIN_PASSWORD_LENGTH, 'Use at least 12 characters.')
  .max(MAX_PASSWORD_LENGTH, 'Use no more than 128 characters.');

export const PASSWORD_REQUIREMENTS = [
  { key: 'length', label: 'At least 12 characters', test: (value: string) => value.length >= MIN_PASSWORD_LENGTH },
] as const;

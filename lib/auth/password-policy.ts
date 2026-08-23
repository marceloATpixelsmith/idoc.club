import { z } from 'zod';

/** Canonical password creation policy: favor length and compromised-password screening over
 * composition rules. Do not trim or normalize passwords; spaces and Unicode are allowed. */
export const passwordSchema = z.string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use no more than 128 characters.');

export const PASSWORD_REQUIREMENTS = [
  { key: 'length', label: '12–128 characters', test: (value: string) => value.length >= 12 && value.length <= 128 },
] as const;

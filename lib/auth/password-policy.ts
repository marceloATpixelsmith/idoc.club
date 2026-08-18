import { z } from 'zod';

const SEQUENTIAL_RUN_LENGTH = 3;
const DIGIT_SEQUENCES = ['0123456789', '9876543210'];
const LETTER_SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba'];

function hasSequentialRun(value: string, alphabets: string[]): boolean {
  const lower = value.toLowerCase();
  return alphabets.some((alphabet) => {
    for (let start = 0; start + SEQUENTIAL_RUN_LENGTH <= alphabet.length; start += 1) {
      if (lower.includes(alphabet.slice(start, start + SEQUENTIAL_RUN_LENGTH))) return true;
    }
    return false;
  });
}

function hasRepeatedRun(value: string): boolean {
  return /(.)\1\1/.test(value);
}

export const passwordSchema = z.string().min(10, 'Use at least 10 characters.').max(100)
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a special character.')
  .refine((value) => !hasSequentialRun(value, DIGIT_SEQUENCES), 'Avoid sequential numbers like 1234.')
  .refine((value) => !hasSequentialRun(value, LETTER_SEQUENCES), 'Avoid sequential letters like abcd.')
  .refine((value) => !hasRepeatedRun(value), 'Avoid repeating the same character three or more times.');

export const PASSWORD_REQUIREMENTS = [
  { key: 'length', label: 'At least 10 characters', test: (value: string) => value.length >= 10 },
  { key: 'lowercase', label: 'One lowercase letter (a-z)', test: (value: string) => /[a-z]/.test(value) },
  { key: 'uppercase', label: 'One uppercase letter (A-Z)', test: (value: string) => /[A-Z]/.test(value) },
  { key: 'number', label: 'One number (0-9)', test: (value: string) => /[0-9]/.test(value) },
  { key: 'special', label: 'One special character (!@#$...)', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
  {
    key: 'no-bad-patterns', label: 'No repeated or sequential characters',
    test: (value: string) => value.length > 0 && !hasSequentialRun(value, DIGIT_SEQUENCES)
      && !hasSequentialRun(value, LETTER_SEQUENCES) && !hasRepeatedRun(value),
  },
] as const;

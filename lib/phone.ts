import { KNOWN_CALLING_CODES } from './phone-country-codes.ts';

const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidInternationalPhone(value: string): boolean {
  const normalized = value.trim();
  return E164.test(normalized) && KNOWN_CALLING_CODES.some((callingCode) => normalized.startsWith(callingCode));
}

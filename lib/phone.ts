import { isValidPhoneNumber } from 'libphonenumber-js/max';

export function isValidInternationalPhone(value: string): boolean {
  try {
    return isValidPhoneNumber(value);
  } catch {
    return false;
  }
}

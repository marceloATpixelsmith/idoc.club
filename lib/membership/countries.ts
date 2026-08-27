import { ISO_COUNTRY_CODES } from './validation';

const englishRegionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export type CountryOption = { code: string; name: string };

/**
 * Canonical country options for member-facing forms. The persisted value remains the
 * ISO 3166-1 alpha-2 code while the UI always presents a human-readable country name.
 */
export const COUNTRY_OPTIONS: CountryOption[] = ISO_COUNTRY_CODES
  .map((code) => ({ code, name: englishRegionNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

export function countryNameForCode(code: string): string {
  return englishRegionNames.of(code.toUpperCase()) ?? code.toUpperCase();
}

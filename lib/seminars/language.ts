const englishLanguageNames = new Intl.DisplayNames(['en'], { type: 'language' });

export function canonicalLanguageTag(value: string): string | null {
  try {
    return new Intl.Locale(value.trim()).toString();
  } catch {
    return null;
  }
}

export function languageNameForTag(tag: string): string {
  try {
    return englishLanguageNames.of(new Intl.Locale(tag).language) ?? tag;
  } catch {
    return tag;
  }
}

/** Standards-derived options supported by the runtime, rather than a project-maintained language list. */
export const LANGUAGE_OPTIONS = Array.from({ length: 26 * 26 }, (_, index) =>
  String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26)))
  .filter((code) => englishLanguageNames.of(code) !== code)
  .map((code) => ({ code, name: englishLanguageNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

/** The board members' country field uses IOC-style three-letter codes (e.g. "GER", "DEN"), which
 * mostly but not always match ISO 3166-1 alpha-3. Only the codes actually used on the board
 * members page need an entry here. */
const IOC_TO_ISO_ALPHA_2: Record<string, string> = {
  AUS: 'au',
  BEL: 'be',
  BRA: 'br',
  DEN: 'dk',
  FRA: 'fr',
  GER: 'de',
  HUN: 'hu',
  IND: 'in',
  MEX: 'mx',
  POL: 'pl',
  USA: 'us'
};

/** Path under /public/flags for a circular flag icon, or null if the code isn't mapped. */
export function countryFlagIconPath(iocCode: string): string | null {
  const iso2 = IOC_TO_ISO_ALPHA_2[iocCode.toUpperCase()];
  return iso2 ? `/flags/${iso2}.svg` : null;
}

import { z } from 'zod';

export const ISO_COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');
const ISO_COUNTRY_CODE_SET = new Set(ISO_COUNTRY_CODES);

export const IDOC_REGIONS = [
  'Western Europe & Africa',
  'Central & Eastern Europe',
  'Asia',
  'North America',
  'Central & Latin America',
  'Pacific',
] as const;

export const JUDGE_STATUSES = [
  'FEI Dressage Judge 1/2**', 'FEI Dressage Judge 2/3*',
  'FEI Dressage Judge 3/4*', 'FEI Dressage Judge 4/5**',
  'National Senior Officials / Candidates from EEFs education system FEI',
  'Para Dressage Judge', 'Retired Official', 'Other',
] as const;

export const STEWARD_STATUSES = [
  'FEI Dressage Steward Level 1', 'FEI Dressage Steward Level 2',
  'FEI Dressage Steward Level 3/4', 'National Dressage Steward',
  'FEI Para Dressage Steward', 'Other',
] as const;

const countryCode = z.string().trim().toUpperCase().refine(
  (value) => ISO_COUNTRY_CODE_SET.has(value), 'Select a valid country',
);
const requiredText = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max);
const officialBase = z.object({
  feiId: requiredText('FEI ID', 40),
  idocRegion: z.enum(IDOC_REGIONS),
  nationalFederationCountryCode: countryCode,
});
/** Dedupes and sorts selected statuses into the order the source form displays them in. */
function canonicalStatusOrder<T extends readonly string[]>(reference: T) {
  const order = new Map(reference.map((value, index) => [value, index]));
  return (values: T[number][]) => [...new Set(values)].sort((a, b) => order.get(a)! - order.get(b)!);
}
const judgeRole = officialBase.extend({
  isTechnicalDelegate: z.boolean(),
  officialStatuses: z.array(z.enum(JUDGE_STATUSES)).min(1).transform(canonicalStatusOrder(JUDGE_STATUSES)),
  roleType: z.literal('judge'),
});
const stewardRole = officialBase.extend({
  officialStatuses: z.array(z.enum(STEWARD_STATUSES)).min(1).transform(canonicalStatusOrder(STEWARD_STATUSES)),
  roleType: z.literal('steward'),
});
const veterinarianRole = z.object({ roleType: z.literal('veterinarian') }).strict();

export const memberProfileSchema = z.object({
  address1: requiredText('Address 1', 200),
  address2: z.string().trim().max(200).optional().transform((value) => value || null),
  city: requiredText('City', 100),
  countryCode,
  firstName: requiredText('First name', 100),
  lastName: requiredText('Last name', 100),
  postalCode: requiredText('ZIP/postal code', 30),
  roles: z.array(z.discriminatedUnion('roleType', [judgeRole, stewardRole, veterinarianRole])).min(1).max(2),
  stateProvince: requiredText('State/province', 100),
}).superRefine(({ roles }, context) => {
  const types = roles.map(({ roleType }) => roleType);
  if (new Set(types).size !== types.length || (types.length === 2 && !(types.includes('judge') && types.includes('steward')))) {
    context.addIssue({ code: 'custom', message: 'Select Judge, Steward, Judge + Steward, or Veterinarian', path: ['roles'] });
  }
});

export type MemberProfileInput = z.infer<typeof memberProfileSchema>;

/** Builds the untrusted memberProfileSchema input shape from a submitted profile-edit form. */
export function parseMemberProfileFormData(formData: FormData): unknown {
  const classification = String(formData.get('classification') ?? '');
  const official = {
    feiId: formData.get('feiId'), idocRegion: formData.get('idocRegion'),
    nationalFederationCountryCode: formData.get('nationalFederationCountryCode'),
  };
  const roles = classification === 'veterinarian' ? [{ roleType: 'veterinarian' }] : [
    ...(classification === 'judge' || classification === 'judge_steward' ? [{ ...official, isTechnicalDelegate: formData.get('isTechnicalDelegate') === 'yes', officialStatuses: formData.getAll('judgeStatus'), roleType: 'judge' }] : []),
    ...(classification === 'steward' || classification === 'judge_steward' ? [{ ...official, officialStatuses: formData.getAll('stewardStatus'), roleType: 'steward' }] : []),
  ];
  return { address1: formData.get('address1'), address2: formData.get('address2'), city: formData.get('city'), countryCode: formData.get('countryCode'), firstName: formData.get('firstName'), lastName: formData.get('lastName'), postalCode: formData.get('postalCode'), roles, stateProvince: formData.get('stateProvince') };
}

export function normalizeEmail(email: string): string {
  return z.string().trim().email().max(255).parse(email).toLowerCase();
}

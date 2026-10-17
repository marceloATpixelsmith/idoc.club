export const MEMBER_CLASSIFICATIONS = ['judge', 'steward', 'judge_steward', 'veterinarian'] as const;

export type MemberClassification = (typeof MEMBER_CLASSIFICATIONS)[number];

export function parseMemberClassification(value: string | null | undefined): MemberClassification | null {
  return MEMBER_CLASSIFICATIONS.find((classification) => classification === value) ?? null;
}

/** Prefill for the onboarding wizard of a member whose profile came from the legacy import with some required fields still blank. */
export interface OnboardingPrefill {
  classification: MemberClassification | null;
  firstName: string;
  lastName: string;
  countryCode: string;
  address1: string;
  address2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  nationalFederationCountryCode: string;
  idocRegion: string;
  feiId: string;
  judgeStatuses: string[];
  stewardStatuses: string[];
  isTechnicalDelegate: boolean;
}

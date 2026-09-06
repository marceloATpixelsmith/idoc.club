export const MEMBER_CLASSIFICATIONS = ['judge', 'steward', 'judge_steward', 'veterinarian'] as const;

export type MemberClassification = (typeof MEMBER_CLASSIFICATIONS)[number];

export function parseMemberClassification(value: string | null | undefined): MemberClassification | null {
  return MEMBER_CLASSIFICATIONS.find((classification) => classification === value) ?? null;
}

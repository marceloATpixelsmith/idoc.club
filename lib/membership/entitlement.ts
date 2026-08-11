export type EntitlementRecord = {
  status: string;
  validUntil: string;
};

export function isEntitled(record: EntitlementRecord | null, today: string): boolean {
  if (!record || record.validUntil < today) return false;
  return ['active', 'grace', 'complimentary', 'canceled'].includes(record.status);
}

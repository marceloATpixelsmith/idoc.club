import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

const RECENT_LIMIT = 10;
const CLASSIFICATION_LABELS: Record<string, string> = { judge: 'judges', steward: 'stewards', veterinarian: 'veterinarians' };

export type NewMembersSummary = {
  byClassification: { count: number; label: string }[];
  recent: { countryCode: string; joinedAt: Date; name: string; profileId: number }[];
  total: number;
};

/** Profiles created in the last 7 days by a real sign-up. Members created by the legacy WordPress import (legacy_wp_user_id set) are not new members and are excluded. */
export async function listNewMembersLastWeek(now: Date = new Date()): Promise<NewMembersSummary> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  // The database client takes ISO strings, not Date objects, as parameters.
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [recent, [totals], roles] = await Promise.all([
    client<{ country_code: string; created_at: Date | string; first_name: string; id: number; last_name: string }[]>`
      select id, first_name, last_name, country_code, created_at from profiles where created_at >= ${since}::timestamptz and legacy_wp_user_id is null order by created_at desc, id desc limit ${RECENT_LIMIT}`,
    client<{ total: number }[]>`select count(*)::int as total from profiles where created_at >= ${since}::timestamptz and legacy_wp_user_id is null`,
    client<{ count: number; role_type: string }[]>`
      select r.role_type, count(distinct r.profile_id)::int as count from professional_roles r join profiles p on p.id = r.profile_id
      where p.created_at >= ${since}::timestamptz and p.legacy_wp_user_id is null and r.effective_to is null group by r.role_type order by r.role_type`,
  ]);
  return {
    byClassification: roles.map((row) => ({ count: row.count, label: CLASSIFICATION_LABELS[row.role_type] ?? row.role_type })),
    recent: recent.map((row) => ({ countryCode: row.country_code, joinedAt: new Date(row.created_at), name: `${row.first_name} ${row.last_name}`, profileId: row.id })),
    total: totals?.total ?? 0,
  };
}

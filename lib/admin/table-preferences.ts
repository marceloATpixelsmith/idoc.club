import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { administratorTablePreferences } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator, type Actor } from '@/lib/membership/authorization';
import { MEMBERSHIP_STATUSES, MEMBERSHIP_TYPE_OPTIONS } from '@/lib/membership/admin-memberships';
import { IDOC_REGIONS, ISO_COUNTRY_CODES } from '@/lib/membership/validation';
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES } from '@/lib/support/inbox';
import { NEWS_STATUSES } from '@/lib/news/articles';
import { SEMINAR_STATUSES } from '@/lib/seminars/status';
import { CONTENT_AUDIENCES, CONTENT_STATUSES } from '@/lib/content/pages';

export const ADMIN_TABLE_IDENTIFIERS = ['memberships', 'support', 'news', 'seminars', 'content_pages'] as const;
export type AdminTableIdentifier = typeof ADMIN_TABLE_IDENTIFIERS[number];
const identifierSchema = z.enum(ADMIN_TABLE_IDENTIFIERS);
const text = (max = 200) => z.string().trim().max(max).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const direction = z.enum(['asc', 'desc']).optional();
const columns = (allowed: readonly string[]) => z.array(z.string()).max(20).transform((values) => [...new Set(values.filter((value) => allowed.includes(value)))]).optional();
const pageSize = z.coerce.number().int().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).optional();
// Restoring the exact page a member left off on -- not just filters/sort/columns -- is deliberate:
// the whole point of persisting to the database instead of the URL is that closing the tab and
// coming back should put the admin exactly where they were, not just apply the same filters to page 1.
const page = z.coerce.number().int().positive().max(10_000).optional();
// A multi-select facet filter's committed value round-trips as the same comma-joined query-param
// string the toolbar itself writes (?status=active,expired) -- see lib/admin/resource-list-query.ts's
// `many()` helper, which every filter-building module parses that shape with. This validates every
// comma-separated token against the column's real allow-list while keeping the stored string as-is,
// so a single selection continues to round-trip identically to before multi-select existed.
const multiToken = (allowed: readonly string[], maxLength = 500) => z.string().trim().max(maxLength)
  .refine((value) => value.split(',').every((item) => allowed.includes(item.trim())), 'Invalid selection').optional();

const schemas = {
  memberships: z.object({
    columns: columns(['name', 'email', 'type', 'status', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated', 'actions']),
    country: multiToken(ISO_COUNTRY_CODES, 1000), direction, expiresFrom: date, expiresTo: date, federation: multiToken(ISO_COUNTRY_CODES, 1000), filters: text(4000),
    // 'membershipType' is a legacy key accepted for preferences saved before the membership-type
    // filter was keyed by column id; current code always writes 'type' (see members-table.tsx).
    membershipType: multiToken(MEMBERSHIP_TYPE_OPTIONS, 100),
    page, pageSize, q: text(), region: multiToken(IDOC_REGIONS, 500), sort: text(1000), columnOrder: text(500), joinOperator: z.enum(['and', 'or']).optional(),
    status: multiToken(MEMBERSHIP_STATUSES, 200),
    type: multiToken(MEMBERSHIP_TYPE_OPTIONS, 100),
  }).strict(),
  support: z.object({ activityFrom: date, activityTo: date, columns: columns(['member', 'subject', 'category', 'status', 'assigned', 'activity']), columnOrder: text(500), category: multiToken(SUPPORT_CATEGORIES, 200), direction, filters: text(4000), joinOperator: z.enum(['and', 'or']).optional(), page, pageSize, q: text(), assigned: text(2000), sort: text(1000), status: multiToken(SUPPORT_STATUSES, 200) }).strict(),
  news: z.object({ columns: columns(['title', 'subtitle', 'slug', 'status', 'publication', 'updated']), columnOrder: text(500), direction, filters: text(4000), from: date, joinOperator: z.enum(['and', 'or']).optional(), page, pageSize, q: text(), sort: text(1000), status: multiToken(NEWS_STATUSES, 200), to: date }).strict(),
  seminars: z.object({ columns: columns(['title', 'date', 'status', 'payment', 'registrations']), columnOrder: text(500), direction, filters: text(4000), from: date, joinOperator: z.enum(['and', 'or']).optional(), membershipRequirement: text(30), page, pageSize, q: text(), sort: text(1000), status: multiToken(SEMINAR_STATUSES, 200), to: date }).strict(),
  content_pages: z.object({ audience: multiToken(CONTENT_AUDIENCES, 200), columns: columns(['title', 'slug', 'status', 'audience', 'updated']), columnOrder: text(500), direction, filters: text(4000), joinOperator: z.enum(['and', 'or']).optional(), page, pageSize, publicationState: text(30), q: text(), sort: text(1000), status: multiToken(CONTENT_STATUSES, 200) }).strict(),
} satisfies Record<AdminTableIdentifier, z.ZodType>;

export type TablePreferenceState = Record<string, string | string[] | number | undefined>;

export function validateTablePreferences(table: AdminTableIdentifier, value: unknown): TablePreferenceState | null {
  const parsed = schemas[table].safeParse(value);
  if (!parsed.success) return null;
  const result = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([, item]) => item !== undefined));
  return result as TablePreferenceState;
}

async function authorizedActor(): Promise<Actor> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return actor;
}

export function validateTableIdentifier(value: unknown): AdminTableIdentifier { return identifierSchema.parse(value); }

export async function getTablePreferences(tableInput: unknown): Promise<TablePreferenceState | null> {
  const actor = await authorizedActor();
  const table = validateTableIdentifier(tableInput);
  const [record] = await db.select({ preferences: administratorTablePreferences.preferences }).from(administratorTablePreferences)
    .where(and(eq(administratorTablePreferences.userId, actor.id), eq(administratorTablePreferences.tableIdentifier, table))).limit(1);
  return record ? validateTablePreferences(table, record.preferences) : null;
}

export async function saveTablePreferences(tableInput: unknown, value: unknown): Promise<TablePreferenceState> {
  const actor = await authorizedActor();
  const table = validateTableIdentifier(tableInput);
  const preferences = validateTablePreferences(table, value);
  if (!preferences) throw new z.ZodError([]);
  const now = new Date();
  await db.insert(administratorTablePreferences).values({ preferences, tableIdentifier: table, updatedAt: now, userId: actor.id })
    .onConflictDoUpdate({ set: { preferences, updatedAt: now }, target: [administratorTablePreferences.userId, administratorTablePreferences.tableIdentifier] });
  return preferences;
}

export async function resetTablePreferences(tableInput: unknown): Promise<void> {
  const actor = await authorizedActor();
  const table = validateTableIdentifier(tableInput);
  await db.delete(administratorTablePreferences).where(and(eq(administratorTablePreferences.userId, actor.id), eq(administratorTablePreferences.tableIdentifier, table)));
}

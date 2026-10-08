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
import { NEWS_AUDIENCES, NEWS_STATUSES, NEWS_TYPES } from '@/lib/news/articles';
import { PAYMENT_STATUSES, SEMINAR_STATUSES } from '@/lib/seminars/status';

export const ADMIN_TABLE_IDENTIFIERS = ['memberships', 'support', 'news', 'seminars', 'seminar_registrations'] as const;
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
const newsAccessFilter = multiToken(NEWS_AUDIENCES, 200).refine((value) => {
  if (!value) return true;
  const selected = value.split(',').map((item) => item.trim());
  const broad = selected.filter((item) => item === 'public' || item === 'members');
  return broad.length === 0 || (broad.length === 1 && selected.length === 1);
}, 'Invalid access combination');

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
  news: z.object({ access: newsAccessFilter, columns: columns(['title', 'type', 'status', 'access', 'publication', 'subtitle', 'updated']), columnOrder: text(500), direction, filters: text(4000), from: date, joinOperator: z.enum(['and', 'or']).optional(), page, pageSize, q: text(), sort: text(1000), status: multiToken(NEWS_STATUSES, 200), type: multiToken(NEWS_TYPES, 100), to: date }).strict(),
  seminars: z.object({ columns: columns(['title', 'status', 'start', 'end', 'deadline', 'prices', 'registrations']), columnOrder: text(500), direction, filters: text(4000), from: date, joinOperator: z.enum(['and', 'or']).optional(), membershipRequirement: text(30), page, pageSize, q: text(), sort: text(1000), status: multiToken(SEMINAR_STATUSES, 200), to: date }).strict(),
  seminar_registrations: z.object({ columns: columns(['registrant', 'seminar', 'status', 'registered']), columnOrder: text(500), direction, filters: text(4000), from: date, joinOperator: z.enum(['and', 'or']).optional(), page, pageSize, paymentStatus: multiToken(PAYMENT_STATUSES, 500), q: text(), registrantType: multiToken(['member', 'guest'], 100), seminarId: z.string().trim().max(4000).refine((value) => value.split(',').every((item) => /^\d+$/.test(item.trim())), 'Invalid selection').optional(), sort: text(1000), to: date }).strict(),
} satisfies Record<AdminTableIdentifier, z.ZodType>;

export type TablePreferenceState = Record<string, string | string[] | number | undefined>;

function normalizeLegacyNewsPreferences(value: Record<string, unknown>): Record<string, unknown> {
  const order = typeof value.columnOrder === 'string' ? value.columnOrder.split(',') : [];
  const savedColumns = Array.isArray(value.columns)
    ? value.columns.filter((item): item is string => typeof item === 'string' && item !== 'subtitle')
    : undefined;

  // Keep Article Type visible even for saved News/Blog views created before the column existed.
  // Saved column order can also omit Type entirely; insert it immediately before Status without
  // reordering the administrator's remaining columns.
  const normalizedOrder = order.filter((id) => id !== 'subtitle' && id !== 'type');
  if (order.length > 0) {
    const statusIndex = normalizedOrder.indexOf('status');
    normalizedOrder.splice(statusIndex >= 0 ? statusIndex : normalizedOrder.length, 0, 'type');
  }

  // Preserve the original migration of Subtitle to Access when an older view still has Subtitle.
  if (order.includes('subtitle') && !normalizedOrder.includes('access')) {
    const statusIndex = normalizedOrder.indexOf('status');
    normalizedOrder.splice(statusIndex >= 0 ? statusIndex + 1 : normalizedOrder.length, 0, 'access');
  }
  const normalizedColumns = savedColumns
    ? [...new Set([...savedColumns, 'type', ...(order.includes('subtitle') ? ['access'] : [])])]
    : undefined;

  return {
    ...value,
    ...(normalizedColumns ? { columns: normalizedColumns } : {}),
    ...(order.length > 0 ? { columnOrder: normalizedOrder.join(',') } : {}),
  };
}

export function validateTablePreferences(table: AdminTableIdentifier, value: unknown): TablePreferenceState | null {
  const parsed = schemas[table].safeParse(value);
  if (!parsed.success) return null;
  const parsedData = parsed.data as Record<string, unknown>;
  const normalized = table === 'news' ? normalizeLegacyNewsPreferences(parsedData) : parsedData;
  const result = Object.fromEntries(Object.entries(normalized).filter(([, item]) => item !== undefined));
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

import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { administratorTablePreferences } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator, type Actor } from '@/lib/membership/authorization';

export const ADMIN_TABLE_IDENTIFIERS = ['memberships', 'support', 'news', 'seminars', 'content_pages'] as const;
export type AdminTableIdentifier = typeof ADMIN_TABLE_IDENTIFIERS[number];
const identifierSchema = z.enum(ADMIN_TABLE_IDENTIFIERS);
const text = (max = 200) => z.string().trim().max(max).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const direction = z.enum(['asc', 'desc']).optional();
const columns = (allowed: readonly string[]) => z.array(z.string()).max(20).transform((values) => [...new Set(values.filter((value) => allowed.includes(value)))]).optional();
const pageSize = z.coerce.number().int().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).optional();

const schemas = {
  memberships: z.object({
    columns: columns(['name', 'email', 'type', 'status', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated', 'actions']),
    country: text(2), direction, expiresFrom: date, expiresTo: date, federation: text(2), filters: text(4000), membershipType: z.enum(['judge', 'steward', 'combo', 'veterinarian']).optional(),
    pageSize, q: text(), region: text(40), sort: text(1000),
    status: z.enum(['active', 'expired', 'archived', 'without_active', 'administrator', 'super_admin', 'onboarding', 'test']).optional(),
  }).strict(),
  support: z.object({ columns: columns(['member', 'subject', 'category', 'status', 'assigned', 'activity']), category: text(30), direction, filters: text(4000), joinOperator: z.enum(['and', 'or']).optional(), pageSize, q: text(), assigned: text(255), sort: text(1000), status: text(30) }).strict(),
  news: z.object({ columns: columns(['title', 'subtitle', 'slug', 'status', 'publication', 'updated']), direction, from: date, pageSize, q: text(), sort: z.enum(['title', 'status', 'publication', 'updated']).optional(), status: text(30), to: date }).strict(),
  seminars: z.object({ columns: columns(['title', 'date', 'status', 'payment', 'registrations']), direction, from: date, membershipRequirement: text(30), pageSize, q: text(), sort: z.enum(['title', 'date', 'status', 'registrations']).optional(), status: text(30), to: date }).strict(),
  content_pages: z.object({ audience: text(30), columns: columns(['title', 'slug', 'status', 'audience', 'updated']), direction, pageSize, publicationState: text(30), q: text(), sort: z.enum(['title', 'status', 'updated']).optional(), status: text(30) }).strict(),
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

export function preferenceQuery(preferences: TablePreferenceState | null): Record<string, string | string[]> {
  if (!preferences) return {};
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (value === undefined) continue;
    if (key === 'columns' && Array.isArray(value)) query.column = value;
    else query[key] = String(value);
  }
  return query;
}

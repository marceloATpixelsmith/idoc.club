import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { client as productionClient } from '../lib/db/drizzle.ts';
import { validateTestDatabaseUrl } from '../lib/db/test-database-url.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';

export const testUrl = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString();
export const sql = postgres(testUrl, { max: 10, onnotice: () => {} });
export const database = drizzle(sql);
const migrationsFolder = new URL('../lib/db/migrations', import.meta.url).pathname;

export async function resetIdoc(): Promise<void> {
  await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE');
  await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
}

export async function closeHarness(): Promise<void> {
  await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE');
  await sql.end();
  // Production code (everything under lib/membership, lib/notifications, ...) connects through
  // lib/db/drizzle.ts's own lazily-created, module-level connection, entirely separate from this
  // harness's own `sql` above. Left open, that connection has no idle timeout and keeps the process
  // alive indefinitely after every test in the file finishes — this was silently hanging every
  // *.integration.ts run (locally and, worse, the real "Run Release 1 gate" CI job) until something
  // external eventually reset the idle socket, not a genuine test failure.
  await productionClient.end();
}

export type AccountState = 'active' | 'deleted' | 'migrated_pending' | 'onboarding' | 'suspended' | 'unverified';

let fixtureSequence = 0;
export async function createUser(accountState: AccountState = 'active') {
  fixtureSequence += 1;
  const email = `member-${fixtureSequence}@example.test`;
  const [user] = await sql<{ id: number; email: string }[]>`
    insert into idoc.users (email,password_hash,email_verified_at,account_state)
    values (${email}, 'fixture-password-hash', ${accountState === 'unverified' ? null : new Date().toISOString()}, ${accountState})
    returning id,email`;
  return user;
}

export const judgeRole = {
  feiId: '10000123', idocRegion: 'Western Europe & Africa' as const,
  isTechnicalDelegate: false, nationalFederationCountryCode: 'DE',
  officialStatuses: ['FEI Dressage Judge 1/2**'] as const, roleType: 'judge' as const,
};
export const stewardRole = {
  feiId: '10000456', idocRegion: 'Central & Eastern Europe' as const,
  nationalFederationCountryCode: 'PL', officialStatuses: ['FEI Dressage Steward Level 1'] as const,
  roleType: 'steward' as const,
};
export const veterinarianRole = { roleType: 'veterinarian' as const };

export function profileInput(roles: Array<typeof judgeRole | typeof stewardRole | typeof veterinarianRole> = [judgeRole]) {
  return { address1: '1 Test Road', address2: 'Suite 2', city: 'Test City', countryCode: 'DE',
    firstName: 'Test', lastName: 'Member', postalCode: '10115', roles, stateProvince: 'Berlin' };
}

export async function createProfile(userId: number, roles = [judgeRole]) {
  const input = profileInput(roles);
  const [profile] = await sql<{ id: number }[]>`
    insert into idoc.profiles(user_id,first_name,last_name,address_1,address_2,city,state_province,postal_code,country_code)
    values(${userId},${input.firstName},${input.lastName},${input.address1},${input.address2},${input.city},${input.stateProvince},${input.postalCode},${input.countryCode}) returning id`;
  for (const role of roles) {
    await sql`insert into idoc.professional_roles(profile_id,role_type,national_federation_country_code,idoc_region,fei_id,official_statuses,is_technical_delegate)
      values(${profile.id},${role.roleType},${'nationalFederationCountryCode' in role ? role.nationalFederationCountryCode : null},${'idocRegion' in role ? role.idocRegion : null},${'feiId' in role ? role.feiId : null},${'officialStatuses' in role ? sql.array([...role.officialStatuses]) : null},${'isTechnicalDelegate' in role ? role.isTechnicalDelegate : null})`;
  }
  return profile;
}

export async function createMembership(profileId: number, current = true) {
  const [membership] = await sql<{ id: number }[]>`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
    values(${profileId},${current ? 'active' : 'expired'},'2025-01-01',${current ? '2099-12-31' : '2025-12-31'},'migration') returning id`;
  return membership;
}

export async function grantRole(userId: number, role: 'administrator' | 'super_admin') {
  await sql`insert into idoc.application_roles(user_id,role,granted_by) values(${userId},${role},${userId})`;
}

export async function adminUser() {
  const admin = await createUser();
  await grantRole(admin.id, 'administrator');
  return admin;
}

export function asAdmin<T>(adminId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: adminId, roles: [] } }, operation);
}

export async function createCompleteGraph() {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  await sql`insert into idoc.billing_accounts(profile_id,external_customer_id) values(${profile.id},'cus_fixture')`;
  await sql`insert into idoc.migration_map(legacy_type,legacy_id,new_entity_id,disposition) values('wp_user','42',${String(user.id)},'imported')`;
  return { profile, user };
}

export async function persistedGraph(userId: number) {
  const [user] = await sql`select * from idoc.users where id=${userId}`;
  const [profile] = await sql`select * from idoc.profiles where user_id=${userId}`;
  assert.ok(profile);
  const profileId = profile.id as number;
  return {
    audit: await sql`select * from idoc.audit_log where actor_id=${userId} order by id`,
    billing: await sql`select * from idoc.billing_accounts where profile_id=${profileId} order by id`,
    membership: await sql`select * from idoc.memberships where profile_id=${profileId} order by id`,
    migration: await sql`select * from idoc.migration_map where new_entity_id=${String(userId)} order by id`,
    notifications: await sql`select * from idoc.notification_outbox where profile_id=${profileId} order by id`,
    profile,
    profileHistory: await sql`select * from idoc.profile_change_history where profile_id=${profileId} order by id`,
    roles: await sql`select * from idoc.professional_roles where profile_id=${profileId} order by id`,
    user,
  };
}

export async function concurrently<L, R>(left: () => Promise<L>, right: () => Promise<R>) {
  return Promise.allSettled([left(), right()]);
}

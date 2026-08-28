import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { consumeAccountToken, requestAccountLink } from '../lib/membership/account-recovery.ts';
import { createOwnMemberProfile, deleteOwnAccount, getOwnPrivateMember, updateMemberProfile } from '../lib/membership/data-access.ts';
import { consumeEmailVerification } from '../lib/membership/email-verification.ts';
import { decryptDeliveryPayload } from '../lib/security/encrypted-payload.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import {
  closeHarness, createCompleteGraph, createMembership, createProfile, createUser,
  grantRole, profileInput, resetIdoc, sql,
} from './postgres-harness.ts';
import { stubPasswordBreachCheckAsClean } from './password-breach-check-stub.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const timing = { now: () => 0, random: () => 0, sleep: async () => undefined };
const restoreFetch = stubPasswordBreachCheckAsClean();
after(restoreFetch);

beforeEach(async () => {
  process.env.ACCOUNT_DELIVERY_KEY_VERSION = 'test-v1';
  process.env.ACCOUNT_DELIVERY_ENCRYPTION_KEYS = JSON.stringify({ 'test-v1': 'integration-only-key-material-at-least-32-characters' });
  process.env.RATE_LIMIT_HASH_KEY = 'integration-only-rate-limit-secret';
  await resetIdoc();
});
after(closeHarness);

async function rawRequestedToken(userId: number, purpose: 'migration_activation' | 'password_reset') {
  const [row] = await sql<{ encrypted_payload: string; key_version: string }[]>`
    select encrypted_payload,key_version from idoc.account_delivery_outbox
    where user_id=${userId} and purpose=${purpose} order by id desc limit 1`;
  assert.ok(row);
  return decryptDeliveryPayload(row.encrypted_payload, row.key_version).token;
}

// This enumerates every currently-implemented Release 1 account lifecycle transition and asserts the
// exact audit action, actor, and entity identity it writes — not just that no secret leaked (already
// covered elsewhere), but that the positive evidence a transition claims to produce actually exists.

test('onboarding writes member.profile.created and account.onboarding.completed with correct actor and entity identity', async () => {
  const user = await createUser('onboarding');
  const profile = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput()));
  const rows = [...await sql`select action, actor_id, entity_type, entity_id from idoc.audit_log order by id`];
  assert.deepEqual(rows, [
    { action: 'member.profile.created', actor_id: user.id, entity_type: 'profile', entity_id: String((profile as { id: number }).id) },
    { action: 'account.onboarding.completed', actor_id: user.id, entity_type: 'user', entity_id: String(user.id) },
  ]);
});

test('a self-service profile edit writes member.profile.updated; an administrator editing another member writes admin.profile.updated', async () => {
  const owner = await createUser();
  const ownerProfile = await createProfile(owner.id);
  await createMembership(ownerProfile.id);
  await withTestMembershipBoundary({ actor: { id: owner.id, roles: [] } }, () => updateMemberProfile(ownerProfile.id, profileInput()));
  const [selfRow] = await sql`select action, actor_id, entity_type, entity_id from idoc.audit_log where entity_type='profile'`;
  assert.equal(selfRow.action, 'member.profile.updated');
  assert.equal(selfRow.actor_id, owner.id);
  assert.equal(selfRow.entity_id, String(ownerProfile.id));

  await resetIdoc();
  const other = await createUser();
  const otherProfile = await createProfile(other.id);
  await createMembership(otherProfile.id);
  const administrator = await createUser();
  await grantRole(administrator.id, 'administrator');
  await withTestMembershipBoundary({ actor: { id: administrator.id, roles: [] } }, () => updateMemberProfile(otherProfile.id, profileInput(), { reason: 'Administrative correction' }));
  const [adminRow] = await sql`select action, actor_id, entity_type, entity_id, reason from idoc.audit_log where entity_type='profile'`;
  assert.equal(adminRow.action, 'admin.profile.updated');
  assert.equal(adminRow.actor_id, administrator.id);
  assert.equal(adminRow.entity_id, String(otherProfile.id));
  assert.equal(adminRow.reason, 'Administrative correction');
  assert.equal((await sql`select count(*)::int as count from idoc.notification_outbox`)[0].count, 0);
});

test('an administrator edit without a reason is rejected and persists nothing', async () => {
  const other = await createUser();
  const otherProfile = await createProfile(other.id);
  await createMembership(otherProfile.id);
  const administrator = await createUser();
  await grantRole(administrator.id, 'administrator');
  await assert.rejects(withTestMembershipBoundary({ actor: { id: administrator.id, roles: [] } }, () => updateMemberProfile(otherProfile.id, profileInput())));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: administrator.id, roles: [] } }, () => updateMemberProfile(otherProfile.id, profileInput(), { reason: '   ' })));
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_type='profile'`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.profile_change_history`)[0].count, 0);
});

test('registration verification for a brand-new member with no profile transitions to onboarding and writes account.email.verified', async () => {
  const user = await createUser('unverified');
  const raw = 'fresh-registration-verification-token-1234567890';
  await sql`insert into idoc.email_verification_tokens(user_id,token_hash,pending_email,expires_at)
    values(${user.id},${digest(raw)},'verified-member@example.test',now()+interval '1 hour')`;
  assert.equal((await consumeEmailVerification(raw)).status, 'verified');
  const [row] = await sql`select account_state, email, email_verified_at from idoc.users where id=${user.id}`;
  assert.equal(row.account_state, 'onboarding');
  assert.equal(row.email, 'verified-member@example.test');
  assert.ok(row.email_verified_at);
  const [audit] = await sql`select action, actor_id, entity_type, entity_id from idoc.audit_log`;
  assert.equal(audit.action, 'account.email.verified');
  assert.equal(audit.actor_id, user.id);
  assert.equal(audit.entity_type, 'user');
});

test('a password-reset request writes account.password_reset.delivery_queued and completion writes account.password_reset.completed', async () => {
  const user = await createUser('active');
  await requestAccountLink(user.email, 'password_reset', 'test-origin', timing);
  const [queued] = await sql`select action, entity_type, entity_id from idoc.audit_log where action='account.password_reset.delivery_queued'`;
  assert.equal(queued.entity_type, 'user');
  assert.equal(queued.entity_id, String(user.id));

  const raw = await rawRequestedToken(user.id, 'password_reset');
  assert.equal((await consumeAccountToken(raw, 'password_reset', 'Replacement9Password')).status, 'success');
  const [completed] = await sql`select action, actor_id, entity_type, entity_id from idoc.audit_log where action='account.password_reset.completed'`;
  assert.equal(completed.actor_id, user.id);
  assert.equal(completed.entity_id, String(user.id));
});

test('a migration-activation request writes account.migration_activation.delivery_queued and completion writes account.migration_activation.completed', async () => {
  const graph = await createCompleteGraph();
  await sql`update idoc.users set account_state='migrated_pending', email_verified_at=null where id=${graph.user.id}`;
  await requestAccountLink(graph.user.email, 'migration_activation', 'test-origin', timing);
  const [queued] = await sql`select action, entity_id from idoc.audit_log where action='account.migration_activation.delivery_queued'`;
  assert.equal(queued.entity_id, String(graph.user.id));

  const raw = await rawRequestedToken(graph.user.id, 'migration_activation');
  assert.equal((await consumeAccountToken(raw, 'migration_activation', 'Replacement9Password')).status, 'success');
  const [completed] = await sql`select action, actor_id from idoc.audit_log where action='account.migration_activation.completed'`;
  assert.equal(completed.actor_id, graph.user.id);
});

test('account deletion writes account.deleted audit evidence, mangles the email, and denies further access', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => deleteOwnAccount());

  const [row] = await sql`select account_state, email, deleted_at from idoc.users where id=${user.id}`;
  assert.equal(row.account_state, 'deleted');
  assert.equal(row.email, `${user.email}-${user.id}-deleted`);
  assert.ok(row.deleted_at);

  const [audit] = await sql`select action, actor_id, entity_type, entity_id from idoc.audit_log`;
  assert.equal(audit.action, 'account.deleted');
  assert.equal(audit.actor_id, user.id);
  assert.equal(audit.entity_type, 'user');
  assert.equal(audit.entity_id, String(user.id));

  await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => getOwnPrivateMember()));
});

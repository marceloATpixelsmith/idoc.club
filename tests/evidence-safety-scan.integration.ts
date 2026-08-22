import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { consumeAccountToken, requestAccountLink } from '../lib/membership/account-recovery.ts';
import { createOwnMemberProfile, deleteOwnAccount, updateMemberProfile } from '../lib/membership/data-access.ts';
import { consumeEmailVerification, issueEmailVerification } from '../lib/membership/email-verification.ts';
import { decryptDeliveryPayload } from '../lib/security/encrypted-payload.ts';
import { deliverNextAccountLink } from '../lib/notifications/account-delivery.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import {
  closeHarness, consentInput, createCompleteGraph, createMembership, createProfile, createUser,
  judgeRole, profileInput, resetIdoc, sql,
} from './postgres-harness.ts';

// A single consolidated sweep, closing the "comprehensive operational-evidence safety scan" gap.
// Individual tests elsewhere already check that their own specific failure path's evidence excludes
// secrets (grep this repo for `evidence.includes`); this test instead runs a representative flow
// across every category the gap lists (identity, onboarding, profile, professional-role, recovery,
// reset, activation, rate limiting, notifications, encryption, provider failure, database failure)
// and scans every evidence-bearing table's *complete* content in one pass, rather than relying on
// each flow's own narrower spot check.

const PASSWORD = 'ScanSensitive9Password';
const PROVIDER_FAILURE_MARKER = 'deliberate-provider-failure-should-never-persist';
const secrets = {
  encryptionMaterial: 'evidence-scan-only-encryption-key-at-least-32-chars',
  rateLimitKey: 'evidence-scan-only-rate-limit-secret',
};
const timing = { now: () => 0, random: () => 0, sleep: async () => undefined };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const rawTokens: string[] = [];
const emails: string[] = [];

beforeEach(async () => {
  process.env.BASE_URL = 'https://idoc.club';
  process.env.ACCOUNT_DELIVERY_KEY_VERSION = 'scan-v1';
  process.env.ACCOUNT_DELIVERY_ENCRYPTION_KEYS = JSON.stringify({ 'scan-v1': secrets.encryptionMaterial });
  process.env.RATE_LIMIT_HASH_KEY = secrets.rateLimitKey;
  rawTokens.length = 0;
  emails.length = 0;
  await resetIdoc();
});
after(closeHarness);

async function rawRequestedToken(userId: number, purpose: 'migration_activation' | 'password_reset') {
  const [row] = await sql<{ encrypted_payload: string; key_version: string }[]>`
    select encrypted_payload,key_version from idoc.account_delivery_outbox
    where user_id=${userId} and purpose=${purpose} order by id desc limit 1`;
  const token = decryptDeliveryPayload(row.encrypted_payload, row.key_version).token;
  rawTokens.push(token);
  return token;
}

test('a representative sweep across identity, onboarding, profile, recovery, reset, activation, rate limiting, delivery, and provider-failure paths leaves no password, raw token, secret, or raw exception in any persisted evidence', async () => {
  // Onboarding: one success, one rejected invalid payload.
  const onboarding = await createUser('onboarding');
  await withTestMembershipBoundary({ actor: { id: onboarding.id, roles: [] } }, () => createOwnMemberProfile(profileInput(), consentInput()));
  emails.push(onboarding.email);
  const rejectedOnboarding = await createUser('onboarding');
  emails.push(rejectedOnboarding.email);
  await assert.rejects(withTestMembershipBoundary(
    { actor: { id: rejectedOnboarding.id, roles: [] } },
    () => createOwnMemberProfile({ ...profileInput(), roles: [{ ...judgeRole, feiId: '' }] }, consentInput()),
  ));

  // Profile edit: one success, one rejected invalid edit.
  const editable = await createUser();
  const editableProfile = await createProfile(editable.id);
  await createMembership(editableProfile.id);
  emails.push(editable.email);
  await withTestMembershipBoundary({ actor: { id: editable.id, roles: [] } }, () => updateMemberProfile(editableProfile.id, profileInput()));
  await assert.rejects(withTestMembershipBoundary(
    { actor: { id: editable.id, roles: [] } },
    () => updateMemberProfile(editableProfile.id, { ...profileInput(), countryCode: 'XX' }),
  ));

  // Registration verification (identity).
  const raw = 'evidence-scan-registration-token-1234567890123';
  rawTokens.push(raw);
  await sql`insert into idoc.email_verification_tokens(user_id,token_hash,pending_email,expires_at)
    values(${onboarding.id},${digest(raw)},'scan-verified@example.test',now()+interval '1 hour')`;
  await consumeEmailVerification(raw);
  emails.push('scan-verified@example.test');

  // Standalone email change, including a provider (delivery) failure.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(PROVIDER_FAILURE_MARKER); };
  await issueEmailVerification(editable.id, 'scan-change@example.test');
  emails.push('scan-change@example.test');
  globalThis.fetch = originalFetch;

  // Password recovery request + reset completion, plus rate-limit exhaustion.
  const recoverable = await createUser('active');
  emails.push(recoverable.email);
  for (let attempt = 0; attempt < 5; attempt += 1) await requestAccountLink(recoverable.email, 'password_reset', 'scan-origin', timing);
  emails.push('scan-origin');
  const resetRaw = await rawRequestedToken(recoverable.id, 'password_reset');
  await consumeAccountToken(resetRaw, 'password_reset', PASSWORD);

  // Migration activation: one success, one reconciliation failure (missing imported profile).
  const graph = await createCompleteGraph();
  await sql`update idoc.users set account_state='migrated_pending', email_verified_at=null where id=${graph.user.id}`;
  emails.push(graph.user.email);
  await requestAccountLink(graph.user.email, 'migration_activation', 'scan-origin', timing);
  const activationRaw = await rawRequestedToken(graph.user.id, 'migration_activation');
  await consumeAccountToken(activationRaw, 'migration_activation', PASSWORD);

  const orphaned = await createUser('migrated_pending');
  emails.push(orphaned.email);
  const orphanedRaw = 'evidence-scan-orphaned-activation-token-12345';
  rawTokens.push(orphanedRaw);
  await sql`insert into idoc.account_tokens(user_id,purpose,token_hash,expires_at) values(${orphaned.id},'migration_activation',${digest(orphanedRaw)},now()+interval '1 hour')`;
  await consumeAccountToken(orphanedRaw, 'migration_activation', PASSWORD);

  // Account deletion.
  const deletable = await createUser();
  const deletableProfile = await createProfile(deletable.id);
  await createMembership(deletableProfile.id);
  emails.push(deletable.email);
  await withTestMembershipBoundary({ actor: { id: deletable.id, roles: [] } }, () => deleteOwnAccount());

  // Delivery worker: a provider failure that produces a retryable outcome (database/provider failure
  // path). The queue also still holds the two earlier, now-consumed-by-the-rate-limit-completion-above
  // outbox rows for `recoverable`, which will claim as 'ineligible' first — drain until 'empty' rather
  // than asserting the very next claim is `deliverable`'s row.
  const deliverable = await createUser('active');
  emails.push(deliverable.email);
  await requestAccountLink(deliverable.email, 'password_reset', 'scan-origin', timing);
  const failingSend = async () => { throw new Error(PROVIDER_FAILURE_MARKER); };
  const deliveryOutcomes: string[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await deliverNextAccountLink('scan-worker', { now: () => new Date(), send: failingSend });
    if (result.status === 'empty') break;
    deliveryOutcomes.push(result.status);
  }
  assert.ok(deliveryOutcomes.includes('retryable'), `expected a retryable outcome; saw: ${deliveryOutcomes.join(', ')}`);

  // Two scans, not one: audit_log/account_request_limits/notification_outbox/profile_change_history
  // are genuine append-only *evidence* — nothing they weren't specifically designed to hold, including
  // email/origin identifiers, belongs there. account_tokens/email_verification_tokens/
  // account_delivery_outbox are operational *state*, and email_verification_tokens.pending_email in
  // particular is legitimate business data (the address being verified) rather than a log; it is
  // checked for secrets/tokens/passwords but not for the presence of an email address, unlike the
  // evidence tables. (notification_outbox's `stripe.customer_email_sync` kind is a documented, narrow
  // exception that legitimately carries an email — not exercised by this sweep, since Release 1 has no
  // real Stripe billing wired yet; every notification this sweep actually produces is checked here.)
  const logEvidence = JSON.stringify({
    auditLog: await sql`select * from idoc.audit_log`,
    notificationOutbox: await sql`select * from idoc.notification_outbox`,
    profileChangeHistory: await sql`select * from idoc.profile_change_history`,
    rateLimits: await sql`select * from idoc.account_request_limits`,
  });
  const operationalState = JSON.stringify({
    accountDeliveryOutbox: await sql`select * from idoc.account_delivery_outbox`,
    accountTokens: await sql`select * from idoc.account_tokens`,
    emailVerificationTokens: await sql`select * from idoc.email_verification_tokens`,
  });

  for (const [label, evidence] of [['log evidence', logEvidence], ['operational state', operationalState]] as const) {
    assert.equal(evidence.includes(PASSWORD), false, `password leaked into ${label}`);
    assert.equal(evidence.includes(PROVIDER_FAILURE_MARKER), false, `a raw exception message leaked into ${label}`);
    assert.equal(evidence.includes(secrets.encryptionMaterial), false, `the encryption key material leaked into ${label}`);
    assert.equal(evidence.includes(secrets.rateLimitKey), false, `the rate-limit hashing secret leaked into ${label}`);
    for (const token of rawTokens) assert.equal(evidence.includes(token), false, `raw token leaked into ${label}: ${token}`);
  }
  for (const email of emails) assert.equal(logEvidence.includes(email), false, `email/origin identifier leaked into log evidence: ${email}`);
});

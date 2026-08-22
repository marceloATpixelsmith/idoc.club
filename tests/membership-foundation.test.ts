import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AuthorizationError, requireAdministrator, requireOwnerOrAdmin, requireSuperAdmin,
} from '../lib/membership/authorization.ts';
import { memberProfileSchema, normalizeEmail, onboardingConsentSchema } from '../lib/membership/validation.ts';
import { isEntitled } from '../lib/membership/entitlement.ts';
import { mayAccessAccountFunction } from '../lib/membership/account-access.ts';

const judge = {
  feiId: '10012345', idocRegion: 'Western Europe & Africa',
  isTechnicalDelegate: false, nationalFederationCountryCode: 'DE',
  officialStatuses: ['FEI Dressage Judge 1/2**'], roleType: 'judge',
};
const common = {
  address1: '1 Main Street', city: 'Aachen', countryCode: 'DE', firstName: 'Ada',
  lastName: 'Example', postalCode: '52062', stateProvince: 'NRW',
};

test('ownership rejects cross-account access but permits an administrator', () => {
  assert.throws(() => requireOwnerOrAdmin({ id: 1, roles: [] }, 2), AuthorizationError);
  assert.doesNotThrow(() => requireOwnerOrAdmin({ id: 1, roles: ['administrator'] }, 2));
});

test('a member cannot escalate to administrator or super admin', () => {
  assert.throws(() => requireAdministrator({ id: 1, roles: ['member'] }), AuthorizationError);
  assert.throws(() => requireSuperAdmin({ id: 1, roles: ['administrator'] }), AuthorizationError);
});

test('validation enforces official fields and canonical countries', () => {
  assert.equal(memberProfileSchema.safeParse({ ...common, roles: [{ roleType: 'judge' }] }).success, false);
  assert.equal(memberProfileSchema.safeParse({ ...common, countryCode: 'XX', roles: [judge] }).success, false);
  assert.equal(memberProfileSchema.safeParse({ ...common, roles: [judge] }).success, true);
});

test('only Judge plus Steward is a valid combined classification', () => {
  assert.equal(memberProfileSchema.safeParse({ ...common, roles: [judge, { roleType: 'veterinarian' }] }).success, false);
});

test('onboarding consent requires both Terms and Privacy acknowledgment but not the marketing opt-in', () => {
  const valid = { keepUpdated: false, privacyAccepted: true, termsAccepted: true };
  assert.equal(onboardingConsentSchema.safeParse(valid).success, true);
  assert.equal(onboardingConsentSchema.safeParse({ ...valid, termsAccepted: false }).success, false);
  assert.equal(onboardingConsentSchema.safeParse({ ...valid, privacyAccepted: false }).success, false);
  assert.equal(onboardingConsentSchema.safeParse({ ...valid, keepUpdated: true }).success, true);
});

test('email usernames are normalized and validated', () => {
  assert.equal(normalizeEmail(' Member@IDOC.Club '), 'member@idoc.club');
  assert.throws(() => normalizeEmail('not-email'));
});

test('entitlement comes from current IDOC membership dates and status', () => {
  assert.equal(isEntitled({ status: 'active', validUntil: '2027-01-01' }, '2026-08-11'), true);
  assert.equal(isEntitled({ status: 'suspended', validUntil: '2027-01-01' }, '2026-08-11'), false);
  assert.equal(isEntitled({ status: 'active', validUntil: '2026-01-01' }, '2026-08-11'), false);
});

test('migration makes audit and profile history immutable', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0002_blue_the_anarchist.sql', import.meta.url), 'utf8');
  assert.match(migration, /audit_log_immutable/);
  assert.match(migration, /profile_change_history_immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
});

test('registration does not create starter teams or return password values', () => {
  const actions = readFileSync(new URL('../app/(login)/actions.ts', import.meta.url), 'utf8');
  const signUpBody = actions.slice(actions.indexOf('export const signUp'), actions.indexOf('export async function signOut'));
  assert.doesNotMatch(signUpBody, /insert\(teams\)|insert\(teamMembers\)/);
  assert.doesNotMatch(actions, /return\s*\{[^}]*\n\s*(currentPassword|newPassword|confirmPassword|password)\s*[,}:]/s);
});

test('verification uses digests, one-time claims, and the approved sender boundary', () => {
  const verification = readFileSync(new URL('../lib/membership/email-verification.ts', import.meta.url), 'utf8');
  const mail = readFileSync(new URL('../lib/notifications/mailchimp-transactional.ts', import.meta.url), 'utf8');
  assert.match(verification, /createHash\('sha256'\)/);
  assert.match(verification, /isNull\(emailVerificationTokens\.consumedAt\)/);
  assert.match(verification, /gt\(emailVerificationTokens\.expiresAt/);
  assert.doesNotMatch(verification, /return token/);
  assert.match(mail, /accounts@idoc\.club/);
});

test('verification delivery is recoverable and Stripe synchronization remains retryable', () => {
  const actions = readFileSync(new URL('../app/(login)/actions.ts', import.meta.url), 'utf8');
  const verification = readFileSync(new URL('../lib/membership/email-verification.ts', import.meta.url), 'utf8');
  assert.match(actions, /export const resendVerification/);
  assert.match(actions, /If an unverified account uses this address/);
  assert.match(verification, /kind: 'stripe\.customer_email_sync'/);
  assert.match(verification, /THE OUTBOX RECORD RETAINS THE JOB FOR A RETRYING WORKER/);
});

test('onboarding conditionally renders approved professional fields', () => {
  const form = readFileSync(new URL('../app/(dashboard)/onboarding/onboarding-wizard.tsx', import.meta.url), 'utf8');
  assert.match(form, /classification !== 'veterinarian'/);
  assert.match(form, /classification === 'judge' \|\| classification === 'judge_steward'/);
  assert.match(form, /classification === 'steward' \|\| classification === 'judge_steward'/);
});

test('member billing linkage preserves external Stripe identity', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0004_member_billing_accounts.sql', import.meta.url), 'utf8');
  const stripeBoundary = readFileSync(new URL('../lib/payments/customer-email.ts', import.meta.url), 'utf8');
  assert.match(migration, /external_customer_id.*UNIQUE/s);
  assert.match(stripeBoundary, /customers\.update\(customerId, \{ email \}\)/);
  assert.doesNotMatch(stripeBoundary, /customers\.create/);
});

test('account-state policy blocks suspension and permits expired account maintenance', () => {
  const actor = { id: 1, roles: ['member'] };
  assert.equal(mayAccessAccountFunction({ accountState: 'suspended', actor, entitled: true }, 'profile'), false);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor, entitled: false }, 'profile'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor, entitled: false }, 'renewal'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'migrated_pending', actor, entitled: true }, 'profile'), false);
  assert.equal(mayAccessAccountFunction({ accountState: 'deleted', actor, entitled: true }, 'profile'), false);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor, entitled: true }, 'administration'), false);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: { id: 2, roles: ['super_admin'] }, entitled: false }, 'administration'), true);
});

test('account-state policy separates onboarding, member, administration, and expired access', () => {
  const member = { id: 1, roles: ['member'] };
  const administrator = { id: 2, roles: ['administrator'] };
  const superAdmin = { id: 3, roles: ['super_admin'] };
  for (const accountState of ['unverified', 'suspended', 'migrated_pending', 'deleted'] as const) {
    assert.equal(mayAccessAccountFunction({ accountState, actor: superAdmin, entitled: true }, 'administration'), false);
    assert.equal(mayAccessAccountFunction({ accountState, actor: member, entitled: true }, 'profile'), false);
  }
  assert.equal(mayAccessAccountFunction({ accountState: 'onboarding', actor: member, entitled: false }, 'onboarding'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'onboarding', actor: member, entitled: false }, 'account'), false);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: member, entitled: true }, 'member'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: member, entitled: false }, 'member'), false);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: member, entitled: false }, 'profile'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: administrator, entitled: false }, 'administration'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: superAdmin, entitled: false }, 'administration'), true);
  assert.equal(mayAccessAccountFunction({ accountState: 'active', actor: member, entitled: true }, 'administration'), false);
});

test('recovery and activation store digests, claim once, and revoke sessions', () => {
  const source = readFileSync(new URL('../lib/membership/account-recovery.ts', import.meta.url), 'utf8');
  const delivery = readFileSync(new URL('../lib/notifications/account-delivery.ts', import.meta.url), 'utf8');
  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /isNull\(accountTokens\.consumedAt\)/);
  assert.match(source, /sessionVersion.*\+ 1/s);
  assert.doesNotMatch(source, /tokenHash:\s*rawToken/);
  assert.match(source, /delivery_queued/);
  assert.match(delivery, /delivery_succeeded/);
  assert.match(delivery, /temporary_delivery_failure/);
  assert.match(delivery, /ne\(accountTokens\.id, record\.tokenId\)/);
});

test('ordinary sign-in returns a neutral credential failure for blocked account states', () => {
  const actions = readFileSync(new URL('../app/(login)/actions.ts', import.meta.url), 'utf8');
  assert.match(actions, /\['active', 'onboarding'\]\.includes\(foundUser\.accountState\)/);
  assert.doesNotMatch(actions, /Verify your email before signing in/);
});

test('onboarding profile completion atomically activates only onboarding accounts', () => {
  const access = readFileSync(new URL('../lib/membership/data-access.ts', import.meta.url), 'utf8');
  assert.match(access, /for update/);
  assert.match(access, /account\.account_state !== 'onboarding'/);
  assert.match(access, /account\.onboarding\.completed/);
  assert.match(access, /accountState: 'active'/);
});

test('migrated activation requires imported profile, role, entitlement, and mapping foundations', () => {
  const recovery = readFileSync(new URL('../lib/membership/account-recovery.ts', import.meta.url), 'utf8');
  assert.match(recovery, /missing_imported_profile/);
  assert.match(recovery, /incomplete_import_foundation/);
  assert.match(recovery, /migrationMap/);
  assert.match(recovery, /migrationMap\.legacyType/);
  assert.match(recovery, /migrationMap\.disposition/);
});

test('migration 0005 deliberately replaces the normalized-email index from migration 0002', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0005_release_one_account_tokens.sql', import.meta.url), 'utf8');
  assert.match(migration, /DROP INDEX IF EXISTS "idoc"\."users_normalized_email_unique"/);
  assert.match(migration, /CREATE UNIQUE INDEX "users_normalized_email_unique"/);
});

test('profile edits are atomic and notification delivery retains retry history', () => {
  const access = readFileSync(new URL('../lib/membership/data-access.ts', import.meta.url), 'utf8');
  const delivery = readFileSync(new URL('../lib/notifications/profile-change-delivery.ts', import.meta.url), 'utf8');
  assert.match(access, /db\.transaction/);
  assert.match(access, /effectiveTo: now/);
  assert.match(access, /administrator\.profile_changed/);
  assert.match(delivery, /temporary_delivery_failure/);
  assert.match(delivery, /attemptCount/);
});

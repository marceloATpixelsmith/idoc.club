import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoogleAccountLinkRequiredError,
  GoogleAccountNotEligibleError,
  authenticateGoogleIdentity,
} from '../lib/auth/google-account.ts';
import type { GoogleOidcIdentity } from '../lib/auth/google-oidc-reference.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

function identity(overrides: Partial<GoogleOidcIdentity> = {}): GoogleOidcIdentity {
  return {
    issuer: 'https://accounts.google.com',
    subject: `subject-${Math.random().toString(36).slice(2)}`,
    email: `googleuser-${Math.random().toString(36).slice(2)}@example.test`,
    emailVerified: true,
    name: 'Google Test User',
    picture: null,
    returnTo: '/dashboard',
    oauthTransactionPurpose: 'authentication',
    oauthAuthenticatedUserId: null,
    ...overrides,
  };
}

test.beforeEach(resetIdoc);
test.after(closeHarness);

test('a first-time Google identity with a verified email and no existing account creates a new onboarding account and a linked identity row', async () => {
  const claim = identity();
  const result = await authenticateGoogleIdentity(claim);
  assert.equal(result.newAccount, true);
  assert.equal(result.redirectTo, '/onboarding');
  assert.equal(result.user.accountState, 'onboarding');
  assert.equal(result.user.email, claim.email);

  const [row] = await sql<{ issuer: string; subject: string; user_id: number }[]>`
    select issuer, subject, user_id from idoc.external_identities where subject = ${claim.subject}`;
  assert.equal(row.issuer, claim.issuer);
  assert.equal(row.user_id, result.user.id);
});

test('a returning Google identity (an existing external_identities row) authenticates the same account and updates last_used_at, without creating a duplicate user', async () => {
  const claim = identity();
  const first = await authenticateGoogleIdentity(claim);
  const [before] = await sql<{ last_used_at: Date }[]>`
    select last_used_at from idoc.external_identities where subject = ${claim.subject}`;

  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await authenticateGoogleIdentity(identity({ issuer: claim.issuer, subject: claim.subject, email: claim.email }));

  assert.equal(second.newAccount, false);
  assert.equal(second.user.id, first.user.id);
  const [[{ count }]] = [await sql<{ count: string }[]>`select count(*)::int as count from idoc.users where email = ${claim.email}`];
  assert.equal(Number(count), 1);
  const [after] = await sql<{ last_used_at: Date }[]>`
    select last_used_at from idoc.external_identities where subject = ${claim.subject}`;
  assert.ok(new Date(after.last_used_at).getTime() >= new Date(before.last_used_at).getTime());
});

test('a Google identity with no verified email is rejected and creates no user or identity row', async () => {
  const claim = identity({ emailVerified: false });
  await assert.rejects(() => authenticateGoogleIdentity(claim), GoogleAccountNotEligibleError);
  const [[{ count }]] = [await sql<{ count: string }[]>`select count(*)::int as count from idoc.external_identities where subject = ${claim.subject}`];
  assert.equal(Number(count), 0);
});

test('a Google identity with no email at all is rejected and creates no user or identity row', async () => {
  const claim = identity({ email: null });
  await assert.rejects(() => authenticateGoogleIdentity(claim), GoogleAccountNotEligibleError);
  const [[{ count }]] = [await sql<{ count: string }[]>`select count(*)::int as count from idoc.external_identities where subject = ${claim.subject}`];
  assert.equal(Number(count), 0);
});

test('a Google email matching an existing local account with no linked Google identity is rejected as link-required, never auto-linked', async () => {
  const existing = await createUser();
  const claim = identity({ email: existing.email });
  await assert.rejects(() => authenticateGoogleIdentity(claim), GoogleAccountLinkRequiredError);

  const [[{ count: identityCount }]] = [await sql<{ count: string }[]>`
    select count(*)::int as count from idoc.external_identities where subject = ${claim.subject}`];
  assert.equal(Number(identityCount), 0, 'no external_identities row may be created on a link-required rejection');

  const [[{ count: userCount }]] = [await sql<{ count: string }[]>`
    select count(*)::int as count from idoc.users where email = ${existing.email}`];
  assert.equal(Number(userCount), 1, 'no duplicate user is created for the same normalized email either');
});

test('email matching is case- and whitespace-normalized so an attacker cannot bypass link-required by casing/whitespace variants', async () => {
  const existing = await createUser();
  const claim = identity({ email: `  ${existing.email.toUpperCase()}  ` });
  await assert.rejects(() => authenticateGoogleIdentity(claim), GoogleAccountLinkRequiredError);
});

test('a linked identity whose account has since become ineligible (suspended) is rejected on subsequent Google login', async () => {
  const claim = identity();
  const first = await authenticateGoogleIdentity(claim);
  await sql`update idoc.users set account_state = 'suspended' where id = ${first.user.id}`;
  await assert.rejects(
    () => authenticateGoogleIdentity(identity({ issuer: claim.issuer, subject: claim.subject, email: claim.email })),
    GoogleAccountNotEligibleError,
  );
});

test('a linked identity whose account has been deleted is rejected on subsequent Google login', async () => {
  const claim = identity();
  const first = await authenticateGoogleIdentity(claim);
  await sql`update idoc.users set account_state = 'deleted' where id = ${first.user.id}`;
  await assert.rejects(
    () => authenticateGoogleIdentity(identity({ issuer: claim.issuer, subject: claim.subject, email: claim.email })),
    GoogleAccountNotEligibleError,
  );
});

test('two different Google subjects under the same issuer create two independent accounts even with similar profile data', async () => {
  const a = identity();
  const b = identity();
  const resultA = await authenticateGoogleIdentity(a);
  const resultB = await authenticateGoogleIdentity(b);
  assert.notEqual(resultA.user.id, resultB.user.id);
});

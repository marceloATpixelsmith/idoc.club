import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { consumeEmailVerification, issueEmailVerification } from '../lib/membership/email-verification.ts';
import { closeHarness, concurrently, createCompleteGraph, createUser, persistedGraph, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(async () => {
  process.env.BASE_URL = 'https://idoc.club';
  process.env.MAILCHIMP_TRANSACTIONAL_API_KEY = 'integration-only-provider-key-32-chars-plus';
  await resetIdoc();
});
after(closeHarness);

// This exercises the production call path a standalone, authenticated email-change action
// (`updateAccount` in app/(login)/actions.ts) actually uses: issueEmailVerification to create the
// pending change, and consumeEmailVerification to commit it once the member clicks the link. The
// registration-verification tests in account-token-lifecycles.integration.ts prove consumption is
// atomic and graph-preserving; these tests prove the issuance side those tests never exercise.

function capturedToken(html: string): string {
  return new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;
}

test('issuing an email change for an active member does not mutate the email until the token is consumed, and the full round trip commits only the email', async () => {
  const originalFetch = globalThis.fetch;
  let raw = '';
  globalThis.fetch = async (_input, init) => {
    const message = JSON.parse(String(init?.body)).message;
    assert.deepEqual(message.to, [{ email: 'changed@example.test', type: 'to' }]);
    raw = capturedToken(message.html);
    return new Response('[{"status":"sent"}]', { status: 200 });
  };
  try {
    const { user } = await createCompleteGraph();
    const before = await persistedGraph(user.id);
    const result = await issueEmailVerification(user.id, '  Changed@Example.TEST  ');
    assert.equal(result.delivered, true);
    assert.ok(raw);

    const afterIssuance = await persistedGraph(user.id);
    assert.deepEqual(afterIssuance, before, 'issuance must not mutate the identity graph');
    const [pending] = await sql`select pending_email, pending_email_display, consumed_at from idoc.email_verification_tokens where user_id=${user.id}`;
    assert.equal(pending.pending_email, 'changed@example.test');
    // AUTH-IDENTITY-003: the normalized (lowercased) form governs identity/uniqueness, but the
    // display form the member actually typed -- trimmed, casing intact -- is carried through the
    // transaction separately so it can be shown back to them once the change completes.
    assert.equal(pending.pending_email_display, 'Changed@Example.TEST');
    assert.equal(pending.consumed_at, null);

    assert.equal((await consumeEmailVerification(raw)).status, 'verified');
    const afterConsumption = await persistedGraph(user.id);
    assert.equal(afterConsumption.user.id, before.user.id);
    assert.equal(afterConsumption.user.email, 'changed@example.test');
    assert.equal(afterConsumption.user.email_display, 'Changed@Example.TEST');
    assert.equal(afterConsumption.user.accountState, before.user.accountState);
    assert.equal(afterConsumption.profile.id, before.profile.id);
    assert.deepEqual(afterConsumption.roles, before.roles);
    assert.deepEqual(afterConsumption.membership, before.membership);
    assert.deepEqual(afterConsumption.billing, before.billing);
    assert.deepEqual(afterConsumption.migration, before.migration);
    assert.deepEqual(afterConsumption.profileHistory, before.profileHistory);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a superseding email-change request invalidates the prior pending token for that member only', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[{"status":"sent"}]', { status: 200 });
  try {
    const member = await createUser();
    const other = await createUser();
    await issueEmailVerification(other.id, 'other-pending@example.test');
    await issueEmailVerification(member.id, 'first-choice@example.test');
    await issueEmailVerification(member.id, 'second-choice@example.test');

    const rows = await sql`select pending_email, consumed_at from idoc.email_verification_tokens where user_id=${member.id} order by id`;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].pending_email, 'first-choice@example.test');
    assert.notEqual(rows[0].consumed_at, null);
    assert.equal(rows[1].pending_email, 'second-choice@example.test');
    assert.equal(rows[1].consumed_at, null);

    const [otherRow] = await sql`select consumed_at from idoc.email_verification_tokens where user_id=${other.id}`;
    assert.equal(otherRow.consumed_at, null, "a different member's pending token must not be touched");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email delivery failure during an email-change request leaves a valid, still-consumable token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider unreachable'); };
  try {
    const { user } = await createCompleteGraph();
    const result = await issueEmailVerification(user.id, 'undelivered@example.test');
    assert.equal(result.delivered, false);
    const [token] = await sql`select expires_at, consumed_at, token_hash from idoc.email_verification_tokens where user_id=${user.id}`;
    assert.equal(token.consumed_at, null);
    assert.ok(new Date(token.expires_at) > new Date());
    assert.ok(token.token_hash);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('two members racing to claim the same new email atomically resolve to exactly one winner', async () => {
  const originalFetch = globalThis.fetch;
  const rawTokens: string[] = [];
  globalThis.fetch = async (_input, init) => {
    rawTokens.push(capturedToken(JSON.parse(String(init?.body)).message.html));
    return new Response('[{"status":"sent"}]', { status: 200 });
  };
  try {
    const first = await createUser();
    const second = await createUser();
    const contested = 'contested@example.test';
    await issueEmailVerification(first.id, contested);
    await issueEmailVerification(second.id, contested);
    assert.equal(rawTokens.length, 2);

    const outcomes = await concurrently(
      () => consumeEmailVerification(rawTokens[0]),
      () => consumeEmailVerification(rawTokens[1]),
    );
    const statuses = outcomes.map((outcome) => outcome.status === 'fulfilled' ? outcome.value.status : 'rejected').sort();
    assert.deepEqual(statuses, ['invalid', 'verified']);

    const [firstAfter] = await sql`select email from idoc.users where id=${first.id}`;
    const [secondAfter] = await sql`select email from idoc.users where id=${second.id}`;
    const claimants = [firstAfter.email, secondAfter.email].filter((email) => email === contested);
    assert.equal(claimants.length, 1, 'exactly one member may end up with the contested email');
    assert.equal((await sql`select count(*)::int as count from idoc.users where email=${contested}`)[0].count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression test for a Codex review finding on the pull request that fixed the exact-match race
// above: the pre-commit existence check compares against the already-lowercased `pendingEmail`, so it
// misses an existing user stored with different casing (plausible for legacy/migrated data, since the
// `users.email` column itself has no case-enforcing constraint) -- that collision is caught only by
// `users_normalized_email_unique` (`lower(email)`, schema.ts), a distinct constraint from
// `users_email_unique`, and must resolve to the same graceful 'invalid' outcome, not an uncaught error.
test('claiming an address that collides only case-insensitively with an existing member resolves to invalid, not a server error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[{"status":"sent"}]', { status: 200 });
  try {
    const [mixedCaseOwner] = await sql<{ id: number }[]>`
      insert into idoc.users (email,password_hash,email_verified_at,account_state)
      values ('Mixed.Case@Example.TEST', 'fixture-password-hash', now(), 'active')
      returning id`;
    const claimant = await createUser();
    let raw = '';
    globalThis.fetch = async (_input, init) => {
      raw = capturedToken(JSON.parse(String(init?.body)).message.html);
      return new Response('[{"status":"sent"}]', { status: 200 });
    };
    await issueEmailVerification(claimant.id, 'mixed.case@example.test');
    assert.ok(raw);

    const result = await consumeEmailVerification(raw);
    assert.deepEqual(result, { status: 'invalid' });

    const [claimantAfter] = await sql`select email from idoc.users where id=${claimant.id}`;
    assert.notEqual(claimantAfter.email, 'mixed.case@example.test');
    const [ownerAfter] = await sql`select email from idoc.users where id=${mixedCaseOwner.id}`;
    assert.equal(ownerAfter.email, 'Mixed.Case@Example.TEST', "the existing member's row must be untouched");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

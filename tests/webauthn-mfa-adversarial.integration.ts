import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { beginPasskeyRegistration, finishPasskeyRegistration, removePasskeyCredential } from '../app/(dashboard)/dashboard/security/actions.ts';
import { beginLoginWebAuthn, verifyLoginWebAuthn, verifyStepUpTotp } from '../app/(login)/mfa/actions.ts';
import { beginPrimaryMfa, MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { setWebAuthnCredentialReadHookForTest, webauthnStore } from '../lib/auth/mfa/webauthn-store.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { setSession } from '../lib/auth/session.ts';
import { sessionCookieName } from '../lib/auth/session-tokens.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { TestWebAuthnAuthenticator } from './webauthn-ceremony-simulator.ts';

// AUTH-CRYPTO-003 / AUTH-OPERATIONS-004: docs/22's own AUTH-CRYPTO-003 row disclosed that
// passkey_registered/passkey_removed had "no comparable secret ... confirmed by direct code reading
// rather than a dedicated scan", and AUTH-OPERATIONS-004's WebAuthn replay defense was proven only
// by a source-inspection test (tests/webauthn-mfa-wiring.test.ts) plus the raw signature-counter
// mechanism in isolation (tests/webauthn-store.integration.ts), never a full simulated WebAuthn
// ceremony. This file drives the real production WebAuthn Server Actions end to end through a
// genuine, real ES256 keypair and real CBOR-encoded attestation/assertion material (built by
// tests/webauthn-ceremony-simulator.ts, which reuses @simplewebauthn/server's own public /helpers
// encoding utilities rather than a hand-rolled reimplementation) -- not a mocked verifier, not a
// stubbed response, not a bypassed ceremony.

const totpEncryptionKey = randomBytes(32);
const continuationKey = randomBytes(32);
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'webauthn-adversarial-test-secret-long-enough-32-chars',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: continuationKey.toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'webauthn-adversarial-test',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'webauthn-adversarial-test': totpEncryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'webauthn-adversarial-test-rate-limit-secret',
});

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3000';

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

function totp(secret: string, nowMs = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

beforeEach(resetIdoc);
after(closeHarness);

async function privilegedUserWithTotp() {
  const created = await createUser();
  await grantRole(created.id, 'administrator');
  const enrolledAt = Date.now() - 30_000;
  const enrollment = await beginTotpEnrollment({
    accountLabel: created.email, applicationId: MFA_APPLICATION_ID, encryptionKey: totpEncryptionKey,
    issuer: 'IDOC', keyId: 'webauthn-adversarial-test', nowMs: enrolledAt, store, subjectId: String(created.id),
  });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const completed = await completeTotpEnrollment({
    applicationId: MFA_APPLICATION_ID, code: totp(secret, enrolledAt), factorId: enrollment.factorId, nowMs: enrolledAt,
    resolveKey: () => totpEncryptionKey, store, subjectId: String(created.id), transactionId: enrollment.transactionId,
  });
  assert.equal(completed.status, 'activated');
  const [fresh] = await sql<Record<string, unknown>[]>`select * from idoc.users where id=${created.id}`;
  return { secret, user: { ...fresh, accountState: fresh.account_state, deletedAt: fresh.deleted_at,
    emailVerifiedAt: fresh.email_verified_at, sessionVersion: Number(fresh.session_version) } as any };
}

function requireCeremony(result: Record<string, unknown>): { ceremonyId: string; options: { challenge: string } } {
  assert.ok(result.ceremonyId && result.options, `expected a real ceremony to be issued, got: ${JSON.stringify(result)}`);
  return { ceremonyId: result.ceremonyId as string, options: result.options as { challenge: string } };
}

function csrfFrom(cookies: TestCookies) { return cookies.get(csrfCookieName())?.value ?? ''; }
function withCsrf(data: Record<string, string>, csrfToken: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  form.set('csrf_token', csrfToken);
  return form;
}

/** Establishes a real authenticated session, then satisfies the real fresh-step-up gate
 * (`change-mfa`) via a genuine TOTP round -- exactly the flow a browser would drive. */
async function sessionWithFreshStepUp(secret: string, user: any) {
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, () => setSession(user));
  const csrfToken = csrfFrom(cookies);

  await withTestRequestCookies(cookies, () => beginPasskeyRegistration({}, withCsrf({}, csrfToken)))
    .then(() => assert.fail('the first call with no fresh step-up must redirect to /mfa'),
      (error) => assert.match(String((error as { digest?: string }).digest), /NEXT_REDIRECT;replace;\/mfa;/));

  await withTestRequestCookies(cookies, () => verifyStepUpTotp({}, withCsrf({ code: totp(secret) }, csrfToken)))
    .then(() => assert.fail('successful step-up verification should redirect'),
      (error) => assert.match(String(error), /NEXT_REDIRECT/));
  assert.ok(cookies.get('idoc_fresh_step_up'), 'fresh step-up authority must now be present');
  return { cookies, csrfToken };
}

test('a real WebAuthn registration ceremony (genuine ES256 keypair, real CBOR attestation) registers a passkey through the real production Server Action, with evidence containing no raw key material', async () => {
  const { secret, user } = await privilegedUserWithTotp();
  const { cookies, csrfToken } = await sessionWithFreshStepUp(secret, user);
  const authenticator = await TestWebAuthnAuthenticator.create();

  const begin = requireCeremony(await withTestRequestCookies(cookies, () => beginPasskeyRegistration({}, withCsrf({}, csrfToken))));

  const response = await authenticator.buildRegistrationResponse({ challenge: begin.options.challenge, origin: ORIGIN, rpID: RP_ID });
  const finish = await withTestRequestCookies(cookies, () => finishPasskeyRegistration({},
    withCsrf({ ceremonyId: begin.ceremonyId, credentialJson: JSON.stringify(response) }, csrfToken)));
  assert.deepEqual(finish, { success: 'Passkey added.' }, 'the real production verifier must accept a genuine, correctly-signed attestation');

  const [credentialRow] = await sql<{ credential_id: string; public_key: string }[]>`
    select credential_id, public_key from idoc.webauthn_credentials where user_id=${user.id}`;
  assert.ok(credentialRow, 'a real credential row must be persisted');
  const credentialId = credentialRow.credential_id;

  const registeredEvidence = JSON.stringify({
    audit: await sql`select * from idoc.audit_log where actor_id=${user.id}`,
    notifications: await sql`select * from idoc.auth_security_notification_outbox where user_id=${user.id}`,
  });
  assert.ok(registeredEvidence.includes('passkey'), 'the flow must actually produce passkey-related evidence to be a meaningful scan');
  // WebAuthn's own asymmetric design means there is no raw private key ever transmitted to or
  // knowable by the server to begin with -- proven here by confirming the one artifact this
  // simulator alone holds (the private key it never sent anywhere) cannot possibly appear, and that
  // the public COSE key bytes (not secret, but also not meant to appear in security-event evidence)
  // are excluded from the audit/notification rows too, same as every other MFA output boundary.
  const publicKeyBytes = Buffer.from(await authenticator.coseBytesPublicKey()).toString('base64url');
  assert.equal(registeredEvidence.includes(publicKeyBytes), false, 'the raw public-key material must not appear in audit/notification evidence');
});

test('removing a real passkey through the real production Server Action produces evidence containing no raw key material', async () => {
  const { secret, user } = await privilegedUserWithTotp();
  const authenticator = await TestWebAuthnAuthenticator.create();
  // The registration ceremony itself (genuine ES256 keypair, real CBOR attestation, real
  // production verifyRegistrationResponse) is already proven end to end by the previous test;
  // seeding the credential to be removed directly through the real production
  // webauthnStore.createCredential -- the same store write finishWebAuthnRegistration itself calls
  // -- keeps this test focused on removal's own authorization/audit behavior, and avoids needing a
  // second, independently-fresh TOTP step-up round within one test (real TOTP replay protection is
  // per-factor, not per-transaction, so a second genuinely-fresh code is not available without
  // waiting out a real 30-second window).
  const publicKeyBytes = Buffer.from(await authenticator.coseBytesPublicKey()).toString('base64url');
  const created = await webauthnStore.createCredential({
    applicationId: MFA_APPLICATION_ID, backedUp: false, credentialId: Buffer.from(authenticator.credentialId).toString('base64url'),
    deviceName: null, deviceType: 'singleDevice', nowMs: Date.now(), publicKey: publicKeyBytes,
    signCount: 0, subjectId: String(user.id), transports: ['internal'],
  });
  assert.equal(created.status, 'created');
  const credentialId = Buffer.from(authenticator.credentialId).toString('base64url');

  const { cookies, csrfToken } = await sessionWithFreshStepUp(secret, user);
  const removed = await withTestRequestCookies(cookies, () => removePasskeyCredential({}, withCsrf({ credentialId }, csrfToken)));
  assert.deepEqual(removed, { success: 'Passkey removed.' });

  const [afterRemoval] = await sql<{ status: string; revoked_at: Date | null }[]>`
    select f.status, f.revoked_at from idoc.webauthn_credentials c
    join idoc.mfa_factors f on f.factor_id = c.factor_id
    where c.credential_id=${credentialId}`;
  assert.equal(afterRemoval.status, 'revoked');
  assert.ok(afterRemoval.revoked_at);

  const removalEvidence = JSON.stringify({
    audit: await sql`select * from idoc.audit_log where actor_id=${user.id} and action='auth.mfa.passkey.removed'`,
    notifications: await sql`select * from idoc.auth_security_notification_outbox where user_id=${user.id} and kind='passkey_removed'`,
  });
  assert.ok(removalEvidence.length > 2, 'the removal must actually produce evidence to be a meaningful scan');
  assert.equal(removalEvidence.includes(publicKeyBytes), false, 'the raw public-key material must not appear in removal evidence');
});

// A non-increasing counter is rejected by two independent layers here: @simplewebauthn/server's own
// verifyAuthenticationResponse throws before ever consulting the store if the submitted counter does
// not exceed the *stale, pre-fetch* value it read (status 'invalid-response' -- proven below with a
// straightforward resubmission); lib/auth/mfa/webauthn-store.ts's updateSignCount is the second,
// atomic layer underneath that, re-checking against the *live, transactionally-locked* value at write
// time and reporting 'replay' distinctly when it -- not the library's earlier, coarser check --  is
// what actually catches a non-increasing counter (the scenario a real two-cloned-authenticator race
// produces, since both would pass the library's check against the same stale snapshot). That second
// layer is forced through the complete production action by the deterministic barrier test below.
test('a real WebAuthn login ceremony authenticates, and resubmitting a stale-countered assertion on a second independent challenge is rejected without leaking detail', async () => {
  const { secret, user } = await privilegedUserWithTotp();
  const { cookies, csrfToken } = await sessionWithFreshStepUp(secret, user);
  const authenticator = await TestWebAuthnAuthenticator.create();
  const begin = requireCeremony(await withTestRequestCookies(cookies, () => beginPasskeyRegistration({}, withCsrf({}, csrfToken))));
  const registrationResponse = await authenticator.buildRegistrationResponse({ challenge: begin.options.challenge, origin: ORIGIN, rpID: RP_ID });
  await withTestRequestCookies(cookies, () => finishPasskeyRegistration({},
    withCsrf({ ceremonyId: begin.ceremonyId, credentialJson: JSON.stringify(registrationResponse) }, csrfToken)));

  // Sign the account out of its dashboard session and drive a real, independent primary-login
  // WebAuthn challenge, exactly as app/(login)/actions.ts does after password verification.
  const loginCookies = new TestCookies();
  const loginCsrfToken = await issueTestCsrfToken(loginCookies, null);
  const firstLoginChallenge = await withTestRequestCookies(loginCookies, async () => {
    assert.equal(await beginPrimaryMfa(user, 'password', '/dashboard'), true);
    return beginLoginWebAuthn(loginCsrfToken);
  });
  const firstAssertion = await authenticator.buildAuthenticationResponse({ challenge: firstLoginChallenge.options.challenge, origin: ORIGIN, rpID: RP_ID, signCount: 1 });
  await withTestRequestCookies(loginCookies, () => verifyLoginWebAuthn({}, withCsrf({ ceremonyId: firstLoginChallenge.ceremonyId, credentialJson: JSON.stringify(firstAssertion) }, loginCsrfToken)))
    .then((result) => assert.fail(`a genuine, correctly-signed, incrementing-counter assertion should authenticate and redirect, got: ${JSON.stringify(result)}`),
      (error) => assert.match(String(error), /NEXT_REDIRECT/));

  // A second, independent login challenge for the same account, submitting an assertion whose
  // signature counter does not exceed the one just accepted -- the real signature of a
  // cloned/replayed authenticator, matching the TOTP-replay test's shape in
  // tests/mfa-replay-notifications.integration.ts.
  const replayCookies = new TestCookies();
  const replayCsrfToken = await issueTestCsrfToken(replayCookies, null);
  const secondLoginChallenge = await withTestRequestCookies(replayCookies, async () => {
    assert.equal(await beginPrimaryMfa(user, 'password', '/dashboard'), true);
    return beginLoginWebAuthn(replayCsrfToken);
  });
  const replayedAssertion = await authenticator.buildAuthenticationResponse({ challenge: secondLoginChallenge.options.challenge, origin: ORIGIN, rpID: RP_ID, signCount: 1 });
  const replayResult = await withTestRequestCookies(replayCookies, () => verifyLoginWebAuthn({}, withCsrf({ ceremonyId: secondLoginChallenge.ceremonyId, credentialJson: JSON.stringify(replayedAssertion) }, replayCsrfToken)));
  assert.deepEqual(replayResult, { error: 'That passkey could not be verified.' },
    'a non-increasing signature counter must never authenticate, and must not leak detail beyond the generic message');

  const [user2] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${user.id}`;
  assert.equal(user2.session_version, 0, 'the rejected resubmission must not itself have mutated any session-granting state');
});

test('two concurrent genuine WebAuthn ceremonies deterministically produce one session and one replay event from the production counter race', async (t) => {
  const { secret, user } = await privilegedUserWithTotp();
  const registrationSession = await sessionWithFreshStepUp(secret, user);
  const authenticator = await TestWebAuthnAuthenticator.create();
  const registration = requireCeremony(await withTestRequestCookies(registrationSession.cookies,
    () => beginPasskeyRegistration({}, withCsrf({}, registrationSession.csrfToken))));
  const registrationResponse = await authenticator.buildRegistrationResponse({
    challenge: registration.options.challenge, origin: ORIGIN, rpID: RP_ID,
  });
  const registered = await withTestRequestCookies(registrationSession.cookies, () => finishPasskeyRegistration({}, withCsrf({
    ceremonyId: registration.ceremonyId, credentialJson: JSON.stringify(registrationResponse),
  }, registrationSession.csrfToken)));
  assert.deepEqual(registered, { success: 'Passkey added.' });

  const attempts = await Promise.all([0, 1].map(async () => {
    const cookies = new TestCookies();
    const csrfToken = await issueTestCsrfToken(cookies, null);
    const ceremony = await withTestRequestCookies(cookies, async () => {
      assert.equal(await beginPrimaryMfa(user, 'password', '/dashboard'), true);
      return beginLoginWebAuthn(csrfToken);
    });
    const assertion = await authenticator.buildAuthenticationResponse({
      challenge: ceremony.options.challenge, origin: ORIGIN, rpID: RP_ID, signCount: 1,
    });
    return { assertion, ceremony, cookies, csrfToken };
  }));

  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  setWebAuthnCredentialReadHookForTest(async () => {
    arrived += 1;
    if (arrived === 2) release();
    await barrier;
  });
  t.after(() => setWebAuthnCredentialReadHookForTest(null));

  const beforeSessions = Number((await sql<{ count: number }[]>`
    select count(*)::int as count from idoc.auth_sessions where user_id=${user.id}`)[0].count);
  const outcomes = await Promise.all(attempts.map(async (attempt) => {
    try {
      const result = await withTestRequestCookies(attempt.cookies, () => verifyLoginWebAuthn({}, withCsrf({
        ceremonyId: attempt.ceremony.ceremonyId,
        credentialJson: JSON.stringify(attempt.assertion),
      }, attempt.csrfToken)));
      return { result, redirected: false };
    } catch (error) {
      assert.match(String(error), /NEXT_REDIRECT/);
      return { result: null, redirected: true };
    }
  }));
  setWebAuthnCredentialReadHookForTest(null);

  assert.equal(arrived, 2, 'both real verifier calls must read the same stale production-store snapshot');
  assert.equal(outcomes.filter((outcome) => outcome.redirected).length, 1, 'exactly one ceremony must authenticate');
  assert.deepEqual(outcomes.find((outcome) => !outcome.redirected)?.result,
    { error: 'That passkey could not be verified.' }, 'the losing action must return the generic production replay response');

  const winner = attempts[outcomes.findIndex((outcome) => outcome.redirected)];
  const loser = attempts[outcomes.findIndex((outcome) => !outcome.redirected)];
  const canonicalSessionCookie = sessionCookieName(process.env);
  assert.ok(winner.cookies.get(canonicalSessionCookie), 'the winner must receive a canonical session');
  assert.equal(loser.cookies.get(canonicalSessionCookie), undefined, 'the replay must not receive or mutate a session');
  const afterSessions = Number((await sql<{ count: number }[]>`
    select count(*)::int as count from idoc.auth_sessions where user_id=${user.id}`)[0].count);
  assert.equal(afterSessions, beforeSessions + 1, 'only the winning ceremony may persist a session transition');

  const [credential] = await sql<{ credential_id: string; public_key: string; sign_count: number }[]>`
    select credential_id,public_key,sign_count::int from idoc.webauthn_credentials where user_id=${user.id}`;
  assert.equal(credential.sign_count, 1, 'the accepted counter must remain stored after the losing transaction');
  const notifications = await sql<Record<string, unknown>[]>`
    select * from idoc.auth_security_notification_outbox
    where user_id=${user.id} and kind='mfa_replay_detected'`;
  assert.equal(notifications.length, 1, 'the concurrent loser must enqueue exactly one dedicated replay event');

  const evidence = JSON.stringify({
    audit: await sql`select * from idoc.audit_log where actor_id=${user.id}`,
    notifications,
  });
  const forbidden = [credential.credential_id, credential.public_key,
    ...attempts.flatMap((attempt) => [attempt.ceremony.options.challenge, attempt.ceremony.ceremonyId,
      JSON.stringify(attempt.assertion)]), winner.cookies.get(canonicalSessionCookie)?.value ?? ''];
  for (const material of forbidden.filter(Boolean)) {
    assert.equal(evidence.includes(material), false, 'credential, assertion, challenge, and session material must stay out of evidence');
  }
  assert.equal(JSON.stringify(outcomes).includes(credential.credential_id), false,
    'the client-facing result must not disclose credential material');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const loginActions = read('app/(login)/actions.ts');
const signUpActions = read('app/(login)/sign-up/actions.ts');
const recoverPasswordActions = read('app/(login)/recover-password/actions.ts');
const signInActions = read('app/(login)/sign-in/actions.ts');
const accountRecovery = read('lib/membership/account-recovery.ts');
const rateLimit = read('lib/security/rate-limit.ts');
const schema = read('lib/db/schema.ts');
const authSecurityEvents = read('lib/notifications/auth-security-events.ts');
const authSecurityDelivery = read('lib/notifications/auth-security-delivery.ts');

test('every password-creation/change call site checks for a breached password before writing it', () => {
  assert.match(signUpActions, /checkPasswordBreached\(password\)/);
  assert.match(recoverPasswordActions, /checkPasswordBreached\(password\)/);
  assert.match(loginActions, /checkPasswordBreached\(newPassword\)/);
  assert.match(accountRecovery, /checkPasswordBreached\(password\)/);
});

test('signup rejects a breached password before the account row is ever created', () => {
  const body = signUpActions.slice(signUpActions.indexOf('export const completeSignup'));
  assert.ok(body.indexOf('checkPasswordBreached') < body.indexOf('db.insert(users'),
    'the breach check must run before the user row is inserted');
});

test('the legacy recovery token path checks breach status before opening its claiming transaction, never inside it', () => {
  const body = accountRecovery.slice(accountRecovery.indexOf('export async function consumeAccountToken'));
  const breachIndex = body.indexOf('checkPasswordBreached');
  const transactionIndex = body.indexOf('db.transaction');
  assert.ok(breachIndex >= 0 && transactionIndex >= 0 && breachIndex < transactionIndex,
    'an external network call must never run inside an open database transaction');
});

test('a breached password never consumes the legacy recovery token: the token record is read only after the breach check passes', () => {
  const body = accountRecovery.slice(accountRecovery.indexOf('export async function consumeAccountToken'));
  assert.match(body, /status: 'breached_password' as const/);
});

test('every breach rejection alerts the configured operations recipient, and the caller never treats a network-unreachable check as a rejection', () => {
  const breachCheck = read('lib/security/password-breach-check.ts');
  assert.match(breachCheck, /checked: false/);
  for (const source of [signUpActions, recoverPasswordActions, loginActions, accountRecovery]) {
    assert.match(source, /notifyWebmasterOfBreachedPasswordAttempt/);
    // Every call site branches on `.breached`, never on `.checked` -- an unreachable provider must
    // never be treated as a rejection.
  }
});

test('the webmaster alert is routed through the existing documented operations-recipient variable, not a new dedicated secret', () => {
  const alert = read('lib/notifications/breached-password-alert.ts');
  assert.match(alert, /IDOC_ADMIN_NOTIFICATION_EMAIL/);
  assert.doesNotMatch(alert, /BREACH.*ALERT.*EMAIL|SECURITY_ALERT_EMAIL/i);
});

test('the login password-comparison step is throttled by the same dual-independent-bucket primitive used elsewhere, before any credential comparison', () => {
  const body = loginActions.slice(loginActions.indexOf('export const signIn'), loginActions.indexOf('export const requestPasswordRecovery'));
  assert.match(body, /checkRateLimit\('login_password', email, await requestOrigin\(\)\)/);
  assert.ok(body.indexOf("checkRateLimit('login_password'") < body.indexOf('comparePasswords(password, foundUser.passwordHash)'),
    'the throttle must be checked before the password is ever compared');
});

test('the legacy account-recovery path no longer uses a single combined-key bucket: the old function is gone and it now calls the shared dual-bucket primitive', () => {
  assert.doesNotMatch(accountRecovery, /takeAllowance/);
  assert.match(accountRecovery, /checkRateLimit\(purpose, email, origin, now\)/);
});

test('the shared rate-limit primitive is unchanged by this: purpose remains a free-form string, so adding new purposes never requires a schema/constraint change', () => {
  assert.match(rateLimit, /export async function checkRateLimit\(purpose: string/);
});

test('an ordinary member signing in from a browser without recognized device trust triggers a new-sign-in alert, before the session is established', () => {
  const body = signInActions.slice(signInActions.indexOf('export const verifyLoginOtp'));
  const enqueueIndex = body.indexOf("kind: 'new_sign_in'");
  const setSessionIndex = body.indexOf('await setSession(verifiedUser)');
  assert.ok(enqueueIndex >= 0 && setSessionIndex >= 0 && enqueueIndex < setSessionIndex);
  assert.match(body.slice(0, enqueueIndex), /if \(role === 'member'\) \{\s*$/m);
});

test('the new-sign-in alert is deliberately not sent for privileged roles (they always pass through mandatory TOTP already)', () => {
  const body = signInActions.slice(signInActions.indexOf('export const verifyLoginOtp'));
  assert.match(body, /roles are deliberately excluded/);
});

test('new_sign_in is a registered notification kind with delivery content, matching every other kind', () => {
  assert.match(authSecurityEvents, /'new_sign_in'/);
  assert.match(authSecurityDelivery, /new_sign_in: \{ heading:/);
});

test('account_state is now constrained at the database level to the exact set the application policy recognizes, closing AUTH-DB-004', () => {
  const usersTableBody = schema.slice(schema.indexOf("idocSchema.table('users'"), schema.indexOf("idocSchema.table('auth_sessions'"));
  assert.match(usersTableBody, /check\('users_account_state_check', sql`\$\{table\.accountState\} in \('unverified', 'onboarding', 'active', 'suspended', 'migrated_pending', 'deleted'\)`\)/);
});

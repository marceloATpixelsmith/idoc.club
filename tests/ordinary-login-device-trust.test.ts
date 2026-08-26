import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('ordinary login trust is opaque, digest-only, fixed-life, scoped, and non-sliding', () => {
  const trust = read('lib/auth/login-device-trust.ts');
  assert.match(trust, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(trust, /createHmac\('sha256', loginDeviceTrustDigestKeyForServer\(\)\)/);
  assert.match(trust, /14 \* 24 \* 60 \* 60/);
  assert.match(trust, /sessionVersionAtIssue/);
  assert.match(trust, /MFA_APPLICATION_ID/);
  assert.match(trust, /isNull\(loginTrustedDevices\.revokedAt\)/);
  assert.match(trust, /gt\(loginTrustedDevices\.expiresAt, now\)/);
  assert.doesNotMatch(trust.slice(trust.indexOf('hasValidLoginDeviceTrust'), trust.indexOf('issueLoginDeviceTrust')), /update\(/);
  const persisted = trust.slice(trust.indexOf('db.insert(loginTrustedDevices)'), trust.indexOf('(await cookies()).set'));
  assert.doesNotMatch(persisted, /\n\s+token[,}:]/);
});

test('ordinary trust cookie is separate and hardened for exactly fourteen days', () => {
  const trust = read('lib/auth/login-device-trust.ts');
  assert.match(trust, /__Host-idoc-login-device/);
  for (const attribute of [/httpOnly: true/, /secure: true/, /sameSite: 'lax'/, /path: '\/'/, /maxAge: LOGIN_DEVICE_TRUST_LIFETIME_SECONDS/]) {
    assert.match(trust, attribute);
  }
  assert.doesNotMatch(trust, /domain:/i);
});

test('password precedes trust and privileged grants bypass ordinary trust lookup', () => {
  const actions = read('app/(login)/actions.ts');
  const password = actions.indexOf('comparePasswords(password, foundUser.passwordHash)');
  const role = actions.indexOf('authoritativeMfaRole(foundUser.id)');
  const ordinary = actions.indexOf("if (role === 'member')");
  const trust = actions.indexOf('hasValidLoginDeviceTrust(foundUser)');
  assert.ok(password >= 0 && role > password && ordinary > role && trust > ordinary);
  assert.match(actions.slice(ordinary), /beginPrimaryMfa\(foundUser/);
});

test('untrusted ordinary login cannot create a session before bound OTP verification', () => {
  const primary = read('app/(login)/actions.ts');
  const ordinary = primary.slice(primary.indexOf("if (role === 'member')"), primary.indexOf("if (await beginPrimaryMfa(foundUser"));
  const untrusted = ordinary.slice(ordinary.indexOf("const origin"));
  assert.doesNotMatch(untrusted, /setSession\(/);
  assert.match(untrusted, /issueEmailOtp\(email, 'login_verification'/);
  assert.match(untrusted, /requireLoginOtp/);

  const verify = read('app/(login)/sign-in/actions.ts');
  assert.ok(verify.indexOf("result !== 'verified'") < verify.indexOf('await setSession(verifiedUser)'));
  assert.match(verify, /pending\.userId/);
  assert.match(verify, /user\.sessionVersion !== pending\.sessionVersion/);
  assert.match(verify, /eq\(users\.sessionVersion, pending\.sessionVersion\)/);
  assert.ok(verify.lastIndexOf('eq(users.sessionVersion, pending.sessionVersion)') < verify.indexOf('issueLoginDeviceTrust(verifiedUser)'));
});

test('remember is offered only by trusted pending state and never substitutes for privileged TOTP', () => {
  const otp = read('app/(login)/sign-in/otp-step.tsx');
  const entry = read('components/auth/otp-entry-step.tsx');
  const verify = read('app/(login)/sign-in/actions.ts');
  assert.match(otp, /allowRemember[\s\S]*Remember me for 2 weeks/);
  assert.match(entry, /if \(!verifyFields\) formRef\.current\?\.requestSubmit\(\)/);
  assert.match(verify, /pending\.allowRemember && role === 'member' && remember === 'on'/);
  const body = verify.slice(verify.indexOf('export const verifyLoginOtp'));
  assert.ok(body.indexOf('issueLoginDeviceTrust') < body.indexOf('beginPrimaryMfa'));
});

test('security-sensitive identity and credential changes increment sessionVersion', () => {
  assert.match(read('lib/membership/email-verification.ts'), /sessionVersion: sql`\$\{users\.sessionVersion\} \+ 1`/);
  assert.match(read('app/(login)/actions.ts'), /passwordHash: newPasswordHash,[\s\S]*sessionVersion: sql/);
  assert.match(read('app/(login)/recover-password/actions.ts'), /sessionVersion: sql/);
  assert.match(read('lib/membership/role-grants.ts'), /sessionVersion: sql/);
});

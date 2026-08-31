import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ALERT_SEVERITY, taggedSubject } from '../lib/notifications/alert-severity.ts';

test('every existing admin-email alert kind has exactly one fixed severity, and the subject tag matches it', () => {
  assert.equal(ALERT_SEVERITY['auth.breached_password_rejected'], 'high');
  assert.equal(ALERT_SEVERITY['auth.google_oauth_failure'], 'warning');
  assert.equal(ALERT_SEVERITY['administrator.profile_changed'], 'informational');

  assert.equal(taggedSubject('auth.breached_password_rejected', 'IDOC: breached password rejected'), '[HIGH] IDOC: breached password rejected');
  assert.equal(taggedSubject('auth.google_oauth_failure', 'IDOC: Google sign-in failed (rate_limited)'), '[WARNING] IDOC: Google sign-in failed (rate_limited)');
  assert.equal(taggedSubject('administrator.profile_changed', 'IDOC member profile changed'), '[INFO] IDOC member profile changed');
});

test('every admin-email alert call site tags its subject with taggedSubject, not a bare string', () => {
  const files = [
    'lib/notifications/breached-password-alert.ts',
    'lib/notifications/google-oauth-failure-alert.ts',
    'lib/notifications/profile-change-delivery.ts',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /import \{ taggedSubject \} from '\.\/alert-severity(?:\.ts)?';/, `${file} must import taggedSubject`);
    assert.match(source, /subject: taggedSubject\(/, `${file} must tag its subject with taggedSubject`);
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { describePasswordRejection, summarizePromotionCredentials } from '../lib/admin/data-promotion-credentials.ts';

const password = '3f9a1c7e5b2d4a8c0e6f1b3d5a7c9e2f4b6d8a0c1e3f5a7b';
const url = `postgresql://idoc_data_promoter:${password}@dpg-example.oregon-postgres.render.com/ayni_space`;

test('the summary describes the credentials without containing the password', () => {
  const summary = summarizePromotionCredentials(url)!;
  assert.equal(summary.user, 'idoc_data_promoter');
  assert.equal(summary.host, 'dpg-example.oregon-postgres.render.com');
  assert.equal(summary.database, 'ayni_space');
  assert.equal(summary.passwordLength, password.length);
  assert.equal(summary.passwordSha256Prefix, createHash('sha256').update(password).digest('hex').slice(0, 6));
  assert.equal(JSON.stringify(summary).includes(password), false);
  assert.equal(describePasswordRejection(summary).includes(password), false);
});

test('percent-encoded passwords are summarized as the decoded password the driver sends', () => {
  const summary = summarizePromotionCredentials('postgresql://u:p%40ss%23word@h.example/db?sslmode=require')!;
  assert.equal(summary.passwordLength, 'p@ss#word'.length);
  assert.equal(summary.sslmode, 'require');
});

test('an unreadable URL produces a safe message instead of throwing', () => {
  assert.equal(summarizePromotionCredentials('not a url'), null);
  assert.match(describePasswordRejection(null), /could not be read/);
});

test('a short or human-chosen password never yields a password-derived value', () => {
  for (const weak of ['hunter2', 'CorrectHorseBatteryStaple2026', 'abcdefABCDEF0123456789abcdefABCDEFxyz']) {
    const summary = summarizePromotionCredentials(`postgresql://u:${weak}@h.example/db`)!;
    assert.equal(summary.passwordSha256Prefix, null);
    assert.equal(summary.passwordLength, weak.length);
    const text = describePasswordRejection(summary);
    assert.doesNotMatch(text, /SHA-256 starts with/);
    assert.match(text, /openssl rand -hex 24/);
  }
});

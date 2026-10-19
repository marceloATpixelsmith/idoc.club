import assert from 'node:assert/strict';
import test from 'node:test';

import { describePasswordRejection, summarizePromotionCredentials } from '../lib/admin/data-promotion-credentials.ts';

const password = '3f9a1c7e5b2d4a8c0e6f1b3d5a7c9e2f4b6d8a0c1e3f5a7b';
const url = `postgresql://idoc_data_promoter:${password}@dpg-example.oregon-postgres.render.com/ayni_space`;

test('the summary describes the connection without containing or deriving anything from the password', () => {
  const summary = summarizePromotionCredentials(url)!;
  assert.equal(summary.user, 'idoc_data_promoter');
  assert.equal(summary.host, 'dpg-example.oregon-postgres.render.com');
  assert.equal(summary.database, 'ayni_space');
  assert.deepEqual(Object.keys(summary).sort(), ['database', 'host', 'sslmode', 'user']);
  assert.equal(JSON.stringify(summary).includes(password), false);
  const text = describePasswordRejection(summary);
  assert.equal(text.includes(password), false);
  assert.doesNotMatch(text, /SHA-256|characters/);
});

test('an explicit sslmode is reported as given', () => {
  assert.equal(summarizePromotionCredentials('postgresql://u:p%40ss%23word@h.example/db?sslmode=require')!.sslmode, 'require');
});

test('an unreadable URL produces a safe message instead of throwing', () => {
  assert.equal(summarizePromotionCredentials('not a url'), null);
  assert.match(describePasswordRejection(null), /could not be read/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTestDatabaseUrl } from '../lib/db/test-database-url.ts';

test('accepts only explicitly and unambiguously named isolated databases', () => {
  assert.equal(validateTestDatabaseUrl('postgres://tester:secret@localhost:5432/idoc_test').pathname, '/idoc_test');
  assert.equal(validateTestDatabaseUrl('postgresql://tester:secret@db.internal/idoc_test_worker_1').pathname, '/idoc_test_worker_1');
});

test('rejects missing, malformed, unsupported, ambiguous, and production-like URLs', () => {
  for (const value of [undefined, '', 'not-a-url', 'postgres://',
    'postgres://localhost/idoc_test', 'mysql://u:p@localhost/idoc_test',
    'file:///idoc_test', 'postgres://u:p@localhost/',
    'postgres://u:p@localhost/latest', 'postgres://u:p@contest/latest',
    'postgres://u:p@contest/idoc_test', 'postgres://u:p@production-db/idoc_test',
    'postgres://u:p@primary-db/idoc_test', 'postgres://u:p@live-db/idoc_test',
    'postgres://u:p@example.render.com/idoc_test']) {
    assert.throws(() => validateTestDatabaseUrl(value));
  }
});

test('rejects the configured production database even when test-named', () => {
  const value = 'postgres://u:p@localhost/idoc_test';
  assert.throws(() => validateTestDatabaseUrl(value, value));
});

test('compares database destinations independently of credentials and URL decoration', () => {
  const testUrls = [
    'postgres://other:other@LOCALHOST/idoc_test',
    'postgresql://u:new@localhost:5432/idoc_test',
    'postgres://u:p@localhost/idoc_test?sslmode=disable',
    'postgres://u:p@localhost/idoc_test?ssl=true#ignored',
    'postgres://u:p@localhost/idoc%5Ftest',
  ];
  for (const value of testUrls) {
    assert.throws(() => validateTestDatabaseUrl(value, 'postgresql://production:secret@localhost:5432/idoc_test?sslmode=require'));
  }
});

test('normalizes bracketed IPv6 targets and accepts genuinely isolated targets', () => {
  assert.throws(() => validateTestDatabaseUrl('postgres://u:p@[::1]/idoc_test', 'postgresql://other:secret@[::1]:5432/idoc_test'));
  assert.equal(validateTestDatabaseUrl('postgres://u:p@localhost/idoc_test', 'postgres://u:p@localhost/idoc_test_other').pathname, '/idoc_test');
  assert.equal(validateTestDatabaseUrl('postgres://u:p@127.0.0.1/idoc_test', 'postgres://u:p@localhost/idoc_test').hostname, '127.0.0.1');
});

test('fails closed when POSTGRES_URL cannot be compared safely', () => {
  for (const production of ['not-a-url', 'mysql://u:p@localhost/idoc_test', 'postgres://u:p@localhost/', 'postgres://u:p@localhost/a/b']) {
    assert.throws(() => validateTestDatabaseUrl('postgres://u:p@localhost/idoc_test', production));
  }
});

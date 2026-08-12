import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTestDatabaseUrl } from '../lib/db/test-database-url.ts';

test('accepts only explicitly and unambiguously named isolated databases', () => {
  assert.equal(validateTestDatabaseUrl('postgres://tester:secret@localhost:5432/idoc_test').pathname, '/idoc_test');
  assert.equal(validateTestDatabaseUrl('postgresql://tester:secret@db.internal/idoc_test_worker_1').pathname, '/idoc_test_worker_1');
});

test('rejects missing, malformed, unsupported, ambiguous, and production-like URLs', () => {
  for (const value of [undefined, '', 'not-a-url', 'mysql://u:p@localhost/idoc_test',
    'postgres://u:p@localhost/latest', 'postgres://u:p@contest/latest',
    'postgres://u:p@contest/idoc_test', 'postgres://u:p@production-db/idoc_test',
    'postgres://u:p@example.render.com/idoc_test']) {
    assert.throws(() => validateTestDatabaseUrl(value));
  }
});

test('rejects the configured production database even when test-named', () => {
  const value = 'postgres://u:p@localhost/idoc_test';
  assert.throws(() => validateTestDatabaseUrl(value, value));
});

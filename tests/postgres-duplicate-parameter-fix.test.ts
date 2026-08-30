import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

/** This driver's parameter serializer throws (a TypeError inside Buffer.byteLength, confirmed
 * directly against production twice) when a native JS `Date` is interpolated into a raw `client`
 * tagged-template query -- drizzle's query builder never hits this because it stringifies Date
 * values itself before they reach the driver, but a raw `client` call has to do that conversion
 * explicitly. These tests guard every raw `client` call site in these two files against ever
 * interpolating a bare `Date` (a bare variable, `new Date(...)`, or `new Date()`) again -- every
 * one must go through `.toISOString()` first. */
function assertNoRawDateInterpolation(source: string, path: string) {
  const bareDateInterpolation = /\$\{[^}]*\bnew Date\([^)]*\)(?!\.toISOString\(\))[^}]*\}/;
  assert.doesNotMatch(source, bareDateInterpolation, `${path}: found a \${...} interpolation constructing a Date without .toISOString()`);
}

test('purgeExpiredGoogleOauthTransactions interpolates `cutoff` as an ISO string, not a raw Date', () => {
  const store = read('lib/auth/google-oidc-store.ts');
  assertNoRawDateInterpolation(store, 'lib/auth/google-oidc-store.ts');
  assert.match(store, /const cutoff = new Date\(now\.getTime\(\) - RETENTION_MILLISECONDS\)\.toISOString\(\);/);
  assert.match(store, /where expires_at < \$\{cutoff\}/);
  assert.match(store, /consumed_at < \$\{cutoff\}/);
});

test('googleOidcTransactionStore.create interpolates created_at/expires_at as ISO strings, not raw Dates', () => {
  const store = read('lib/auth/google-oidc-store.ts');
  assert.match(store, /\$\{new Date\(transaction\.createdAtMs\)\.toISOString\(\)\}/);
  assert.match(store, /\$\{new Date\(transaction\.expiresAtMs\)\.toISOString\(\)\}/);
});

test('the account-security-notification dead-letter update interpolates dead_lettered_at as an ISO string, not a raw Date', () => {
  const delivery = read('lib/notifications/auth-security-delivery.ts');
  assertNoRawDateInterpolation(delivery, 'lib/notifications/auth-security-delivery.ts');
  assert.match(delivery, /dead_lettered_at=\$\{deadLettered \? new Date\(\)\.toISOString\(\) : null\}/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

/** Counts how many `${...}` interpolations of a given expression appear inside one raw `client`
 * tagged-template call (a plain substring window between the call's opening and closing backtick,
 * which is precise enough for these two known call sites). */
function countInterpolations(source: string, callStart: string, callEnd: string, expression: string) {
  const start = source.indexOf(callStart);
  assert.ok(start >= 0, `expected to find the call starting with "${callStart}"`);
  const end = source.indexOf(callEnd, start);
  assert.ok(end > start, `expected to find the closing backtick after "${callStart}"`);
  const body = source.slice(start, end);
  const needle = `\${${expression}}`;
  return body.split(needle).length - 1;
}

test('purgeExpiredGoogleOauthTransactions binds `cutoff` exactly once -- postgres.js throws serializing the same JS value interpolated twice in one tagged-template query (confirmed in production: a TypeError inside Buffer.byteLength on the second occurrence)', () => {
  const store = read('lib/auth/google-oidc-store.ts');
  const count = countInterpolations(store, 'export async function purgeExpiredGoogleOauthTransactions', '\n}', 'cutoff');
  assert.equal(count, 1, 'cutoff must be interpolated exactly once in the delete query');
  assert.match(store, /with cutoff as \(select \$\{cutoff\}::timestamptz as value\)/);
  assert.match(store, /where expires_at < \(select value from cutoff\)/);
  assert.match(store, /consumed_at < \(select value from cutoff\)/);
});

test('the account-security-notification retry/dead-letter query binds `attempt` exactly once -- same bug shape as the Google OAuth purge query, in the worker independently observed failing hundreds of times in production', () => {
  const delivery = read('lib/notifications/auth-security-delivery.ts');
  const count = countInterpolations(delivery, 'const deadLettered = attempt >= MAX_ATTEMPTS;', 'return { status: deadLettered', 'attempt');
  assert.equal(count, 1, 'attempt must be interpolated exactly once in the retry/dead-letter update');
  // The dead-letter decision moved into JS (a plain boolean) instead of a SQL `case when` that
  // would otherwise reference `attempt` a second time.
  assert.match(delivery, /const deadLettered = attempt >= MAX_ATTEMPTS;/);
  assert.match(delivery, /dead_lettered_at=\$\{deadLettered \? new Date\(\) : null\}/);
  assert.match(delivery, /return \{ status: deadLettered \? 'dead_lettered' as const : 'retryable' as const \};/);
  assert.doesNotMatch(delivery, /case when \$\{attempt\}/);
});

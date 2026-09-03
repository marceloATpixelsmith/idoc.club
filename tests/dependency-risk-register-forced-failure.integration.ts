import assert from 'node:assert/strict';
import test from 'node:test';

// AUTH-DEPENDENCY-001: the register (lib/security/dependency-risk-register.ts) declares postgres as
// fail-closed for every authoritative read path. tests/dependency-risk-register.test.ts already
// proves this structurally (no catch block exists in the named files that could swallow a failure);
// this file proves it *behaviorally* instead, by making the real production database connection
// genuinely unreachable -- not mocked at the JS level -- before driving real production callers
// (checkRateLimit, requireAccountAccess) through it, and asserting the call rejects rather than
// resolving with a fallback. lib/db/drizzle.ts's `client`/`db` are lazily-created, memoized
// singletons: the first real query in this process is what actually opens the connection, so
// pointing TEST_DATABASE_URL at a port nothing listens on *before* that first use (and before
// importing anything that could trigger it) guarantees the singleton's very first connection attempt
// itself fails, with no need to sever an already-working connection mid-test. This is kept in its
// own file, isolated from the rest of the suite, since every other integration test needs a real
// working database connection and this one deliberately ensures there is none.

process.env.TEST_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:1/idoc_test';
process.env.AUTH_SECRET = 'dependency-forced-failure-test-secret-long-enough-32';
process.env.RATE_LIMIT_HASH_KEY = 'dependency-forced-failure-test-secret-long-enough';

test('checkRateLimit propagates rather than silently allowing when the real production Postgres connection is genuinely unreachable', async () => {
  const { checkRateLimit } = await import('../lib/security/rate-limit.ts');
  await assert.rejects(
    checkRateLimit('dependency-forced-failure-smoke', 'probe@example.test', 'probe.example.test'),
    'an unreachable Postgres connection must reject the call -- rate limiting must never silently fall back to "allowed" when its authoritative store is unreachable',
  );
});

test('requireAccountAccess propagates rather than silently granting access when the connection is genuinely unreachable', async () => {
  const { requireAccountAccess } = await import('../lib/membership/data-access.ts');
  const { withTestMembershipBoundary } = await import('../lib/membership/test-boundary.ts');
  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: 1, roles: [] } }, () => requireAccountAccess('administration')),
    'an unreachable Postgres connection must reject the call -- account access must never be silently granted when its authoritative store is unreachable',
  );
});

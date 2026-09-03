import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { logError, logWarn } from '../lib/observability/logger.ts';
import { SECURITY_EVENT_TAXONOMY } from '../lib/observability/security-events.ts';

// AUTH-LOG-001: "Trusted server security events MUST use stable taxonomy, safe correlation,
// actor/subject/tenant/resource attribution, minimized metadata, and remain distinct from
// application logs and audit records." The taxonomy's real enforcement mechanism is the TypeScript
// compiler: logWarn/logError's `event` parameter is typed as `SecurityEventName` (a union derived
// directly from SECURITY_EVENT_TAXONOMY's keys -- see security-events.ts), so `pnpm typecheck`
// itself already fails if any call site anywhere in the repository ever passes an unregistered
// name; that is proven by this repository's own green typecheck, not re-provable by a unit test.
// What a unit test *can* and must prove is the metadata/attribution behavior at runtime: category
// and resource are actually auto-attached from the registry (never left to caller discipline), a
// caller cannot override them, and non-minimized metadata is actually stripped/truncated rather
// than merely documented as forbidden.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

test('every logWarn/logError call site anywhere in app/ and lib/ passes a name registered in SECURITY_EVENT_TAXONOMY', () => {
  const files = [...sourceFiles('app'), ...sourceFiles('lib')];
  const callPattern = /\blog(?:Warn|Error)\(\s*'([^']+)'/g;
  let sawAtLeastOneCall = false;
  for (const file of files) {
    if (file.endsWith('lib/observability/logger.ts')) continue;
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(callPattern)) {
      sawAtLeastOneCall = true;
      assert.ok(
        match[1] in SECURITY_EVENT_TAXONOMY,
        `${file} calls log(Warn|Error) with '${match[1]}', which is not a key of SECURITY_EVENT_TAXONOMY`,
      );
    }
  }
  assert.ok(sawAtLeastOneCall, 'sanity check: this scan must actually find real call sites, not vacuously pass');
});

test('category, resource, and retentionClass are auto-attached from the registry and cannot be overridden by caller-supplied meta', async () => {
  const calls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    await logWarn('mailchimp_webhook_malformed_payload', { category: 'not-a-real-category', resource: 'attacker-controlled', retentionClass: 'security' });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
  const [event, meta] = calls[0] as [string, Record<string, unknown>];
  assert.equal(event, 'mailchimp_webhook_malformed_payload');
  assert.equal(meta.category, SECURITY_EVENT_TAXONOMY.mailchimp_webhook_malformed_payload.category);
  assert.equal(meta.resource, SECURITY_EVENT_TAXONOMY.mailchimp_webhook_malformed_payload.resource);
  assert.equal(meta.retentionClass, SECURITY_EVENT_TAXONOMY.mailchimp_webhook_malformed_payload.retentionClass);
  assert.ok(typeof meta.requestId === 'string' && meta.requestId.length > 0);
});

test('event schemas drop unknown, nested, oversized, and secret-bearing metadata at runtime', async () => {
  const calls: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    await logError('client_error', {
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature',
      cookie: 'session=raw-session-secret', csrf: 'raw-csrf-secret',
      nested: { password: 'plaintext-password' }, otp: '123456',
      oversized: 'x'.repeat(3000), password: 'plaintext-password',
      providerSecret: 'provider-secret', recoveryCode: 'recover-me',
      token: 'oauth-code-or-token', unknown: 'unknown-value',
    } as Record<string, unknown>);
  } finally {
    console.error = originalError;
  }
  assert.equal(calls.length, 1);
  const [, meta] = calls[0] as [string, Record<string, unknown>];
  assert.deepEqual(Object.keys(meta).sort(), ['attribution', 'category', 'requestId', 'resource', 'retentionClass'].sort());
  const serialized = JSON.stringify(calls);
  for (const secret of ['plaintext-password', '123456', 'recover-me', 'raw-session-secret', 'oauth-code-or-token', 'raw-csrf-secret', 'provider-secret', 'unknown-value']) {
    assert.ok(!serialized.includes(secret), `log output retained forbidden value: ${secret}`);
  }
});

test('an oversized number of metadata entries is capped, not forwarded unbounded', async () => {
  const calls: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  const manyFields: Record<string, unknown> = {};
  for (let i = 0; i < 50; i += 1) manyFields[`field${i}`] = i;
  try {
    await logError('client_error', manyFields);
  } finally {
    console.error = originalError;
  }
  const [, meta] = calls[0] as [string, Record<string, unknown>];
  assert.ok(Object.keys(meta).length <= 5, `expected unknown metadata to be dropped, got ${Object.keys(meta).length}`);
});

test('invalid subject attribution suppresses the event while registry attribution is non-overridable', async () => {
  const calls: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    await logError('email_otp_delivery_failed', { actorId: 42, subjectId: null, purpose: 'login_verification', reason: 'operational' } as Record<string, unknown>);
    await logError('email_otp_delivery_failed', { attribution: 'system', subjectId: 42, purpose: 'login_verification', reason: 'operational' } as Record<string, unknown>);
  } finally { console.error = originalError; }
  assert.equal(calls.length, 1);
  const [, meta] = calls[0] as [string, Record<string, unknown>];
  assert.equal(meta.attribution, 'subject');
  assert.equal(meta.subjectId, 42);
  assert.equal(meta.actorId, undefined);
});

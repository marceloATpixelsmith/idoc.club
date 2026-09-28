import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSentryEvent } from '../lib/observability/sentry-privacy.ts';
import { sentryEnvironment, sentryOptions } from '../lib/observability/sentry-options.ts';

test('Sentry sanitization removes request content and attaches the IDOC request id', () => {
  const sanitized = sanitizeSentryEvent({
    extra: { nested: { password: 'not-for-sentry', safe: 'diagnostic' }, stripeSecret: 'sk_test_secret' },
    request: {
      cookies: { session: 'private' },
      data: { recoveryCode: 'private' },
      headers: { authorization: 'Bearer private', cookie: 'private', 'x-request-id': '4f57c42b-a929-4a86-bb11-413ca2a60aa5' },
      query_string: 'token=private',
      url: 'https://idoc.club/dashboard?token=private',
    },
    user: { email: 'member@example.test', id: '42', ip_address: '127.0.0.1' },
  });

  assert.deepEqual(sanitized.request?.headers, { 'x-request-id': '4f57c42b-a929-4a86-bb11-413ca2a60aa5' });
  assert.equal(sanitized.request?.url, 'https://idoc.club/dashboard');
  assert.equal('cookies' in (sanitized.request ?? {}), false);
  assert.equal('data' in (sanitized.request ?? {}), false);
  assert.equal('query_string' in (sanitized.request ?? {}), false);
  assert.deepEqual(sanitized.user, { id: '42' });
  assert.equal(sanitized.tags?.idoc_request_id, '4f57c42b-a929-4a86-bb11-413ca2a60aa5');
  assert.deepEqual(sanitized.contexts?.idoc, { request_id: '4f57c42b-a929-4a86-bb11-413ca2a60aa5' });
  assert.equal((sanitized.extra?.nested as Record<string, unknown>).password, '[Filtered]');
  assert.equal(sanitized.extra?.stripeSecret, '[Filtered]');
});

test('Sentry sanitization drops non-internal user identity and redacts URL values', () => {
  const sanitized = sanitizeSentryEvent({
    extra: { link: 'https://example.test/reset?token=secret&next=private', value: 'Bearer abc.def' },
    user: { email: 'member@example.test' },
  });
  assert.equal(sanitized.user, undefined);
  assert.equal(sanitized.extra?.link, 'https://example.test/reset?token=[Filtered]&next=[Filtered]');
  assert.equal(sanitized.extra?.value, 'Bearer [Filtered]');
});

test('Sentry sanitization redacts PII and authentication codes from free-form exception strings', () => {
  const sanitized = sanitizeSentryEvent({
    exception: {
      values: [{ value: 'Failed for member@example.test from 192.168.1.42; recovery code 123456; MFA code 654321' }],
    },
    extra: { message: 'Contact member@example.test from 10.0.0.8 with TOTP 123456' },
  });

  const exceptionValue = (sanitized.exception as { values: Array<{ value: string }> }).values[0]?.value ?? '';
  assert.equal(exceptionValue.includes('member@example.test'), false);
  assert.equal(exceptionValue.includes('192.168.1.42'), false);
  assert.equal(exceptionValue.includes('123456'), false);
  assert.equal(exceptionValue.includes('654321'), false);
  assert.equal(String(sanitized.extra?.message).includes('member@example.test'), false);
  assert.equal(String(sanitized.extra?.message).includes('10.0.0.8'), false);
});

test('Sentry environment and error-only defaults use Vercel deployment context', () => {
  assert.equal(sentryEnvironment({ VERCEL_ENV: 'production' }), 'production');
  assert.equal(sentryEnvironment({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' }), 'staging');
  const options = sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.test/1', VERCEL_GIT_COMMIT_SHA: 'abc123' });
  assert.equal(options.enabled, true);
  assert.equal(options.release, 'abc123');
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.tracesSampleRate, 0);
});

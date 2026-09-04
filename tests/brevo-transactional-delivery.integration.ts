import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { sendTransactionalEmail } from '../lib/notifications/brevo-transactional.ts';

// Migrated off Mailchimp Transactional (Mandrill) after its free/demo-tier account rejected real
// production signup-verification sends with reject_reason "recipient-domain-mismatch" for any
// recipient domain other than the sender's own or a handful of major providers -- a real production
// blocker discovered while manually testing the release-readiness checklist, not a code defect.
// Unlike Mandrill (HTTP 200 even for a rejected recipient, with the true outcome hidden in the
// response body), Brevo's send API gives a definitive synchronous answer in the HTTP status itself.

const originalFetch = globalThis.fetch;
let brevoResponseBody = '';
let brevoStatus = 201;
beforeEach(() => {
  process.env.BREVO_API_KEY = 'test-only-provider-key';
  process.env.BREVO_FROM_EMAIL = 'accounts@idoc.club';
  brevoResponseBody = '{"messageId":"<test@smtp-relay.brevo.com>"}';
  brevoStatus = 201;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.brevo.com/v3/smtp/email') {
      return new Response(brevoResponseBody, { status: brevoStatus });
    }
    return originalFetch(input);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('an accepted send (HTTP 201) does not throw', async () => {
  await sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' });
});

test('an unauthorized response (bad API key) throws with Brevo\'s own reported reason', async () => {
  brevoStatus = 401;
  brevoResponseBody = '{"code":"unauthorized","message":"Key not found"}';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not accept the message \(Key not found\)/,
  );
});

test('a rejected recipient domain throws with the reported reason (the real production failure this migration fixes)', async () => {
  brevoStatus = 400;
  brevoResponseBody = '{"code":"invalid_parameter","message":"recipient-domain-mismatch"}';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not accept the message \(recipient-domain-mismatch\)/,
  );
});

test('a non-2xx response with an unparseable body still throws, falling back to the HTTP status', async () => {
  brevoStatus = 500;
  brevoResponseBody = 'not json';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not accept the message \(HTTP 500\)/,
  );
});

test('a non-2xx response with a body that parses but carries no message field falls back to the HTTP status', async () => {
  brevoStatus = 402;
  brevoResponseBody = '{"code":"plan_limit_exceeded"}';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not accept the message \(HTTP 402\)/,
  );
});

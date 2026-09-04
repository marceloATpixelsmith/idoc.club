import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { sendTransactionalEmail } from '../lib/notifications/mailchimp-transactional.ts';

// Found while investigating a real production report: a real signup verification email never
// arrived, twice, with zero logged delivery failures either time. Traced to this exact gap --
// sendTransactionalEmail only checked response.ok (the HTTP status), never the response body.
// Mandrill's send API returns HTTP 200 even when a specific recipient is rejected, invalid, or
// bounced; that outcome only appears in the body's per-recipient `status` field. A rejected send
// therefore looked identical to a delivered one to every caller: no thrown error, nothing logged,
// and (for outbox-based sends) no retry ever triggered.

const originalFetch = globalThis.fetch;
let mandrillResponseBody = '';
let mandrillStatus = 200;
beforeEach(() => {
  process.env.MAILCHIMP_TRANSACTIONAL_API_KEY = 'test-only-provider-key-at-least-32-characters';
  mandrillResponseBody = '';
  mandrillStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://mandrillapp.com/api/1.0/messages/send.json') {
      return new Response(mandrillResponseBody, { status: mandrillStatus });
    }
    return originalFetch(input);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('a normal accepted send (status: sent) does not throw', async () => {
  mandrillResponseBody = '[{"email":"user@example.test","status":"sent"}]';
  await sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' });
});

test('a queued or scheduled send does not throw -- those are also non-terminal accepted states', async () => {
  mandrillResponseBody = '[{"email":"user@example.test","status":"queued"}]';
  await sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' });
  mandrillResponseBody = '[{"email":"user@example.test","status":"scheduled"}]';
  await sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' });
});

test('a rejected recipient throws even though the HTTP call itself returned 200', async () => {
  mandrillResponseBody = '[{"email":"user@example.test","status":"rejected","reject_reason":"hard-bounce"}]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not confirm delivery \(hard-bounce\)/,
  );
});

test('an invalid recipient throws even though the HTTP call itself returned 200', async () => {
  mandrillResponseBody = '[{"email":"user@example.test","status":"invalid"}]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not confirm delivery \(invalid\)/,
  );
});

// A Codex review on this pull request caught that the original implementation only searched for
// the two known-bad statuses ("rejected"/"invalid") and treated everything else -- including a
// malformed entry -- as an implicit success, reopening the exact silent-success gap this file
// exists to close. These four cases are the shapes that check must reject even though none of them
// is literally "rejected" or "invalid".
test('a null entry in the results array throws rather than being silently treated as success', async () => {
  mandrillResponseBody = '[null]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not confirm delivery \(an unrecognized response entry\)/,
  );
});

test('a scalar entry in the results array throws rather than being silently treated as success', async () => {
  mandrillResponseBody = '["oops"]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not confirm delivery \(an unrecognized response entry\)/,
  );
});

test('an entry with no status field throws rather than being silently treated as success', async () => {
  mandrillResponseBody = '[{"email":"user@example.test"}]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not confirm delivery \(an unrecognized response entry\)/,
  );
});

test('an unrecognized status value throws rather than being silently treated as success', async () => {
  mandrillResponseBody = '[{"email":"user@example.test","status":"some-future-status"}]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /did not confirm delivery \(some-future-status\)/,
  );
});

test('a non-2xx HTTP status still throws (the pre-existing check)', async () => {
  mandrillStatus = 502;
  mandrillResponseBody = 'provider unavailable';
  await assert.rejects(sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }));
});

test('an empty array response throws rather than being silently treated as success', async () => {
  mandrillResponseBody = '[]';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /unexpected response/,
  );
});

test('an unparseable response body throws rather than being silently treated as success', async () => {
  mandrillResponseBody = 'not json';
  await assert.rejects(
    sendTransactionalEmail({ html: '<p>hi</p>', subject: 'Test', to: 'user@example.test' }),
    /could not be parsed/,
  );
});

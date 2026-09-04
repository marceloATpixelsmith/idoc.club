import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { GET, POST } from '../app/api/brevo/webhook/route.ts';

const webhookKey = 'route-test-webhook-key';
const url = `https://idoc.club/api/brevo/webhook?key=${webhookKey}`;

function eventRequest(body: unknown, keyOverride?: string) {
  const target = keyOverride === undefined ? url : `https://idoc.club/api/brevo/webhook?key=${keyOverride}`;
  return new Request(target, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

let originalFetch: typeof fetch;
let sentMessages: { subject: string; to: string }[];

beforeEach(() => {
  process.env.BREVO_WEBHOOK_KEY = webhookKey;
  process.env.BREVO_API_KEY = 'integration-only-provider-key';
  process.env.BREVO_FROM_EMAIL = 'accounts@idoc.club';
  process.env.IDOC_ADMIN_NOTIFICATION_EMAIL = 'ops@idoc.club';
  sentMessages = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sentMessages.push({ subject: body.subject, to: body.to[0].email });
    return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.BREVO_WEBHOOK_KEY;
});

test('GET always returns 200 for Brevo\'s Notify URL setup ping', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
});

test('POST rejects when the webhook key is not configured', async () => {
  delete process.env.BREVO_WEBHOOK_KEY;
  const response = await POST(eventRequest({ email: 'a@example.test', event: 'hardBounce' }));
  assert.equal(response.status, 503);
  assert.equal(sentMessages.length, 0);
});

test('POST rejects a request with a missing or incorrect key query parameter', async () => {
  const event = { email: 'a@example.test', event: 'hardBounce' };
  assert.equal((await POST(eventRequest(event, 'not-the-real-key'))).status, 400);
  assert.equal((await POST(eventRequest(event, ''))).status, 400);
  assert.equal(sentMessages.length, 0);
});

test('a hard bounce with a valid key alerts the operations recipient with the reported reason, tagged WARNING', async () => {
  const response = await POST(eventRequest({ email: 'bounced@example.test', event: 'hardBounce', reason: 'bad_mailbox' }));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ops@idoc.club');
  assert.match(sentMessages[0].subject, /^\[WARNING\] IDOC: email hard bounce$/);
});

test('a spam complaint with a valid key alerts the operations recipient, tagged CRITICAL', async () => {
  const response = await POST(eventRequest({ email: 'complainer@example.test', event: 'spam' }));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].subject, /^\[CRITICAL\] IDOC: email spam complaint$/);
});

test('a soft bounce never sends an alert email', async () => {
  const response = await POST(eventRequest({ email: 'transient@example.test', event: 'softBounce' }));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

test('an unrelated event type (delivered, opened, click) is accepted and ignored without alerting', async () => {
  await POST(eventRequest({ email: 'delivered@example.test', event: 'delivered' }));
  const response = await POST(eventRequest({ email: 'delivered@example.test', event: 'opened' }));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

test('a malformed payload with a valid key is accepted (200) but triggers no alert', async () => {
  const request = new Request(url, {
    body: 'not json',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

test('an event missing the required "event" field with a valid key is accepted (200) but triggers no alert', async () => {
  const response = await POST(eventRequest({ email: 'a@example.test' }));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

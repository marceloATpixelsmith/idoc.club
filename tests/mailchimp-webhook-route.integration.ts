import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test, { afterEach, beforeEach } from 'node:test';
import { GET, POST } from '../app/api/mailchimp/webhook/route.ts';

const url = 'https://idoc.club/api/mailchimp/webhook';
const webhookKey = 'route-test-webhook-key';

function signedRequest(events: unknown[], key = webhookKey) {
  const body = new URLSearchParams({ mandrill_events: JSON.stringify(events) });
  const signedString = url + 'mandrill_events' + JSON.stringify(events);
  const signature = createHmac('sha1', key).update(signedString, 'utf8').digest('base64');
  return new Request(url, {
    body: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-mandrill-signature': signature },
    method: 'POST',
  });
}

let originalFetch: typeof fetch;
let sentMessages: { subject: string; to: string }[];

beforeEach(() => {
  process.env.MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY = webhookKey;
  process.env.MAILCHIMP_TRANSACTIONAL_API_KEY = 'integration-only-provider-key-32-chars-plus';
  process.env.IDOC_ADMIN_NOTIFICATION_EMAIL = 'ops@idoc.club';
  sentMessages = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)).message;
    sentMessages.push({ subject: body.subject, to: body.to[0].email });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY;
});

test('GET always returns 200 for the Mandrill setup ping', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
});

test('POST rejects when the webhook key is not configured', async () => {
  delete process.env.MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY;
  const response = await POST(signedRequest([{ event: 'hard_bounce', msg: { email: 'a@example.test' } }]));
  assert.equal(response.status, 503);
  assert.equal(sentMessages.length, 0);
});

test('POST rejects a request with a missing or incorrect signature', async () => {
  const events = [{ event: 'hard_bounce', msg: { email: 'a@example.test' } }];
  const wrongKey = signedRequest(events, 'not-the-real-key');
  assert.equal((await POST(wrongKey)).status, 400);

  const noSignature = new Request(url, {
    body: new URLSearchParams({ mandrill_events: JSON.stringify(events) }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  assert.equal((await POST(noSignature)).status, 400);
  assert.equal(sentMessages.length, 0);
});

test('a hard bounce with a valid signature alerts the operations recipient with the categorical bounce reason, tagged WARNING', async () => {
  const response = await POST(signedRequest([{ event: 'hard_bounce', msg: { bounce_description: 'bad_mailbox', email: 'bounced@example.test' } }]));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ops@idoc.club');
  assert.match(sentMessages[0].subject, /^\[WARNING\] IDOC: email hard bounce$/);
});

test('a spam complaint with a valid signature alerts the operations recipient, tagged CRITICAL', async () => {
  const response = await POST(signedRequest([{ event: 'spam', msg: { email: 'complainer@example.test' } }]));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].subject, /^\[CRITICAL\] IDOC: email spam complaint$/);
});

test('a soft bounce never sends an alert email', async () => {
  const response = await POST(signedRequest([{ event: 'soft_bounce', msg: { email: 'transient@example.test' } }]));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

test('an unrelated event type (send, open, click) is accepted and ignored without alerting', async () => {
  const response = await POST(signedRequest([{ event: 'send', msg: { email: 'delivered@example.test' } }, { event: 'open', msg: { email: 'delivered@example.test' } }]));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

test('a batch with multiple bounce/complaint events alerts once per event', async () => {
  const response = await POST(signedRequest([
    { event: 'hard_bounce', msg: { email: 'first@example.test' } },
    { event: 'spam', msg: { email: 'second@example.test' } },
  ]));
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 2);
});

test('a malformed mandrill_events payload with a valid signature over that exact payload is accepted (200) but triggers no alert', async () => {
  const rawBody = 'mandrill_events=not-json';
  const signature = createHmac('sha1', webhookKey).update(url + 'mandrill_eventsnot-json', 'utf8').digest('base64');
  const request = new Request(url, {
    body: rawBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-mandrill-signature': signature },
    method: 'POST',
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 0);
});

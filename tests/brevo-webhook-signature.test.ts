import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrevoEvent, verifyBrevoWebhookKey } from '../lib/notifications/brevo-transactional-webhook.ts';

test('verifyBrevoWebhookKey accepts the correct shared secret and rejects a wrong or missing one', () => {
  assert.equal(verifyBrevoWebhookKey('the-real-key', 'the-real-key'), true);
  assert.equal(verifyBrevoWebhookKey('a-wrong-key', 'the-real-key'), false);
  assert.equal(verifyBrevoWebhookKey(null, 'the-real-key'), false);
  assert.equal(verifyBrevoWebhookKey('the-real-key', undefined), false);
});

test('parseBrevoEvent reads a well-formed hard bounce event, capping the free-text reason', () => {
  const raw = { email: 'bounced@example.test', event: 'hardBounce', reason: 'x'.repeat(500) };
  const event = parseBrevoEvent(raw);
  assert.equal(event?.event, 'hardBounce');
  assert.equal(event?.email, 'bounced@example.test');
  assert.equal(event?.reason?.length, 200);
});

test('parseBrevoEvent reads a spam event with no reason field', () => {
  const event = parseBrevoEvent({ email: 'complainer@example.test', event: 'spam' });
  assert.deepEqual(event, { email: 'complainer@example.test', event: 'spam', reason: undefined });
});

test('parseBrevoEvent rejects malformed, non-object, or missing-event payloads', () => {
  assert.equal(parseBrevoEvent(undefined), null);
  assert.equal(parseBrevoEvent(null), null);
  assert.equal(parseBrevoEvent('not an object'), null);
  assert.equal(parseBrevoEvent([]), null);
  assert.equal(parseBrevoEvent({ email: 'a@example.test' }), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { brevoEventTime, normalizeBrevoEventName, normalizeBrevoMessageId, recipientDomain, statusAfterEvent } from '../lib/notifications/email-delivery-log-core.ts';
import { parseBrevoDeliveryEvent } from '../lib/notifications/brevo-transactional-webhook.ts';

test('both spellings of every Brevo event normalize to one name, so a spelling difference can never drop an event', () => {
  const pairs: [string, string][] = [
    ['delivered', 'delivered'], ['request', 'accepted'], ['requests', 'accepted'], ['deferred', 'deferred'],
    ['soft_bounce', 'soft_bounced'], ['softBounce', 'soft_bounced'], ['softBounces', 'soft_bounced'],
    ['hard_bounce', 'hard_bounced'], ['hardBounce', 'hard_bounced'], ['hardBounces', 'hard_bounced'],
    ['invalid_email', 'invalid'], ['invalid', 'invalid'], ['blocked', 'blocked'], ['spam', 'spam'], ['error', 'error'],
    ['unique_opened', 'opened'], ['uniqueOpened', 'opened'], ['opened', 'opened'], ['click', 'clicked'], ['clicks', 'clicked'],
  ];
  for (const [raw, expected] of pairs) assert.equal(normalizeBrevoEventName(raw), expected, raw);
  assert.equal(normalizeBrevoEventName('something_new'), null);
  assert.equal(normalizeBrevoEventName(undefined), null);
});

test('a later, more final outcome replaces an earlier one and a late earlier event never downgrades it', () => {
  assert.equal(statusAfterEvent('accepted', 'deferred'), 'deferred');
  assert.equal(statusAfterEvent('deferred', 'delivered'), 'delivered');
  assert.equal(statusAfterEvent('delivered', 'deferred'), 'delivered');
  assert.equal(statusAfterEvent('soft_bounced', 'delivered'), 'delivered');
  assert.equal(statusAfterEvent('deferred', 'hard_bounced'), 'hard_bounced');
  assert.equal(statusAfterEvent('delivered', 'spam'), 'spam');
  assert.equal(statusAfterEvent('hard_bounced', 'delivered'), 'hard_bounced');
  // Opens and clicks are history only.
  assert.equal(statusAfterEvent('delivered', 'opened'), 'delivered');
  assert.equal(statusAfterEvent('accepted', 'clicked'), 'accepted');
});

test('Brevo message ids lose the angle brackets, and an absent or blank id is null', () => {
  assert.equal(normalizeBrevoMessageId('<202610271500.12345@smtp-relay.mailin.fr>'), '202610271500.12345@smtp-relay.mailin.fr');
  assert.equal(normalizeBrevoMessageId('  plain-id  '), 'plain-id');
  assert.equal(normalizeBrevoMessageId('<>'), null);
  assert.equal(normalizeBrevoMessageId(undefined), null);
  assert.equal(normalizeBrevoMessageId(42), null);
});

test('recipient domain is the lower-cased part after the last @', () => {
  assert.equal(recipientDomain('Sd.Ferrer@Wanadoo.FR'), 'wanadoo.fr');
});

test('the event time comes from ts_event seconds or ts_epoch milliseconds and falls back to arrival for anything implausible', () => {
  const now = new Date('2026-10-27T15:00:00Z');
  assert.equal(brevoEventTime({ ts_event: 1793113200 }, now).toISOString(), '2026-10-27T15:00:00.000Z');
  assert.equal(brevoEventTime({ ts_epoch: 1793113200000 }, now).toISOString(), '2026-10-27T15:00:00.000Z');
  assert.equal(brevoEventTime({ ts_event: 5 }, now).toISOString(), now.toISOString());
  assert.equal(brevoEventTime({ date: '2026-10-27 15:00:00' }, now).toISOString(), now.toISOString());
});

test('parseBrevoDeliveryEvent reads the message id, event and time from a real-shaped payload and caps the reason', () => {
  const now = new Date('2026-10-27T15:00:00Z');
  const parsed = parseBrevoDeliveryEvent({ email: 'a@example.test', event: 'soft_bounce', 'message-id': '<abc@relay>', reason: 'x'.repeat(500), ts_event: 1793113200 }, now);
  assert.equal(parsed?.event, 'soft_bounced');
  assert.equal(parsed?.messageId, 'abc@relay');
  assert.equal(parsed?.reason?.length, 200);
  assert.equal(parsed?.occurredAt.toISOString(), '2026-10-27T15:00:00.000Z');
  assert.equal(parseBrevoDeliveryEvent({ email: 'a@example.test', event: 'delivered' }, now), null, 'no message id');
  assert.equal(parseBrevoDeliveryEvent({ event: 'mystery', 'message-id': '<abc@relay>' }, now), null, 'untracked event');
  assert.equal(parseBrevoDeliveryEvent('nope', now), null);
});

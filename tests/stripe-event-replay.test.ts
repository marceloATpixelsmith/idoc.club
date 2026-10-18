import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReplayEvent, describeReplayEvent, parseReplaySince, replayConfirmationPhrase, ReplayInputError } from '../lib/payments/stripe-event-replay-core.ts';

const NOW = new Date('2026-10-22T12:00:00Z');

test('the replay start must be a UTC date and time within the last 29 days and not in the future', () => {
  assert.equal(parseReplaySince('2026-10-22 09:30', NOW).toISOString(), '2026-10-22T09:30:00.000Z');
  assert.equal(parseReplaySince('2026-10-22T09:30:15Z', NOW).toISOString(), '2026-10-22T09:30:15.000Z');
  for (const bad of ['22/10/2026', '2026-10-22', 'yesterday', '2026-13-40 10:00', '2026-10-23 10:00', '2026-09-01 10:00']) {
    assert.throws(() => parseReplaySince(bad, NOW), ReplayInputError, bad);
  }
});

test('an event is new, blocked earlier by the launch hold, or already processed', () => {
  const received = new Set(['evt_blocked', 'evt_done']);
  const blocked = new Set(['evt_blocked']);
  assert.equal(classifyReplayEvent('evt_new', received, blocked), 'new');
  assert.equal(classifyReplayEvent('evt_blocked', received, blocked), 'blocked_earlier');
  assert.equal(classifyReplayEvent('evt_done', received, blocked), 'already_processed');
});

test('an event is described by amount, currency, customer and object ID', () => {
  assert.deepEqual(describeReplayEvent({ created: 1, data: { object: { amount_paid: 8000, currency: 'eur', customer: 'cus_1', id: 'in_1' } }, id: 'evt_1', type: 'invoice.paid' }),
    { amountCents: 8000, currency: 'EUR', customerId: 'cus_1', objectId: 'in_1' });
  assert.deepEqual(describeReplayEvent({ created: 1, data: { object: { customer: { id: 'cus_2' }, id: 'sub_1' } }, id: 'evt_2', type: 'customer.subscription.updated' }),
    { amountCents: null, currency: null, customerId: 'cus_2', objectId: 'sub_1' });
  assert.equal(replayConfirmationPhrase(7), 'REPLAY 7 EVENTS');
});

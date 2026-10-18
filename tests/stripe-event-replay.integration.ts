import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import type Stripe from 'stripe';
import { applyReplay, previewReplay, ReplayBlockedError } from '../lib/payments/stripe-event-replay.ts';
import { adminUser, closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

const NOW = new Date();
const SINCE = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const at = (hoursAgo: number) => Math.floor((NOW.getTime() - hoursAgo * 3_600_000) / 1000);

// Types without a handler are recorded as received and ignored, which exercises the replay bookkeeping without needing full Stripe fixtures.
const fakeEvent = (id: string, hoursAgo: number) => ({ created: at(hoursAgo), data: { object: { amount: 100, currency: 'eur', customer: 'cus_x', id: `obj_${id}` } }, id, livemode: false, object: 'event', type: 'test.unhandled' }) as unknown as Stripe.Event;
const fakeStripe = (events: Stripe.Event[]) => ({ events: { list: async () => ({ data: [...events].reverse(), has_more: false }) } }) as never;

function withHold<T>(value: 'true' | 'false', run: () => Promise<T>): Promise<T> {
  const previous = process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING;
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = value;
  return run().finally(() => { if (previous === undefined) delete process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING; else process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = previous; });
}

test('the preview separates new events, events the launch hold consumed, and events already processed', async () => {
  await sql`insert into idoc.stripe_events(external_event_id,event_type,processed_at) values ('evt_done','test.unhandled',now()),('evt_held','test.unhandled',now())`;
  await sql`insert into idoc.reconciliation_findings(kind,summary,details) values ('status_conflict','held',${JSON.stringify({ eventId: 'evt_held', reason: 'member_launch_hold' })}::jsonb)`;
  const preview = await previewReplay(fakeStripe([fakeEvent('evt_done', 40), fakeEvent('evt_held', 30), fakeEvent('evt_new', 20)]), SINCE, NOW);
  assert.deepEqual(preview.counts, { already_processed: 1, blocked_earlier: 1, new: 1, superseded: 0 });
  assert.equal(preview.replayable, 2);
  assert.deepEqual(preview.events.map((event) => [event.id, event.status]), [['evt_held', 'blocked_earlier'], ['evt_new', 'new']]);
});

test('a replay is refused while the hold is on, when the reviewed count has changed, or when the confirmation text is wrong', async () => {
  const admin = await adminUser();
  const stripe = fakeStripe([fakeEvent('evt_a', 20), fakeEvent('evt_b', 10)]);
  await withHold('true', async () => {
    await assert.rejects(() => applyReplay({ actorId: admin.id, confirmation: 'REPLAY 2 EVENTS', expected: 2, now: NOW, since: SINCE, stripe }), /hold is still on/);
  });
  await withHold('false', async () => {
    await assert.rejects(() => applyReplay({ actorId: admin.id, confirmation: 'REPLAY 3 EVENTS', expected: 3, now: NOW, since: SINCE, stripe }), /now 2, not the 3/);
    await assert.rejects(() => applyReplay({ actorId: admin.id, confirmation: 'yes', expected: 2, now: NOW, since: SINCE, stripe }), ReplayBlockedError);
  });
  assert.equal((await sql`select 1 from idoc.stripe_events`).length, 0, 'nothing was applied');
});

test('a replay applies new events and re-applies events the hold consumed, oldest first, once', async () => {
  const admin = await adminUser();
  await sql`insert into idoc.stripe_events(external_event_id,event_type,processed_at) values ('evt_held','test.unhandled',now())`;
  await sql`insert into idoc.reconciliation_findings(kind,summary,details) values ('status_conflict','held',${JSON.stringify({ eventId: 'evt_held', reason: 'member_launch_hold' })}::jsonb)`;
  const stripe = fakeStripe([fakeEvent('evt_held', 30), fakeEvent('evt_new', 20)]);
  await withHold('false', async () => {
    const result = await applyReplay({ actorId: admin.id, confirmation: 'REPLAY 2 EVENTS', expected: 2, now: NOW, since: SINCE, stripe });
    assert.deepEqual({ failed: result.failed.length, ignored: result.ignored, processed: result.processed }, { failed: 0, ignored: 2, processed: 0 });
    const again = await previewReplay(stripe, SINCE, NOW);
    assert.equal(again.replayable, 1, 'the consumed event is still listed as blocked until a real handler records it; the new one is now processed');
  });
  assert.equal((await sql`select 1 from idoc.stripe_events where external_event_id in ('evt_held','evt_new') and processed_at is not null`).length, 2);
  const [audit] = await sql<{ after_json: { ignored: number } }[]>`select after_json from idoc.audit_log where action='admin.stripe_event_replay.applied'`;
  assert.equal(audit.after_json.ignored, 2);
});

test('a missed state event that a newer, already applied event for the same customer has overtaken is listed but not replayed', async () => {
  const admin = await adminUser();
  await sql`insert into idoc.stripe_events(external_event_id,event_type,processed_at) values ('evt_paid_later','invoice.paid',now())`;
  const failed = { ...fakeEvent('evt_failed_old', 40), type: 'invoice.payment_failed' } as unknown as Stripe.Event;
  const paidLater = { ...fakeEvent('evt_paid_later', 20), type: 'invoice.paid' } as unknown as Stripe.Event;
  const missed = fakeEvent('evt_missed', 10);
  const stripe = fakeStripe([failed, paidLater, missed]);
  const preview = await previewReplay(stripe, SINCE, NOW);
  assert.deepEqual(preview.counts, { already_processed: 1, blocked_earlier: 0, new: 1, superseded: 1 });
  assert.equal(preview.replayable, 1);
  assert.deepEqual(preview.events.map((event) => [event.id, event.status]), [['evt_failed_old', 'superseded'], ['evt_missed', 'new']]);
  await withHold('false', async () => {
    const result = await applyReplay({ actorId: admin.id, confirmation: 'REPLAY 1 EVENTS', expected: 1, now: NOW, since: SINCE, stripe });
    assert.equal(result.ignored, 1);
  });
  assert.equal((await sql`select 1 from idoc.stripe_events where external_event_id='evt_failed_old'`).length, 0, 'the overtaken event was not applied');
});

test('a membership payment received before the member existed is replayable; one that was applied, whose customer is not a member, or that is not a membership invoice is not', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.billing_accounts(profile_id,external_customer_id) values(${profile.id},'cus_member')`;
  await sql`insert into idoc.stripe_events(external_event_id,event_type,processed_at) values ('evt_early','invoice.paid',now()),('evt_applied','invoice.paid',now()),('evt_stranger','invoice.paid',now()),('evt_unrelated','invoice.paid',now())`;
  await sql`insert into idoc.payments(profile_id,source,external_payment_id,amount_cents,currency,paid_at) values (${profile.id},'stripe_recurring','in_applied',8000,'EUR',now())`;
  const paid = (id: string, invoice: string, customer: string, hoursAgo: number, product = 'prod_membership') => ({ created: at(hoursAgo), data: { object: { amount_paid: 8000, currency: 'eur', customer, id: invoice, lines: { data: [{ pricing: { price_details: { price: 'price_x', product } } }] } } }, id, livemode: false, object: 'event', type: 'invoice.paid' }) as unknown as Stripe.Event;
  process.env.STRIPE_MEMBERSHIP_PRODUCT_ID = 'prod_membership';
  const preview = await previewReplay(fakeStripe([paid('evt_early', 'in_early', 'cus_member', 40), paid('evt_applied', 'in_applied', 'cus_member', 30), paid('evt_stranger', 'in_stranger', 'cus_nobody', 20), paid('evt_unrelated', 'in_unrelated', 'cus_member', 10, 'prod_other')]), SINCE, NOW);
  assert.deepEqual(preview.events.map((event) => [event.id, event.status]), [['evt_early', 'blocked_earlier']]);
  assert.equal(preview.replayable, 1);
});

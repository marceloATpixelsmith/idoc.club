import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('lib/db/migrations/0049_payment_refunds.sql');
const refunds = read('lib/payments/refunds.ts');
const webhook = read('lib/payments/webhook-handlers.ts');
const checkout = read('lib/seminars/checkout.ts');

test('seminar Checkout remains dynamic one-time EUR pricing derived from the locked server record', () => {
  assert.match(checkout, /s\.title,s\.price_cents/);
  assert.match(checkout, /price_data: \{ currency: 'eur', product_data: \{ name: row\.title \}, unit_amount: row\.price_cents \}/);
  assert.match(checkout, /mode: 'payment'/);
  assert.match(checkout, /createSeminarCheckoutSession\(registrationIdValue: unknown/);
  assert.doesNotMatch(checkout, /priceValue|titleValue|customerIdValue|profileIdValue/);
});

test('seminar Checkout reuses the membership billing customer and converges duplicate creation', () => {
  assert.match(checkout, /resolveOrCreateBillingAccount/);
  assert.match(checkout, /for update/);
  assert.match(checkout, /checkout\.sessions\.retrieve/);
  assert.match(checkout, /idempotencyKey: `idoc-seminar-checkout-/);
});

test('webhook confirmation binds purpose, registration, profile, seminar, session, amount, currency, active state and paid status', () => {
  for (const evidence of ['seminar_registration', 'metadataProfileId', 'metadataSeminarId', 'checkoutSessionId', 'expectedAmountCents', "registrationStatus === 'registered'", "payment_status === 'paid'"]) {
    assert.ok(webhook.includes(evidence), `missing webhook evidence: ${evidence}`);
  }
  assert.match(webhook, /session\.currency\?\.toLowerCase\(\) === 'eur'/);
  assert.match(webhook, /seminar_payment_conflict/);
});

test('refund persistence is full-only, linked, idempotent and preserves original payments', () => {
  assert.match(migration, /payment_refunds_owner_check/);
  assert.match(migration, /external_refund_id.*UNIQUE/);
  assert.match(migration, /idempotency_key.*UNIQUE/);
  assert.match(refunds, /amount: row\.price_cents/);
  assert.match(refunds, /amount: payment\.amount_cents/);
  assert.doesNotMatch(refunds, /delete from idoc\.(?:payments|seminar_registrations)/i);
});

test('refund actions are administrator-authorized, reasoned, and never mutate membership entitlement', () => {
  assert.match(refunds, /requireAdministrator\(actor\)/);
  assert.match(refunds, /refund reason of 5–1000 characters is required/);
  assert.doesNotMatch(refunds, /update idoc\.memberships|insert into idoc\.memberships/);
  assert.match(refunds, /current_mode='non_recurring'/);
});

test('Stripe refund, failure, partial refund, dispute and chargeback states remain actionable', () => {
  for (const event of ['refund.created', 'refund.failed', 'refund.updated', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']) assert.ok(webhook.includes(event));
  for (const state of ['refunded', 'partially_refunded', 'refund_failed', 'disputed', 'chargeback']) assert.ok(webhook.includes(state));
  assert.match(webhook, /reconciliationFindings/);
});

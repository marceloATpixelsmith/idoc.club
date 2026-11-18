import assert from 'node:assert/strict';
import test from 'node:test';
import { failedRenewalDate, gracePeriodEnd, nextValidUntil } from '../lib/payments/renewal.ts';

test('a brand-new membership (no prior paid-through date) runs 12 months from the payment date', () => {
  assert.equal(nextValidUntil({ currentValidUntil: null, paidAt: '2026-03-10' }), '2027-03-10');
});

test('an early renewal, paid before the current paid-through date, adds 12 months to that date and keeps the unused remainder', () => {
  assert.equal(nextValidUntil({ currentValidUntil: '2026-12-31', paidAt: '2026-03-10' }), '2027-12-31');
});

test('a renewal paid exactly on the paid-through date is still an early renewal, not an expired one', () => {
  assert.equal(nextValidUntil({ currentValidUntil: '2026-06-15', paidAt: '2026-06-15' }), '2027-06-15');
});

test('a renewal paid after the membership has expired starts a fresh 12-month term on the actual payment date', () => {
  assert.equal(nextValidUntil({ currentValidUntil: '2026-01-01', paidAt: '2026-03-10' }), '2027-03-10');
});

test('adding 12 months across a leap day rolls Feb 29 forward to Mar 1 in a non-leap year', () => {
  assert.equal(nextValidUntil({ currentValidUntil: null, paidAt: '2028-02-29' }), '2029-03-01');
});

test('the five-day grace period rolls over a month boundary correctly', () => {
  assert.equal(gracePeriodEnd('2026-01-29'), '2026-02-02');
});

test('the five-day grace period rolls over a year boundary correctly', () => {
  assert.equal(gracePeriodEnd('2026-12-29'), '2027-01-02');
});

test('failedRenewalDate uses the billed period start, not the previous period start Stripe puts on invoice.period_start', () => {
  const unix = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
  // Renewal due 2026-11-14: invoice.period_start is a year earlier, the line's period.start is the renewal date.
  const invoice = { period_start: unix('2025-11-14'), lines: { data: [{ period: { start: unix('2026-11-14') } }] } };
  assert.equal(failedRenewalDate(invoice, new Date('2026-11-14T12:50:00Z')), '2026-11-14');
  assert.equal(gracePeriodEnd(failedRenewalDate(invoice, new Date('2026-11-14T12:50:00Z'))), '2026-11-18');
  assert.equal(failedRenewalDate({}, new Date('2026-11-14T12:50:00Z')), '2026-11-14');
  assert.equal(failedRenewalDate({ lines: { data: [{ period: null }, {}] } }, new Date('2026-03-02T01:00:00Z')), '2026-03-02');
});

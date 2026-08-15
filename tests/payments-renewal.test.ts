import assert from 'node:assert/strict';
import test from 'node:test';
import { gracePeriodEnd, nextValidUntil } from '../lib/payments/renewal.ts';

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
  assert.equal(gracePeriodEnd('2026-01-29'), '2026-02-03');
});

test('the five-day grace period rolls over a year boundary correctly', () => {
  assert.equal(gracePeriodEnd('2026-12-29'), '2027-01-03');
});

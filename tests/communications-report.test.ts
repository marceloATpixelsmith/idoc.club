import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkAgainstBrevoLog, noticeSendDate, totalsByKind, type BrevoLogEvent } from '../lib/notifications/communications-report.ts';

const at = (iso: string) => new Date(iso);
const event = (email: string, name: BrevoLogEvent['event'], iso: string): BrevoLogEvent => ({ at: at(iso), email, event: name });

test('a Brevo delivered event confirms the send, matched case-insensitively by recipient', () => {
  const checks = checkAgainstBrevoLog([{ email: 'Member@Example.com', id: 'n1', sentAt: at('2026-10-20T10:00:00Z') }], [event('member@example.com', 'delivered', '2026-10-20T10:00:05Z')]);
  assert.equal(checks.get('n1'), 'delivered');
});

test('a bounce after the send beats delivery, and one delivery is never credited to two sends', () => {
  const failed = checkAgainstBrevoLog([{ email: 'a@x.org', id: 'n1', sentAt: at('2026-10-20T10:00:00Z') }], [event('a@x.org', 'delivered', '2026-10-20T10:00:02Z'), event('a@x.org', 'hardBounces', '2026-10-20T10:00:09Z')]);
  assert.equal(failed.get('n1'), 'failed');
  const twice = checkAgainstBrevoLog([
    { email: 'a@x.org', id: 'n1', sentAt: at('2026-10-20T10:00:00Z') }, { email: 'a@x.org', id: 'n2', sentAt: at('2026-10-21T10:00:00Z') },
  ], [event('a@x.org', 'delivered', '2026-10-20T10:00:03Z')]);
  assert.equal(twice.get('n1'), 'delivered');
  assert.equal(twice.get('n2'), 'not_found');
});

test('events before the send, other recipients, and a missing Brevo log are never counted as delivery', () => {
  const sent = [{ email: 'a@x.org', id: 'n1', sentAt: at('2026-10-20T10:00:00Z') }, { email: null, id: 'n2', sentAt: at('2026-10-20T10:00:00Z') }];
  const checks = checkAgainstBrevoLog(sent, [event('a@x.org', 'delivered', '2026-10-19T10:00:00Z'), event('b@x.org', 'delivered', '2026-10-20T10:00:01Z')]);
  assert.equal(checks.get('n1'), 'not_found');
  assert.equal(checks.get('n2'), 'not_found');
  assert.equal(checkAgainstBrevoLog(sent, null).get('n1'), 'unavailable');
});

test('weekly totals separate sent, Brevo outcomes, pending and given-up emails per type', () => {
  const rows = [
    { deadLettered: false, email: 'a@x.org', id: 'n1', kind: 'membership.payment_failed', sentAt: at('2026-10-20T10:00:00Z') },
    { deadLettered: false, email: 'b@x.org', id: 'n2', kind: 'membership.payment_failed', sentAt: at('2026-10-20T11:00:00Z') },
    { deadLettered: false, email: 'c@x.org', id: 'n3', kind: 'membership.payment_failed', sentAt: null },
    { deadLettered: true, email: 'd@x.org', id: 'n4', kind: 'membership.payment_failed', sentAt: null },
  ];
  const [totals] = totalsByKind(rows, new Map([['n1', 'delivered'], ['n2', 'failed']]));
  assert.deepEqual({ delivered: totals.brevoDelivered, failed: totals.brevoFailed, failedToSend: totals.failedToSend, pending: totals.pending, sent: totals.sent }, { delivered: 1, failed: 1, failedToSend: 1, pending: 1, sent: 2 });
});

test('a notice goes out when its date enters the notice window, or on the next scan if it already has', () => {
  assert.equal(noticeSendDate('2026-11-30', 15, '2026-10-24'), '2026-11-15');
  assert.equal(noticeSendDate('2026-11-01', 15, '2026-10-24'), '2026-10-24');
});

test('the Communications page is an administrator-only menu item under Members, and the support badge text is dark', () => {
  const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
  assert.ok(navigation.indexOf("label: 'Members'") < navigation.indexOf("label: 'Communications'"));
  assert.ok(navigation.indexOf("label: 'Communications'") < navigation.indexOf("label: 'Revenue'"));
  assert.match(navigation, /bg-gold px-2 py-0\.5 text-xs font-semibold text-primary-foreground/);
  assert.doesNotMatch(navigation, /text-navy/);
  assert.match(readFileSync('lib/notifications/communications-report-data.ts', 'utf8'), /requireAdministrator\(actor\)/);
});

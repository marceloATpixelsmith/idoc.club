import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkAgainstBrevoLog, noticeSendDate, totalsByKind, type BrevoLogEvent } from '../lib/notifications/communications-report.ts';

const at = (iso: string) => new Date(iso);
const event = (email: string, name: BrevoLogEvent['event'], iso: string, messageId?: string): BrevoLogEvent => ({ at: at(iso), email, event: name, messageId });

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

test('a later send to the same address cannot overturn an earlier delivery', () => {
  const checks = checkAgainstBrevoLog([
    { email: 'a@x.org', id: 'renewal', sentAt: at('2026-10-20T10:00:00Z') }, { email: 'a@x.org', id: 'reset', sentAt: at('2026-10-21T10:00:00Z') },
  ], [event('a@x.org', 'delivered', '2026-10-20T10:00:03Z'), event('a@x.org', 'hardBounces', '2026-10-21T10:00:05Z')]);
  assert.equal(checks.get('renewal'), 'delivered');
  assert.equal(checks.get('reset'), 'failed');
});

test('the Communications lists use the shared administrator report table', () => {
  const tables = readFileSync('app/(dashboard)/admin/communications/communications-tables.tsx', 'utf8');
  assert.match(tables, /AdminReadOnlyTable/);
  assert.match(tables, /filterColumns/);
  assert.doesNotMatch(readFileSync('app/(dashboard)/admin/communications/page.tsx', 'utf8'), /<table[\s>]+className="min-w-full border text-sm">\s*<caption className="sr-only">(Renewal notices from|Upcoming)/);
});

test('two sends to one address less than two minutes apart each keep their own delivery', () => {
  const checks = checkAgainstBrevoLog([
    { email: 'a@x.org', id: 'first', sentAt: at('2026-10-20T10:00:00Z') }, { email: 'a@x.org', id: 'second', sentAt: at('2026-10-20T10:01:00Z') },
  ], [event('a@x.org', 'delivered', '2026-10-20T10:00:05Z'), event('a@x.org', 'delivered', '2026-10-20T10:01:05Z')]);
  assert.equal(checks.get('first'), 'delivered');
  assert.equal(checks.get('second'), 'delivered');
  const onlySecond = checkAgainstBrevoLog([
    { email: 'a@x.org', id: 'first', sentAt: at('2026-10-20T10:00:00Z') }, { email: 'a@x.org', id: 'second', sentAt: at('2026-10-20T10:01:00Z') },
  ], [event('a@x.org', 'delivered', '2026-10-20T10:01:05Z')]);
  assert.equal(onlySecond.get('first'), 'not_found');
  assert.equal(onlySecond.get('second'), 'delivered');
});

test('every outcome of an earlier send stays with it, so a close second send cannot reuse its leftover delivery', () => {
  const checks = checkAgainstBrevoLog([
    { email: 'a@x.org', id: 'first', sentAt: at('2026-10-20T10:00:00Z') }, { email: 'a@x.org', id: 'second', sentAt: at('2026-10-20T10:01:00Z') },
  ], [event('a@x.org', 'delivered', '2026-10-20T10:00:05Z'), event('a@x.org', 'softBounces', '2026-10-20T10:00:09Z')]);
  assert.equal(checks.get('first'), 'failed');
  assert.equal(checks.get('second'), 'not_found');
});

test('the Communications and new-member queries pass ISO strings, never Date objects, to the database client', () => {
  for (const file of ['lib/notifications/communications-report-data.ts', 'lib/membership/new-members.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\$\{from\}|\$\{since\}(?!::timestamptz)/);
    assert.match(source, /::timestamptz/);
  }
  const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
  assert.ok(navigation.indexOf("label: 'Members'") < navigation.indexOf("label: 'Support inbox'"));
  assert.ok(navigation.indexOf("label: 'Support inbox'") < navigation.indexOf("label: 'Communications'"));
});

test('admin menu order: Members, Support inbox, Communications, then Seminars, Registrations, News / Blog, with Stripe reconciliation last', () => {
  const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
  const order = ['Members', 'Support inbox', 'Communications', 'Revenue', 'Exports', 'Seminars/Courses', 'Registrations', 'News / Blog', 'Stripe reconciliation'].map((label) => navigation.indexOf(`label: '${label}'`));
  assert.ok(order.every((position) => position > 0));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
  assert.ok(order.at(-1)! < navigation.indexOf('const SUPER_ADMIN_ITEMS'));
});

test('the Communications page has one tab per section and a delivery-issues list of non-delivered emails', () => {
  const page = readFileSync('app/(dashboard)/admin/communications/page.tsx', 'utf8');
  const tabs = readFileSync('app/(dashboard)/admin/communications/communications-tabs.tsx', 'utf8');
  for (const value of ['system', 'renewal', 'upcoming', 'issues']) assert.match(tabs, new RegExp(`<TabsTrigger value="${value}"`));
  assert.match(page, /DeliveryIssuesTable/);
  assert.doesNotMatch(page, /min-w-full/);
  const data = readFileSync('lib/notifications/communications-report-data.ts', 'utf8');
  assert.match(data, /brevo !== 'failed' && brevo !== 'not_found'/);
});

test('emails sent in a quick burst to one address and delivered much later are each matched to their own delivery by message id', () => {
  // The real pattern: three activation emails within 90 seconds, each delivered 25-93 minutes later. Matching by time window gave the
  // delivery of the first two to the last send, so two of every three were reported as unconfirmed.
  const sends = [
    { email: 'm@wanadoo.fr', id: 'a1', sentAt: at('2026-10-27T07:37:15Z') }, { email: 'm@wanadoo.fr', id: 'a2', sentAt: at('2026-10-27T07:37:50Z') }, { email: 'm@wanadoo.fr', id: 'a3', sentAt: at('2026-10-27T07:38:45Z') },
  ];
  const log = [
    event('m@wanadoo.fr', 'requests', '2026-10-27T07:37:16Z', 'id-1'), event('m@wanadoo.fr', 'requests', '2026-10-27T07:37:51Z', 'id-2'), event('m@wanadoo.fr', 'requests', '2026-10-27T07:38:45Z', 'id-3'),
    event('m@wanadoo.fr', 'delivered', '2026-10-27T08:02:21Z', 'id-1'), event('m@wanadoo.fr', 'delivered', '2026-10-27T08:14:18Z', 'id-2'), event('m@wanadoo.fr', 'delivered', '2026-10-27T09:11:36Z', 'id-3'),
  ];
  const checks = checkAgainstBrevoLog(sends, log);
  assert.deepEqual(['a1', 'a2', 'a3'].map((id) => checks.get(id)), ['delivered', 'delivered', 'delivered']);
  // Without message ids the old time-window matching is still used.
  const legacy = checkAgainstBrevoLog(sends, log.map(({ at: when, email, event: name }) => ({ at: when, email, event: name })));
  assert.equal(legacy.get('a1'), 'not_found', 'the limitation the message-id matching removes');
});

test('by message id a failure still beats a delivery, and a message with no outcome yet is not confirmed', () => {
  const sends = [{ email: 'a@x.org', id: 's1', sentAt: at('2026-10-27T10:00:00Z') }, { email: 'a@x.org', id: 's2', sentAt: at('2026-10-27T10:01:00Z') }];
  const log = [
    event('a@x.org', 'requests', '2026-10-27T10:00:01Z', 'm1'), event('a@x.org', 'requests', '2026-10-27T10:01:01Z', 'm2'),
    event('a@x.org', 'delivered', '2026-10-27T10:05:00Z', 'm1'), event('a@x.org', 'hardBounces', '2026-10-27T10:06:00Z', 'm1'),
    event('a@x.org', 'deferred', '2026-10-27T10:03:00Z', 'm2'),
  ];
  const checks = checkAgainstBrevoLog(sends, log);
  assert.equal(checks.get('s1'), 'failed');
  assert.equal(checks.get('s2'), 'not_found');
});

test('a send whose own request event is missing is never paired with a neighbouring send\'s request', () => {
  const sends = [{ email: 'a@x.org', id: 's1', sentAt: at('2026-10-27T10:00:00Z') }, { email: 'a@x.org', id: 's2', sentAt: at('2026-10-27T10:01:30Z') }];
  // Only s2 has a request event; s1's was never logged. s1 must not borrow s2's (90 seconds away) and take its delivery.
  const checks = checkAgainstBrevoLog(sends, [event('a@x.org', 'requests', '2026-10-27T10:01:31Z', 'm2'), event('a@x.org', 'delivered', '2026-10-27T10:20:00Z', 'm2')]);
  assert.equal(checks.get('s2'), 'delivered');
  assert.notEqual(checks.get('s1'), 'delivered');
});

test('two sends under 30 seconds apart where only the later one has a request event: the earlier is not judged by the later one\'s message', () => {
  const sends = [{ email: 'a@x.org', id: 's1', sentAt: at('2026-10-27T10:00:00Z') }, { email: 'a@x.org', id: 's2', sentAt: at('2026-10-27T10:00:20Z') }];
  const checks = checkAgainstBrevoLog(sends, [event('a@x.org', 'requests', '2026-10-27T10:00:21Z', 'm2'), event('a@x.org', 'hardBounces', '2026-10-27T10:05:00Z', 'm2')]);
  assert.equal(checks.get('s2'), 'failed', 'the later send, which owns the request, is the one that bounced');
  assert.notEqual(checks.get('s1'), 'failed', 'the earlier send must not borrow its neighbour\'s message and bounce');
});

test('an earlier send without a request event cannot consume the outcome of a later send that owns it by message id', () => {
  const sends = [{ email: 'a@x.org', id: 's1', sentAt: at('2026-10-27T10:00:00Z') }, { email: 'a@x.org', id: 's2', sentAt: at('2026-10-27T10:01:00Z') }];
  const checks = checkAgainstBrevoLog(sends, [event('a@x.org', 'requests', '2026-10-27T10:00:58Z', 'm2'), event('a@x.org', 'delivered', '2026-10-27T10:00:59Z', 'm2')]);
  assert.equal(checks.get('s2'), 'delivered');
  assert.equal(checks.get('s1'), 'not_found', 'the earlier send must not be credited with the later message\'s delivery');
});

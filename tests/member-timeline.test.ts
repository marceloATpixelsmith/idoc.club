import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyUserAgent, sanitizeActivityDetail, USER_ACTIVITY_EVENTS } from '../lib/activity/user-activity-events.ts';
import { auditActor, auditTitle, brevoEntry, safeLink, sortTimeline, timelineRange, withinRange } from '../lib/admin/member-timeline-core.ts';

const now = new Date('2026-10-25T13:00:00Z');

test('the date range defaults to the last 30 days and refuses reversed or oversized ranges', () => {
  assert.deepEqual([timelineRange(null, null, now).fromKey, timelineRange(null, null, now).toKey], ['2026-09-26', '2026-10-25']);
  assert.deepEqual([timelineRange('2026-10-01', '2026-10-10', now).fromKey, timelineRange('2026-10-01', '2026-10-10', now).toKey], ['2026-10-01', '2026-10-10']);
  assert.equal(timelineRange('2026-10-10', '2026-10-01', now).fromKey, '2026-09-26');
  assert.equal(timelineRange('2020-01-01', '2026-10-25', now).fromKey, '2026-09-26');
  assert.equal(timelineRange('not-a-date', 'x', now).toKey, '2026-10-25');
  assert.equal(timelineRange('2026-10-01', '2026-10-10', now).to.toISOString(), '2026-10-10T23:59:59.999Z');
});

test('every row says who did it: the member, the server, or an administrator', () => {
  assert.equal(auditActor(414, 414), 'user');
  assert.equal(auditActor(1, 414), 'administrator');
  assert.equal(auditActor(null, 414), 'server');
  assert.equal(auditActor(null, 414, 'member.seminar_registration.registered'), 'user');
  assert.equal(auditActor(1, 414, 'admin.seminar_registration.created'), 'administrator');
  assert.equal(auditTitle('account.migration_activation.completed'), 'Account activated');
  assert.equal(auditTitle('membership.extended'), 'Membership extended');
});

test('Brevo opens and clicks are the member; deliveries and bounces are the mail system; link tokens are dropped', () => {
  const at = '2026-10-24T07:43:37.000Z';
  assert.equal(brevoEntry({ at, event: 'opened', subject: 'Activate your IDOC account' }, 0).actor, 'user');
  assert.equal(brevoEntry({ at, event: 'delivered', subject: 'x' }, 1).actor, 'server');
  assert.equal(brevoEntry({ at, event: 'hardBounces', reason: 'mailbox full', subject: 'x' }, 2).detail, 'mailbox full');
  const click = brevoEntry({ at, event: 'clicks', link: 'https://idoc.club/activate?token=SECRETSECRETSECRET', subject: 'x' }, 3);
  assert.equal(click.actor, 'user');
  assert.equal(click.detail, 'https://idoc.club/activate');
  assert.equal(safeLink('https://idoc.club/dashboard/membership#frag'), 'https://idoc.club/dashboard/membership');
  assert.equal(safeLink('not a url'), undefined);
  assert.ok(brevoEntry({ at, event: 'opened' }, 4).source === 'brevo');
});

test('the timeline sorts chronologically in either direction', () => {
  const entries = [{ at: '2026-10-24T07:42:00Z', id: 'b' }, { at: '2026-10-24T07:26:00Z', id: 'a' }].map((e) => ({ ...e, actor: 'server' as const, category: 'x', source: 'idoc' as const, title: e.id }));
  assert.deepEqual(sortTimeline(entries).map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(sortTimeline(entries, 'desc').map((entry) => entry.id), ['b', 'a']);
});

test('recorded activity detail is a closed set of short categorical values and never free text or secrets', () => {
  assert.deepEqual(sanitizeActivityDetail({ browser: 'scanner', host: 'idoc.club', password: 'hunter2', token: 'abc', kind: 'membership.grace_reminder', signedIn: false }), { browser: 'scanner', host: 'idoc.club', kind: 'membership.grace_reminder', signedIn: false });
  assert.equal(sanitizeActivityDetail({ token: 'abc' }), null);
  assert.equal(String(sanitizeActivityDetail({ host: 'x'.repeat(500) })?.host).length, 80);
  assert.equal(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), 'browser');
  assert.equal(classifyUserAgent('Mozilla/5.0 (compatible; Proofpoint URL Defense)'), 'scanner');
  assert.equal(classifyUserAgent(''), 'missing');
  assert.ok(Object.keys(USER_ACTIVITY_EVENTS).includes('email_link_clicked'));
});

test('the timeline is its own drawer opened from a table action, separate from the member form tabs', () => {
  const sheet = readFileSync('app/(dashboard)/admin/members/member-detail-sheet.tsx', 'utf8');
  assert.doesNotMatch(sheet, /value="timeline"/);
  const table = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');
  assert.match(table, /aria-label="Timeline"/);
  assert.match(table, /\?timeline=\$\{row\.original\.profileId\}/);
  const page = readFileSync('app/(dashboard)/admin/members/page.tsx', 'utf8');
  assert.match(page, /MemberTimelineDrawer/);
  const drawer = readFileSync('app/(dashboard)/admin/members/member-timeline-drawer.tsx', 'utf8');
  assert.match(drawer, /AdminFormDrawer/);
  assert.match(drawer, /DateRangeFilter/);
  assert.doesNotMatch(drawer, /router\.(push|replace)\(.*from=/);
  const route = readFileSync('app/api/admin/members/[profileId]/timeline/route.ts', 'utf8');
  assert.match(route, /requireAdministrator/);
  assert.match(readFileSync('lib/admin/member-timeline.ts', 'utf8'), /requireAdministrator\(actor\)/);
});

test('every non-delivered count on the Communications dashboard opens its addresses and links to the member timeline', () => {
  const page = readFileSync('app/(dashboard)/admin/communications/page.tsx', 'utf8');
  for (const bucket of ['bounced', 'notInBrevo', 'pending', 'failedToSend']) assert.match(page, new RegExp(`'${bucket}'`));
  assert.equal((page.match(/<RecipientCount /g) ?? []).length, 6);
  assert.match(readFileSync('app/(dashboard)/admin/communications/recipient-count.tsx', 'utf8'), /\/admin\/members\?timeline=\$\{recipient\.profileId\}/);
});

test('events outside the requested range are dropped even when their record is selected by another timestamp', () => {
  const entries = ['2026-10-01T10:00:00.000Z', '2026-10-10T10:00:00.000Z', '2026-10-20T10:00:00.000Z'].map((at) => ({ actor: 'user' as const, at, category: 'x', id: at, source: 'idoc' as const, title: at }));
  assert.deepEqual(withinRange(entries, '2026-10-05T00:00:00.000Z', '2026-10-15T23:59:59.999Z').map((entry) => entry.at), ['2026-10-10T10:00:00.000Z']);
  assert.match(readFileSync('lib/admin/member-timeline.ts', 'utf8'), /withinRange\(entries, fromIso, toIso\)/);
});

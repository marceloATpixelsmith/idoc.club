import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalActivityDetail, classifyUserAgent, sanitizeActivityDetail, USER_ACTIVITY_EVENTS } from '../lib/activity/user-activity-events.ts';
import { accountMilestones, auditActor, auditDuplicatesAnotherSource, auditTitle, brevoEntry, emailStepTitles, errorCodeLabel, formatTimelineTime, otpPurposeLabel, safeLink, securityNoticeLabel, sortTimeline, timelineRange, withinRange } from '../lib/admin/member-timeline-core.ts';

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
  assert.equal(auditTitle('account.migration_activation.completed'), 'Activated their account by choosing a new password');
  assert.equal(auditTitle('account.migration_activation.completed'), 'Activated their account by choosing a new password');
  assert.equal(auditTitle('some.new_internal_event'), 'System record: some new internal event');
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

test('duplicate-click detection compares activity detail regardless of the key order the database returns', () => {
  const sent = sanitizeActivityDetail({ browser: 'browser', host: 'idoc.club', kind: 'membership.grace_reminder', signedIn: false, slot: 'membership' });
  const stored = { slot: 'membership', host: 'idoc.club', kind: 'membership.grace_reminder', browser: 'browser', signedIn: false }; // jsonb reorders keys
  assert.notEqual(JSON.stringify(sent), JSON.stringify(stored));
  assert.equal(canonicalActivityDetail(sent), canonicalActivityDetail(stored));
  assert.notEqual(canonicalActivityDetail(sent), canonicalActivityDetail({ ...stored, signedIn: true }));
  assert.equal(canonicalActivityDetail(null), canonicalActivityDetail(undefined));
  assert.match(readFileSync('lib/activity/user-activity.ts', 'utf8'), /canonicalActivityDetail\(row\.detail/);
});

test('an imported member shows when they registered on the old site and when they were imported; a new member shows when they signed up', () => {
  const imported = accountMilestones({ accountState: 'migrated_pending', emailVerifiedAt: null, legacyWpUserId: 592, profileCreatedAt: '2026-10-23T22:07:15.363Z', userCreatedAt: '2025-10-21T00:00:00.000Z' });
  assert.deepEqual(imported.map((entry) => [entry.title, entry.at, entry.actor]), [
    ['Registered on the old site', '2025-10-21T00:00:00.000Z', 'user'],
    ['Imported into the new site', '2026-10-23T22:07:15.363Z', 'administrator'],
  ]);
  assert.match(imported[1].detail ?? '', /#592/);
  const fresh = accountMilestones({ accountState: 'active', emailVerifiedAt: '2026-10-24T20:50:39.635Z', legacyWpUserId: null, profileCreatedAt: '2026-10-24T20:51:28.653Z', userCreatedAt: '2026-10-24T20:50:39.926Z' });
  assert.deepEqual(fresh.map((entry) => entry.title), ['Created their account on the new site']);
  assert.match(fresh[0].detail ?? '', /verified as part of signing up/);
  assert.ok(fresh.every((entry) => entry.actor === 'user'));
});

test('audit rows that repeat another source are skipped only when that source was actually read', () => {
  const both = { accountEmails: true, payments: true };
  assert.equal(auditDuplicatesAnotherSource('admin.payment.recorded', both), true);
  assert.equal(auditDuplicatesAnotherSource('account.migration_activation.delivery_queued', both), true);
  assert.equal(auditDuplicatesAnotherSource('account.password_reset.delivery_succeeded', both), true);
  assert.equal(auditDuplicatesAnotherSource('account.session.signed_in', both), false);
  assert.equal(auditDuplicatesAnotherSource('admin.payment.recorded', { accountEmails: true, payments: false }), false);
  assert.equal(auditDuplicatesAnotherSource('account.migration_activation.delivery_queued', { accountEmails: false, payments: true }), false);
  assert.equal(auditTitle('account.session.signed_in'), 'Signed in');
});

test('each timeline source fails on its own instead of blanking the timeline, and the drawer says what is missing', () => {
  const data = readFileSync('lib/admin/member-timeline.ts', 'utf8');
  assert.match(data, /const safe = async/);
  assert.equal((data.match(/safe\('/g) ?? []).length, 13);
  assert.match(data, /unavailableSources/);
  const drawer = readFileSync('app/(dashboard)/admin/members/member-timeline-drawer.tsx', 'utf8');
  assert.match(drawer, /Some sources could not be read/);
  assert.match(drawer, /Account history/);
});

test('timeline times show milliseconds so events in the same second keep their order', () => {
  assert.equal(formatTimelineTime('2026-10-24T20:50:39.926Z'), '20:50:39.926');
  const close = [{ at: '2026-10-24T20:50:39.987Z', id: 'b' }, { at: '2026-10-24T20:50:39.926Z', id: 'z' }].map((e) => ({ ...e, actor: 'server' as const, category: 'x', source: 'idoc' as const, title: e.id }));
  assert.deepEqual(sortTimeline(close).map((entry) => entry.id), ['z', 'b']);
});

test('wording is plain English: no raw event codes or provider jargon in titles', () => {
  const at = '2026-10-24T07:43:37.000Z';
  assert.match(brevoEntry({ at, event: 'loadedByProxy', subject: 'Your IDOC sign-in code' }, 0).title, /mail app automatically loaded/);
  assert.match(brevoEntry({ at, event: 'loadedByProxy' }, 1).detail ?? '', /does not prove they read it/);
  assert.equal(brevoEntry({ at, event: 'loadedByProxy' }, 2).actor, 'user');
  for (const event of ['requests', 'delivered', 'opened', 'clicks', 'hardBounces', 'softBounces', 'blocked', 'invalid', 'deferred', 'spam', 'unsubscribed', 'error', 'uniqueOpened']) {
    assert.doesNotMatch(brevoEntry({ at, event, subject: 'Hello' }, 3).title, /hardBounces|softBounces|loadedByProxy|uniqueOpened|requests\b/, event);
  }
  assert.equal(auditTitle('account.session.signed_in'), 'Signed in');
  assert.equal(emailStepTitles('Renewal reminder').sent, 'Email handed to our email service (Brevo): Renewal reminder');
  assert.equal(securityNoticeLabel('new_sign_in'), 'Security alert email (new sign-in)');
  assert.equal(otpPurposeLabel('login_verification'), 'sign-in code');
  assert.match(errorCodeLabel('member_launch_hold') ?? '', /switched off/);
  assert.equal(errorCodeLabel(undefined), undefined);
  for (const action of ['account.onboarding.completed', 'member.profile.created', 'admin.payment.recorded', 'admin.role.granted', 'auth.mfa.recovery_code.used', 'support.conversation.closed']) {
    assert.doesNotMatch(auditTitle(action), /[._]/, action);
  }
});

test('a sign-in shows the device it came from, taken from the session recorded at the same moment', () => {
  const data = readFileSync('lib/admin/member-timeline.ts', 'utf8');
  assert.match(data, /deviceAt\(at\)/);
  assert.match(data, /safe\('Devices'/);
});

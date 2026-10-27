import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertTier, buildDeliveryProblemAlert, buildRepeatRequestAlert, deliveryDeadlineMs, diagnose, emailKindLabel,
  AUTH_CODE_DEADLINE_MS, buildFloodSummaryAlert, GENERAL_DEADLINE_MS, HOURLY_ALERT_CAP, HOURLY_REPEAT_ALERT_CAP, type DeliveryProblemData,
} from '../lib/notifications/email-delivery-watch-core.ts';

const now = new Date('2026-10-27T15:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

test('a code email is overdue after 5 minutes and every other email after 30', () => {
  assert.equal(deliveryDeadlineMs('auth.otp.login_verification'), AUTH_CODE_DEADLINE_MS);
  assert.equal(deliveryDeadlineMs('account.migration_activation'), GENERAL_DEADLINE_MS);
  assert.equal(deliveryDeadlineMs(null), GENERAL_DEADLINE_MS);
  assert.equal(alertTier({ kind: 'auth.otp.login_verification', now, sentAt: ago(4), status: 'accepted' }), null);
  assert.equal(alertTier({ kind: 'auth.otp.login_verification', now, sentAt: ago(5), status: 'accepted' }), 'late');
  assert.equal(alertTier({ kind: 'account.password_reset', now, sentAt: ago(10), status: 'deferred' }), null);
  assert.equal(alertTier({ kind: 'account.password_reset', now, sentAt: ago(30), status: 'deferred' }), 'late');
});

test('delivered never alerts, a permanent failure alerts at once, and 24 hours undelivered is reported as final', () => {
  assert.equal(alertTier({ kind: 'auth.otp.login_verification', now, sentAt: ago(600), status: 'delivered' }), null);
  for (const status of ['hard_bounced', 'blocked', 'invalid', 'error', 'spam']) assert.equal(alertTier({ kind: null, now, sentAt: ago(1), status }), 'failed', status);
  assert.equal(alertTier({ kind: null, now, sentAt: ago(24 * 60), status: 'soft_bounced' }), 'final');
});

test('every status has a diagnosis with next steps, and an undelivered one says whether Brevo was asked', () => {
  for (const status of ['hard_bounced', 'blocked', 'invalid', 'spam', 'error', 'deferred', 'soft_bounced', 'accepted']) {
    const result = diagnose({ ageMinutes: 9, brevoCheck: 'no_events', events: [], status });
    assert.ok(result.summary.length > 20 && result.steps.length > 0, status);
  }
  assert.match(diagnose({ ageMinutes: 9, brevoCheck: 'no_events', events: [], status: 'accepted' }).summary, /not even when asked directly/);
  assert.match(diagnose({ ageMinutes: 9, brevoCheck: 'unavailable', events: [], status: 'accepted' }).summary, /could not reach Brevo/);
  assert.match(diagnose({ ageMinutes: 9, brevoCheck: 'skipped', events: [{ at: now, event: 'blocked', reason: 'on blocklist' }], status: 'blocked' }).summary, /on blocklist/);
});

const problem = (overrides: Partial<DeliveryProblemData> = {}): DeliveryProblemData => ({
  baseUrl: 'https://idoc.club', brevoCheck: 'no_events', codeRequests: { requested: 3, withEntryAttempt: 0 },
  domain: { delivered: 1, domain: 'wanadoo.fr', notDelivered: 3, total: 5 },
  email: { id: 7, kind: 'auth.otp.login_verification', messageId: '202610271445.1@smtp-relay.mailin.fr', messageRef: 'ref-9', sentAt: ago(9), status: 'deferred', statusAt: ago(8), subject: 'Your IDOC sign-in code', to: 'sd.ferrer@wanadoo.fr' },
  events: [{ at: ago(8), event: 'deferred', reason: '421 try again later' }],
  member: { accountState: 'onboarding', name: 'S. Ferrer', profileId: 68, userId: 68 }, now,
  recent: [{ kind: 'account.migration_activation', sentAt: ago(300), status: 'delivered', subject: 'Activate' }], tier: 'late', ...overrides,
});

test('the delivery alert carries everything needed to troubleshoot and nothing secret', () => {
  const alert = buildDeliveryProblemAlert(problem());
  for (const expected of ['sd.ferrer@wanadoo.fr', '202610271445.1@smtp-relay.mailin.fr', 'ref-9', 'sign-in code', 'Your IDOC sign-in code', 'deferred',
    '421 try again later', 'S. Ferrer', 'user #68', 'https://idoc.club/admin/members?timeline=68', 'wanadoo.fr', '3 not delivered', 'Several are stuck',
    '5 minutes (a code is only useful briefly)', '3, of which 0 had at least one code entered', 'Brevo → Transactional → Logs']) {
    assert.ok(alert.html.includes(expected), `missing: ${expected}`);
  }
  assert.equal(alert.dedupeKey, 'email-delivery-problem:7:late');
  assert.equal(alert.subject, 'IDOC: email not delivered — sign-in code to wanadoo.fr');
  assert.equal(/\b\d{6}\b/.test(alert.html.replace(/<[^>]*>/g, ' ').replace(/\d{12}\.\d/g, '')), false, 'no six-digit code appears in the text');
});

test('alert text is HTML-escaped and a final alert is distinct from a late one', () => {
  const hostile = buildDeliveryProblemAlert(problem({ events: [{ at: now, event: 'deferred', reason: '<script>alert(1)</script>' }], member: { accountState: null, name: '<b>x</b>', profileId: null, userId: 1 } }));
  assert.equal(hostile.html.includes('<script>alert(1)'), false);
  assert.ok(hostile.html.includes('&lt;script&gt;'));
  assert.notEqual(buildDeliveryProblemAlert(problem({ tier: 'final' })).dedupeKey, buildDeliveryProblemAlert(problem({ tier: 'late' })).dedupeKey);
  assert.match(buildDeliveryProblemAlert(problem({ tier: 'failed' })).html, /Email could not be delivered/);
});

test('an address with no account and no events still produces a complete alert', () => {
  const alert = buildDeliveryProblemAlert(problem({ codeRequests: null, events: [], member: null, recent: [] }));
  assert.ok(alert.html.includes('No account'));
  assert.ok(alert.html.includes('No events have been reported'));
  assert.ok(alert.html.includes('No other emails to this address'));
});

test('the repeated-request alert tells delivered-but-never-entered apart from not-delivered', () => {
  const base = { baseUrl: 'https://idoc.club', domain: { delivered: 2, domain: 'wanadoo.fr', notDelivered: 0, total: 2 }, member: null, now, purpose: 'login_verification', to: 'sd.ferrer@wanadoo.fr' };
  const delivered = buildRepeatRequestAlert({ ...base, requests: [0, 1, 2].map((index) => ({ events: [{ at: ago(10 - index), event: 'delivered', reason: null }], requestedAt: ago(10 - index), status: 'delivered' })) });
  assert.match(delivered.html, /never entered one\. They most likely cannot find the email/);
  const stuck = buildRepeatRequestAlert({ ...base, requests: [{ events: [], requestedAt: ago(9), status: 'deferred' }, { events: [], requestedAt: ago(6), status: null }, { events: [], requestedAt: ago(3), status: 'delivered' }] });
  assert.match(stuck.html, /at least one was not reported delivered/);
  assert.match(stuck.html, /no delivery record/);
  assert.equal(delivered.dedupeKey, buildRepeatRequestAlert({ ...base, requests: [] }).dedupeKey, 'one alert per address, purpose and hour');
  assert.equal(delivered.subject, 'IDOC: 3 sign-in code requests, none entered — wanadoo.fr');
});

test('kinds have readable labels and fall back to the subject', () => {
  assert.equal(emailKindLabel('auth.otp.signup_verification', null), 'sign-up code');
  assert.equal(emailKindLabel(null, 'Welcome'), 'Welcome');
  assert.equal(emailKindLabel(null, null), 'email');
});

test('the flood summaries state how many are held, why, whether they will be reported later, and where to look, once per family per hour', () => {
  const emails = buildFloodSummaryAlert({ baseUrl: 'https://idoc.club', held: 12, kind: 'emails', now });
  assert.ok(emails.html.includes('12 more emails need attention'));
  assert.ok(emails.html.includes(`after ${HOURLY_ALERT_CAP}`));
  assert.ok(emails.html.includes('https://idoc.club/admin/communications'));
  assert.ok(emails.html.includes('reported as the cap allows over the next hours'));
  assert.equal(emails.dedupeKey, buildFloodSummaryAlert({ baseUrl: 'https://idoc.club', held: 99, kind: 'emails', now: new Date(now.getTime() + 60_000) }).dedupeKey);
  assert.match(buildFloodSummaryAlert({ baseUrl: 'https://idoc.club', held: 1, kind: 'emails', now }).html, /1 more email needs attention/);

  const requests = buildFloodSummaryAlert({ baseUrl: 'https://idoc.club', held: 3, kind: 'requests', now });
  assert.ok(requests.html.includes('3 more members are requesting codes'));
  assert.ok(requests.html.includes(`after ${HOURLY_REPEAT_ALERT_CAP}`));
  assert.ok(requests.html.includes('NOT reported later'), 'it does not promise later reporting for a pattern that expires');
  assert.notEqual(requests.dedupeKey, emails.dedupeKey, 'the two families never share a summary');
});

test('URL schemes in untrusted text never reach an alert, because the send boundary refuses a message that mentions another IDOC host as a URL', async () => {
  const { nonCanonicalEmailHosts } = await import('../lib/notifications/email-link-policy.ts');
  const hostile = 'rejected, see https://staging.idoc.club/x and http://my-idoc.vercel.app/y and ftp://idoc.test/z';
  const alert = buildDeliveryProblemAlert(problem({
    events: [{ at: now, event: 'deferred', reason: hostile }], member: { accountState: null, name: 'https://redesign.idoc.club', profileId: null, userId: 1 },
    email: { ...problem().email, status: 'deferred', subject: 'http://idoc.vercel.app' },
  }));
  assert.deepEqual(nonCanonicalEmailHosts(alert.html), [], 'the alert HTML carries no non-canonical IDOC URL');
  const repeat = buildRepeatRequestAlert({ baseUrl: 'https://idoc.club', domain: { delivered: 0, domain: 'x.org', notDelivered: 1, total: 1 }, member: null, now, purpose: 'login_verification', to: 'a@x.org',
    requests: [{ events: [{ at: now, event: 'deferred', reason: hostile }], requestedAt: now, status: 'deferred' }] });
  assert.deepEqual(nonCanonicalEmailHosts(repeat.html), []);
  assert.ok(alert.html.includes('staging.idoc.club/x'), 'the text itself is still readable, only the scheme is removed');
});

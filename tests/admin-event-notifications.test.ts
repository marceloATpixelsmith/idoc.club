import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const notifications = read('lib/notifications/admin-event-notifications.ts');
const alerts = read('lib/notifications/admin-event-alerts.ts');

test('recipients are exactly the active administrators and super administrators assigned to the support category, with the operations mailbox as the only fallback', () => {
  assert.match(notifications, /from support_category_defaults d/);
  assert.match(notifications, /u\.account_state='active'/);
  assert.match(notifications, /r\.revoked_at is null and r\.role in \('administrator','super_admin'\)/);
  assert.match(notifications, /IDOC_ADMIN_NOTIFICATION_EMAIL/);
});

test('the sender is branded, severity-tagged, bounded and can never throw into the caller', () => {
  assert.match(notifications, /renderTransactionalEmail\(/);
  assert.match(notifications, /taggedSubject\(event\.kind/);
  assert.match(notifications, /AbortSignal\.timeout\(DELIVERY_TIMEOUT_MS\)/);
  assert.match(notifications, /Promise\.allSettled/);
  assert.doesNotMatch(notifications, /\bthrow\b/);
});

test('each event family routes to its own support category', () => {
  assert.match(alerts, /category: 'seminars'/);
  assert.match(alerts, /category: 'technical_support'/);
  assert.equal((alerts.match(/category: 'billing_membership'/g) ?? []).length, 2);
});

test('seminar registrations notify after commit from both the member and the administrator paths', () => {
  const source = read('lib/seminars/registrations.ts');
  assert.match(source, /notifySeminarRegistration\(outcome\.registrationId, 'member'\)/);
  assert.match(source, /notifySeminarRegistration\(created\.registrationId, 'administrator'\)/);
});

test('payment failures notify from the verified webhook (never for duplicate deliveries) and from failed checkout starts', () => {
  const webhook = read('app/api/stripe/webhook/route.ts');
  assert.match(webhook, /status !== 'duplicate'\) deferAdminNotification\(\(\) => notifyBillingStripeEvent\(event\)\)/);
  assert.match(read('lib/payments/checkout.ts'), /notifyCheckoutStartFailure\(/);
  assert.match(read('lib/seminars/checkout.ts'), /notifyCheckoutStartFailure\(/);
  for (const type of ['payment_intent.payment_failed', 'invoice.payment_failed', 'invoice.payment_action_required', 'checkout.session.async_payment_failed', 'charge.dispute.created', 'refund.failed']) {
    assert.ok(alerts.includes(`'${type}'`), `${type} must raise a billing notification`);
  }
});

test('support submissions, replies and closures notify the conversation category\'s assignees, excluding the actor, only when something changed', () => {
  assert.match(alerts, /category: row\.category, excludeUserId: input\.actorUserId/);
  assert.match(notifications, /rows\.filter\(\(row\) => row\.id !== excludeUserId\)/);
  const inbox = read('lib/support/inbox.ts');
  for (const activity of ['submitted', 'member_reply', 'admin_reply', 'closed_by_administrator', 'reopened_by_administrator', 'closed_by_member', 'reopened_by_member']) {
    assert.ok(inbox.includes(`'${activity}'`), `${activity} must raise a support notification`);
  }
  assert.match(inbox, /if \(result\.created\) deferAdminNotification/);
  assert.match(inbox, /if \(replied\) deferAdminNotification/);
  assert.equal((inbox.match(/if \(rows\[0\]\.status === next\) return false;/g) ?? []).length, 2);
});

test('server and browser errors notify Technical Support without reading the anonymous client-error body', () => {
  const instrumentation = read('instrumentation.ts');
  assert.match(instrumentation, /Sentry\.captureRequestError\(error, request, context\)/);
  assert.match(instrumentation, /NEXT_RUNTIME !== 'nodejs'\) return/);
  const route = read('app/api/client-error/route.ts');
  assert.match(route, /deferAdminNotification\(\(\) => notifyTechnicalError\(report\)\)/);
  assert.doesNotMatch(route, /request\.json|request\.text|formData/);
});

test('error emails never carry bound query parameters, echoed row values, emails, bearer tokens or hashes', async () => {
  const { scrubErrorText } = await import('../lib/notifications/error-report-text.ts');
  // The shape Drizzle's DrizzleQueryError really produces: SQL with placeholders, then a params line.
  const otpDigest = 'a'.repeat(32) + 'b'.repeat(32);
  const passwordHash = 'argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw';
  const bcryptHash = '$2b$10$' + 'N9qo8uLOickgx2ZMRZoMye'.padEnd(53, 'IjZAgcfl7p92ldGxad68LJZdL17lhWy').slice(0, 53);
  const message = [
    'Failed query: insert into "idoc"."email_otps" ("email", "code_hash") values ($1, $2)',
    `params: someone@example.org,${otpDigest}`,
    `cause: error: duplicate key value violates unique constraint. Key (email)=(someone@example.org) already exists.`,
    `update users set password_hash = '${passwordHash}' for member@example.org`,
    `legacy credential ${bcryptHash} was being upgraded`,
    'retry with Bearer opaque-token-value-123 failed',
  ].join('\n');
  const scrubbed = scrubErrorText(message);
  assert.doesNotMatch(scrubbed, /someone@example\.org|member@example\.org|opaque-token-value|argon2id\$v=19|a{32}|c29tZXNhbHRzYWx0|N9qo8uLOickgx2ZMRZoMye/);
  // The diagnostic value stays: the SQL with its placeholders, the constraint and the column names.
  assert.match(scrubbed, /insert into "idoc"\."email_otps" \("email", "code_hash"\) values \(\$1, \$2\)/);
  assert.match(scrubbed, /unique constraint/);
  assert.match(scrubbed, /Key \(email\)=\(\[redacted\]\)/);
  assert.match(scrubbed, /^params: \[redacted\]$/m);
});

test('error emails strip secrets and query strings, and repeats are throttled', async () => {
  const { pathWithoutQuery, resetErrorNotificationThrottleForTests, scrubErrorText, shouldSendErrorNotification } = await import('../lib/notifications/error-report-text.ts');
  assert.equal(pathWithoutQuery('https://idoc.club/a/b?token=abc#x'), 'https://idoc.club/a/b');
  assert.doesNotMatch(scrubErrorText('fetch failed /x?token=abc123&y=2 key sk_live_abcdefgh12345 Authorization: Bearer zzz'), /abc123|sk_live_abcdefgh|Bearer zzz/);
  resetErrorNotificationThrottleForTests();
  assert.equal(shouldSendErrorNotification('a', 1_000), true);
  assert.equal(shouldSendErrorNotification('a', 2_000), false);
  assert.equal(shouldSendErrorNotification('a', 1_000 + 16 * 60_000), true);
  resetErrorNotificationThrottleForTests();
  for (let index = 0; index < 5; index += 1) assert.equal(shouldSendErrorNotification(`b${index}`, 5_000, 'browser'), true);
  assert.equal(shouldSendErrorNotification('b-more', 5_000, 'browser'), false);
  // Exhausting the anonymous browser budget leaves the server-exception budget untouched.
  for (let index = 0; index < 20; index += 1) assert.equal(shouldSendErrorNotification(`s${index}`, 5_000), true);
  assert.equal(shouldSendErrorNotification('another', 5_000), false);
});

test('a failing scheduled job emails the operations recipient on the first failure and at escalating repeats only', async () => {
  const { shouldAlertJobFailure } = await import('../lib/observability/job-run-record-core.ts');
  assert.deepEqual([0, 1, 2, 4, 5, 6, 25, 100, 101].filter(shouldAlertJobFailure), [1, 5, 25, 100]);
  const record = read('lib/observability/job-run-record.ts');
  assert.match(record, /if \(!ok && row && shouldAlertJobFailure\(row\.consecutiveFailures\)\)/);
  assert.match(read('lib/observability/job-failure-alert.ts'), /IDOC_ADMIN_NOTIFICATION_EMAIL/);
});

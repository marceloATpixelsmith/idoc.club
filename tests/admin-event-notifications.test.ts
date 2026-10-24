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

test('server and browser errors notify Technical Support without reading the anonymous client-error body', () => {
  const instrumentation = read('instrumentation.ts');
  assert.match(instrumentation, /Sentry\.captureRequestError\(error, request, context\)/);
  assert.match(instrumentation, /NEXT_RUNTIME !== 'nodejs'\) return/);
  const route = read('app/api/client-error/route.ts');
  assert.match(route, /notifyTechnicalError\(/);
  assert.doesNotMatch(route, /request\.json|request\.text|formData/);
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

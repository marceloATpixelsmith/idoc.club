import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const startRoute = read('app/api/auth/google/start/route.ts');
const callbackRoute = read('app/api/auth/google/callback/route.ts');
const alertModule = read('lib/notifications/google-oauth-failure-alert.ts');
const mailchimpModule = read('lib/notifications/mailchimp-transactional.ts');

const deliverAlertBody = alertModule.slice(
  alertModule.indexOf('async function deliverAlert'),
  alertModule.indexOf('/** Bounds the *whole* operation'),
);
const withDeadlineBody = alertModule.slice(
  alertModule.indexOf('async function withDeadline'),
  alertModule.indexOf('/** Best-effort operational alert only'),
);
const notifyBody = alertModule.slice(alertModule.indexOf('export async function notifyWebmasterOfGoogleOauthFailure'));

test('every unexpected Google OAuth start-route failure logs a categorical reason and alerts the operations recipient', () => {
  assert.match(startRoute, /logError\('google_oauth_start_failed'/);
  assert.match(startRoute, /notifyWebmasterOfGoogleOauthFailure\(\{ reason, step: 'start' \}\)/);
  const catchBody = startRoute.slice(startRoute.indexOf('} catch (error) {'));
  assert.ok(catchBody.indexOf('logError') < catchBody.indexOf('notifyWebmasterOfGoogleOauthFailure'),
    'the log line must run before the alert, so a log entry exists even if the alert delivery itself fails');
});

test('the start route also logs a rate-limited attempt -- an ordinary, expected redirect that must not be silently invisible to an operator explaining a real user\'s "failed" report -- but deliberately does not alert on it (routine throttling, e.g. one institutional NAT, is not an incident)', () => {
  const rateLimitBranch = startRoute.slice(
    startRoute.indexOf("if (!(await checkOriginRateLimit('google_oauth_start', origin)))"),
    startRoute.indexOf('await purgeExpiredGoogleOauthTransactions();'),
  );
  assert.match(rateLimitBranch, /logWarn\('google_oauth_start_failed', \{ category: 'auth', reason: 'rate_limited' \}\)/);
  assert.doesNotMatch(rateLimitBranch, /notifyWebmasterOfGoogleOauthFailure\(/);
});

test('the callback route logs and alerts on an invalid/missing OAuth browser-binding cookie -- the very first check on the return leg', () => {
  const bindingCheck = callbackRoute.slice(
    callbackRoute.indexOf('if (!state || !verifyGoogleOauthBrowserBinding'),
    callbackRoute.indexOf('const config = loadGoogleOidcConfig();'),
  );
  assert.match(bindingCheck, /logError\('google_oauth_callback_failed', \{ category: 'auth', reason: 'binding_cookie_invalid' \}\)/);
  assert.match(bindingCheck, /notifyWebmasterOfGoogleOauthFailure\(\{ reason: 'binding_cookie_invalid', step: 'callback' \}\)/);
});

test('the callback route classifies every failure and logs it, but only alerts for genuinely unexpected/protocol errors -- not for the three expected/benign outcomes', () => {
  assert.match(callbackRoute, /function classifyGoogleOauthFailure/);
  const classifier = callbackRoute.slice(
    callbackRoute.indexOf('function classifyGoogleOauthFailure'),
    callbackRoute.indexOf('export async function GET'),
  );
  assert.match(classifier, /error\.code === 'provider_error' && providerErrorParam === 'access_denied'\) return \{ alert: false, reason: 'user_declined_consent' \}/);
  assert.match(classifier, /GoogleOidcError\) \{[\s\S]*?return \{ alert: true, reason: error\.code \}/);
  assert.match(classifier, /GoogleAccountLinkRequiredError\) return \{ alert: false, reason: 'link_required' \}/);
  assert.match(classifier, /GoogleAccountNotEligibleError\) return \{ alert: false, reason: 'account_not_eligible' \}/);
  assert.match(classifier, /return \{ alert: true, reason: 'unexpected_error' \}/);

  const catchBody = callbackRoute.slice(callbackRoute.lastIndexOf('} catch (error) {'));
  assert.match(catchBody, /const \{ alert, reason \} = classifyGoogleOauthFailure\(error, request\.nextUrl\.searchParams\.get\('error'\)\);/);
  assert.match(catchBody, /await logError\('google_oauth_callback_failed', \{ category: 'auth', reason \}\);/);
  assert.match(catchBody, /if \(alert\) await notifyWebmasterOfGoogleOauthFailure/);
});

test('the outer function only skips synchronously (unconfigured recipient) before entering the guarded, deadline-bounded delivery -- every other check, including rate limiting, happens inside deliverAlert', () => {
  const preflight = notifyBody.slice(0, notifyBody.indexOf('try {'));
  assert.match(preflight, /if \(!to\) \{/);
  assert.match(preflight, /logWarn\('google_oauth_failure_alert_skipped'/);
  // Nothing that can throw (a database call, a second env var lookup) may run before the try.
  assert.doesNotMatch(preflight, /requestOrigin\(|checkOriginRateLimit\(/);
  const guardedCall = notifyBody.slice(notifyBody.indexOf('try {'), notifyBody.indexOf('} catch {'));
  assert.match(guardedCall, /await withDeadline\(deliverAlert\(input, to\), ALERT_DELIVERY_TIMEOUT_MS\);/);
});

test('deliverAlert rate-limits by origin before sending, and skips the email (but still returns normally) once the limit is exceeded', () => {
  assert.match(deliverAlertBody, /const origin = await requestOrigin\(\);/);
  assert.match(deliverAlertBody, /checkOriginRateLimit\('google_oauth_failure_alert', origin\)/);
  assert.match(deliverAlertBody, /logWarn\('google_oauth_failure_alert_rate_limited'/);
  assert.ok(deliverAlertBody.indexOf('requestOrigin') < deliverAlertBody.indexOf('checkOriginRateLimit'),
    'origin must be resolved before it is used to rate-limit');
  assert.ok(deliverAlertBody.indexOf('checkOriginRateLimit') < deliverAlertBody.indexOf('sendTransactionalEmail'),
    'the rate-limit check must gate the send, not run after it');
});

test('withDeadline bounds the *entire* preflight-and-delivery operation (a Promise.race against a timer), not only whichever step happens to accept an AbortSignal -- so a slow rate-limit database query cannot hold the caller open any longer than a slow Mailchimp could', () => {
  assert.match(withDeadlineBody, /Promise\.race\(\[/);
  assert.match(withDeadlineBody, /setTimeout\(\(\) => reject/);
  assert.match(withDeadlineBody, /clearTimeout\(timer\)/);
  assert.match(alertModule, /const ALERT_DELIVERY_TIMEOUT_MS = \d+/);
  const guardedCall = notifyBody.slice(notifyBody.indexOf('try {'), notifyBody.indexOf('} catch {'));
  assert.match(guardedCall, /withDeadline\(deliverAlert\(input, to\), ALERT_DELIVERY_TIMEOUT_MS\)/);
});

test('sendTransactionalEmail is additionally bounded by its own AbortSignal timeout, so the underlying fetch/socket is actually cancelled rather than merely abandoned once withDeadline stops waiting', () => {
  assert.match(deliverAlertBody, /signal:\s*AbortSignal\.timeout\(ALERT_DELIVERY_TIMEOUT_MS\)/);
  // sendTransactionalEmail itself must actually forward that signal into the underlying fetch,
  // otherwise passing it from the caller would be a no-op.
  assert.match(mailchimpModule, /signal:\s*options\.signal/);
});

test('the alert body only ever interpolates the caller-supplied reason/step and the request correlation ID -- never a raw OAuth code, state, cookie, or token value', () => {
  // Every `${...}` template interpolation in deliverAlert, not the surrounding human-readable prose
  // elsewhere in the module (which legitimately says the words "code"/"state"/"cookie"/"token" to
  // describe what's excluded) -- each one must come from this fixed, safe allow-list.
  const interpolations = [...deliverAlertBody.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
  assert.ok(interpolations.length > 0, 'expected at least one interpolation to check');
  const allowed = new Set(['escapeHtml(input.step)', 'escapeHtml(input.reason)', 'escapeHtml(requestId)', 'input.reason']);
  for (const expr of interpolations) {
    assert.ok(allowed.has(expr), `unexpected interpolation "${expr}" -- verify it cannot leak an OAuth code/state/cookie/token value`);
  }
  assert.match(deliverAlertBody, /currentRequestId/);
});

test('a failure anywhere in the guarded operation (rate-limit, delivery, or the deadline itself firing) is caught and logged, never thrown back at the caller', () => {
  const failureBranch = notifyBody.slice(notifyBody.indexOf('} catch {'));
  assert.match(failureBranch, /logWarn\('google_oauth_failure_alert_failed'/);
});

test('the alert is routed through the existing documented operations-recipient variable, not a new dedicated secret', () => {
  assert.match(alertModule, /IDOC_ADMIN_NOTIFICATION_EMAIL/);
  assert.doesNotMatch(alertModule, /GOOGLE.*ALERT.*EMAIL|OAUTH_ALERT_EMAIL/i);
});

test('the optional delivery-timeout signal on sendTransactionalEmail defaults to unbounded, so no existing caller (e.g. the breached-password alert) changes behavior', () => {
  assert.match(mailchimpModule, /export async function sendTransactionalEmail\(message: TransactionalEmail, options: \{ signal\?: AbortSignal \} = \{\}\)/);
});

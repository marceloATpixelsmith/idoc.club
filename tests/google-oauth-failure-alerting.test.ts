import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const startRoute = read('app/api/auth/google/start/route.ts');
const callbackRoute = read('app/api/auth/google/callback/route.ts');
const alertModule = read('lib/notifications/google-oauth-failure-alert.ts');
const mailchimpModule = read('lib/notifications/mailchimp-transactional.ts');
// The function body only, past its own doc comment, so assertions on what the *code* references
// don't trip over the doc comment's own prose describing what is deliberately excluded.
const alertBody = alertModule.slice(alertModule.indexOf('export async function notifyWebmasterOfGoogleOauthFailure'));

test('every Google OAuth start-route failure path logs a categorical reason and alerts the operations recipient', () => {
  assert.match(startRoute, /logError\('google_oauth_start_failed'/);
  assert.match(startRoute, /notifyWebmasterOfGoogleOauthFailure\(\{ reason, step: 'start' \}\)/);
  const catchBody = startRoute.slice(startRoute.indexOf('} catch (error) {'));
  assert.ok(catchBody.indexOf('logError') < catchBody.indexOf('notifyWebmasterOfGoogleOauthFailure'),
    'the log line must run before the alert, so a log entry exists even if the alert delivery itself fails');
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

test('the alert skips delivery entirely when no operations recipient is configured, or when the calling origin has exceeded the alert rate limit', () => {
  const preflight = alertBody.slice(0, alertBody.indexOf('try {'));
  assert.match(preflight, /if \(!to\) \{/);
  assert.match(preflight, /logWarn\('google_oauth_failure_alert_skipped'/);
  const deliveryBranch = alertBody.slice(alertBody.indexOf('try {'), alertBody.indexOf('} catch {'));
  assert.match(deliveryBranch, /checkOriginRateLimit\('google_oauth_failure_alert', origin\)/);
  assert.match(deliveryBranch, /logWarn\('google_oauth_failure_alert_rate_limited'/);
  assert.match(deliveryBranch, /return;/);
});

test('the rate-limit preflight (requestOrigin + checkOriginRateLimit) runs inside the guarded try block, not before it -- so a RATE_LIMIT_HASH_KEY misconfiguration or a database outage there is caught and logged like any other delivery failure, never thrown back into the caller\'s OAuth response', () => {
  const preflight = alertBody.slice(0, alertBody.indexOf('try {'));
  // Only the synchronous, unconfigured-recipient check may run before the try -- it cannot itself
  // throw. Every actual *call* that touches the database or a second env var must be inside the
  // guarded block (the preceding comment's own prose is allowed to name these functions).
  assert.doesNotMatch(preflight, /requestOrigin\(|checkOriginRateLimit\(/);
  const deliveryBranch = alertBody.slice(alertBody.indexOf('try {'), alertBody.indexOf('} catch {'));
  assert.match(deliveryBranch, /const origin = await requestOrigin\(\);/);
  assert.ok(deliveryBranch.indexOf('requestOrigin') < deliveryBranch.indexOf('checkOriginRateLimit'),
    'origin must be resolved before it is used to rate-limit');
});

test('the alert delivery is bounded by a timeout so a slow/unresponsive Mailchimp can never block the caller\'s own failure redirect indefinitely', () => {
  const deliveryBranch = alertBody.slice(alertBody.indexOf('try {'), alertBody.indexOf('} catch {'));
  assert.match(deliveryBranch, /signal:\s*AbortSignal\.timeout\(ALERT_DELIVERY_TIMEOUT_MS\)/);
  assert.match(alertModule, /const ALERT_DELIVERY_TIMEOUT_MS = \d+/);
  // sendTransactionalEmail itself must actually forward that signal into the underlying fetch,
  // otherwise passing it from the caller would be a no-op.
  assert.match(mailchimpModule, /signal:\s*options\.signal/);
});

test('the alert body only ever interpolates the caller-supplied reason/step and the request correlation ID -- never a raw OAuth code, state, cookie, or token value', () => {
  const deliveryBranch = alertBody.slice(alertBody.indexOf('try {'), alertBody.indexOf('} catch {'));
  // Every `${...}` template interpolation in the delivery path, not the surrounding human-readable
  // prose (which legitimately says the words "code"/"state"/"cookie"/"token" to describe what's
  // excluded) -- each one must come from this fixed, safe allow-list.
  const interpolations = [...deliveryBranch.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
  assert.ok(interpolations.length > 0, 'expected at least one interpolation to check');
  const allowed = new Set(['escapeHtml(input.step)', 'escapeHtml(input.reason)', 'escapeHtml(requestId)', 'input.reason']);
  for (const expr of interpolations) {
    assert.ok(allowed.has(expr), `unexpected interpolation "${expr}" -- verify it cannot leak an OAuth code/state/cookie/token value`);
  }
  assert.match(deliveryBranch, /currentRequestId/);
});

test('a delivery failure inside the alert itself (including a timeout) is caught and logged, never thrown back at the caller', () => {
  const failureBranch = alertBody.slice(alertBody.indexOf('} catch {'));
  assert.match(failureBranch, /logWarn\('google_oauth_failure_alert_failed'/);
});

test('the alert is routed through the existing documented operations-recipient variable, not a new dedicated secret', () => {
  assert.match(alertModule, /IDOC_ADMIN_NOTIFICATION_EMAIL/);
  assert.doesNotMatch(alertModule, /GOOGLE.*ALERT.*EMAIL|OAUTH_ALERT_EMAIL/i);
});

test('the optional delivery-timeout signal on sendTransactionalEmail defaults to unbounded, so no existing caller (e.g. the breached-password alert) changes behavior', () => {
  assert.match(mailchimpModule, /export async function sendTransactionalEmail\(message: TransactionalEmail, options: \{ signal\?: AbortSignal \} = \{\}\)/);
});

import * as Sentry from '@sentry/nextjs';

// The Turnstile widget gates Sign In, so a visitor whose widget never yields a token is blocked
// with nothing in any server log: the Sign In button is disabled, so no request is ever made. These
// are the genuine, categorical ways that happens; each is reported to Sentry once per page load so a
// blocked visitor's browser, device and OS (which Sentry attaches itself) show up as a warning.
// Expected behavior -- a challenge being shown, a silent pass -- is deliberately NOT reported:
// Sentry is the genuine-failure inbox (docs/07 "Sentry application error monitoring").
export const TURNSTILE_FAILURE_STAGES = [
  'script_not_loaded',
  'render_failed',
  'widget_error',
  'unsupported_browser',
  'no_token_after_retries',
] as const;

export type TurnstileFailureStage = (typeof TURNSTILE_FAILURE_STAGES)[number];

export type TurnstileFailureSink = (signal: { action: string; errorCode: string | null; stage: TurnstileFailureStage }) => void;

// Only a short lowercase slug and Cloudflare's own numeric error code ever leave the page; the
// message text is fixed, so no visitor-controlled value (an email, a token) can reach Sentry.
const ACTION_SLUG = /^[a-z0-9_-]{1,40}$/;
const CLOUDFLARE_ERROR_CODE = /^\d{3,7}$/;

const reported = new Set<string>();

const sentrySink: TurnstileFailureSink = ({ action, errorCode, stage }) => {
  if (typeof Sentry.withScope !== 'function' || typeof Sentry.captureMessage !== 'function') return;
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setTag('turnstile_stage', stage);
    scope.setTag('turnstile_action', action);
    if (errorCode) scope.setTag('turnstile_error_code', errorCode);
    scope.setFingerprint(['turnstile-widget-failure', stage]);
    Sentry.captureMessage('Turnstile widget did not produce a token', 'warning');
  });
};

/** Reports that the widget is in a state that leaves Sign In disabled. At most once per stage and
 * action per page load, and never throws: monitoring must not affect the page. */
export function reportTurnstileFailure(
  stage: TurnstileFailureStage,
  action: string,
  errorCode?: unknown,
  sink: TurnstileFailureSink = sentrySink,
): void {
  const safeAction = ACTION_SLUG.test(action) ? action : 'unknown';
  const key = `${stage}:${safeAction}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    sink({
      action: safeAction,
      errorCode: typeof errorCode === 'string' && CLOUDFLARE_ERROR_CODE.test(errorCode) ? errorCode : null,
      stage,
    });
  } catch {
    // Monitoring must never affect the page.
  }
}

export function resetTurnstileFailureReportsForTests(): void {
  reported.clear();
}

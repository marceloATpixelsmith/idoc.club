import 'server-only';

// AUTH-OPERATIONS-006: a minimal, real severity taxonomy for the operational admin-email alerts
// this codebase already sends -- distinct from, and a prerequisite to, a correlation/anomaly
// engine (which this does not attempt to build; that remains a genuinely larger, separate gap).
// Each existing alert type is assigned exactly one fixed severity here, and every alert subject is
// tagged with it, so an operator scanning an inbox (or a future alert-routing rule keyed on the
// subject prefix) can triage without opening every message.
export type AlertSeverity = 'critical' | 'high' | 'informational' | 'warning';

export const ALERT_SEVERITY = {
  // A breached password was rejected before storage -- the control worked, but repeated hits
  // against one account are a meaningful signal of active credential-stuffing.
  'auth.breached_password_rejected': 'high',
  // A single Google sign-in failure is usually configuration drift or a one-off provider hiccup,
  // not an incident by itself -- see the alert's own body for when to escalate it.
  'auth.google_oauth_failure': 'warning',
  // Routine account-maintenance activity an administrator may want to review, not a security event.
  'administrator.profile_changed': 'informational',
  // A spam/abuse complaint risks the sending domain's deliverability reputation for every member --
  // the highest severity of the alerts in this table.
  'email.spam_complaint': 'critical',
  // An address that permanently can't be delivered to (bad mailbox, bad domain, ...) -- worth an
  // operator's attention, but not urgent the way a complaint is.
  'email.hard_bounce': 'warning',
  // The same account or origin has been blocked by an auth-security rate limit across multiple
  // consecutive windows -- a single blocked request is routine, but sustained repeated blocking is
  // the correlated signal of an active credential-stuffing/brute-force attempt (AUTH-OPERATIONS-006).
  'auth.repeated_rate_limit_exceeded': 'high',
} as const satisfies Record<string, AlertSeverity>;

export type AlertKind = keyof typeof ALERT_SEVERITY;

const SEVERITY_TAG: Record<AlertSeverity, string> = {
  critical: '[CRITICAL]',
  high: '[HIGH]',
  informational: '[INFO]',
  warning: '[WARNING]',
};

/** Prefixes a notification subject with its fixed severity tag, e.g. "[HIGH] IDOC: breached
 * password rejected". `kind` is a compile-time key into ALERT_SEVERITY, so a new alert type cannot
 * be wired up without deliberately choosing a severity for it. */
export function taggedSubject(kind: AlertKind, subject: string): string {
  return `${SEVERITY_TAG[ALERT_SEVERITY[kind]]} ${subject}`;
}

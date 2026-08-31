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

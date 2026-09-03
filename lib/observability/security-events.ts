// AUTH-LOG-001: "Trusted server security events MUST use stable taxonomy, safe correlation,
// actor/subject/tenant/resource attribution, minimized metadata, and remain distinct from
// application logs and audit records." Safe correlation (requestId) and the distinctness from
// idoc.audit_log (a separate, DB-persisted, actor-attributed table for security-sensitive state
// *changes* -- see AUTH-AUDIT-001/002) were already true before this file existed. What was missing
// was a closed, explicit taxonomy: `event` was a bare `string` parameter, so any call site could
// invent a new name with no compile-time record of what names exist, and each call site supplied
// its own free-form `category` string with no shared vocabulary. This registry is the single,
// closed source of truth: lib/observability/logger.ts's `SecurityEventName` type is derived
// directly from its keys, so passing an unregistered name is a type error, not a silent drift.
//
// `resource` is this event's domain of attribution (the "what" a canonical resource/subsystem
// requirement asks for) -- the logger auto-attaches it, so call sites never restate it and can't
// get it wrong. `tenant` is intentionally absent: this deployment is single-tenant (see docs/22),
// so a tenant field would be a constant with no discriminating value.
//
// AUTH-LOG-003: `retentionClass` is this registry's answer to "retention-classed" -- Vercel's
// platform log store, not this application's own code, is what actually enforces a retention
// duration (there is no self-hosted log database this app controls), so this field is the
// deliberate, explicit classification docs/07 documents operator retention-window guidance
// against, rather than an unexamined default with no declared class at all. `security` marks an
// event that is itself evidence of a real or attempted attack (a forged/invalid webhook signature,
// an auth-flow failure) and warrants the longer of the two windows; `operational` marks routine
// ops/delivery noise (a scheduled scan, a soft bounce) that does not.
export type SecurityEventCategory = 'auth' | 'configuration' | 'delivery' | 'operational';
export type SecurityEventRetentionClass = 'operational' | 'security';

export type SecurityEventDefinition = {
  category: SecurityEventCategory;
  /** The subsystem/domain this event is attributed to. */
  resource: string;
  retentionClass: SecurityEventRetentionClass;
  /** Whether an authenticated subject is ever meaningfully attachable to this event: 'subject' means
   * call sites pass a `subjectId` in meta when one is resolved; 'anonymous' means the event fires
   * only in pre-authentication flows where attaching an identifier would itself be an enumeration
   * risk (see the call site's own comment); 'system' means this event has no human actor at all
   * (a cron job, a provider webhook). */
  attribution: 'anonymous' | 'subject' | 'system';
  /** Closed metadata vocabulary. Values are categorical; free-form text is never accepted. */
  metadata?: Readonly<Record<string, readonly (string | number | boolean | null)[] | 'positiveInteger'>>;
};

export const SECURITY_EVENT_TAXONOMY = {
  account_delivery_worker_failed: { attribution: 'system', category: 'operational', resource: 'account-delivery-outbox', retentionClass: 'operational' },
  account_link_request_failed: { attribution: 'anonymous', category: 'operational', metadata: { purpose: ['migration_activation', 'password_reset'], reason: ['configuration', 'database', 'encryption', 'operational'] }, resource: 'account-recovery', retentionClass: 'security' },
  auth_security_delivery_worker_failed: { attribution: 'system', category: 'operational', resource: 'account-delivery-outbox', retentionClass: 'operational' },
  bounce_complaint_alert_failed: { attribution: 'system', category: 'delivery', resource: 'bounce-complaint-alert', retentionClass: 'operational' },
  bounce_complaint_alert_skipped: { attribution: 'system', category: 'configuration', resource: 'bounce-complaint-alert', retentionClass: 'operational' },
  breached_password_alert_failed: { attribution: 'system', category: 'delivery', resource: 'breached-password-alert', retentionClass: 'security' },
  breached_password_alert_skipped: { attribution: 'system', category: 'configuration', resource: 'breached-password-alert', retentionClass: 'operational' },
  clock_skew_check_failed: { attribution: 'system', category: 'operational', resource: 'clock-skew-check', retentionClass: 'operational' },
  client_error: { attribution: 'anonymous', category: 'operational', resource: 'client-error-report', retentionClass: 'operational' },
  data_retention_purge_failed: { attribution: 'system', category: 'operational', resource: 'data-retention-purge', retentionClass: 'operational' },
  email_otp_delivery_failed: { attribution: 'subject', category: 'delivery', metadata: { purpose: ['login_verification', 'password_reset'], reason: ['configuration', 'network', 'operational'], subjectId: 'positiveInteger' }, resource: 'email-otp', retentionClass: 'security' },
  email_otp_anonymous_delivery_failed: { attribution: 'anonymous', category: 'delivery', metadata: { purpose: ['signup_verification'], reason: ['configuration', 'network', 'operational'] }, resource: 'email-otp', retentionClass: 'security' },
  google_oauth_callback_failed: { attribution: 'anonymous', category: 'auth', metadata: { reason: ['account_not_eligible', 'binding_cookie_invalid', 'configuration', 'expired_transaction', 'invalid_id_token', 'invalid_request', 'invalid_transaction', 'link_required', 'provider_error', 'token_exchange_failed', 'unexpected_error', 'user_declined_consent'] }, resource: 'google-oauth', retentionClass: 'security' },
  google_oauth_failure_alert_failed: { attribution: 'system', category: 'delivery', resource: 'google-oauth-failure-alert', retentionClass: 'operational' },
  google_oauth_failure_alert_rate_limited: { attribution: 'system', category: 'auth', resource: 'google-oauth-failure-alert', retentionClass: 'security' },
  google_oauth_failure_alert_skipped: { attribution: 'system', category: 'configuration', resource: 'google-oauth-failure-alert', retentionClass: 'operational' },
  google_oauth_start_failed: { attribution: 'anonymous', category: 'auth', metadata: { reason: ['configuration', 'invalid_request', 'rate_limited', 'unexpected_error:authorization_request', 'unexpected_error:configuration', 'unexpected_error:transaction', 'unexpected_error:transaction_purge'] }, resource: 'google-oauth', retentionClass: 'security' },
  mailchimp_webhook_malformed_payload: { attribution: 'system', category: 'operational', resource: 'mailchimp-webhook', retentionClass: 'operational' },
  mailchimp_webhook_signature_verification_failed: { attribution: 'system', category: 'operational', resource: 'mailchimp-webhook', retentionClass: 'security' },
  mailchimp_webhook_soft_bounce: { attribution: 'system', category: 'operational', resource: 'mailchimp-webhook', retentionClass: 'operational' },
  operational_alert_dead_lettered: { attribution: 'system', category: 'delivery', metadata: { kind: ['incident_response_action_taken', 'rate_limit_correlation_alert'] }, resource: 'operational-alert-outbox', retentionClass: 'operational' },
  operational_alert_delivery_worker_failed: { attribution: 'system', category: 'operational', resource: 'operational-alert-outbox', retentionClass: 'operational' },
  rate_limit_correlation_alert_failed: { attribution: 'system', category: 'delivery', resource: 'rate-limit-correlation-alert', retentionClass: 'security' },
  reconciliation_scan_failed: { attribution: 'system', category: 'operational', resource: 'reconciliation-scan', retentionClass: 'operational' },
  renewal_notice_delivery_failed: { attribution: 'system', category: 'operational', resource: 'renewal-notice-delivery', retentionClass: 'operational' },
  renewal_notice_scan_failed: { attribution: 'system', category: 'operational', resource: 'renewal-notice-scan', retentionClass: 'operational' },
  stripe_webhook_signature_verification_failed: { attribution: 'system', category: 'operational', metadata: { reason: ['invalid_signature'] }, resource: 'stripe-webhook', retentionClass: 'security' },
} as const satisfies Record<string, SecurityEventDefinition>;

export type SecurityEventName = keyof typeof SECURITY_EVENT_TAXONOMY;

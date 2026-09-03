-- AUTH-OPERATIONS-007: forceRevokeAllAuthority previously had no durable idempotency guarantee -- a
-- retried or double-submitted call with the same incidentReference would re-bump session_version,
-- re-revoke already-revoked factors, and re-notify with a fresh dedupe key every time. This partial
-- unique index is the actual guarantee (matching the established users_email_unique /
-- users_normalized_email_unique race pattern in lib/membership/email-verification.ts): a second
-- transaction attempting to record the same (user, incidentReference) pair for this action raises a
-- unique violation instead of silently duplicating the state transition. Scoped to this one action via
-- the partial WHERE clause so it imposes no constraint on any other audit_log row.
create unique index if not exists audit_log_force_revoke_incident_unique
  on idoc.audit_log (entity_id, (after_json ->> 'incidentReference'))
  where entity_type = 'user' and action = 'admin.account.authority_force_revoked';
--> statement-breakpoint
-- Adds an operations-facing durable alert (via the operational_alert_outbox worker built for
-- AUTH-OPERATIONS-006) so a Super-Admin-initiated incident-response action is never visible only to
-- the affected account owner.
alter table idoc.operational_alert_outbox drop constraint operational_alert_outbox_kind_check;
--> statement-breakpoint
alter table idoc.operational_alert_outbox add constraint operational_alert_outbox_kind_check
  check (kind in ('rate_limit_correlation_alert', 'incident_response_action_taken'));

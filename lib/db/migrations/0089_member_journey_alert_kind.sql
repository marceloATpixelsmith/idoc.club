-- Add a dedicated durable administrator alert category for member journey monitoring.
-- This only expands the allow-list; existing alerts and delivery behavior are unchanged.
alter table idoc.operational_alert_outbox drop constraint operational_alert_outbox_kind_check;
--> statement-breakpoint
alter table idoc.operational_alert_outbox add constraint operational_alert_outbox_kind_check
  check (kind in ('rate_limit_correlation_alert', 'incident_response_action_taken', 'email_delivery_problem', 'repeated_code_requests', 'member_journey_attention'));

-- Migration 0006 created these two unique constraints without explicit names, so
-- PostgreSQL auto-generated the default "_key" suffix. This forward-only
-- reconciliation aligns them with the authoritative Drizzle schema and snapshot
-- naming convention ("_unique") without rewriting released migration history,
-- following the same pattern already used by migration 0009 for the foreign keys.
ALTER TABLE "idoc"."account_delivery_outbox"
  RENAME CONSTRAINT "account_delivery_outbox_message_id_key" TO "account_delivery_outbox_message_id_unique";--> statement-breakpoint
ALTER TABLE "idoc"."account_delivery_outbox"
  RENAME CONSTRAINT "account_delivery_outbox_token_id_key" TO "account_delivery_outbox_token_id_unique";--> statement-breakpoint
-- Migration 0006 also created this uniqueness rule as a table CONSTRAINT, but the
-- authoritative Drizzle schema declares it as a plain unique INDEX (uniqueIndex(...)).
-- Both enforce identical uniqueness semantics and both satisfy the ON CONFLICT
-- (columns) clause in lib/membership/account-recovery.ts; this reconciles the
-- catalog shape to match schema.ts without changing any enforced behavior.
ALTER TABLE "idoc"."account_request_limits"
  DROP CONSTRAINT "account_request_limits_bucket_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "account_request_limits_bucket_unique" ON "idoc"."account_request_limits" ("purpose","identifier_hash","origin_hash","window_started_at");

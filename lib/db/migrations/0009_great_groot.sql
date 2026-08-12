-- The checks and partial indexes below were already installed by released
-- migrations 0002, 0005, and 0006. This forward-only reconciliation aligns
-- the two historical account-delivery constraint names with the authoritative
-- Drizzle schema and snapshot without rewriting released migration history.
ALTER TABLE "idoc"."account_delivery_outbox"
  RENAME CONSTRAINT "account_delivery_token_fk" TO "account_delivery_outbox_token_id_account_tokens_id_fk";--> statement-breakpoint
ALTER TABLE "idoc"."account_delivery_outbox"
  RENAME CONSTRAINT "account_delivery_user_fk" TO "account_delivery_outbox_user_id_users_id_fk";

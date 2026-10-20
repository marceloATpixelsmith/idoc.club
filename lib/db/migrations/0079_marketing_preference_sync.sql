ALTER TABLE "idoc"."onboarding_consents" ADD COLUMN IF NOT EXISTS "keep_updated_changed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "idoc"."onboarding_consents" ADD COLUMN IF NOT EXISTS "keep_updated_pending_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "idoc"."onboarding_consents" ADD COLUMN IF NOT EXISTS "keep_updated_source" varchar(40);

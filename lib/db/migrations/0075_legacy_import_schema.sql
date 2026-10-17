ALTER TABLE "idoc"."users" ADD COLUMN IF NOT EXISTS "legacy_password_hash" text;
--> statement-breakpoint
ALTER TABLE "idoc"."users" ADD COLUMN IF NOT EXISTS "legacy_password_format" varchar(20);
--> statement-breakpoint
ALTER TABLE "idoc"."users" DROP CONSTRAINT IF EXISTS "users_legacy_password_format_check";
--> statement-breakpoint
ALTER TABLE "idoc"."users" ADD CONSTRAINT "users_legacy_password_format_check" CHECK ("idoc"."users"."legacy_password_format" is null or "idoc"."users"."legacy_password_format" in ('phpass', 'wp_bcrypt'));
--> statement-breakpoint
ALTER TABLE "idoc"."users" DROP CONSTRAINT IF EXISTS "users_legacy_password_pair_check";
--> statement-breakpoint
ALTER TABLE "idoc"."users" ADD CONSTRAINT "users_legacy_password_pair_check" CHECK (("idoc"."users"."legacy_password_hash" is null) = ("idoc"."users"."legacy_password_format" is null));
--> statement-breakpoint
ALTER TABLE "idoc"."profiles" ADD COLUMN IF NOT EXISTS "legacy_wp_user_id" integer;
--> statement-breakpoint
ALTER TABLE "idoc"."profiles" DROP CONSTRAINT IF EXISTS "profiles_legacy_wp_user_id_unique";
--> statement-breakpoint
ALTER TABLE "idoc"."profiles" ADD CONSTRAINT "profiles_legacy_wp_user_id_unique" UNIQUE ("legacy_wp_user_id");
--> statement-breakpoint
ALTER TABLE "idoc"."payments" DROP CONSTRAINT IF EXISTS "payments_source_check";
--> statement-breakpoint
ALTER TABLE "idoc"."payments" ADD CONSTRAINT "payments_source_check" CHECK ("idoc"."payments"."source" in ('stripe_recurring', 'stripe_one_time', 'stripe_manual', 'bank_transfer', 'cash', 'complimentary', 'legacy_import'));
--> statement-breakpoint
ALTER TABLE "idoc"."payments" DROP CONSTRAINT IF EXISTS "payments_evidence_check";
--> statement-breakpoint
ALTER TABLE "idoc"."payments" ADD CONSTRAINT "payments_evidence_check" CHECK (("idoc"."payments"."source" in ('stripe_recurring', 'stripe_one_time') and "idoc"."payments"."external_payment_id" is not null)
      or ("idoc"."payments"."source" in ('stripe_manual', 'bank_transfer', 'cash', 'complimentary', 'legacy_import') and "idoc"."payments"."administrator_id" is not null));

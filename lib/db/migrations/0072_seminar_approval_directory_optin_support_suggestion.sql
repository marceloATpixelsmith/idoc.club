-- Expand-only: staging and production share this database, so nothing is dropped or tightened.
ALTER TABLE "idoc"."support_conversations"
  DROP CONSTRAINT IF EXISTS "support_conversations_category_check";
--> statement-breakpoint
ALTER TABLE "idoc"."support_conversations"
  ADD CONSTRAINT "support_conversations_category_check"
  CHECK ("category" in ('billing_membership', 'seminars', 'technical_support', 'suggestion', 'other'));
--> statement-breakpoint
ALTER TABLE "idoc"."support_category_defaults"
  DROP CONSTRAINT IF EXISTS "support_category_defaults_category_check";
--> statement-breakpoint
ALTER TABLE "idoc"."support_category_defaults"
  ADD CONSTRAINT "support_category_defaults_category_check"
  CHECK ("category" in ('billing_membership', 'seminars', 'technical_support', 'suggestion', 'other'));
--> statement-breakpoint
ALTER TABLE "idoc"."payments"
  DROP CONSTRAINT IF EXISTS "payments_source_check";
--> statement-breakpoint
ALTER TABLE "idoc"."payments"
  ADD CONSTRAINT "payments_source_check"
  CHECK ("source" in ('stripe_recurring', 'stripe_one_time', 'stripe_manual', 'paypal', 'bank_transfer', 'cash', 'complimentary'));
--> statement-breakpoint
ALTER TABLE "idoc"."payments"
  DROP CONSTRAINT IF EXISTS "payments_evidence_check";
--> statement-breakpoint
ALTER TABLE "idoc"."payments"
  ADD CONSTRAINT "payments_evidence_check"
  CHECK (("source" in ('stripe_recurring', 'stripe_one_time') and "external_payment_id" is not null)
    or ("source" in ('stripe_manual', 'paypal', 'bank_transfer', 'cash', 'complimentary') and "administrator_id" is not null));
--> statement-breakpoint
ALTER TABLE "idoc"."profiles"
  ADD COLUMN IF NOT EXISTS "directory_email_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminars"
  ALTER COLUMN "non_member_price_cents" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations"
  ADD COLUMN IF NOT EXISTS "approval_status" varchar(30) DEFAULT 'confirmed' NOT NULL;
--> statement-breakpoint
UPDATE "idoc"."seminar_registrations" r
  SET "approval_status" = 'pending_fei_approval'
  FROM "idoc"."seminars" s
  WHERE s."id" = r."seminar_id" AND s."is_fei" = true AND r."approval_status" = 'confirmed';
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations"
  DROP CONSTRAINT IF EXISTS "seminar_registrations_approval_status_check";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations"
  ADD CONSTRAINT "seminar_registrations_approval_status_check"
  CHECK ("approval_status" in ('confirmed', 'pending_fei_approval', 'approved_by_fei', 'not_approved_by_fei', 'approved_audit_only_by_fei'));

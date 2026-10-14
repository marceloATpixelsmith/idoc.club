-- Pre-launch cleanup (no real data exists yet): removes the retired guest registration identity, the
-- non-member price, the seminar Organizing National Federation, and the PayPal payment source.
DELETE FROM "idoc"."payment_refunds"
  WHERE "seminar_registration_id" IN (SELECT "id" FROM "idoc"."seminar_registrations" WHERE "profile_id" IS NULL);
--> statement-breakpoint
DELETE FROM "idoc"."seminar_registrations" WHERE "profile_id" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "idoc"."seminar_registrations_seminar_guest_email_unique";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP CONSTRAINT IF EXISTS "seminar_registrations_registrant_identity_check";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP COLUMN IF EXISTS "guest_name";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP COLUMN IF EXISTS "guest_first_name";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP COLUMN IF EXISTS "guest_last_name";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP COLUMN IF EXISTS "guest_email";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP COLUMN IF EXISTS "guest_phone";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ALTER COLUMN "profile_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT IF EXISTS "seminars_non_member_price_check";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP COLUMN IF EXISTS "non_member_price_cents";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP COLUMN IF EXISTS "organizing_national_federation";
--> statement-breakpoint
DELETE FROM "idoc"."payment_refunds"
  WHERE "membership_payment_id" IN (SELECT "id" FROM "idoc"."payments" WHERE "source" = 'paypal');
--> statement-breakpoint
DELETE FROM "idoc"."payments" WHERE "source" = 'paypal';
--> statement-breakpoint
ALTER TABLE "idoc"."payments" DROP CONSTRAINT IF EXISTS "payments_source_check";
--> statement-breakpoint
ALTER TABLE "idoc"."payments"
  ADD CONSTRAINT "payments_source_check"
  CHECK ("source" in ('stripe_recurring', 'stripe_one_time', 'stripe_manual', 'bank_transfer', 'cash', 'complimentary'));
--> statement-breakpoint
ALTER TABLE "idoc"."payments" DROP CONSTRAINT IF EXISTS "payments_evidence_check";
--> statement-breakpoint
ALTER TABLE "idoc"."payments"
  ADD CONSTRAINT "payments_evidence_check"
  CHECK (("source" in ('stripe_recurring', 'stripe_one_time') and "external_payment_id" is not null)
    or ("source" in ('stripe_manual', 'bank_transfer', 'cash', 'complimentary') and "administrator_id" is not null));

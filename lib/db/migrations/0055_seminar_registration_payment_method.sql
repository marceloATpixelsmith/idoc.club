-- Moves payment-method choice from the seminar (one value shared by every registrant, chosen by
-- the administrator at creation time) to the registration (one value per registrant, chosen by the
-- member at registration time). Every seminar now accepts whichever of the three canonical
-- seminar_payment_methods are currently enabled in Organization Settings, rather than a single
-- admin-picked method locked in for the whole seminar.
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "payment_method_canonical_id" varchar(40);
--> statement-breakpoint
-- Backfill: every existing registration inherits the payment method its seminar was created with
-- -- the only value it could possibly have meant, since this column didn't exist before today.
UPDATE "idoc"."seminar_registrations" r
SET "payment_method_canonical_id" = s."payment_method_canonical_id"
FROM "idoc"."seminars" s
WHERE s."id" = r."seminar_id";
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ALTER COLUMN "payment_method_canonical_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_payment_method_canonical_id_seminar_payment_methods_canonical_id_fk" FOREIGN KEY ("payment_method_canonical_id") REFERENCES "idoc"."seminar_payment_methods"("canonical_id");
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT "seminars_payment_method_canonical_id_seminar_payment_methods_canonical_id_fk";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP COLUMN "payment_method_canonical_id";

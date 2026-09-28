-- Multi-day seminars: replace the single seminar_date with start_date/end_date. Every existing
-- seminar is single-day today, so end_date = start_date is a genuinely lossless backfill, not a
-- guess.
ALTER TABLE "idoc"."seminars" RENAME COLUMN "seminar_date" TO "start_date";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ADD COLUMN "end_date" date;
--> statement-breakpoint
UPDATE "idoc"."seminars" SET "end_date" = "start_date" WHERE "end_date" IS NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ALTER COLUMN "end_date" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "idoc"."seminars_status_date_idx";
--> statement-breakpoint
CREATE INDEX "seminars_status_date_idx" ON "idoc"."seminars" USING btree ("status","start_date");
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT "seminars_time_order_check";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_date_order_check" CHECK ("end_date" > "start_date" OR ("end_date" = "start_date" AND "end_time" > "start_time"));
--> statement-breakpoint

-- Two prices per seminar: the existing single price becomes the member price. The non-member
-- price defaults to the same value on backfill (no price is invented) -- an administrator should
-- review and adjust each seminar's non-member price afterward.
ALTER TABLE "idoc"."seminars" RENAME COLUMN "price_cents" TO "member_price_cents";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ADD COLUMN "non_member_price_cents" integer;
--> statement-breakpoint
UPDATE "idoc"."seminars" SET "non_member_price_cents" = "member_price_cents" WHERE "non_member_price_cents" IS NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ALTER COLUMN "non_member_price_cents" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT "seminars_price_check";
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_member_price_check" CHECK ("member_price_cents" >= 0);
--> statement-breakpoint
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_non_member_price_check" CHECK ("non_member_price_cents" >= 0);
--> statement-breakpoint

-- Guest (non-member) registration: a registration now belongs to a real member profile OR a guest
-- identified by name+email, never both, never neither. A partial unique index on (seminar, lower
-- guest email) guards a guest against double-registering the same seminar, mirroring the existing
-- (seminar, profile_id) guard for members. payment_reference is an optional administrator note
-- recorded when manually confirming a bank-transfer/cash payment.
ALTER TABLE "idoc"."seminar_registrations" ALTER COLUMN "profile_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "guest_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "guest_email" varchar(255);
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "payment_reference" text;
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_registrant_identity_check" CHECK (("profile_id" IS NOT NULL AND "guest_name" IS NULL AND "guest_email" IS NULL) OR ("profile_id" IS NULL AND "guest_name" IS NOT NULL AND "guest_email" IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "seminar_registrations_seminar_guest_email_unique" ON "idoc"."seminar_registrations" USING btree ("seminar_id", lower("guest_email")) WHERE "profile_id" IS NULL;

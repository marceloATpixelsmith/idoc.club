ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "guest_first_name" varchar(100);--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "guest_last_name" varchar(100);--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "guest_phone" varchar(40);--> statement-breakpoint
UPDATE "idoc"."seminar_registrations"
SET "guest_first_name" = CASE
      WHEN position(' ' in trim("guest_name")) > 0 THEN split_part(trim("guest_name"), ' ', 1)
      ELSE trim("guest_name")
    END,
    "guest_last_name" = CASE
      WHEN position(' ' in trim("guest_name")) > 0 THEN substring(trim("guest_name") from position(' ' in trim("guest_name")) + 1)
      ELSE ''
    END
WHERE "profile_id" IS NULL AND "guest_name" IS NOT NULL;
-- Columns intentionally remain nullable during the staging/main shared-database expand phase.
-- Staging validates and writes all structured fields; a later contract migration may remove
-- guest_name and add NOT NULL constraints only after production runs the new application code.

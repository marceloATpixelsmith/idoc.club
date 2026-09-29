ALTER TABLE "idoc"."seminars" ADD COLUMN "language" varchar(35) DEFAULT 'en' NOT NULL;
ALTER TABLE "idoc"."seminars" ADD COLUMN "organizing_national_federation" varchar(2) DEFAULT 'IE' NOT NULL;
ALTER TABLE "idoc"."seminars" ADD COLUMN "course_directors" text DEFAULT '' NOT NULL;
ALTER TABLE "idoc"."seminars" ADD COLUMN "participant_profile" text DEFAULT '' NOT NULL;
ALTER TABLE "idoc"."seminars" ADD COLUMN "course_venue_information" text DEFAULT '' NOT NULL;
ALTER TABLE "idoc"."seminars" ADD COLUMN "application" text DEFAULT '' NOT NULL;
ALTER TABLE "idoc"."seminars" ADD COLUMN "accommodation_information" text DEFAULT '' NOT NULL;
-- Preserve the existing combined content in both closest semantic destinations before removing its old presentation.
UPDATE "idoc"."seminars"
SET "course_directors" = "description", "application" = "description"
WHERE btrim("description") <> '';
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT "seminars_date_order_check";
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT "seminars_description_length_check";
-- Keep legacy time/timezone columns during the additive staging rollout so the currently deployed main revision remains compatible.
-- Remove them in a later contract migration after the date-only code has been promoted to main.
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_date_order_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_language_length_check" CHECK (char_length("language") between 2 and 35);

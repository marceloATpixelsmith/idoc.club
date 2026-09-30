-- Repair databases where migration 0061 was recorded without the obsolete legacy-description constraint being removed.
-- The redesigned seminar model stores structured rich-information fields and intentionally writes an empty legacy description.
ALTER TABLE "idoc"."seminars" DROP CONSTRAINT IF EXISTS "seminars_description_length_check";

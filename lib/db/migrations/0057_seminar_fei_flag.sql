-- Marks a seminar as FEI-affiliated. Purely a display flag (badge on listing cards and the detail
-- page) -- it carries no business logic of its own, so a plain boolean defaulting to false (every
-- existing seminar stays non-FEI on backfill) is sufficient.
ALTER TABLE "idoc"."seminars" ADD COLUMN "is_fei" boolean DEFAULT false NOT NULL;

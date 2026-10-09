ALTER TABLE "idoc"."news_articles"
  ADD COLUMN IF NOT EXISTS "promotion_key" uuid DEFAULT gen_random_uuid();
--> statement-breakpoint

UPDATE "idoc"."news_articles"
SET "promotion_key" = gen_random_uuid()
WHERE "promotion_key" IS NULL;
--> statement-breakpoint

ALTER TABLE "idoc"."news_articles"
  ALTER COLUMN "promotion_key" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "promotion_key" SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "news_articles_promotion_key_unique"
  ON "idoc"."news_articles" ("promotion_key");
--> statement-breakpoint

ALTER TABLE "idoc"."seminars"
  ADD COLUMN IF NOT EXISTS "promotion_key" uuid DEFAULT gen_random_uuid();
--> statement-breakpoint

UPDATE "idoc"."seminars"
SET "promotion_key" = gen_random_uuid()
WHERE "promotion_key" IS NULL;
--> statement-breakpoint

ALTER TABLE "idoc"."seminars"
  ALTER COLUMN "promotion_key" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "promotion_key" SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "seminars_promotion_key_unique"
  ON "idoc"."seminars" ("promotion_key");

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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "idoc"."lock_seminars_for_promotion"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $promotion_lock$
BEGIN
  LOCK TABLE "idoc"."seminars" IN SHARE ROW EXCLUSIVE MODE;
END;
$promotion_lock$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "idoc"."lock_seminars_for_promotion"() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "idoc"."lock_promotion_source"(p_dataset text, p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $promotion_source_lock$
BEGIN
  IF p_id IS NULL OR p_id <= 0 THEN
    RAISE EXCEPTION 'Invalid promotion source ID';
  END IF;

  IF p_dataset = 'news' THEN
    PERFORM 1 FROM "idoc"."news_articles" WHERE id = p_id FOR SHARE;
  ELSIF p_dataset = 'seminar' THEN
    PERFORM 1 FROM "idoc"."seminars" WHERE id = p_id FOR SHARE;
  ELSIF p_dataset = 'organization' AND p_id = 1 THEN
    PERFORM 1 FROM "idoc"."organization_settings" WHERE id = 1 FOR SHARE;
  ELSE
    RAISE EXCEPTION 'Invalid promotion source dataset';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion source not found';
  END IF;
END;
$promotion_source_lock$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "idoc"."lock_promotion_source"(text, bigint) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE VIEW "idoc"."promotion_audit_success" WITH (security_barrier = true) AS
SELECT id, entity_id, after_json, created_at
FROM "idoc"."audit_log"
WHERE action = 'admin.data_promotion.succeeded' AND entity_type = 'data_promotion';
--> statement-breakpoint

REVOKE ALL ON "idoc"."promotion_audit_success" FROM PUBLIC;

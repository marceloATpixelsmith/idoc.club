ALTER TABLE "idoc"."news_articles"
  ADD COLUMN IF NOT EXISTS "audience" varchar(20)[] DEFAULT ARRAY['public']::varchar[] NOT NULL;
--> statement-breakpoint

ALTER TABLE "idoc"."news_articles"
  DROP CONSTRAINT IF EXISTS "news_articles_audience_check";
--> statement-breakpoint

ALTER TABLE "idoc"."news_articles"
  ADD CONSTRAINT "news_articles_audience_check"
  CHECK (
    cardinality("audience") BETWEEN 1 AND 3
    AND "audience" <@ ARRAY['public','members','judge','steward','veterinarian']::varchar[]
    AND (
      ("audience" && ARRAY['public','members']::varchar[] AND cardinality("audience") = 1)
      OR
      (
        NOT ("audience" && ARRAY['public','members']::varchar[])
        AND "audience" <@ ARRAY['judge','steward','veterinarian']::varchar[]
      )
    )
  );

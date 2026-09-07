CREATE TABLE "idoc"."news_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(200) NOT NULL,
	"subtitle" varchar(300),
	"content_html" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"publication_date" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "news_articles_status_check" CHECK ("idoc"."news_articles"."status" in ('draft', 'scheduled', 'published', 'archived')),
	CONSTRAINT "news_articles_slug_format_check" CHECK ("idoc"."news_articles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "news_articles_title_length_check" CHECK (char_length("idoc"."news_articles"."title") between 1 and 200),
	CONSTRAINT "news_articles_subtitle_length_check" CHECK ("idoc"."news_articles"."subtitle" is null or char_length("idoc"."news_articles"."subtitle") between 1 and 300),
	CONSTRAINT "news_articles_content_length_check" CHECK (char_length("idoc"."news_articles"."content_html") between 1 and 20000)
);
--> statement-breakpoint
ALTER TABLE "idoc"."news_articles" ADD CONSTRAINT "news_articles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."news_articles" ADD CONSTRAINT "news_articles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "idoc"."users"("id");
CREATE INDEX "news_articles_publication_queue_idx" ON "idoc"."news_articles" ("status","publication_date");

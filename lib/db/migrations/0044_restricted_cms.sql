CREATE TABLE "idoc"."content_pages" (
 "id" serial PRIMARY KEY NOT NULL, "slug" varchar(160) NOT NULL, "title" varchar(200) NOT NULL,
 "summary" varchar(500), "content_html" text NOT NULL, "status" varchar(20) DEFAULT 'draft' NOT NULL,
 "audience_mode" varchar(10) DEFAULT 'any' NOT NULL, "publish_at" timestamp with time zone,
 "seo_title" varchar(200), "seo_description" varchar(320), "created_by_user_id" integer NOT NULL,
 "updated_by_user_id" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "content_pages_slug_unique" UNIQUE("slug"),
 CONSTRAINT "content_pages_status_check" CHECK ("idoc"."content_pages"."status" in ('draft', 'published', 'archived')),
 CONSTRAINT "content_pages_audience_mode_check" CHECK ("idoc"."content_pages"."audience_mode" in ('any', 'all')),
 CONSTRAINT "content_pages_slug_format_check" CHECK ("idoc"."content_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 CONSTRAINT "content_pages_title_length_check" CHECK (char_length("idoc"."content_pages"."title") between 1 and 200),
 CONSTRAINT "content_pages_content_length_check" CHECK (char_length("idoc"."content_pages"."content_html") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "idoc"."content_page_audiences" ("page_id" integer NOT NULL,"audience" varchar(20) NOT NULL,CONSTRAINT "content_page_audiences_page_id_audience_pk" PRIMARY KEY("page_id","audience"),CONSTRAINT "content_page_audiences_value_check" CHECK ("idoc"."content_page_audiences"."audience" in ('public','member','judge','steward','veterinarian')));
--> statement-breakpoint
CREATE TABLE "idoc"."content_page_revisions" ("id" serial PRIMARY KEY NOT NULL,"page_id" integer NOT NULL,"revision_number" integer NOT NULL,"snapshot_json" jsonb NOT NULL,"created_by_user_id" integer NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "idoc"."content_pages" ADD CONSTRAINT "content_pages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "idoc"."users"("id");
--> statement-breakpoint
ALTER TABLE "idoc"."content_pages" ADD CONSTRAINT "content_pages_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "idoc"."users"("id");
--> statement-breakpoint
ALTER TABLE "idoc"."content_page_audiences" ADD CONSTRAINT "content_page_audiences_page_id_content_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "idoc"."content_pages"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "idoc"."content_page_revisions" ADD CONSTRAINT "content_page_revisions_page_id_content_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "idoc"."content_pages"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "idoc"."content_page_revisions" ADD CONSTRAINT "content_page_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "idoc"."users"("id");
--> statement-breakpoint
CREATE INDEX "content_pages_publication_idx" ON "idoc"."content_pages" USING btree ("status","publish_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "content_page_revisions_number_unique" ON "idoc"."content_page_revisions" USING btree ("page_id","revision_number");

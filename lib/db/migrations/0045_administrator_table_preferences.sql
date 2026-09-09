CREATE TABLE "idoc"."administrator_table_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "table_identifier" varchar(40) NOT NULL,
  "preferences" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "administrator_table_preferences_identifier_check" CHECK ("idoc"."administrator_table_preferences"."table_identifier" in ('memberships', 'support', 'news', 'seminars', 'content_pages'))
);
--> statement-breakpoint
ALTER TABLE "idoc"."administrator_table_preferences" ADD CONSTRAINT "administrator_table_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "administrator_table_preferences_user_table_unique" ON "idoc"."administrator_table_preferences" USING btree ("user_id","table_identifier");

CREATE TABLE IF NOT EXISTS "idoc"."reconciliation_ignores" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(30) NOT NULL,
	"subject_key" varchar(255) NOT NULL,
	"summary" text,
	"ignored_by_user_id" integer,
	"ignored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idoc"."reconciliation_ignores" ADD CONSTRAINT "reconciliation_ignores_ignored_by_user_id_users_id_fk" FOREIGN KEY ("ignored_by_user_id") REFERENCES "idoc"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reconciliation_ignores_kind_subject_unique" ON "idoc"."reconciliation_ignores" USING btree ("kind","subject_key");

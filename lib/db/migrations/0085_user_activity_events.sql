CREATE TABLE IF NOT EXISTS "idoc"."user_activity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" varchar(60) NOT NULL,
	"outcome" varchar(40),
	"detail" jsonb,
	"request_id" varchar(64)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idoc"."user_activity_events" ADD CONSTRAINT "user_activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_activity_events_user_time_idx" ON "idoc"."user_activity_events" USING btree ("user_id","occurred_at");

CREATE TABLE IF NOT EXISTS "idoc"."email_delivery_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_message_id" varchar(200),
	"recipient_email" varchar(255) NOT NULL,
	"recipient_domain" varchar(255) NOT NULL,
	"user_id" integer,
	"kind" varchar(60),
	"subject" varchar(255),
	"message_ref" varchar(100),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'accepted' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "email_delivery_log_status_check" CHECK ("idoc"."email_delivery_log"."status" in ('accepted', 'deferred', 'soft_bounced', 'delivered', 'hard_bounced', 'blocked', 'invalid', 'error', 'spam'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."email_delivery_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"log_id" integer NOT NULL,
	"event" varchar(30) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" varchar(200)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idoc"."email_delivery_log" ADD CONSTRAINT "email_delivery_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idoc"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_log_id_email_delivery_log_id_fk" FOREIGN KEY ("log_id") REFERENCES "idoc"."email_delivery_log"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_delivery_log_provider_message_id_idx" ON "idoc"."email_delivery_log" USING btree ("provider_message_id") WHERE "idoc"."email_delivery_log"."provider_message_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_log_recipient_idx" ON "idoc"."email_delivery_log" USING btree ("recipient_email","sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_log_status_sent_idx" ON "idoc"."email_delivery_log" USING btree ("status","sent_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_delivery_events_dedupe_idx" ON "idoc"."email_delivery_events" USING btree ("log_id","event","occurred_at");

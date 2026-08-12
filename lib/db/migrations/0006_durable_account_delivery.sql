CREATE TABLE "idoc"."account_request_limits" (
  "id" serial PRIMARY KEY NOT NULL, "purpose" varchar(30) NOT NULL,
  "identifier_hash" varchar(64) NOT NULL, "origin_hash" varchar(64) NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL, "request_count" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "account_request_limits_bucket_unique" UNIQUE("purpose","identifier_hash","origin_hash","window_started_at")
);--> statement-breakpoint
CREATE TABLE "idoc"."account_delivery_outbox" (
  "id" serial PRIMARY KEY NOT NULL, "token_id" integer NOT NULL UNIQUE, "user_id" integer NOT NULL,
  "purpose" varchar(30) NOT NULL, "encrypted_payload" text NOT NULL, "key_version" varchar(30) NOT NULL,
  "message_id" varchar(100) NOT NULL UNIQUE, "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_owner" varchar(100), "lease_expires_at" timestamp with time zone, "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone, "last_error_code" varchar(50), "sent_at" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "idoc"."account_delivery_outbox" ADD CONSTRAINT "account_delivery_token_fk" FOREIGN KEY ("token_id") REFERENCES "idoc"."account_tokens"("id");--> statement-breakpoint
ALTER TABLE "idoc"."account_delivery_outbox" ADD CONSTRAINT "account_delivery_user_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id");--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "lease_owner" varchar(100);--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "account_delivery_claim_idx" ON "idoc"."account_delivery_outbox" ("available_at", "id") WHERE "sent_at" IS NULL AND "dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_claim_idx" ON "idoc"."notification_outbox" ("available_at", "id") WHERE "sent_at" IS NULL AND "dead_lettered_at" IS NULL;

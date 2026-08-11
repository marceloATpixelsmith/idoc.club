CREATE TABLE "idoc"."account_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" varchar(30) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "last_error_code" varchar(50);--> statement-breakpoint
ALTER TABLE "idoc"."users" ADD COLUMN "account_state" varchar(30) DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."account_tokens" ADD CONSTRAINT "account_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_normalized_email_unique" ON "idoc"."users" USING btree (lower("email"));
--> statement-breakpoint
ALTER TABLE "idoc"."account_tokens" ADD CONSTRAINT "account_tokens_purpose_check" CHECK ("purpose" IN ('password_reset', 'migration_activation'));
--> statement-breakpoint
CREATE INDEX "account_tokens_claim_idx" ON "idoc"."account_tokens" ("token_hash", "purpose", "expires_at") WHERE "consumed_at" IS NULL;
--> statement-breakpoint
UPDATE "idoc"."users" SET "account_state" = CASE WHEN "email_verified_at" IS NULL THEN 'unverified' ELSE 'active' END;

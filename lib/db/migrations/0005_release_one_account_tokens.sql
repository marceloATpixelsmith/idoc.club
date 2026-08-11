ALTER TABLE "idoc"."users" ADD COLUMN "account_state" varchar(30) DEFAULT 'unverified' NOT NULL;
ALTER TABLE "idoc"."users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;
CREATE UNIQUE INDEX "users_normalized_email_unique" ON "idoc"."users" (lower("email"));
UPDATE "idoc"."users" SET "account_state" = CASE WHEN "email_verified_at" IS NULL THEN 'unverified' ELSE 'active' END;

CREATE TABLE "idoc"."account_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "idoc"."users"("id"),
  "purpose" varchar(30) NOT NULL CHECK ("purpose" IN ('password_reset', 'migration_activation')),
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "account_tokens_claim_idx" ON "idoc"."account_tokens" ("token_hash", "purpose", "expires_at") WHERE "consumed_at" IS NULL;

ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "last_attempt_at" timestamp with time zone;
ALTER TABLE "idoc"."notification_outbox" ADD COLUMN "last_error_code" varchar(50);

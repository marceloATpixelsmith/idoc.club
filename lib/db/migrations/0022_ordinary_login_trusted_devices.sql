CREATE TABLE "idoc"."login_trusted_devices" (
  "trusted_device_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "token_digest" varchar(64) NOT NULL,
  "session_version_at_issue" integer NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoke_reason" varchar(200),
  CONSTRAINT "login_trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "login_trusted_devices_digest_unique" ON "idoc"."login_trusted_devices" USING btree ("token_digest");
--> statement-breakpoint
CREATE INDEX "login_trusted_devices_owner_idx" ON "idoc"."login_trusted_devices" USING btree ("user_id","application_id","expires_at");

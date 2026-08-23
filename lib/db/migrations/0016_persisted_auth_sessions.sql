CREATE TABLE IF NOT EXISTS "idoc"."auth_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" varchar(64) NOT NULL,
  "user_id" integer NOT NULL,
  "session_version" integer NOT NULL,
  "authenticated_at" timestamp with time zone NOT NULL,
  "last_activity_at" timestamp with time zone NOT NULL,
  "absolute_expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoke_reason" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_sessions_session_id_unique" UNIQUE("session_id"),
  CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_active_user_idx"
  ON "idoc"."auth_sessions" USING btree ("user_id", "last_activity_at")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_expiry_idx"
  ON "idoc"."auth_sessions" USING btree ("absolute_expires_at");

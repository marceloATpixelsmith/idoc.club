CREATE TABLE "idoc"."membership_checkout_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer NOT NULL REFERENCES "idoc"."profiles"("id"),
  "external_checkout_session_id" varchar(255) UNIQUE,
  "mode" varchar(20) NOT NULL,
  "cycle" varchar(40) NOT NULL,
  "status" varchar(20) NOT NULL,
  "expires_at" timestamp with time zone,
  "idempotency_key" varchar(255) NOT NULL UNIQUE,
  "checkout_url" text,
  "attempt" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "membership_checkout_sessions_mode_check" CHECK ("mode" in ('payment','subscription')),
  CONSTRAINT "membership_checkout_sessions_status_check" CHECK ("status" in ('creating','open','expired','completed','superseded','failed'))
);
CREATE UNIQUE INDEX "membership_checkout_sessions_attempt_unique" ON "idoc"."membership_checkout_sessions" ("profile_id","mode","cycle","attempt");
CREATE UNIQUE INDEX "membership_checkout_sessions_one_open_cycle" ON "idoc"."membership_checkout_sessions" ("profile_id","mode","cycle") WHERE "status" in ('creating','open');

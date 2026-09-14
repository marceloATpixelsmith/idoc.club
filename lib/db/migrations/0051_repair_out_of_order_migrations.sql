CREATE TABLE IF NOT EXISTS "idoc"."content_pages" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" varchar(160) NOT NULL,
  "title" varchar(200) NOT NULL,
  "summary" varchar(500),
  "content_html" text NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "audience_mode" varchar(10) DEFAULT 'any' NOT NULL,
  "publish_at" timestamp with time zone,
  "seo_title" varchar(200),
  "seo_description" varchar(320),
  "created_by_user_id" integer NOT NULL,
  "updated_by_user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_pages_slug_unique" UNIQUE("slug"),
  CONSTRAINT "content_pages_status_check" CHECK ("idoc"."content_pages"."status" in ('draft', 'published', 'archived')),
  CONSTRAINT "content_pages_audience_mode_check" CHECK ("idoc"."content_pages"."audience_mode" in ('any', 'all')),
  CONSTRAINT "content_pages_slug_format_check" CHECK ("idoc"."content_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "content_pages_title_length_check" CHECK (char_length("idoc"."content_pages"."title") between 1 and 200),
  CONSTRAINT "content_pages_content_length_check" CHECK (char_length("idoc"."content_pages"."content_html") between 1 and 20000),
  CONSTRAINT "content_pages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "idoc"."users"("id"),
  CONSTRAINT "content_pages_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "idoc"."users"("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."content_page_audiences" (
  "page_id" integer NOT NULL,
  "audience" varchar(20) NOT NULL,
  CONSTRAINT "content_page_audiences_page_id_audience_pk" PRIMARY KEY("page_id","audience"),
  CONSTRAINT "content_page_audiences_value_check" CHECK ("idoc"."content_page_audiences"."audience" in ('public','member','judge','steward','veterinarian')),
  CONSTRAINT "content_page_audiences_page_id_content_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "idoc"."content_pages"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."content_page_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "page_id" integer NOT NULL,
  "revision_number" integer NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "created_by_user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_page_revisions_page_id_content_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "idoc"."content_pages"("id") ON DELETE cascade,
  CONSTRAINT "content_page_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "idoc"."users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_pages_publication_idx" ON "idoc"."content_pages" USING btree ("status","publish_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_page_revisions_number_unique" ON "idoc"."content_page_revisions" USING btree ("page_id","revision_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."administrator_table_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "table_identifier" varchar(40) NOT NULL,
  "preferences" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "administrator_table_preferences_identifier_check" CHECK ("idoc"."administrator_table_preferences"."table_identifier" in ('memberships', 'support', 'news', 'seminars', 'content_pages')),
  CONSTRAINT "administrator_table_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "administrator_table_preferences_user_table_unique" ON "idoc"."administrator_table_preferences" USING btree ("user_id","table_identifier");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."renewal_preferences" (
  "profile_id" integer PRIMARY KEY NOT NULL,
  "current_mode" varchar(20) NOT NULL,
  "pending_mode" varchar(20),
  "effective_on" date,
  "expected_charge_cents" integer,
  "currency" varchar(3) DEFAULT 'EUR' NOT NULL,
  "external_checkout_session_id" varchar(255),
  "external_setup_intent_id" varchar(255),
  "external_payment_method_id" varchar(255),
  "external_recurring_price_id" varchar(255),
  "external_subscription_schedule_id" varchar(255),
  "transition_state" varchar(30) DEFAULT 'current' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "renewal_preferences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id"),
  CONSTRAINT "renewal_preferences_current_mode_check" CHECK ("current_mode" in ('recurring','non_recurring')),
  CONSTRAINT "renewal_preferences_pending_mode_check" CHECK ("pending_mode" is null or "pending_mode" in ('recurring','non_recurring')),
  CONSTRAINT "renewal_preferences_transition_state_check" CHECK ("transition_state" in ('current','awaiting_setup','pending_activation','cancel_pending','failed')),
  CONSTRAINT "renewal_preferences_pending_shape_check" CHECK (("pending_mode" is null and "effective_on" is null) or ("pending_mode" is not null and "effective_on" is not null)),
  CONSTRAINT "renewal_preferences_expected_charge_check" CHECK ("expected_charge_cents" is null or ("expected_charge_cents" = 8000 and "currency" = 'EUR')),
  CONSTRAINT "renewal_preferences_external_checkout_session_id_unique" UNIQUE("external_checkout_session_id"),
  CONSTRAINT "renewal_preferences_external_setup_intent_id_unique" UNIQUE("external_setup_intent_id"),
  CONSTRAINT "renewal_preferences_external_subscription_schedule_id_unique" UNIQUE("external_subscription_schedule_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_one_open_path_per_profile" ON "idoc"."subscriptions" ("profile_id") WHERE "status" in ('active', 'trialing', 'past_due', 'incomplete');
--> statement-breakpoint
ALTER TABLE "idoc"."memberships" ADD COLUMN IF NOT EXISTS "grace_ends_on" date;
--> statement-breakpoint
UPDATE "idoc"."memberships" SET "grace_ends_on" = "valid_until" WHERE "status" = 'grace' AND "grace_ends_on" IS NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "expected_amount_cents" integer;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'EUR' NOT NULL;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "checkout_status" varchar(20);
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "checkout_created_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "payment_status_updated_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "disputed_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN IF NOT EXISTS "chargeback_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" DROP CONSTRAINT IF EXISTS "seminar_registrations_payment_status_check";
ALTER TABLE "idoc"."seminar_registrations" DROP CONSTRAINT IF EXISTS "seminar_registrations_expected_amount_check";
ALTER TABLE "idoc"."seminar_registrations" DROP CONSTRAINT IF EXISTS "seminar_registrations_currency_check";
ALTER TABLE "idoc"."seminar_registrations" DROP CONSTRAINT IF EXISTS "seminar_registrations_checkout_status_check";
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_payment_status_check" CHECK ("payment_status" in ('unpaid','pending','bank_transfer_pending','cash_pending','paid','refunded','partially_refunded','refund_failed','disputed','chargeback'));
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_expected_amount_check" CHECK ("expected_amount_cents" is null or "expected_amount_cents" >= 0);
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_currency_check" CHECK ("currency" = 'EUR');
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_checkout_status_check" CHECK ("checkout_status" is null or "checkout_status" in ('open','complete','expired','superseded'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."payment_refunds" (
  "id" serial PRIMARY KEY NOT NULL,
  "seminar_registration_id" integer CONSTRAINT "payment_refunds_seminar_registration_id_seminar_registrations_id_fk" REFERENCES "idoc"."seminar_registrations"("id"),
  "membership_payment_id" integer CONSTRAINT "payment_refunds_membership_payment_id_payments_id_fk" REFERENCES "idoc"."payments"("id"),
  "external_refund_id" varchar(255) CONSTRAINT "payment_refunds_external_refund_id_unique" UNIQUE,
  "idempotency_key" varchar(255) NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" varchar(3) DEFAULT 'EUR' NOT NULL,
  "status" varchar(30) NOT NULL,
  "reason" text NOT NULL,
  "administrator_id" integer CONSTRAINT "payment_refunds_administrator_id_users_id_fk" REFERENCES "idoc"."users"("id"),
  "failure_code" varchar(100),
  "provider_evidence" jsonb,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "refunded_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_refunds_idempotency_key_unique" UNIQUE ("idempotency_key"),
  CONSTRAINT "payment_refunds_owner_check" CHECK (num_nonnulls("seminar_registration_id","membership_payment_id") = 1),
  CONSTRAINT "payment_refunds_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "payment_refunds_currency_check" CHECK ("currency" = 'EUR'),
  CONSTRAINT "payment_refunds_status_check" CHECK ("status" in ('pending','succeeded','failed','canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_one_pending_seminar" ON "idoc"."payment_refunds" ("seminar_registration_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_one_pending_membership" ON "idoc"."payment_refunds" ("membership_payment_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."membership_checkout_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer NOT NULL REFERENCES "idoc"."profiles"("id"),
  "external_checkout_session_id" varchar(255),
  "mode" varchar(20) NOT NULL,
  "cycle" varchar(40) NOT NULL,
  "status" varchar(20) NOT NULL,
  "expires_at" timestamp with time zone,
  "idempotency_key" varchar(255) NOT NULL,
  "checkout_url" text,
  "attempt" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "membership_checkout_sessions_external_checkout_session_id_unique" UNIQUE ("external_checkout_session_id"),
  CONSTRAINT "membership_checkout_sessions_idempotency_key_unique" UNIQUE ("idempotency_key"),
  CONSTRAINT "membership_checkout_sessions_mode_check" CHECK ("mode" in ('payment','subscription')),
  CONSTRAINT "membership_checkout_sessions_status_check" CHECK ("status" in ('creating','open','expired','completed','superseded','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "membership_checkout_sessions_attempt_unique" ON "idoc"."membership_checkout_sessions" ("profile_id","mode","cycle","attempt");
CREATE UNIQUE INDEX IF NOT EXISTS "membership_checkout_sessions_one_open_cycle" ON "idoc"."membership_checkout_sessions" ("profile_id","mode","cycle") WHERE "status" in ('creating','open');
--> statement-breakpoint
ALTER TABLE "idoc"."reconciliation_findings" DROP CONSTRAINT IF EXISTS "reconciliation_findings_kind_check";
ALTER TABLE "idoc"."reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_kind_check" CHECK ("kind" in ('status_conflict','orphaned_subscription','repeated_failure','unlinked_customer','pending_schedule_conflict','refund_conflict','missing_refund','dispute','chargeback','seminar_payment_conflict'));

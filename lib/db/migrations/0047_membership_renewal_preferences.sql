CREATE TABLE "idoc"."renewal_preferences" (
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
ALTER TABLE "idoc"."reconciliation_findings" DROP CONSTRAINT "reconciliation_findings_kind_check";
--> statement-breakpoint
ALTER TABLE "idoc"."reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_kind_check" CHECK ("kind" in ('status_conflict','orphaned_subscription','repeated_failure','unlinked_customer','pending_schedule_conflict'));
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_open_path_per_profile" ON "idoc"."subscriptions" ("profile_id") WHERE "status" in ('active', 'trialing', 'past_due', 'incomplete');
--> statement-breakpoint
ALTER TABLE "idoc"."memberships" ADD COLUMN "grace_ends_on" date;
--> statement-breakpoint
UPDATE "idoc"."memberships" SET "grace_ends_on"="valid_until" WHERE "status"='grace';

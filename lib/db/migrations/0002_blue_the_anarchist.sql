CREATE TABLE "idoc"."application_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) NOT NULL,
	"granted_by" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idoc"."audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idoc"."memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"starts_on" date NOT NULL,
	"valid_until" date NOT NULL,
	"membership_type" varchar(30) DEFAULT 'standard' NOT NULL,
	"source" varchar(30) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idoc"."migration_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_type" varchar(50) NOT NULL,
	"legacy_id" varchar(255) NOT NULL,
	"new_entity_id" varchar(255),
	"disposition" varchar(40) NOT NULL,
	"confidence" varchar(20),
	"reviewed_by" integer
);
--> statement-breakpoint
CREATE TABLE "idoc"."notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(50) NOT NULL,
	"profile_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idoc"."professional_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"role_type" varchar(20) NOT NULL,
	"national_federation_country_code" varchar(2),
	"idoc_region" varchar(40),
	"fei_id" varchar(40),
	"official_status" varchar(120),
	"is_technical_delegate" boolean,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_by" integer
);
--> statement-breakpoint
CREATE TABLE "idoc"."profile_change_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"before_json" jsonb NOT NULL,
	"after_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idoc"."profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"address_1" varchar(200) NOT NULL,
	"address_2" varchar(200),
	"city" varchar(100) NOT NULL,
	"state_province" varchar(100) NOT NULL,
	"postal_code" varchar(30) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "idoc"."stripe_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_event_id" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
ALTER TABLE "idoc"."users" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "idoc"."application_roles" ADD CONSTRAINT "application_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."application_roles" ADD CONSTRAINT "application_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."memberships" ADD CONSTRAINT "memberships_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."migration_map" ADD CONSTRAINT "migration_map_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."notification_outbox" ADD CONSTRAINT "notification_outbox_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."professional_roles" ADD CONSTRAINT "professional_roles_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."professional_roles" ADD CONSTRAINT "professional_roles_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."profile_change_history" ADD CONSTRAINT "profile_change_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."profile_change_history" ADD CONSTRAINT "profile_change_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_roles_active_unique" ON "idoc"."application_roles" USING btree ("user_id","role") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_map_source_unique" ON "idoc"."migration_map" USING btree ("legacy_type","legacy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_normalized_email_unique" ON "idoc"."users" (lower("email")) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."application_roles" ADD CONSTRAINT "application_roles_role_check" CHECK ("role" IN ('member', 'administrator', 'super_admin'));
--> statement-breakpoint
ALTER TABLE "idoc"."memberships" ADD CONSTRAINT "memberships_status_check" CHECK ("status" IN ('active', 'grace', 'expired', 'canceled', 'suspended', 'complimentary', 'review_required'));
--> statement-breakpoint
ALTER TABLE "idoc"."memberships" ADD CONSTRAINT "memberships_dates_check" CHECK ("valid_until" >= "starts_on");
--> statement-breakpoint
ALTER TABLE "idoc"."professional_roles" ADD CONSTRAINT "professional_roles_type_check" CHECK ("role_type" IN ('judge', 'steward', 'veterinarian'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "idoc"."reject_immutable_history_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IDOC history records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_immutable" BEFORE UPDATE OR DELETE ON "idoc"."audit_log" FOR EACH ROW EXECUTE FUNCTION "idoc"."reject_immutable_history_change"();
--> statement-breakpoint
CREATE TRIGGER "profile_change_history_immutable" BEFORE UPDATE OR DELETE ON "idoc"."profile_change_history" FOR EACH ROW EXECUTE FUNCTION "idoc"."reject_immutable_history_change"();

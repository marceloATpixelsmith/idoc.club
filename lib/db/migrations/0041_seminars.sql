CREATE TABLE "idoc"."seminar_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"seminar_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"registration_status" varchar(20) DEFAULT 'registered' NOT NULL,
	"payment_status" varchar(30) NOT NULL,
	"stripe_checkout_session_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"paid_at" timestamp with time zone,
	"marked_paid_by_user_id" integer,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seminar_registrations_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "seminar_registrations_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "seminar_registrations_registration_status_check" CHECK ("idoc"."seminar_registrations"."registration_status" in ('registered', 'canceled')),
	CONSTRAINT "seminar_registrations_payment_status_check" CHECK ("idoc"."seminar_registrations"."payment_status" in ('unpaid', 'bank_transfer_pending', 'cash_pending', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "idoc"."seminars" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"seminar_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"timezone" varchar(60) NOT NULL,
	"location" text NOT NULL,
	"capacity" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"registration_deadline" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"payment_method_canonical_id" varchar(40) NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seminars_status_check" CHECK ("idoc"."seminars"."status" in ('draft', 'published', 'canceled')),
	CONSTRAINT "seminars_title_length_check" CHECK (char_length("idoc"."seminars"."title") between 1 and 200),
	CONSTRAINT "seminars_description_length_check" CHECK (char_length("idoc"."seminars"."description") between 1 and 10000),
	CONSTRAINT "seminars_location_length_check" CHECK (char_length("idoc"."seminars"."location") between 1 and 2000),
	CONSTRAINT "seminars_capacity_check" CHECK ("idoc"."seminars"."capacity" > 0),
	CONSTRAINT "seminars_price_check" CHECK ("idoc"."seminars"."price_cents" >= 0),
	CONSTRAINT "seminars_time_order_check" CHECK ("idoc"."seminars"."end_time" > "idoc"."seminars"."start_time")
);
--> statement-breakpoint
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_seminar_id_seminars_id_fk" FOREIGN KEY ("seminar_id") REFERENCES "idoc"."seminars"("id");
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id");
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_marked_paid_by_user_id_users_id_fk" FOREIGN KEY ("marked_paid_by_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_payment_method_canonical_id_seminar_payment_methods_canonical_id_fk" FOREIGN KEY ("payment_method_canonical_id") REFERENCES "idoc"."seminar_payment_methods"("canonical_id");
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "idoc"."users"("id");
CREATE UNIQUE INDEX "seminar_registrations_seminar_profile_unique" ON "idoc"."seminar_registrations" ("seminar_id","profile_id");
CREATE INDEX "seminar_registrations_seminar_status_idx" ON "idoc"."seminar_registrations" ("seminar_id","registration_status");
CREATE INDEX "seminar_registrations_profile_idx" ON "idoc"."seminar_registrations" ("profile_id");
CREATE INDEX "seminars_status_date_idx" ON "idoc"."seminars" ("status","seminar_date");

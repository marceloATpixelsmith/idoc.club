CREATE TABLE "idoc"."payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"source" varchar(30) NOT NULL,
	"external_payment_id" varchar(255),
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"reference" text,
	"administrator_id" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_external_payment_id_unique" UNIQUE("external_payment_id"),
	CONSTRAINT "payments_source_check" CHECK ("idoc"."payments"."source" in ('stripe_recurring', 'stripe_one_time', 'paypal', 'bank_transfer', 'cash', 'complimentary')),
	CONSTRAINT "payments_amount_check" CHECK ("idoc"."payments"."amount_cents" > 0),
	CONSTRAINT "payments_evidence_check" CHECK (("idoc"."payments"."source" in ('stripe_recurring', 'stripe_one_time') and "idoc"."payments"."external_payment_id" is not null)
      or ("idoc"."payments"."source" in ('paypal', 'bank_transfer', 'cash', 'complimentary') and "idoc"."payments"."administrator_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "idoc"."subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"external_subscription_id" varchar(255) NOT NULL,
	"price_id" varchar(255) NOT NULL,
	"status" varchar(30) NOT NULL,
	"current_period_end" date NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_external_subscription_id_unique" UNIQUE("external_subscription_id"),
	CONSTRAINT "subscriptions_status_check" CHECK ("idoc"."subscriptions"."status" in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'))
);
--> statement-breakpoint
ALTER TABLE "idoc"."payments" ADD CONSTRAINT "payments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."payments" ADD CONSTRAINT "payments_administrator_id_users_id_fk" FOREIGN KEY ("administrator_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idoc"."subscriptions" ADD CONSTRAINT "subscriptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;

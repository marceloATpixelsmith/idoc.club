CREATE TABLE "idoc"."billing_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"provider" varchar(30) DEFAULT 'stripe' NOT NULL,
	"external_customer_id" varchar(255) NOT NULL,
	CONSTRAINT "billing_accounts_profile_id_unique" UNIQUE("profile_id"),
	CONSTRAINT "billing_accounts_external_customer_id_unique" UNIQUE("external_customer_id")
);
--> statement-breakpoint
ALTER TABLE "idoc"."billing_accounts" ADD CONSTRAINT "billing_accounts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;

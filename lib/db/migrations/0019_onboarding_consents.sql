CREATE TABLE "idoc"."onboarding_consents" (
	"profile_id" integer PRIMARY KEY NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"privacy_accepted_at" timestamp with time zone NOT NULL,
	"keep_updated_opt_in" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_consents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE cascade ON UPDATE no action
);

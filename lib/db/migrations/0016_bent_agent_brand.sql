ALTER TABLE "idoc"."profiles" ADD COLUMN "terms_accepted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."profiles" ADD COLUMN "privacy_accepted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."profiles" ADD COLUMN "keep_updated_opt_in" boolean DEFAULT true NOT NULL;
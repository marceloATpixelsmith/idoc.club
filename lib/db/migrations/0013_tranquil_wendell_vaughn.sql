CREATE TABLE "idoc"."reconciliation_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(30) NOT NULL,
	"profile_id" integer,
	"external_customer_id" varchar(255),
	"external_subscription_id" varchar(255),
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_findings_kind_check" CHECK ("idoc"."reconciliation_findings"."kind" in ('status_conflict', 'orphaned_subscription', 'repeated_failure', 'unlinked_customer'))
);
--> statement-breakpoint
CREATE TABLE "idoc"."reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	CONSTRAINT "reconciliation_runs_status_check" CHECK ("idoc"."reconciliation_runs"."status" in ('completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "idoc"."reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "idoc"."profiles"("id") ON DELETE no action ON UPDATE no action;
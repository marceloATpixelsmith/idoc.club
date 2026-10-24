CREATE TABLE IF NOT EXISTS "idoc"."cron_job_runs" (
	"job" varchar(60) NOT NULL,
	"source" varchar(10) NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_status" integer NOT NULL,
	"last_success_at" timestamp with time zone,
	"runs_total" integer DEFAULT 0 NOT NULL,
	"failures_total" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cron_job_runs_job_source_pk" PRIMARY KEY("job","source"),
	CONSTRAINT "cron_job_runs_source_check" CHECK ("idoc"."cron_job_runs"."source" IN ('vercel', 'qstash'))
);

CREATE TABLE IF NOT EXISTS "idoc"."maintenance_mode" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reason" varchar(200),
	"changed_by_user_id" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_mode_singleton_check" CHECK ("idoc"."maintenance_mode"."id" = 1)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idoc"."maintenance_mode" ADD CONSTRAINT "maintenance_mode_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "idoc"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "idoc"."maintenance_mode" ("id", "enabled") VALUES (1, false) ON CONFLICT ("id") DO NOTHING;

CREATE SCHEMA IF NOT EXISTS "idoc";
--> statement-breakpoint
ALTER TABLE "public"."activity_logs" SET SCHEMA "idoc";
--> statement-breakpoint
ALTER TABLE "public"."invitations" SET SCHEMA "idoc";
--> statement-breakpoint
ALTER TABLE "public"."team_members" SET SCHEMA "idoc";
--> statement-breakpoint
ALTER TABLE "public"."teams" SET SCHEMA "idoc";
--> statement-breakpoint
ALTER TABLE "public"."users" SET SCHEMA "idoc";

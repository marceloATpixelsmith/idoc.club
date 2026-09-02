ALTER TABLE "idoc"."users" ADD COLUMN "email_display" varchar(255);
--> statement-breakpoint
ALTER TABLE "idoc"."email_verification_tokens" ADD COLUMN "pending_email_display" varchar(255);
--> statement-breakpoint
UPDATE "idoc"."users" SET "email_display" = "email" WHERE "email_display" IS NULL;

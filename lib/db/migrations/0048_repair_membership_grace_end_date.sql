ALTER TABLE "idoc"."memberships" ADD COLUMN IF NOT EXISTS "grace_ends_on" date;
--> statement-breakpoint
UPDATE "idoc"."memberships" SET "grace_ends_on" = "valid_until" WHERE "status" = 'grace' AND "grace_ends_on" IS NULL;

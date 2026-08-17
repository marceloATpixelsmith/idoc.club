ALTER TABLE "idoc"."professional_roles" ADD COLUMN "official_statuses" varchar(120)[];--> statement-breakpoint
UPDATE "idoc"."professional_roles" SET "official_statuses" = ARRAY["official_status"] WHERE "official_status" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "idoc"."professional_roles" DROP COLUMN "official_status";
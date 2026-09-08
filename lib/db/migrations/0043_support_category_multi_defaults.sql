ALTER TABLE "idoc"."support_category_defaults" DROP CONSTRAINT "support_category_defaults_pkey";
--> statement-breakpoint
ALTER TABLE "idoc"."support_category_defaults" ADD CONSTRAINT "support_category_defaults_category_administrator_user_id_pk" PRIMARY KEY ("category","administrator_user_id");
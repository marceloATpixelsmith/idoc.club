ALTER TABLE "idoc"."support_conversations"
  DROP CONSTRAINT IF EXISTS "support_conversations_category_check";
--> statement-breakpoint
ALTER TABLE "idoc"."support_conversations"
  ADD CONSTRAINT "support_conversations_category_check"
  CHECK ("category" in ('billing_membership', 'seminars', 'technical_support', 'other'));
--> statement-breakpoint
ALTER TABLE "idoc"."support_category_defaults"
  DROP CONSTRAINT IF EXISTS "support_category_defaults_category_check";
--> statement-breakpoint
ALTER TABLE "idoc"."support_category_defaults"
  ADD CONSTRAINT "support_category_defaults_category_check"
  CHECK ("category" in ('billing_membership', 'seminars', 'technical_support', 'other'));

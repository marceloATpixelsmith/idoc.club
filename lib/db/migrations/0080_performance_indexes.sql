CREATE INDEX IF NOT EXISTS "memberships_profile_latest_idx" ON "idoc"."memberships" USING btree ("profile_id","valid_until" DESC NULLS FIRST,"id" DESC NULLS FIRST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professional_roles_current_profile_idx" ON "idoc"."professional_roles" USING btree ("profile_id") WHERE "idoc"."professional_roles"."effective_to" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_profile_paid_at_idx" ON "idoc"."payments" USING btree ("profile_id","paid_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_paid_at_idx" ON "idoc"."payments" USING btree ("paid_at");

ALTER TABLE "idoc"."users" ADD CONSTRAINT "users_account_state_check" CHECK ("idoc"."users"."account_state" IN ('unverified', 'onboarding', 'active', 'suspended', 'migrated_pending', 'deleted'));

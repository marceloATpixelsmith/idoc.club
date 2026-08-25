ALTER TABLE "idoc"."mfa_challenge_transactions" DROP CONSTRAINT "mfa_challenge_purpose_check";
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_challenge_transactions" ADD CONSTRAINT "mfa_challenge_purpose_check" CHECK ("idoc"."mfa_challenge_transactions"."purpose" in ('login', 'password-reset', 'step-up'));

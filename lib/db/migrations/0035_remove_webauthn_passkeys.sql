-- Passkey/WebAuthn support has been removed from the application (Google sign-in + TOTP
-- authenticator only). Delete any existing WebAuthn factor rows first (this cascades to their
-- webauthn_credentials rows via that table's ON DELETE CASCADE) so the tightened constraints below
-- don't fail against real, still-active data.
DELETE FROM "idoc"."mfa_factors" WHERE "factor_type" = 'webauthn';
--> statement-breakpoint
DROP TABLE "idoc"."webauthn_credentials";
--> statement-breakpoint
DROP TABLE "idoc"."webauthn_ceremony_challenges";
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" DROP CONSTRAINT "mfa_factors_totp_secret_check";
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ALTER COLUMN "encrypted_secret" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ALTER COLUMN "encryption_key_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" DROP CONSTRAINT "mfa_factors_type_check";
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ADD CONSTRAINT "mfa_factors_type_check" CHECK ("idoc"."mfa_factors"."factor_type" in ('totp'));

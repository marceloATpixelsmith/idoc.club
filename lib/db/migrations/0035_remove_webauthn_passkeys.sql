-- Passkey/WebAuthn support has been removed from the application (Google sign-in + TOTP
-- authenticator only). mfa_challenge_transactions.satisfied_factor_id references mfa_factors with
-- no ON DELETE action, so on any database where a passkey ever actually completed a login or
-- step-up challenge, deleting its factor row below would otherwise fail the whole migration with a
-- foreign-key violation. Null out just those historical references first -- the challenge
-- transaction row itself is still valid history, it simply no longer names which factor satisfied
-- it, matching how an expired/never-satisfied challenge already looks.
UPDATE "idoc"."mfa_challenge_transactions" SET "satisfied_factor_id" = NULL
  WHERE "satisfied_factor_id" IN (SELECT "factor_id" FROM "idoc"."mfa_factors" WHERE "factor_type" = 'webauthn');
--> statement-breakpoint
-- Delete any existing WebAuthn factor rows (this cascades to their webauthn_credentials rows via
-- that table's ON DELETE CASCADE) so the tightened constraints below don't fail against real,
-- still-active data.
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

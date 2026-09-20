ALTER TABLE "idoc"."users" ADD COLUMN "password_set_at" timestamp;
--> statement-breakpoint
-- Backfill: every existing account keeps its current password_hash/created_at meaning "has a real
-- password" (password_set_at = created_at) EXCEPT an account whose only credential is the unusable
-- random value google-account.ts assigns at Google-only signup -- identified as a linked Google
-- identity created within a minute of the account itself (i.e. the identity that created the
-- account, not one linked later to an existing password account) with no subsequent evidence the
-- member ever set a real password (no google-link audit row, since that requires password
-- verification, and no password-change/reset audit row).
UPDATE "idoc"."users" u
SET "password_set_at" = u."created_at"
WHERE u."password_set_at" IS NULL
  AND NOT (
    EXISTS (
      SELECT 1 FROM "idoc"."external_identities" ei
      WHERE ei."user_id" = u."id" AND ei."provider" = 'google' AND ei."created_at" <= u."created_at" + interval '1 minute'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "idoc"."audit_log" al
      WHERE al."actor_id" = u."id"
        AND al."action" IN ('auth.google_identity.linked', 'account.password.changed', 'account.password_reset.completed')
    )
  );

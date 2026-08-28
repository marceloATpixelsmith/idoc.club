ALTER TABLE "idoc"."auth_security_notification_outbox" DROP CONSTRAINT "auth_security_notification_kind_check";
--> statement-breakpoint
ALTER TABLE "idoc"."auth_security_notification_outbox" ADD CONSTRAINT "auth_security_notification_kind_check" CHECK ("idoc"."auth_security_notification_outbox"."kind" IN (
  'google_identity_linked', 'google_identity_unlinked', 'password_changed',
  'password_reset_completed', 'verified_email_changed', 'authenticator_enrolled',
  'authenticator_replaced', 'recovery_code_used', 'role_granted', 'role_revoked',
  'other_sessions_revoked', 'new_sign_in'
));

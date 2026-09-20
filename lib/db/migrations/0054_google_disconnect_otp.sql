ALTER TABLE "idoc"."email_otp_codes" DROP CONSTRAINT "email_otp_codes_purpose_check";
--> statement-breakpoint
ALTER TABLE "idoc"."email_otp_codes" ADD CONSTRAINT "email_otp_codes_purpose_check" CHECK ("idoc"."email_otp_codes"."purpose" in ('signup_verification', 'login_verification', 'password_reset', 'google_disconnect_verification'));

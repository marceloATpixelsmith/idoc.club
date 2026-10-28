-- Keep account-security codes isolated from sign-in, password-reset and Google-disconnect codes.
alter table idoc.email_otp_codes drop constraint email_otp_codes_purpose_check;
--> statement-breakpoint
alter table idoc.email_otp_codes add constraint email_otp_codes_purpose_check
  check (purpose in ('signup_verification', 'login_verification', 'password_reset', 'google_disconnect_verification', 'member_password_change', 'member_session_revoke'));

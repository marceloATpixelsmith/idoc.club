\set ON_ERROR_STOP on
SELECT :'confirm' = 'SANITIZE_IDOC_STAGING' AS schema_isolation_confirmed \gset
\if :schema_isolation_confirmed
\else
  \echo 'Refusing staging sanitization without confirm=SANITIZE_IDOC_STAGING'
  \quit
\endif

BEGIN;

DO $$
BEGIN
  IF to_regnamespace('idoc_staging') IS NULL THEN
    RAISE EXCEPTION 'idoc_staging does not exist';
  END IF;
  IF current_schema() = 'idoc_production' THEN
    RAISE EXCEPTION 'Refusing to sanitize production schema';
  END IF;
END $$;

SET LOCAL search_path TO idoc_staging, pg_catalog;

UPDATE users SET session_version=session_version+1, updated_at=now();
UPDATE auth_sessions
SET revoked_at=coalesce(revoked_at,now()), revoke_reason=coalesce(revoke_reason,'staging_schema_clone'), updated_at=now()
WHERE revoked_at IS NULL;

UPDATE email_verification_tokens SET consumed_at=coalesce(consumed_at,now()) WHERE consumed_at IS NULL;
UPDATE account_tokens SET consumed_at=coalesce(consumed_at,now()) WHERE consumed_at IS NULL;
UPDATE email_otp_codes SET consumed_at=coalesce(consumed_at,now()) WHERE consumed_at IS NULL;
UPDATE google_oauth_transactions SET consumed_at=coalesce(consumed_at,now()) WHERE consumed_at IS NULL;
UPDATE mfa_enrollment_transactions SET consumed_at=coalesce(consumed_at,now()) WHERE consumed_at IS NULL;
UPDATE mfa_challenge_transactions SET consumed_at=coalesce(consumed_at,now()) WHERE consumed_at IS NULL;
UPDATE mfa_remembered_devices
SET revoked_at=coalesce(revoked_at,now()), revoke_reason=coalesce(revoke_reason,'staging_schema_clone')
WHERE revoked_at IS NULL;
UPDATE login_trusted_devices
SET revoked_at=coalesce(revoked_at,now()), revoke_reason=coalesce(revoke_reason,'staging_schema_clone')
WHERE revoked_at IS NULL;

UPDATE notification_outbox
SET dead_lettered_at=coalesce(dead_lettered_at,now()), last_error_code='staging_schema_clone',
    lease_owner=null, lease_expires_at=null
WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
UPDATE account_delivery_outbox
SET dead_lettered_at=coalesce(dead_lettered_at,now()), last_error_code='staging_schema_clone',
    lease_owner=null, lease_expires_at=null, terminal_at=coalesce(terminal_at,now()),
    terminal_reason=coalesce(terminal_reason,'staging_schema_clone')
WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
UPDATE auth_security_notification_outbox
SET dead_lettered_at=coalesce(dead_lettered_at,now()), last_error_code='staging_schema_clone',
    lease_owner=null, lease_expires_at=null
WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
UPDATE operational_alert_outbox
SET dead_lettered_at=coalesce(dead_lettered_at,now()), last_error_code='staging_schema_clone',
    lease_owner=null, lease_expires_at=null
WHERE sent_at IS NULL AND dead_lettered_at IS NULL;

UPDATE membership_checkout_sessions
SET status='expired', updated_at=now()
WHERE status IN ('creating','open');
UPDATE seminar_registrations
SET checkout_status='expired', updated_at=now()
WHERE checkout_status='open';

COMMIT;

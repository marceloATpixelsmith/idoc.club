-- ============================================================================
-- Staging-only HARD DELETE of one user (by email) and everything tied to them.
-- Paste into Beekeeper Studio (connected to the Render database), edit the two
-- values in the CONFIG block below, and run the whole file ("Run All").
--
-- Why this exists: scripts/e2e-delete-test-account.sql only *neutralizes* the account
-- (the users row stays, with a mangled email) because audit_log / profile_change_history /
-- support_messages are immutable. This script uses the same transaction-local switch as the
-- app's own "Permanently delete" action (lib/admin/member-lifecycle.ts deleteMembers ->
-- idoc.allow_member_permanent_delete, migration 0066), and additionally disables the
-- audit_log immutability trigger inside this one transaction so the user's audit trail goes too.
-- After it runs, the email can be signed up again from scratch.
--
-- Removes: users row (and any earlier soft-deleted "<email>-<id>-deleted" leftovers), profile,
-- application roles, sessions, MFA factors/recovery codes/challenges/remembered devices, trusted
-- devices, Google identity links, tokens, OTP codes, delivery/notification outboxes, memberships,
-- subscriptions, payments, refunds, seminar registrations (including guest registrations made
-- with the email), consents, support conversations/messages, activity logs, table preferences,
-- invitations, profile change history, and audit_log rows by/about the user or mentioning the
-- email.
--
-- Safety:
--  * Touches ONLY schema idoc_staging. It never reads or writes idoc_production.
--  * One transaction: any error (including a foreign key it did not know about) rolls back
--    everything, trigger change included.
--  * Refuses administrator/super_admin accounts unless v_allow_admin is true, accounts that
--    authored news/seminars/pages, and accounts with live Stripe-side subscriptions unless
--    v_allow_active_subscription is true (this only removes the DB rows; cancel in Stripe test mode
--    separately if you care).
--  * v_dry_run := true performs the full delete, prints the per-table counts in an error message,
--    then deliberately rolls back so nothing is committed.
--  * Needs a role that owns idoc_staging.audit_log (the schema-owner connection used for
--    migrations). With an app login (idoc_staging_app) set v_purge_audit_log := false.
--  * Not touched: account_request_limits (rate limits keyed by one-way hashes of the identifier).
--    If sign-up/reset is throttled right after repeated tests, wait for the window to expire.
-- ============================================================================

DO $$
DECLARE
  -- ===== CONFIG =====================================================================
  v_email                     text    := 'someone@example.com';  -- <- the email to wipe
  v_dry_run                   boolean := false;  -- true = run everything, report, then roll back
  v_allow_admin               boolean := false;  -- true = allow administrator/super_admin accounts
  v_allow_active_subscription boolean := false;
  v_purge_audit_log           boolean := true;   -- false if you are not the audit_log table owner
  -- ==================================================================================

  v_uids   int[];
  v_pids   int[];
  v_regs   int[];
  v_pays   int[];
  v_convs  int[];
  v_n      bigint;
  v_counts jsonb := '{}'::jsonb;
  v_report text;
  v_blocker text;
  v_audit_trigger_disabled boolean := false;
BEGIN
  IF to_regnamespace('idoc_staging') IS NULL THEN
    RAISE EXCEPTION 'Schema idoc_staging does not exist on this connection; refusing to run.';
  END IF;
  IF coalesce(btrim(v_email), '') = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' OR v_email = 'someone@example.com' THEN
    RAISE EXCEPTION 'Set v_email in the CONFIG block to a real email address first.';
  END IF;

  -- Every statement below is unqualified and resolves to idoc_staging only (no idoc_production,
  -- no public). SET LOCAL reverts automatically when the transaction ends.
  PERFORM set_config('search_path', 'idoc_staging, pg_catalog', true);
  -- App-sanctioned switch that lets the immutable history tables be deleted inside this transaction.
  PERFORM set_config('idoc.allow_member_permanent_delete', 'on', true);

  SELECT coalesce(array_agg(id), '{}') INTO v_uids FROM users
   WHERE lower(email) = lower(v_email)
      OR (lower(email) LIKE lower(v_email) || '-%-deleted' AND left(lower(email), length(v_email) + 1) = lower(v_email) || '-');
  IF coalesce(array_length(v_uids, 1), 0) = 0 THEN
    RAISE NOTICE 'No user found for % in idoc_staging; sweeping email-keyed leftovers only.', v_email;
  END IF;
  SELECT coalesce(array_agg(id), '{}') INTO v_pids FROM profiles WHERE user_id = ANY(v_uids);

  -- ---- Guards -----------------------------------------------------------------------
  IF NOT v_allow_admin AND EXISTS (
    SELECT 1 FROM application_roles WHERE user_id = ANY(v_uids) AND revoked_at IS NULL AND role IN ('administrator', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'This account holds an administrator/super_admin role. Set v_allow_admin := true to delete it anyway.';
  END IF;

  SELECT source INTO v_blocker FROM (
    SELECT 'news_articles' AS source FROM news_articles WHERE created_by_user_id = ANY(v_uids) OR updated_by_user_id = ANY(v_uids)
    UNION ALL SELECT 'seminars' FROM seminars WHERE created_by_user_id = ANY(v_uids) OR updated_by_user_id = ANY(v_uids)
    UNION ALL SELECT 'content_pages' FROM content_pages WHERE created_by_user_id = ANY(v_uids) OR updated_by_user_id = ANY(v_uids)
    UNION ALL SELECT 'content_page_revisions' FROM content_page_revisions WHERE created_by_user_id = ANY(v_uids)
    UNION ALL SELECT 'support_category_defaults' FROM support_category_defaults WHERE administrator_user_id = ANY(v_uids) OR updated_by = ANY(v_uids)
  ) b LIMIT 1;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'This account authored retained content (%). Delete or reassign that content first; refusing.', v_blocker;
  END IF;

  IF NOT v_allow_active_subscription AND EXISTS (
    SELECT 1 FROM subscriptions WHERE profile_id = ANY(v_pids) AND status IN ('active', 'trialing', 'past_due', 'incomplete')
  ) THEN
    RAISE EXCEPTION 'Account has an active billing subscription row. Set v_allow_active_subscription := true to delete it anyway.';
  END IF;

  -- The audit_log immutability trigger blocks DELETE even with the switch above; lift it for this
  -- transaction only (DDL is transactional in PostgreSQL, so a failure restores it automatically).
  IF v_purge_audit_log THEN
    ALTER TABLE idoc_staging.audit_log DISABLE TRIGGER audit_log_immutable;
    v_audit_trigger_disabled := true;
  END IF;

  -- ---- Collect ids ----------------------------------------------------------------------
  SELECT coalesce(array_agg(id), '{}') INTO v_regs FROM seminar_registrations
   WHERE profile_id = ANY(v_pids) OR lower(guest_email) = lower(v_email);
  SELECT coalesce(array_agg(id), '{}') INTO v_pays FROM payments WHERE profile_id = ANY(v_pids);
  SELECT coalesce(array_agg(id), '{}') INTO v_convs FROM support_conversations WHERE member_user_id = ANY(v_uids);

  -- ---- Billing / seminars -----------------------------------------------------------------
  DELETE FROM payment_refunds WHERE seminar_registration_id = ANY(v_regs) OR membership_payment_id = ANY(v_pays);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('payment_refunds', v_n);
  DELETE FROM seminar_registrations WHERE id = ANY(v_regs);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('seminar_registrations', v_n);
  DELETE FROM notification_outbox WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notification_outbox', v_n);
  DELETE FROM reconciliation_findings WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reconciliation_findings', v_n);
  DELETE FROM payments WHERE id = ANY(v_pays);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('payments', v_n);
  DELETE FROM subscriptions WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('subscriptions', v_n);
  DELETE FROM membership_checkout_sessions WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('membership_checkout_sessions', v_n);
  DELETE FROM renewal_preferences WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('renewal_preferences', v_n);
  DELETE FROM billing_accounts WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('billing_accounts', v_n);
  DELETE FROM memberships WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('memberships', v_n);

  -- ---- Profile ------------------------------------------------------------------------------
  DELETE FROM profile_change_history WHERE profile_id = ANY(v_pids) OR actor_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('profile_change_history', v_n);
  DELETE FROM professional_roles WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('professional_roles', v_n);
  DELETE FROM onboarding_consents WHERE profile_id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('onboarding_consents', v_n);
  DELETE FROM profiles WHERE id = ANY(v_pids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('profiles', v_n);

  -- ---- Support inbox ------------------------------------------------------------------------
  UPDATE support_conversations SET assigned_admin_user_id = NULL WHERE assigned_admin_user_id = ANY(v_uids);
  UPDATE support_conversation_administrators SET assigned_by_user_id = NULL WHERE assigned_by_user_id = ANY(v_uids);
  DELETE FROM support_administrator_read_cursors WHERE conversation_id = ANY(v_convs) OR administrator_user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('support_administrator_read_cursors', v_n);
  DELETE FROM support_conversation_administrators WHERE conversation_id = ANY(v_convs) OR administrator_user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('support_conversation_administrators', v_n);
  DELETE FROM support_messages WHERE conversation_id = ANY(v_convs) OR author_user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('support_messages', v_n);
  DELETE FROM support_conversations WHERE id = ANY(v_convs);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('support_conversations', v_n);

  -- ---- Auth / MFA / sessions ------------------------------------------------------------------
  DELETE FROM auth_sessions WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('auth_sessions', v_n);
  DELETE FROM mfa_enrollment_transactions WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_enrollment_transactions', v_n);
  DELETE FROM mfa_challenge_transactions WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_challenge_transactions', v_n);
  DELETE FROM mfa_recovery_codes WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_recovery_codes', v_n);
  DELETE FROM mfa_remembered_devices WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_remembered_devices', v_n);
  DELETE FROM mfa_factors WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_factors', v_n);
  DELETE FROM login_trusted_devices WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('login_trusted_devices', v_n);
  DELETE FROM google_oauth_transactions WHERE authenticated_user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('google_oauth_transactions', v_n);
  DELETE FROM external_identities WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('external_identities', v_n);
  DELETE FROM auth_security_notification_outbox WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('auth_security_notification_outbox', v_n);
  DELETE FROM account_delivery_outbox WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_delivery_outbox', v_n);
  DELETE FROM account_tokens WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_tokens', v_n);
  DELETE FROM email_verification_tokens WHERE user_id = ANY(v_uids) OR lower(pending_email) = lower(v_email);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_verification_tokens', v_n);
  DELETE FROM email_otp_codes WHERE user_id = ANY(v_uids) OR lower(email) = lower(v_email);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_otp_codes', v_n);
  DELETE FROM administrator_table_preferences WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('administrator_table_preferences', v_n);

  -- ---- Roles / teams / logs ----------------------------------------------------------------------
  UPDATE application_roles SET granted_by = NULL WHERE granted_by = ANY(v_uids);
  UPDATE professional_roles SET verified_by = NULL WHERE verified_by = ANY(v_uids);
  UPDATE migration_map SET reviewed_by = NULL WHERE reviewed_by = ANY(v_uids);
  UPDATE payments SET administrator_id = NULL WHERE administrator_id = ANY(v_uids);
  UPDATE payment_refunds SET administrator_id = NULL WHERE administrator_id = ANY(v_uids);
  UPDATE seminar_registrations SET marked_paid_by_user_id = NULL WHERE marked_paid_by_user_id = ANY(v_uids);
  DELETE FROM application_roles WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('application_roles', v_n);
  DELETE FROM team_members WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_members', v_n);
  DELETE FROM invitations WHERE invited_by = ANY(v_uids) OR lower(email) = lower(v_email);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('invitations', v_n);
  DELETE FROM activity_logs WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('activity_logs', v_n);

  IF v_purge_audit_log THEN
    DELETE FROM audit_log
     WHERE actor_id = ANY(v_uids)
        OR (entity_type = 'user' AND entity_id = ANY(SELECT x::text FROM unnest(v_uids) x))
        OR (entity_type = 'profile' AND entity_id = ANY(SELECT x::text FROM unnest(v_pids) x))
        OR position(lower(v_email) IN lower(coalesce(before_json::text, ''))) > 0
        OR position(lower(v_email) IN lower(coalesce(after_json::text, ''))) > 0
        OR position(lower(v_email) IN lower(coalesce(reason, ''))) > 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('audit_log', v_n);
  END IF;

  -- ---- Friendly check: anything still pointing at the user/profile? -------------------------------
  SELECT string_agg(format('%s.%s (%s rows)', c.conrelid::regclass, a.attname, cnt.n), ', ')
    INTO v_blocker
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    CROSS JOIN LATERAL (
      SELECT (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM %s WHERE %I = ANY(%L::int[])', c.conrelid::regclass, a.attname,
               CASE WHEN c.confrelid = 'idoc_staging.users'::regclass THEN v_uids::text ELSE v_pids::text END),
        false, true, '')))[1]::text::bigint AS n
    ) cnt
   WHERE c.contype = 'f'
     AND c.confrelid IN ('idoc_staging.users'::regclass, 'idoc_staging.profiles'::regclass)
     AND c.confdeltype IN ('a', 'r')          -- NO ACTION / RESTRICT would block the delete
     AND cnt.n > 0;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'Still referenced by: %. Nothing was deleted (transaction rolled back).', v_blocker;
  END IF;

  -- ---- The user row itself (remaining cascade/set-null FKs resolve here) ----------------------------
  DELETE FROM users WHERE id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('users', v_n);

  IF v_audit_trigger_disabled THEN
    ALTER TABLE idoc_staging.audit_log ENABLE TRIGGER audit_log_immutable;
  END IF;

  SELECT coalesce(string_agg(format('  %-40s %s', key, value), E'\n' ORDER BY key), '  (nothing found)')
    INTO v_report FROM jsonb_each_text(v_counts) WHERE value::bigint > 0;

  IF v_dry_run THEN
    RAISE EXCEPTION E'DRY RUN for % -- rolled back, nothing was deleted. Rows that WOULD be deleted:\n%', v_email, v_report;
  END IF;
  RAISE NOTICE E'Deleted % from idoc_staging. Rows removed:\n%', v_email, v_report;
END
$$;

-- Verification: every count should be 0 after a real run (this is the result Beekeeper shows).
SELECT
  (SELECT count(*) FROM idoc_staging.users WHERE lower(email) = lower('someone@example.com')) AS users,
  (SELECT count(*) FROM idoc_staging.email_otp_codes WHERE lower(email) = lower('someone@example.com')) AS otp_codes,
  (SELECT count(*) FROM idoc_staging.invitations WHERE lower(email) = lower('someone@example.com')) AS invitations,
  (SELECT count(*) FROM idoc_staging.seminar_registrations WHERE lower(guest_email) = lower('someone@example.com')) AS guest_registrations,
  (SELECT count(*) FROM idoc_staging.audit_log WHERE position(lower('someone@example.com') IN lower(coalesce(before_json::text, '') || coalesce(after_json::text, '') || coalesce(reason, ''))) > 0) AS audit_log_mentions;
-- ^ also replace the email in this SELECT with the one you used above.

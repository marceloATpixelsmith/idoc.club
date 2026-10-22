-- ============================================================================
-- Staging-only BULK reset of member data, to re-run the temporary legacy import from a clean slate.
-- Paste into Beekeeper Studio (connected to the Render database), edit the CONFIG block, and
-- run the whole file ("Run All"). Bulk sibling of scripts/staging-hard-delete-user.sql (one email);
-- it deletes the same families of rows, using the same transaction-local switches.
--
-- Scope (v_scope):
--   'all_members'    every user who holds no active administrator/super_admin role (default).
--   'imported_only'  only users the legacy import created (migration_map legacy_type 'wp_user').
-- Administrators and Super Admins are always kept so you can still sign in and run the import,
-- and so is anyone who authored retained news, seminars, pages or support defaults.
-- migration_map 'wp_user' rows are always removed: the importer skips every legacy ID it finds there.
-- Not touched: account_request_limits (rate limits keyed by one-way hashes), stripe_events,
-- reconciliation_runs, and guest seminar registrations with no profile.
--
-- Safety:
--  * Touches ONLY schema idoc_staging. It never reads or writes idoc_production.
--  * One transaction: any error (including a foreign key it did not know about) rolls back
--    everything, trigger change included.
--  * v_dry_run defaults to true: it performs the full delete, prints per-table counts in an error
--    message, then deliberately rolls back. Review the counts, then set v_dry_run := false.
--  * A real run also needs v_confirm set to the exact phrase below.
--  * Needs a role that owns idoc_staging.audit_log (the schema-owner connection used for
--    migrations). With an app login (idoc_staging_app) set v_purge_audit_log := false.
--  * Take or confirm a recent backup first (docs/16). Stripe is never contacted; the import
--    only reads from Stripe, so no Stripe test data needs cleaning up.
-- ============================================================================

DO $$
DECLARE
  -- ===== CONFIG =====================================================================
  v_scope           text    := 'all_members';  -- 'all_members' | 'imported_only'
  v_dry_run         boolean := true;           -- true = run everything, report, then roll back
  v_confirm         text    := '';             -- real run: 'DELETE STAGING MEMBERS'
  v_purge_audit_log boolean := true;           -- false if you are not the audit_log table owner
  -- ==================================================================================

  v_uids   int[];
  v_pids   int[];
  v_regs   int[];
  v_pays   int[];
  v_convs  int[];
  v_emails text[];
  v_n      bigint;
  v_counts jsonb := '{}'::jsonb;
  v_report text;
  v_blocker text;
  v_audit_trigger_disabled boolean := false;
BEGIN
  IF to_regnamespace('idoc_staging') IS NULL THEN
    RAISE EXCEPTION 'Schema idoc_staging does not exist on this connection; refusing to run.';
  END IF;
  IF v_scope NOT IN ('all_members', 'imported_only') THEN
    RAISE EXCEPTION 'v_scope must be all_members or imported_only.';
  END IF;
  IF NOT v_dry_run AND v_confirm <> 'DELETE STAGING MEMBERS' THEN
    RAISE EXCEPTION 'Set v_confirm := ''DELETE STAGING MEMBERS'' to run for real (or leave v_dry_run true).';
  END IF;

  -- Every statement below is unqualified and resolves to idoc_staging only (no idoc_production,
  -- no public). SET LOCAL reverts automatically when the transaction ends.
  PERFORM set_config('search_path', 'idoc_staging, pg_catalog', true);
  -- App-sanctioned switch that lets the immutable history tables be deleted inside this transaction.
  PERFORM set_config('idoc.allow_member_permanent_delete', 'on', true);

  -- ---- Which users --------------------------------------------------------------------------
  SELECT coalesce(array_agg(u.id), '{}') INTO v_uids FROM users u
   WHERE NOT EXISTS (SELECT 1 FROM application_roles r WHERE r.user_id = u.id AND r.revoked_at IS NULL AND r.role IN ('administrator', 'super_admin'))
     AND (v_scope = 'all_members' OR u.id IN (SELECT new_entity_id::int FROM migration_map WHERE legacy_type = 'wp_user'))
     AND NOT EXISTS (SELECT 1 FROM news_articles x WHERE x.created_by_user_id = u.id OR x.updated_by_user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM seminars x WHERE x.created_by_user_id = u.id OR x.updated_by_user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM content_pages x WHERE x.created_by_user_id = u.id OR x.updated_by_user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM content_page_revisions x WHERE x.created_by_user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM support_category_defaults x WHERE x.administrator_user_id = u.id OR x.updated_by = u.id);
  SELECT coalesce(array_agg(id), '{}') INTO v_pids FROM profiles WHERE user_id = ANY(v_uids);
  SELECT coalesce(array_agg(DISTINCT lower(email)), '{}') INTO v_emails FROM users WHERE id = ANY(v_uids);

  -- The audit_log immutability trigger blocks DELETE even with the switch above; lift it for this
  -- transaction only (DDL is transactional in PostgreSQL, so a failure restores it automatically).
  IF v_purge_audit_log THEN
    ALTER TABLE idoc_staging.audit_log DISABLE TRIGGER audit_log_immutable;
    v_audit_trigger_disabled := true;
  END IF;

  -- ---- Collect ids ----------------------------------------------------------------------
  SELECT coalesce(array_agg(id), '{}') INTO v_regs FROM seminar_registrations WHERE profile_id = ANY(v_pids);
  SELECT coalesce(array_agg(id), '{}') INTO v_pays FROM payments WHERE profile_id = ANY(v_pids);
  SELECT coalesce(array_agg(id), '{}') INTO v_convs FROM support_conversations WHERE member_user_id = ANY(v_uids);

  -- ---- Billing / seminars -----------------------------------------------------------------
  DELETE FROM payment_refunds WHERE seminar_registration_id = ANY(v_regs) OR membership_payment_id = ANY(v_pays);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('payment_refunds', v_n);
  DELETE FROM seminar_registrations WHERE id = ANY(v_regs);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('seminar_registrations', v_n);
  DELETE FROM notification_outbox
   WHERE profile_id = ANY(v_pids)
      OR lower(payload->>'to') = ANY(v_emails)
      OR (profile_id IS NULL AND payload->>'registrationId' = ANY(SELECT x::text FROM unnest(v_regs) x));
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
  DELETE FROM auth_security_notification_outbox WHERE user_id = ANY(v_uids) OR lower(recipient_email) = ANY(v_emails);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('auth_security_notification_outbox', v_n);
  DELETE FROM account_delivery_outbox WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_delivery_outbox', v_n);
  DELETE FROM account_tokens WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('account_tokens', v_n);
  DELETE FROM email_verification_tokens WHERE user_id = ANY(v_uids) OR lower(pending_email) = ANY(v_emails);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_verification_tokens', v_n);
  DELETE FROM email_otp_codes WHERE user_id = ANY(v_uids) OR lower(email) = ANY(v_emails);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_otp_codes', v_n);
  DELETE FROM administrator_table_preferences WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('administrator_table_preferences', v_n);

  -- ---- Roles / teams / logs ----------------------------------------------------------------------
  UPDATE application_roles SET granted_by = NULL WHERE granted_by = ANY(v_uids);
  UPDATE professional_roles SET verified_by = NULL WHERE verified_by = ANY(v_uids);
  UPDATE payments SET administrator_id = NULL WHERE administrator_id = ANY(v_uids);
  UPDATE payment_refunds SET administrator_id = NULL WHERE administrator_id = ANY(v_uids);
  UPDATE seminar_registrations SET marked_paid_by_user_id = NULL WHERE marked_paid_by_user_id = ANY(v_uids);
  DELETE FROM application_roles WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('application_roles', v_n);
  DELETE FROM team_members WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_members', v_n);
  DELETE FROM invitations WHERE invited_by = ANY(v_uids) OR lower(email) = ANY(v_emails);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('invitations', v_n);
  DELETE FROM activity_logs WHERE user_id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('activity_logs', v_n);

  IF v_purge_audit_log THEN
    DELETE FROM audit_log
     WHERE actor_id = ANY(v_uids)
        OR (entity_type = 'user' AND entity_id = ANY(SELECT x::text FROM unnest(v_uids) x))
        OR (entity_type = 'profile' AND entity_id = ANY(SELECT x::text FROM unnest(v_pids) x))
        OR (entity_type = 'seminar_registration' AND entity_id = ANY(SELECT x::text FROM unnest(v_regs) x))
        -- exact (whole-value, case-insensitive) email match on top-level JSON fields only; never substring
        OR (jsonb_typeof(before_json) = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(before_json) j WHERE lower(j.value) = ANY(v_emails)))
        OR (jsonb_typeof(after_json) = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(after_json) j WHERE lower(j.value) = ANY(v_emails)));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('audit_log', v_n);
  END IF;

  -- The importer treats every migration_map wp_user row as "already imported", so all of them go.
  DELETE FROM migration_map WHERE legacy_type = 'wp_user';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('migration_map', v_n);

  -- ---- Friendly check: anything still pointing at a user/profile being deleted? ---------------------
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

  -- ---- The user rows themselves (remaining cascade/set-null FKs resolve here) --------------------------
  DELETE FROM users WHERE id = ANY(v_uids);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('users', v_n);

  IF v_audit_trigger_disabled THEN
    ALTER TABLE idoc_staging.audit_log ENABLE TRIGGER audit_log_immutable;
  END IF;

  SELECT coalesce(string_agg(format('  %-40s %s', key, value), E'\n' ORDER BY key), '  (nothing found)')
    INTO v_report FROM jsonb_each_text(v_counts) WHERE value::bigint > 0;

  IF v_dry_run THEN
    RAISE EXCEPTION E'DRY RUN (scope %) -- rolled back, nothing was deleted. Rows that WOULD be deleted:\n%\n  (users kept as administrators, content authors or out of scope: %)', v_scope, v_report,
      (SELECT count(*) FROM users WHERE id <> ALL(v_uids));
  END IF;
  RAISE NOTICE E'Reset staging members (scope %). Rows removed:\n%', v_scope, v_report;
END
$$;

-- Verification after a real run: all zero, apart from rows owned by the administrators that were kept.
SELECT
  (SELECT count(*) FROM idoc_staging.migration_map WHERE legacy_type = 'wp_user') AS migration_map_wp_user,
  (SELECT count(*) FROM idoc_staging.profiles) AS profiles,
  (SELECT count(*) FROM idoc_staging.memberships) AS memberships,
  (SELECT count(*) FROM idoc_staging.payments) AS payments,
  (SELECT count(*) FROM idoc_staging.subscriptions) AS subscriptions,
  (SELECT count(*) FROM idoc_staging.users) AS users_remaining;

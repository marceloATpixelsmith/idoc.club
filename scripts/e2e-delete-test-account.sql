-- Cleanup script for disposable @pixelsmith.space test accounts created during a live IDOC auth
-- audit against staging. This is a plain-SQL mirror of scripts/e2e-delete-test-account.ts, for
-- hand-off to whoever has actual write access to staging -- the environment that runs the audit
-- (Claude Code's sandboxed session) cannot itself open a write connection to this database (raw
-- TCP egress is blocked, and Render's own MCP connector is read-only by design), so this script is
-- generated with the real values already filled in and handed back at the end of a passing run
-- instead of being executed directly. See "Privileged (administrator/super_admin) test identities"
-- in docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md.
--
-- Run with any Postgres client against the real staging database, e.g.:
--   psql "$STAGING_POSTGRES_URL" -f this-file.sql
-- or paste directly into Render's dashboard SQL console for the staging instance.
--
-- Does NOT fully delete the account row. migration 0002 installs BEFORE UPDATE OR DELETE triggers
-- on idoc.audit_log and idoc.profile_change_history that unconditionally reject any attempt to
-- change or remove a row (idoc.support_messages has the identical trigger from migration 0039).
-- Since audit_log.actor_id/profile_change_history.profile_id/support_messages.conversation_id all
-- reference their parent with no cascade, any account that generated even one audited action (real
-- signup, a profile edit, a login) can never have its users or profiles row physically deleted --
-- the foreign key blocks it exactly as intentionally designed. Instead this neutralizes the account
-- the same way the app's own self-service deleteOwnAccount() does (lib/membership/data-access.ts):
-- every genuinely deletable row (sessions, MFA factors/codes, role grants, tokens, memberships,
-- etc.) is removed outright, and the users row itself is soft-neutralized -- account_state set to
-- 'deleted', the login email permanently mangled -- rather than deleted. The immutable audit trail
-- this leaves behind never contains secrets by design (see the Evidence rules in the runbook), so
-- leaving it in place is not a leak; it is the same tradeoff every real account deletion in this
-- app already makes.
--
-- Strict scope, identical in spirit to the .ts version: only ever touches rows a listed account
-- actually owns. If an account is referenced on a row it does not own (authored real content,
-- recorded a real member's payment, etc.), that ONE account is skipped with a warning -- everything
-- else in the list still gets cleaned up, and the whole script never aborts because of one bad
-- account.
--
-- {{TARGET_EMAILS}} is replaced with a literal comma-separated SQL list of disposable test emails,
-- e.g.: 'live-auth-001@pixelsmith.space','live-auth-009-admin@pixelsmith.space'

\set ON_ERROR_STOP on

do $$
declare
  v_email text;
  v_uid int;
  v_profile_id int;
  v_foreign_count int;
  v_account_state text;
begin
  for v_email in select unnest(array[{{TARGET_EMAILS}}]) loop
    begin
      if v_email !~* '^[^@[:space:]]+@pixelsmith\.space$' then
        raise exception 'refusing: % is not a disposable @pixelsmith.space test address', v_email;
      end if;

      select id, account_state into v_uid, v_account_state from idoc.users where lower(email) = lower(v_email);
      if v_uid is null then
        raise notice 'no account found for %; nothing to clean up', v_email;
        continue;
      end if;
      if v_account_state = 'deleted' then
        raise notice '% (user_id=%) is already neutralized; nothing further to do', v_email, v_uid;
        continue;
      end if;

      select id into v_profile_id from idoc.profiles where user_id = v_uid;

      select (
        (select count(*) from idoc.news_articles where created_by_user_id = v_uid or updated_by_user_id = v_uid) +
        (select count(*) from idoc.content_pages where created_by_user_id = v_uid or updated_by_user_id = v_uid) +
        (select count(*) from idoc.content_page_revisions where created_by_user_id = v_uid) +
        (select count(*) from idoc.seminars where created_by_user_id = v_uid or updated_by_user_id = v_uid) +
        (select count(*) from idoc.payments where administrator_id = v_uid and (v_profile_id is null or profile_id <> v_profile_id)) +
        (select count(*) from idoc.payment_refunds where administrator_id = v_uid) +
        (select count(*) from idoc.professional_roles where verified_by = v_uid and (v_profile_id is null or profile_id <> v_profile_id)) +
        (select count(*) from idoc.migration_map where reviewed_by = v_uid) +
        (select count(*) from idoc.seminar_registrations where marked_paid_by_user_id = v_uid and (v_profile_id is null or profile_id <> v_profile_id)) +
        (select count(*) from idoc.support_conversations where assigned_admin_user_id = v_uid and member_user_id <> v_uid) +
        (select count(*) from idoc.support_conversation_administrators sca join idoc.support_conversations sc on sc.id = sca.conversation_id where (sca.administrator_user_id = v_uid or sca.assigned_by_user_id = v_uid) and sc.member_user_id <> v_uid) +
        (select count(*) from idoc.support_administrator_read_cursors src join idoc.support_conversations sc on sc.id = src.conversation_id where src.administrator_user_id = v_uid and sc.member_user_id <> v_uid) +
        (select count(*) from idoc.support_category_defaults where administrator_user_id = v_uid or updated_by = v_uid) +
        (select count(*) from idoc.support_messages sm join idoc.support_conversations sc on sc.id = sm.conversation_id where sm.author_user_id = v_uid and sc.member_user_id <> v_uid) +
        (select count(*) from idoc.profile_change_history where actor_id = v_uid and (v_profile_id is null or profile_id <> v_profile_id))
      ) into v_foreign_count;

      if v_foreign_count > 0 then
        raise exception '% (user_id=%) is referenced on at least one row it does not own (author, verifier, payment administrator, or support assignee for someone else); skipping -- clear that reference manually first', v_email, v_uid;
      end if;

      -- profile-scoped rows the account owns that are genuinely deletable (no immutability lock)
      if v_profile_id is not null then
        delete from idoc.seminar_registrations where profile_id = v_profile_id;
        delete from idoc.notification_outbox where profile_id = v_profile_id;
        delete from idoc.billing_accounts where profile_id = v_profile_id;
        delete from idoc.membership_checkout_sessions where profile_id = v_profile_id;
        delete from idoc.subscriptions where profile_id = v_profile_id;
        delete from idoc.renewal_preferences where profile_id = v_profile_id;
        delete from idoc.payments where profile_id = v_profile_id;
        delete from idoc.reconciliation_findings where profile_id = v_profile_id;
        delete from idoc.professional_roles where profile_id = v_profile_id;
        delete from idoc.memberships where profile_id = v_profile_id;
        -- profiles itself is not deleted: idoc.profile_change_history (immutable, migration 0002)
        -- references profile_id with no cascade, so the foreign key blocks it whenever any profile
        -- edit was ever recorded -- the same reason idoc.users below is neutralized, not deleted.
      end if;

      -- user-scoped rows the account owns, genuinely deletable (no immutability lock)
      delete from idoc.application_roles where user_id = v_uid;
      delete from idoc.email_verification_tokens where user_id = v_uid;
      delete from idoc.account_delivery_outbox where user_id = v_uid;
      delete from idoc.account_tokens where user_id = v_uid;
      delete from idoc.email_otp_codes where user_id = v_uid or (user_id is null and lower(email) = lower(v_email));
      delete from idoc.team_members where user_id = v_uid;
      delete from idoc.invitations where invited_by = v_uid;
      delete from idoc.activity_logs where user_id = v_uid;
      delete from idoc.auth_sessions where user_id = v_uid;
      delete from idoc.mfa_enrollment_transactions where user_id = v_uid;
      delete from idoc.mfa_challenge_transactions where user_id = v_uid;
      delete from idoc.mfa_recovery_codes where user_id = v_uid;
      delete from idoc.mfa_remembered_devices where user_id = v_uid;
      delete from idoc.mfa_factors where user_id = v_uid;
      delete from idoc.login_trusted_devices where user_id = v_uid;
      delete from idoc.administrator_table_preferences where user_id = v_uid;
      -- audit_log (own actions) is not deleted: immutable by design (migration 0002). It never
      -- contains secrets, so leaving it is not a leak -- see the runbook's evidence rules.

      -- neutralize the account itself, exactly like the app's own self-service
      -- lib/membership/data-access.ts deleteOwnAccount(): permanently block login and free the
      -- email for reuse, rather than physically deleting a row idoc.audit_log still references.
      update idoc.users set
        account_state = 'deleted',
        deleted_at = now(),
        email_display = concat(email, '-', id, '-deleted'),
        email = concat(email, '-', id, '-deleted'),
        updated_at = now()
      where id = v_uid;
      insert into idoc.audit_log (actor_id, action, entity_type, entity_id, reason)
      values (v_uid, 'account.deleted', 'user', v_uid::text, 'Automated disposable test-account cleanup for the live auth audit; see docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md.');

      raise notice 'cleaned up % (user_id=%): removed every genuinely deletable row it owned and neutralized the account (immutable audit/profile-history rows and the profile row itself remain, as the schema requires)', v_email, v_uid;
    exception when others then
      raise warning 'skipped %: %', v_email, sqlerrm;
    end;
  end loop;
end $$;

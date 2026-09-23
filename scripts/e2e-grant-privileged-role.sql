-- Grants an administrator/super_admin role to a disposable @pixelsmith.space test account already
-- signed up through the live app, for LIVE-AUTH cases that require a privileged identity
-- (009-013, 017, 026, 033 in tests/auth/auth-test-matrix.json). This is a plain-SQL mirror of
-- scripts/e2e-grant-privileged-role.ts, for hand-off to whoever has actual write access to staging
-- -- the environment that runs the audit (Claude Code's sandboxed session) cannot itself open a
-- write connection to this database (raw TCP egress is blocked, and Render's own MCP connector is
-- read-only by design), so this script is generated with the real values already filled in and
-- handed back for the operator to run instead of being executed directly. See "Privileged
-- (administrator/super_admin) test identities" in docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md.
--
-- This intentionally does not create the account -- run the real signup flow first (LIVE-AUTH-001)
-- so account state, verification, and TOTP enrollment stay genuinely live-tested. This script only
-- performs the one step that has no self-service path.
--
-- Run with any Postgres client against the real staging database, e.g.:
--   psql "$STAGING_POSTGRES_URL" -f this-file.sql
-- or paste directly into Render's dashboard SQL console for the staging instance.
--
-- {{TARGET_EMAIL}} the disposable test account's email ('name@pixelsmith.space')
-- {{TARGET_ROLE}} 'administrator' or 'super_admin'
-- {{GRANTED_BY_USER_ID}} the real Super Admin user id performing this grant (an integer literal)

\set ON_ERROR_STOP on

do $$
declare
  v_email text := {{TARGET_EMAIL}};
  v_role text := {{TARGET_ROLE}};
  v_granted_by int := {{GRANTED_BY_USER_ID}};
  v_uid int;
  v_account_state text;
  v_granter_ok boolean;
  v_existing int;
  v_new_role_id int;
begin
  if v_email !~* '^[^@[:space:]]+@pixelsmith\.space$' then
    raise exception 'refusing: % is not a disposable @pixelsmith.space test address', v_email;
  end if;
  if v_role not in ('administrator', 'super_admin') then
    raise exception 'target role must be administrator or super_admin, got %', v_role;
  end if;

  select id, account_state into v_uid, v_account_state from idoc.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'no account found for %; complete a real signup through the live app first (LIVE-AUTH-001)', v_email;
  end if;
  if v_account_state <> 'active' then
    raise exception 'account for % is in state "%", not active; complete onboarding/verification through the live app first', v_email, v_account_state;
  end if;

  select exists(
    select 1 from idoc.application_roles
    where user_id = v_granted_by and role = 'super_admin' and revoked_at is null
  ) into v_granter_ok;
  if not v_granter_ok then
    raise exception 'granted_by user id % does not hold an active super_admin grant; role grants are super-admin-only', v_granted_by;
  end if;

  select id into v_existing from idoc.application_roles where user_id = v_uid and role = v_role and revoked_at is null;
  if v_existing is not null then
    raise notice '% already holds an active "%" grant (application_roles.id=%); nothing to do', v_email, v_role, v_existing;
    return;
  end if;

  insert into idoc.application_roles (user_id, role, granted_by)
  values (v_uid, v_role, v_granted_by)
  returning id into v_new_role_id;

  -- mirrors lib/membership/role-grants.ts's grantApplicationRole: a privilege grant must not take
  -- effect inside an already-issued lower-assurance session (the one from the real signup login in
  -- LIVE-AUTH-001). Incrementing session_version invalidates every existing session for this user.
  update idoc.users set session_version = session_version + 1, updated_at = now() where id = v_uid;

  insert into idoc.audit_log (actor_id, action, entity_type, entity_id, after_json, reason)
  values (
    v_granted_by,
    'e2e_test_role_grant',
    'application_role',
    v_new_role_id::text,
    jsonb_build_object('role', v_role, 'userId', v_uid, 'email', v_email),
    'Automated disposable test-account provisioning for the live auth audit; see docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md. Torn down by scripts/e2e-delete-test-account.sql at the end of the run.'
  );

  raise notice 'granted "%" to % (user_id=%, application_roles.id=%)', v_role, v_email, v_uid, v_new_role_id;
end $$;

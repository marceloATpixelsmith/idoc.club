import postgres from 'postgres';
import { arg, hasFlag, requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

// Operator tooling for LIVE-AUTH cases that require a privileged (administrator/super_admin)
// identity on the live staging deployment (009-013, 017, 026, 033 in tests/auth/auth-test-matrix.json).
// IDOC has no self-service role elevation by design (docs/07-administrator-and-operations-runbook.md:
// "Organization Settings ... are Super-Admin-only"), so a disposable test account that has completed
// a REAL signup through the live app still needs its role granted out of band before the MFA/role
// live cases can run.
//
// This intentionally does not create the account -- run the real signup flow first (LIVE-AUTH-001)
// so the account state, TOTP enrollment, and everything else stay genuine and live-tested. This
// script only performs the one step that has no self-service path.
//
// Usage: node --conditions=react-server --import tsx scripts/e2e-grant-privileged-role.ts \
//   --email=<name>@pixelsmith.space --role=administrator --granted-by=<real-super-admin-user-id> --confirm-staging

async function main() {
  const email = requireDisposableTestEmail(arg('email'));
  const role = arg('role');
  if (role !== 'administrator' && role !== 'super_admin') {
    throw new Error('--role must be "administrator" or "super_admin".');
  }
  const grantedByArg = arg('granted-by');
  const grantedBy = grantedByArg === undefined ? NaN : Number(grantedByArg);
  if (!Number.isSafeInteger(grantedBy) || grantedBy < 1) {
    throw new Error('--granted-by=<user id> is required: the real Super Admin account performing this grant, for an accountable audit trail.');
  }

  const stagingUrl = validateStagingDatabaseUrl(
    process.env.STAGING_POSTGRES_URL,
    hasFlag('confirm-staging'),
  ).toString();

  const sql = postgres(stagingUrl, { max: 1, onnotice: () => {} });
  try {
    const [user] = await sql<{ id: number; account_state: string }[]>`
      select id, account_state from idoc.users where lower(email) = lower(${email})`;
    if (!user) {
      throw new Error(`No account found for ${email}. Complete a real signup through the live app first (LIVE-AUTH-001), then re-run this script.`);
    }
    if (user.account_state !== 'active') {
      throw new Error(`Account for ${email} is in state "${user.account_state}", not "active". Complete onboarding/verification through the live app first.`);
    }

    const [granter] = await sql<{ id: number }[]>`
      select u.id from idoc.users u
      join idoc.application_roles ar on ar.user_id = u.id
      where u.id = ${grantedBy} and ar.role = 'super_admin' and ar.revoked_at is null`;
    if (!granter) {
      throw new Error(`--granted-by user id ${grantedBy} does not hold an active super_admin grant. Role grants are Super-Admin-only (lib/membership/role-grants.ts); refusing to record an unauthorized actor in the audit trail.`);
    }

    const [existing] = await sql<{ id: number }[]>`
      select id from idoc.application_roles where user_id = ${user.id} and role = ${role} and revoked_at is null`;
    if (existing) {
      console.log(`${email} already holds an active "${role}" grant (application_roles.id=${existing.id}). Nothing to do.`);
      return;
    }

    const [grant] = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: number }[]>`
        insert into idoc.application_roles (user_id, role, granted_by)
        values (${user.id}, ${role}, ${grantedBy})
        returning id`;
      // Mirrors lib/membership/role-grants.ts's grantApplicationRole: a privilege grant must not
      // take effect inside an already-issued lower-assurance session (the one from the real signup
      // login in LIVE-AUTH-001). Incrementing session_version invalidates every existing session for
      // this user, so the LIVE-AUTH-009/010 pending-MFA/privileged-login cases exercise a genuine
      // fresh login under the new role rather than silently inheriting it into a stale session.
      await tx`update idoc.users set session_version = session_version + 1, updated_at = now() where id = ${user.id}`;
      await tx`
        insert into idoc.audit_log (actor_id, action, entity_type, entity_id, after_json, reason)
        values (
          ${grantedBy},
          'e2e_test_role_grant',
          'application_role',
          ${String(row.id)},
          ${sql.json({ role, userId: user.id, email })},
          'Automated disposable test-account provisioning for the live auth audit; see docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md. Torn down by scripts/e2e-delete-test-account.ts at the end of the run.'
        )`;
      return [row];
    });

    console.log(`Granted "${role}" to ${email} (user_id=${user.id}, application_roles.id=${grant.id}). Remember to run scripts/e2e-delete-test-account.ts when the audit is done.`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

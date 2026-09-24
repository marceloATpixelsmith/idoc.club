import postgres from 'postgres';
import { arg, hasFlag, requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

// Full teardown for one disposable @pixelsmith.space test account created during a live auth audit
// (tests/auth/auth-test-matrix.json / docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md), run against the
// real staging database. This is a plain-TypeScript mirror of scripts/e2e-delete-test-account.sql --
// keep the two in exact lockstep; see that file for the full explanation of what it does and why.
//
// Does NOT fully delete the account row. migration 0002 installs BEFORE UPDATE OR DELETE triggers on
// idoc.audit_log and idoc.profile_change_history that unconditionally reject any attempt to change
// or remove a row (idoc.support_messages has the identical trigger from migration 0039). Since
// audit_log.actor_id/profile_change_history.profile_id/support_messages.conversation_id all
// reference their parent with no cascade, any account that generated even one audited action (real
// signup, a profile edit, a login) can never have its users or profiles row physically deleted -- the
// foreign key blocks it exactly as intentionally designed. Instead this neutralizes the account the
// same way the app's own self-service deleteOwnAccount() does (lib/membership/data-access.ts): every
// genuinely deletable row (sessions, MFA factors/codes, role grants, tokens, memberships, etc.) is
// removed outright, and the users row itself is soft-neutralized -- account_state set to 'deleted',
// the login email permanently mangled -- rather than deleted. The immutable audit trail this leaves
// behind never contains secrets by design (see the Evidence rules in the runbook), so leaving it in
// place is not a leak; it is the same tradeoff every real account deletion in this app already makes.
//
// Strict scope: this script touches ONLY rows owned by the test account -- it never deletes,
// modifies, or nulls out any row belonging to someone else. If the test account is referenced
// anywhere as a secondary actor on another person's row (verified a real professional role,
// authored a real news/CMS/seminar entry, recorded or was assigned to a real member's payment or
// support conversation), the whole run aborts with no changes made rather than touching that row in
// any way. That reference has to be cleared by a human, through the app, before this can run.
//
// Usage: node --conditions=react-server --import tsx scripts/e2e-delete-test-account.ts \
//   --email=<name>@pixelsmith.space --confirm-staging [--dry-run]

async function main() {
  const email = requireDisposableTestEmail(arg('email'));
  const dryRun = hasFlag('dry-run');
  const stagingUrl = validateStagingDatabaseUrl(
    process.env.STAGING_POSTGRES_URL,
    hasFlag('confirm-staging'),
  ).toString();

  const sql = postgres(stagingUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const [user] = await tx<{ id: number; account_state: string }[]>`
        select id, account_state from idoc.users where lower(email) = lower(${email})`;
      if (!user) {
        console.log(`No account found for ${email}. Nothing to clean up.`);
        return;
      }
      if (user.account_state === 'deleted') {
        console.log(`${email} (user_id=${user.id}) is already neutralized. Nothing further to do.`);
        return;
      }
      const uid = user.id;

      const [profile] = await tx<{ id: number }[]>`select id from idoc.profiles where user_id = ${uid}`;
      const profileId = profile?.id ?? null;

      // --- Preflight: abort (no changes at all) if the test account is referenced on ANYONE
      // else's row. Every check below is scoped to "acted on a row this account does not own". ---
      const [foreign] = await tx<{ total: string }[]>`
        select (
          (select count(*) from idoc.news_articles where created_by_user_id = ${uid} or updated_by_user_id = ${uid}) +
          (select count(*) from idoc.content_pages where created_by_user_id = ${uid} or updated_by_user_id = ${uid}) +
          (select count(*) from idoc.content_page_revisions where created_by_user_id = ${uid}) +
          (select count(*) from idoc.seminars where created_by_user_id = ${uid} or updated_by_user_id = ${uid}) +
          (select count(*) from idoc.payments where administrator_id = ${uid} and (${profileId}::int is null or profile_id <> ${profileId})) +
          (select count(*) from idoc.payment_refunds where administrator_id = ${uid}) +
          (select count(*) from idoc.professional_roles where verified_by = ${uid} and (${profileId}::int is null or profile_id <> ${profileId})) +
          (select count(*) from idoc.migration_map where reviewed_by = ${uid}) +
          (select count(*) from idoc.seminar_registrations where marked_paid_by_user_id = ${uid} and (${profileId}::int is null or profile_id <> ${profileId})) +
          (select count(*) from idoc.support_conversations where assigned_admin_user_id = ${uid} and member_user_id <> ${uid}) +
          (select count(*) from idoc.support_conversation_administrators sca join idoc.support_conversations sc on sc.id = sca.conversation_id where (sca.administrator_user_id = ${uid} or sca.assigned_by_user_id = ${uid}) and sc.member_user_id <> ${uid}) +
          (select count(*) from idoc.support_administrator_read_cursors src join idoc.support_conversations sc on sc.id = src.conversation_id where src.administrator_user_id = ${uid} and sc.member_user_id <> ${uid}) +
          (select count(*) from idoc.support_category_defaults where administrator_user_id = ${uid} or updated_by = ${uid}) +
          (select count(*) from idoc.support_messages sm join idoc.support_conversations sc on sc.id = sm.conversation_id where sm.author_user_id = ${uid} and sc.member_user_id <> ${uid}) +
          (select count(*) from idoc.profile_change_history where actor_id = ${uid} and (${profileId}::int is null or profile_id <> ${profileId}))
        )::text as total`;
      if (Number(foreign.total) > 0) {
        throw new Error(
          `${email} (user_id=${uid}) is referenced on at least one row it does not own (as an author, verifier, payment administrator, or support assignee for someone else). Refusing to touch it. Clear that reference manually through the app first, then re-run this script.`
        );
      }

      if (dryRun) {
        const counts = await tx<{ table_name: string; n: string }[]>`
          select 'auth_sessions' as table_name, count(*)::text as n from idoc.auth_sessions where user_id = ${uid}
          union all select 'mfa_factors', count(*)::text from idoc.mfa_factors where user_id = ${uid}
          union all select 'mfa_recovery_codes', count(*)::text from idoc.mfa_recovery_codes where user_id = ${uid}
          union all select 'mfa_remembered_devices', count(*)::text from idoc.mfa_remembered_devices where user_id = ${uid}
          union all select 'login_trusted_devices', count(*)::text from idoc.login_trusted_devices where user_id = ${uid}
          union all select 'application_roles', count(*)::text from idoc.application_roles where user_id = ${uid}
          union all select 'email_verification_tokens', count(*)::text from idoc.email_verification_tokens where user_id = ${uid}
          union all select 'account_tokens', count(*)::text from idoc.account_tokens where user_id = ${uid}
          union all select 'email_otp_codes', count(*)::text from idoc.email_otp_codes where user_id = ${uid} or (user_id is null and lower(email) = lower(${email}))
          union all select 'memberships', count(*)::text from idoc.memberships where profile_id = ${profileId}
          union all select 'professional_roles (own)', count(*)::text from idoc.professional_roles where profile_id = ${profileId}
          union all select 'seminar_registrations (own)', count(*)::text from idoc.seminar_registrations where profile_id = ${profileId}`;
        console.log(`Dry run for ${email} (user_id=${uid}). Rows this account owns that WOULD be deleted:`);
        for (const row of counts) if (Number(row.n) > 0) console.log(`  ${row.table_name}: ${row.n}`);
        console.log('  (plus: users row neutralized -- account_state=deleted, login email mangled, real deletion blocked by immutable audit_log/profile_change_history)');
        throw new Error('DRY_RUN_ROLLBACK'); // abort the transaction, nothing committed
      }

      // --- Profile-scoped rows the account owns that are genuinely deletable (no immutability
      // lock). profiles itself is not deleted -- see file header. ---
      if (profileId) {
        await tx`delete from idoc.seminar_registrations where profile_id = ${profileId}`;
        await tx`delete from idoc.notification_outbox where profile_id = ${profileId}`;
        await tx`delete from idoc.billing_accounts where profile_id = ${profileId}`;
        await tx`delete from idoc.membership_checkout_sessions where profile_id = ${profileId}`;
        await tx`delete from idoc.subscriptions where profile_id = ${profileId}`;
        await tx`delete from idoc.renewal_preferences where profile_id = ${profileId}`;
        await tx`delete from idoc.payments where profile_id = ${profileId}`;
        await tx`delete from idoc.reconciliation_findings where profile_id = ${profileId}`;
        await tx`delete from idoc.professional_roles where profile_id = ${profileId}`;
        await tx`delete from idoc.memberships where profile_id = ${profileId}`;
      }

      // --- User-scoped rows the account owns, genuinely deletable (no immutability lock). ---
      await tx`delete from idoc.application_roles where user_id = ${uid}`;
      await tx`delete from idoc.email_verification_tokens where user_id = ${uid}`;
      await tx`delete from idoc.account_delivery_outbox where user_id = ${uid}`;
      await tx`delete from idoc.account_tokens where user_id = ${uid}`;
      await tx`delete from idoc.email_otp_codes where user_id = ${uid} or (user_id is null and lower(email) = lower(${email}))`;
      await tx`delete from idoc.team_members where user_id = ${uid}`;
      await tx`delete from idoc.invitations where invited_by = ${uid}`;
      await tx`delete from idoc.activity_logs where user_id = ${uid}`;
      await tx`delete from idoc.auth_sessions where user_id = ${uid}`;
      await tx`delete from idoc.mfa_enrollment_transactions where user_id = ${uid}`;
      await tx`delete from idoc.mfa_challenge_transactions where user_id = ${uid}`;
      await tx`delete from idoc.mfa_recovery_codes where user_id = ${uid}`;
      await tx`delete from idoc.mfa_remembered_devices where user_id = ${uid}`;
      await tx`delete from idoc.mfa_factors where user_id = ${uid}`;
      await tx`delete from idoc.login_trusted_devices where user_id = ${uid}`;
      await tx`delete from idoc.administrator_table_preferences where user_id = ${uid}`;
      // audit_log (own actions) is not deleted: immutable by design. It never contains secrets, so
      // leaving it is not a leak -- see the runbook's evidence rules.

      // --- Neutralize the account itself, exactly like the app's own self-service
      // lib/membership/data-access.ts deleteOwnAccount(): permanently block login and free the
      // email for reuse, rather than physically deleting a row idoc.audit_log still references. ---
      await tx`update idoc.users set
        account_state = 'deleted',
        deleted_at = now(),
        email_display = concat(email, '-', id, '-deleted'),
        email = concat(email, '-', id, '-deleted'),
        updated_at = now()
        where id = ${uid}`;
      await tx`insert into idoc.audit_log (actor_id, action, entity_type, entity_id, reason)
        values (${uid}, 'account.deleted', 'user', ${String(uid)}, 'Automated disposable test-account cleanup for the live auth audit; see docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md.')`;

      console.log(`Cleaned up ${email} (user_id=${uid}): removed every genuinely deletable row it owned and neutralized the account (immutable audit/profile-history rows and the profile row itself remain, as the schema requires).`);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'DRY_RUN_ROLLBACK') {
      console.log('(dry run only -- no changes were committed)');
    } else {
      throw error;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

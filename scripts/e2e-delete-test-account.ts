import postgres from 'postgres';
import { arg, hasFlag, requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

// Full teardown for one disposable @pixelsmith.space test account created during a live auth audit
// (tests/auth/auth-test-matrix.json / docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md), run against the
// real staging database. Deletes only rows the test account actually owns -- its own sessions, MFA
// factors/codes, role grants, profile/membership/payment rows, verification/reset tokens, its own
// support threads, and its own audit_log entries. This is a deliberate, test-only exception to
// normal audit-log immutability: never run this against a real member or administrator account (the
// @pixelsmith.space email guard exists specifically to make that impossible by accident).
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
    process.env.POSTGRES_URL,
    hasFlag('confirm-staging'),
  ).toString();

  const sql = postgres(stagingUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const [user] = await tx<{ id: number }[]>`select id from idoc.users where lower(email) = lower(${email})`;
      if (!user) {
        console.log(`No account found for ${email}. Nothing to clean up.`);
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
          union all select 'audit_log (own actions)', count(*)::text from idoc.audit_log where actor_id = ${uid}
          union all select 'profiles', count(*)::text from idoc.profiles where user_id = ${uid}
          union all select 'memberships', count(*)::text from idoc.memberships where profile_id = ${profileId}
          union all select 'professional_roles (own)', count(*)::text from idoc.professional_roles where profile_id = ${profileId}
          union all select 'seminar_registrations (own)', count(*)::text from idoc.seminar_registrations where profile_id = ${profileId}
          union all select 'support_conversations (own)', count(*)::text from idoc.support_conversations where member_user_id = ${uid}`;
        console.log(`Dry run for ${email} (user_id=${uid}). Rows this account owns that WOULD be deleted:`);
        for (const row of counts) if (Number(row.n) > 0) console.log(`  ${row.table_name}: ${row.n}`);
        throw new Error('DRY_RUN_ROLLBACK'); // abort the transaction, nothing committed
      }

      // --- The test account's own support threads (it is the member on these; already confirmed
      // above that it is not an assignee on anyone else's). ---
      const ownConversations = await tx<{ id: number }[]>`select id from idoc.support_conversations where member_user_id = ${uid}`;
      for (const { id: conversationId } of ownConversations) {
        await tx`delete from idoc.support_messages where conversation_id = ${conversationId}`;
        await tx`delete from idoc.support_conversation_administrators where conversation_id = ${conversationId}`;
        await tx`delete from idoc.support_administrator_read_cursors where conversation_id = ${conversationId}`;
      }
      await tx`delete from idoc.support_conversations where member_user_id = ${uid}`;

      // --- Profile-scoped rows the account owns (must precede deleting the profile itself). ---
      if (profileId) {
        await tx`delete from idoc.seminar_registrations where profile_id = ${profileId}`;
        await tx`delete from idoc.notification_outbox where profile_id = ${profileId}`;
        await tx`delete from idoc.billing_accounts where profile_id = ${profileId}`;
        await tx`delete from idoc.membership_checkout_sessions where profile_id = ${profileId}`;
        await tx`delete from idoc.subscriptions where profile_id = ${profileId}`;
        await tx`delete from idoc.renewal_preferences where profile_id = ${profileId}`;
        await tx`delete from idoc.payments where profile_id = ${profileId}`;
        await tx`delete from idoc.reconciliation_findings where profile_id = ${profileId}`;
        await tx`delete from idoc.profile_change_history where profile_id = ${profileId}`;
        await tx`delete from idoc.professional_roles where profile_id = ${profileId}`;
        await tx`delete from idoc.memberships where profile_id = ${profileId}`;
        // onboarding_consents cascades automatically on profile delete.
        await tx`delete from idoc.profiles where id = ${profileId}`;
      }

      // --- User-scoped rows the account owns, without ON DELETE CASCADE. ---
      await tx`delete from idoc.application_roles where user_id = ${uid}`;
      await tx`delete from idoc.email_verification_tokens where user_id = ${uid}`;
      await tx`delete from idoc.account_delivery_outbox where user_id = ${uid}`;
      await tx`delete from idoc.account_tokens where user_id = ${uid}`;
      await tx`delete from idoc.email_otp_codes where user_id = ${uid} or (user_id is null and lower(email) = lower(${email}))`;
      await tx`delete from idoc.team_members where user_id = ${uid}`;
      await tx`delete from idoc.invitations where invited_by = ${uid}`;
      await tx`delete from idoc.activity_logs where user_id = ${uid}`;
      await tx`delete from idoc.audit_log where actor_id = ${uid}`;

      // --- Everything else (auth_sessions, mfa_*, login_trusted_devices,
      // administrator_table_preferences) has ON DELETE CASCADE on user_id and is removed by this. ---
      await tx`delete from idoc.users where id = ${uid}`;

      console.log(`Deleted ${email} (user_id=${uid}) and every row it owned.`);
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

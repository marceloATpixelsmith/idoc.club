import { client } from '@/lib/db/drizzle';

export async function deleteMembers(ids: string[], actorId: number) {
  const numeric = ids.map(Number);
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number; email: string; profile_id: number | null }[]>`
      select u.id,u.email,p.id as profile_id from idoc.users u
      left join idoc.profiles p on p.user_id=u.id where u.id in ${sql(numeric)} for update of u`;
    if (rows.length !== numeric.length) throw new Error('One or more selected members no longer exist.');
    if (rows.some((row) => row.id === actorId)) throw new Error('You cannot delete your own administrator account.');
    const privileged = await sql<{ user_id: number }[]>`select distinct user_id from idoc.application_roles where user_id in ${sql(numeric)} and revoked_at is null and role in ('administrator','super_admin')`;
    if (privileged.length) throw new Error('Administrator accounts cannot be bulk deleted. Revoke their administrator role first.');
    const profileIds = rows.flatMap((row) => row.profile_id === null ? [] : [row.profile_id]);
    const activeSubscriptions = profileIds.length ? await sql<{ count: number }[]>`select count(*)::int as count from idoc.subscriptions where profile_id in ${sql(profileIds)} and status in ('active','trialing','past_due','incomplete')` : [{ count: 0 }];
    if (activeSubscriptions[0]?.count) throw new Error('Cancel active billing subscriptions before permanently deleting selected members.');
    const userIds = rows.map((row) => row.id);
    const registrations = profileIds.length ? await sql<{ id: number }[]>`select id from idoc.seminar_registrations where profile_id in ${sql(profileIds)}` : [];
    const registrationIds = registrations.map((row) => row.id);
    const payments = profileIds.length ? await sql<{ id: number }[]>`select id from idoc.payments where profile_id in ${sql(profileIds)}` : [];
    const paymentIds = payments.map((row) => row.id);
    await sql`select set_config('idoc.allow_member_permanent_delete','on',true)`;
    if (registrationIds.length) await sql`delete from idoc.payment_refunds where seminar_registration_id in ${sql(registrationIds)}`;
    if (paymentIds.length) await sql`delete from idoc.payment_refunds where membership_payment_id in ${sql(paymentIds)}`;
    if (registrationIds.length) await sql`delete from idoc.seminar_registrations where id in ${sql(registrationIds)}`;
    if (profileIds.length) {
      await sql`delete from idoc.profile_change_history where profile_id in ${sql(profileIds)} or actor_id in ${sql(userIds)}`;
      await sql`delete from idoc.notification_outbox where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.reconciliation_findings where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.payments where id in ${sql(paymentIds)}`;
      await sql`delete from idoc.subscriptions where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.membership_checkout_sessions where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.renewal_preferences where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.billing_accounts where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.memberships where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.professional_roles where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.onboarding_consents where profile_id in ${sql(profileIds)}`;
      await sql`delete from idoc.profiles where id in ${sql(profileIds)}`;
    }
    await sql`update idoc.support_conversations set assigned_admin_user_id=null where assigned_admin_user_id in ${sql(userIds)}`;
    await sql`update idoc.support_conversation_administrators set assigned_by_user_id=null where assigned_by_user_id in ${sql(userIds)}`;
    const conversations = await sql<{ id: number }[]>`select id from idoc.support_conversations where member_user_id in ${sql(userIds)}`;
    const conversationIds = conversations.map((row) => row.id);
    if (conversationIds.length) {
      await sql`delete from idoc.support_administrator_read_cursors where conversation_id in ${sql(conversationIds)} or administrator_user_id in ${sql(userIds)}`;
      await sql`delete from idoc.support_conversation_administrators where conversation_id in ${sql(conversationIds)} or administrator_user_id in ${sql(userIds)}`;
      await sql`delete from idoc.support_messages where conversation_id in ${sql(conversationIds)} or author_user_id in ${sql(userIds)}`;
      await sql`delete from idoc.support_conversations where id in ${sql(conversationIds)}`;
    } else {
      await sql`delete from idoc.support_messages where author_user_id in ${sql(userIds)}`;
      await sql`delete from idoc.support_administrator_read_cursors where administrator_user_id in ${sql(userIds)}`;
      await sql`delete from idoc.support_conversation_administrators where administrator_user_id in ${sql(userIds)}`;
    }
    await sql`delete from idoc.activity_logs where user_id in ${sql(userIds)}`;
    await sql`delete from idoc.team_members where user_id in ${sql(userIds)}`;
    await sql`delete from idoc.application_roles where user_id in ${sql(userIds)}`;
    await sql`delete from idoc.email_verification_tokens where user_id in ${sql(userIds)}`;
    await sql`delete from idoc.account_tokens where user_id in ${sql(userIds)}`;
    await sql`delete from idoc.account_delivery_outbox where user_id in ${sql(userIds)}`;
    await sql`delete from idoc.email_otp_codes where user_id in ${sql(userIds)}`;
    await sql`update idoc.application_roles set granted_by=null where granted_by in ${sql(userIds)}`;
    await sql`update idoc.professional_roles set verified_by=null where verified_by in ${sql(userIds)}`;
    await sql`update idoc.migration_map set reviewed_by=null where reviewed_by in ${sql(userIds)}`;
    await sql`update idoc.payments set administrator_id=null where administrator_id in ${sql(userIds)}`;
    await sql`update idoc.payment_refunds set administrator_id=null where administrator_id in ${sql(userIds)}`;
    await sql`update idoc.seminar_registrations set marked_paid_by_user_id=null where marked_paid_by_user_id in ${sql(userIds)}`;
    for (const row of rows) {
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,reason) values (${actorId},'admin.member.permanently_deleted','user',${String(row.id)},${JSON.stringify({ email: row.email })}::jsonb,${JSON.stringify({ deleted: true })}::jsonb,'Bulk permanent delete from Members admin table')`;
    }
    await sql`delete from idoc.users where id in ${sql(userIds)}`;
    return rows.length;
  });
}
export async function archiveMembers(ids: string[], actorId: number) {
  const numeric = ids.map(Number);
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number }[]>`select id from idoc.users where id in ${sql(numeric)} for update`;
    if (rows.length !== numeric.length) throw new Error('One or more selected members no longer exist.');
    if (rows.some((row) => row.id === actorId)) throw new Error('You cannot archive your own administrator account.');
    const privileged = await sql<{ user_id: number }[]>`select distinct user_id from idoc.application_roles where user_id in ${sql(numeric)} and revoked_at is null and role in ('administrator','super_admin')`;
    if (privileged.length) throw new Error('Administrator accounts cannot be bulk archived. Revoke their administrator role first.');
    const activeSubscriptions = await sql<{ count: number }[]>`select count(*)::int as count from idoc.subscriptions s join idoc.profiles p on p.id=s.profile_id where p.user_id in ${sql(numeric)} and s.status in ('active','trialing','past_due','incomplete')`;
    if (activeSubscriptions[0]?.count) throw new Error('Cancel active billing subscriptions before archiving selected members.');
    for (const row of rows) {
      await sql`update idoc.users set account_state='deleted',deleted_at=null,session_version=session_version+1,updated_at=now() where id=${row.id}`;
      await sql`delete from idoc.auth_sessions where user_id=${row.id}`;
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,reason) values (${actorId},'admin.member.archived','user',${String(row.id)},${JSON.stringify({ accountState: 'active' })}::jsonb,${JSON.stringify({ accountState: 'archived' })}::jsonb,'Bulk archive from Members admin table')`;
    }
    return rows.length;
  });
}


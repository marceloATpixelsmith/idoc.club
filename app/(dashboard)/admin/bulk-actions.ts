'use server';

import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { deleteArticles } from '@/lib/news/articles';
import { requireCsrfToken } from '@/lib/security/csrf';

export type BulkDeleteState = { error?: string; stepUpRequired?: boolean; success?: string };
const TABLES = ['members', 'news', 'seminars', 'registrations', 'support'] as const;
type BulkTable = (typeof TABLES)[number];

function parseIds(formData: FormData): { table: BulkTable; ids: string[] } {
  const table = String(formData.get('table') ?? '') as BulkTable;
  if (!TABLES.includes(table)) throw new Error('Unsupported admin table.');
  const ids = [...new Set(formData.getAll('id').map(String).map((value) => value.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100) throw new Error('Select between 1 and 100 records.');
  if (table === 'support') {
    if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid support record.');
  } else if (!ids.every((id) => /^\d+$/.test(id) && Number(id) > 0)) throw new Error('Invalid selected record.');
  return { table, ids };
}

async function deleteMembers(ids: string[], actorId: number) {
  const numeric = ids.map(Number);
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number; email: string; profile_id: number | null }[]>`
      select u.id,u.email,p.id as profile_id from idoc.users u
      left join idoc.profiles p on p.user_id=u.id where u.id in ${sql(numeric)} for update of u`;
    if (rows.length !== numeric.length) throw new Error('One or more selected members no longer exist.');
    if (rows.some((row) => row.id === actorId)) throw new Error('You cannot delete your own administrator account.');
    const privileged = await sql<{ user_id: number }[]>`select distinct user_id from idoc.application_roles where user_id in ${sql(numeric)} and role in ('administrator','super_admin')`;
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
async function archiveMembers(ids: string[], actorId: number) {
  const numeric = ids.map(Number);
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number }[]>`select id from idoc.users where id in ${sql(numeric)} for update`;
    if (rows.length !== numeric.length) throw new Error('One or more selected members no longer exist.');
    if (rows.some((row) => row.id === actorId)) throw new Error('You cannot archive your own administrator account.');
    const privileged = await sql<{ user_id: number }[]>`select distinct user_id from idoc.application_roles where user_id in ${sql(numeric)} and role in ('administrator','super_admin')`;
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

async function deleteSeminars(ids: string[], actorId: number) {
  const numeric = ids.map(Number);
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number; status: string; title: string; registrations: number }[]>`select s.id,s.status,s.title,(select count(*)::int from idoc.seminar_registrations r where r.seminar_id=s.id) registrations from idoc.seminars s where s.id in ${sql(numeric)} for update`;
    if (rows.length !== numeric.length) throw new Error('One or more selected seminars no longer exist.');
    const blocked = rows.find((row) => row.registrations > 0 || !['draft','canceled'].includes(row.status));
    if (blocked) throw new Error('“' + blocked.title + '” cannot be deleted. A seminar must be Draft or Canceled and have no registration history.');
    for (const row of rows) {
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,reason) values (${actorId},'admin.seminar.deleted','seminar',${String(row.id)},${JSON.stringify({ status: row.status, title: row.title })}::jsonb,'Bulk delete from Seminars admin table')`;
      await sql`delete from idoc.seminars where id=${row.id}`;
    }
    return rows.length;
  });
}

async function deleteRegistrations(ids: string[], actorId: number) {
  const numeric = ids.map(Number);
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number; registration_status: string; payment_status: string; payment_reference: string | null; stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null; paid_at: Date | null }[]>`select id,registration_status,payment_status,payment_reference,stripe_checkout_session_id,stripe_payment_intent_id,paid_at from idoc.seminar_registrations where id in ${sql(numeric)} for update`;
    if (rows.length !== numeric.length) throw new Error('One or more selected registrations no longer exist.');
    const refundRows = await sql<{ seminar_registration_id: number }[]>`select seminar_registration_id from idoc.payment_refunds where seminar_registration_id in ${sql(numeric)}`;
    const refundIds = new Set(refundRows.map((row) => row.seminar_registration_id));
    const deletableStatuses = new Set(['unpaid','pending','bank_transfer_pending','cash_pending']);
    const blocked = rows.find((row) => row.registration_status !== 'canceled' || !deletableStatuses.has(row.payment_status) || row.payment_reference || row.stripe_checkout_session_id || row.stripe_payment_intent_id || row.paid_at || refundIds.has(row.id));
    if (blocked) throw new Error('Registrations can only be deleted after cancellation when they have no Stripe, payment, refund, dispute, or charge history.');
    for (const row of rows) {
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,reason) values (${actorId},'admin.seminar_registration.deleted','seminar_registration',${String(row.id)},${JSON.stringify({ paymentStatus: row.payment_status, registrationStatus: row.registration_status })}::jsonb,'Bulk delete from Registrations admin table')`;
      await sql`delete from idoc.seminar_registrations where id=${row.id}`;
    }
    return rows.length;
  });
}

async function deleteSupport(ids: string[], actorId: number) {
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number; public_id: string; status: string; subject: string }[]>`select id,public_id::text,status,subject from idoc.support_conversations where public_id::text in ${sql(ids)} for update`;
    if (rows.length !== ids.length) throw new Error('One or more selected support conversations no longer exist.');
    const blocked = rows.find((row) => row.status !== 'closed');
    if (blocked) throw new Error('Support conversations must be closed before they can be deleted.');
    for (const row of rows) {
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,reason) values (${actorId},'admin.support_conversation.deleted','support_conversation',${row.public_id},${JSON.stringify({ status: row.status, subject: row.subject })}::jsonb,'Bulk delete from Support admin table')`;
      await sql`delete from idoc.support_administrator_read_cursors where conversation_id=${row.id}`;
      await sql`delete from idoc.support_conversation_administrators where conversation_id=${row.id}`;
      await sql`delete from idoc.support_messages where conversation_id=${row.id}`;
      await sql`delete from idoc.support_conversations where id=${row.id}`;
    }
    return rows.length;
  });
}

export async function bulkDeleteAdminRows(_state: BulkDeleteState, formData: FormData): Promise<BulkDeleteState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const { table, ids } = parseIds(formData);
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', '/admin');
    if (stepUp.required) return { stepUpRequired: true };
    let deleted = 0;
    if (table === 'members') deleted = await deleteMembers(ids, actor.id);
    else if (table === 'news') { await deleteArticles(ids); deleted = ids.length; }
    else if (table === 'seminars') deleted = await deleteSeminars(ids, actor.id);
    else if (table === 'registrations') deleted = await deleteRegistrations(ids, actor.id);
    else deleted = await deleteSupport(ids, actor.id);
    for (const path of ['/admin/members','/admin/news','/admin/seminars','/admin/seminars/registrations','/admin/support','/news','/blog','/']) revalidatePath(path);
    return { success: String(deleted) + ' selected record' + (deleted === 1 ? '' : 's') + ' deleted.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The selected records could not be deleted.' };
  }
}


export async function bulkArchiveMembers(_state: BulkDeleteState, formData: FormData): Promise<BulkDeleteState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const { table, ids } = parseIds(formData);
    if (table !== 'members') throw new Error('Only member records can be archived.');
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', '/admin/members');
    if (stepUp.required) return { stepUpRequired: true };
    const archived = await archiveMembers(ids, actor.id);
    revalidatePath('/admin/members');
    return { success: String(archived) + ' selected member' + (archived === 1 ? '' : 's') + ' archived.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The selected members could not be archived.' };
  }
}
export type BulkUpdateState = { error?: string; success?: string };

function selectedIds(formData: FormData, table: 'news' | 'support'): string[] {
  const ids = [...new Set(formData.getAll('id').map(String).map((value) => value.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100) throw new Error('Select between 1 and 100 records.');
  if (table === 'support') {
    if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid support record.');
  } else if (!ids.every((id) => /^\d+$/.test(id) && Number(id) > 0)) throw new Error('Invalid selected record.');
  return ids;
}

export async function bulkCloseSupportRows(_state: BulkUpdateState, formData: FormData): Promise<BulkUpdateState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const ids = selectedIds(formData, 'support');
    const changed = await client.begin(async (sql) => {
      const rows = await sql<{ id: number; public_id: string; status: string }[]>`
        select id,public_id::text,status from idoc.support_conversations
        where public_id::text in ${sql(ids)} for update`;
      if (rows.length !== ids.length) throw new Error('One or more selected support conversations no longer exist.');
      let count = 0;
      for (const row of rows) {
        if (row.status === 'closed') continue;
        await sql`update idoc.support_conversations set status='closed',updated_at=now() where id=${row.id}`;
        await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
          values(${actor.id},'support.conversation.closed','support_conversation',${row.public_id},
          ${JSON.stringify({ status: row.status })}::jsonb,${JSON.stringify({ status: 'closed' })}::jsonb)`;
        count += 1;
      }
      return count;
    });
    revalidatePath('/admin/support');
    revalidatePath('/admin');
    return { success: String(changed) + ' selected support record' + (changed === 1 ? '' : 's') + ' closed.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The selected support records could not be closed.' };
  }
}

const BULK_NEWS_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;

export async function bulkSetNewsStatus(_state: BulkUpdateState, formData: FormData): Promise<BulkUpdateState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const ids = selectedIds(formData, 'news').map(Number);
    const status = String(formData.get('status') ?? '') as (typeof BULK_NEWS_STATUSES)[number];
    if (!BULK_NEWS_STATUSES.includes(status)) throw new Error('Choose a valid News/Blog status.');

    await client.begin(async (sql) => {
      const rows = await sql<{ id: number; publication_date: Date | string; status: string }[]>`
        select id,status,publication_date from idoc.news_articles where id in ${sql(ids)} for update`;
      if (rows.length !== ids.length) throw new Error('One or more selected News/Blog records no longer exist.');
      if (status === 'scheduled' && rows.some((row) => new Date(row.publication_date).getTime() <= Date.now())) {
        throw new Error('Every selected item needs a future publication date before it can be scheduled.');
      }
      for (const row of rows) {
        if (status === 'published') {
          const publicationDate = new Date(row.publication_date).getTime() > Date.now() ? new Date().toISOString() : new Date(row.publication_date).toISOString();
          await sql`update idoc.news_articles set status='published',publication_date=${publicationDate},published_at=now(),archived_at=null,updated_by_user_id=${actor.id},updated_at=now() where id=${row.id}`;
        } else if (status === 'scheduled') {
          await sql`update idoc.news_articles set status='scheduled',published_at=null,archived_at=null,updated_by_user_id=${actor.id},updated_at=now() where id=${row.id}`;
        } else if (status === 'archived') {
          await sql`update idoc.news_articles set status='archived',archived_at=now(),updated_by_user_id=${actor.id},updated_at=now() where id=${row.id}`;
        } else {
          await sql`update idoc.news_articles set status='draft',published_at=null,archived_at=null,updated_by_user_id=${actor.id},updated_at=now() where id=${row.id}`;
        }
        await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
          values(${actor.id},'admin.news_article.bulk_status_changed','news_article',${String(row.id)},
          ${JSON.stringify({ status: row.status })}::jsonb,${JSON.stringify({ status })}::jsonb)`;
      }
    });
    for (const refreshPath of ['/admin/news','/news','/blog','/']) revalidatePath(refreshPath);
    return { success: String(ids.length) + ' selected News/Blog record' + (ids.length === 1 ? '' : 's') + ' updated.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The selected News/Blog records could not be updated.' };
  }
}

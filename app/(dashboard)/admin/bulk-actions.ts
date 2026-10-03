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
    const rows = await sql<{ id: number; email: string }[]>`select u.id,u.email from idoc.users u where u.id in ${sql(numeric)} for update`;
    if (rows.length !== numeric.length) throw new Error('One or more selected members no longer exist.');
    if (rows.some((row) => row.id === actorId)) throw new Error('You cannot delete your own administrator account.');
    const privileged = await sql<{ user_id: number }[]>`select distinct user_id from idoc.application_roles where user_id in ${sql(numeric)} and revoked_at is null and role in ('administrator','super_admin')`;
    if (privileged.length) throw new Error('Administrator accounts cannot be bulk deleted. Revoke their administrator role first.');
    for (const row of rows) {
      const anonymized = 'deleted-' + row.id + '-' + Date.now() + '@deleted.invalid';
      await sql`update idoc.users set account_state='deleted',deleted_at=now(),email=${anonymized},email_display=${anonymized},session_version=session_version+1,updated_at=now() where id=${row.id}`;
      await sql`delete from idoc.auth_sessions where user_id=${row.id}`;
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,reason) values (${actorId},'admin.member.deleted','user',${String(row.id)},${JSON.stringify({ email: row.email })}::jsonb,${JSON.stringify({ accountState: 'deleted' })}::jsonb,'Bulk delete from Members admin table')`;
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

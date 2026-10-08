'use server';

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { client } from '@/lib/db/drizzle';
import { archiveMembers, deleteMembers } from '@/lib/admin/member-lifecycle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { deleteArticles, requireNewsArticleSchema } from '@/lib/news/articles';
import { requireCsrfToken } from '@/lib/security/csrf';

export type BulkDeleteState = { error?: string; stepUpRequired?: boolean; success?: string };
const TABLES = ['members', 'news', 'seminars', 'registrations', 'support'] as const;
type BulkTable = (typeof TABLES)[number];

function parseIds(formData: FormData): { table: BulkTable; ids: string[] } {
  const table = String(formData.get('table') ?? '') as BulkTable;
  if (!TABLES.includes(table)) throw new InlineAdminValidationError('Unsupported admin table.');
  const ids = [...new Set(formData.getAll('id').map(String).map((value) => value.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100) throw new Error('Select between 1 and 100 records.');
  if (table === 'support') {
    if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid support record.');
  } else if (!ids.every((id) => /^\d+$/.test(id) && Number(id) > 0)) throw new Error('Invalid selected record.');
  return { table, ids };
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
export type InlineAdminUpdateState = { error?: string; success?: string };

class InlineAdminValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InlineAdminValidationError';
  }
}

const INLINE_NEWS_AUDIENCES = ['public', 'members', 'judge', 'steward', 'veterinarian'] as const;
const INLINE_SEMINAR_STATUSES = ['draft', 'published', 'canceled'] as const;

function normalizeInlineAudience(values: FormDataEntryValue[]): string[] {
  const audience = [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
  if (!audience.length || audience.some((value) => !(INLINE_NEWS_AUDIENCES as readonly string[]).includes(value))) {
    throw new InlineAdminValidationError('Choose a valid News/Blog access setting.');
  }
  if (audience.includes('public')) {
    if (audience.length !== 1) throw new InlineAdminValidationError('Public cannot be combined with member-only access.');
    return ['public'];
  }
  if (audience.includes('members')) {
    if (audience.length !== 1) throw new InlineAdminValidationError('All logged-in Members cannot be combined with role-specific access.');
    return ['members'];
  }
  return audience;
}

async function updateInlineNewsRow(formData: FormData, actorId: number) {
  const id = Number(String(formData.get('id') ?? ''));
  if (!Number.isInteger(id) || id <= 0) throw new InlineAdminValidationError('Invalid News/Blog record.');
  const field = String(formData.get('field') ?? '');
  if (field !== 'status' && field !== 'access') throw new InlineAdminValidationError('Unsupported News/Blog inline field.');
  await requireNewsArticleSchema();

  await client.begin(async (sql) => {
    const [row] = await sql<{ audience: string[]; id: number; publication_date: Date | string; status: string }[]>`select id,status,audience,publication_date from idoc.news_articles where id=${id} for update`;
    if (!row) throw new InlineAdminValidationError('News/Blog record not found.');

    if (field === 'access') {
      const audience = normalizeInlineAudience(formData.getAll('audience'));
      await sql`update idoc.news_articles set audience=${audience},updated_by_user_id=${actorId},updated_at=now() where id=${id}`;
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
        values(${actorId},'admin.news_article.inline_access_changed','news_article',${String(id)},
        ${JSON.stringify({ audience: row.audience })}::jsonb,${JSON.stringify({ audience })}::jsonb)`;
      return;
    }

    const status = String(formData.get('status') ?? '') as (typeof BULK_NEWS_STATUSES)[number];
    if (!BULK_NEWS_STATUSES.includes(status)) throw new InlineAdminValidationError('Choose a valid News/Blog status.');
    if (status === 'scheduled' && new Date(row.publication_date).getTime() <= Date.now()) {
      throw new InlineAdminValidationError('Set a future publication date before scheduling this item.');
    }

    if (status === 'published') {
      const publicationDate = new Date(row.publication_date).getTime() > Date.now() ? new Date().toISOString() : new Date(row.publication_date).toISOString();
      await sql`update idoc.news_articles set status='published',publication_date=${publicationDate},published_at=now(),archived_at=null,updated_by_user_id=${actorId},updated_at=now() where id=${id}`;
    } else if (status === 'scheduled') {
      await sql`update idoc.news_articles set status='scheduled',published_at=null,archived_at=null,updated_by_user_id=${actorId},updated_at=now() where id=${id}`;
    } else if (status === 'archived') {
      await sql`update idoc.news_articles set status='archived',archived_at=now(),updated_by_user_id=${actorId},updated_at=now() where id=${id}`;
    } else {
      await sql`update idoc.news_articles set status='draft',published_at=null,archived_at=null,updated_by_user_id=${actorId},updated_at=now() where id=${id}`;
    }
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
      values(${actorId},'admin.news_article.inline_status_changed','news_article',${String(id)},
      ${JSON.stringify({ status: row.status })}::jsonb,${JSON.stringify({ status })}::jsonb)`;
  });
}

async function updateInlineSeminarStatus(formData: FormData, actorId: number) {
  const id = Number(String(formData.get('id') ?? ''));
  if (!Number.isInteger(id) || id <= 0) throw new InlineAdminValidationError('Invalid seminar record.');
  const status = String(formData.get('status') ?? '') as (typeof INLINE_SEMINAR_STATUSES)[number];
  if (!INLINE_SEMINAR_STATUSES.includes(status)) throw new InlineAdminValidationError('Choose a valid seminar status.');

  await client.begin(async (sql) => {
    const [row] = await sql<{ id: number; status: string }[]>`select id,status from idoc.seminars where id=${id} for update`;
    if (!row) throw new InlineAdminValidationError('Seminar not found.');
    await sql`update idoc.seminars set status=${status},updated_by_user_id=${actorId},updated_at=now() where id=${id}`;

    let canceledRegistrations = 0;
    if (row.status !== 'canceled' && status === 'canceled') {
      const canceled = await sql<{ id: number }[]>`update idoc.seminar_registrations set registration_status='canceled',canceled_at=now(),updated_at=now() where seminar_id=${id} and registration_status='registered' returning id`;
      canceledRegistrations = canceled.length;
      if (canceledRegistrations) {
        await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values(${actorId},'admin.seminar.registrations_canceled_by_cascade','seminar',${String(id)},${JSON.stringify({ registrationIds: canceled.map((entry) => entry.id) })}::jsonb)`;
      }
    }

    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
      values(${actorId},'admin.seminar.inline_status_changed','seminar',${String(id)},
      ${JSON.stringify({ status: row.status })}::jsonb,${JSON.stringify({ canceledRegistrations, status })}::jsonb)`;
  });
}

export async function updateAdminTableInlineField(_state: InlineAdminUpdateState, formData: FormData): Promise<InlineAdminUpdateState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const table = String(formData.get('table') ?? '');
    if (table === 'news') {
      await updateInlineNewsRow(formData, actor.id);
      for (const refreshPath of ['/admin/news','/news','/blog','/']) revalidatePath(refreshPath);
      return { success: 'News/Blog row updated.' };
    }
    if (table === 'seminars') {
      if (String(formData.get('field') ?? '') !== 'status') throw new InlineAdminValidationError('Unsupported seminar inline field.');
      await updateInlineSeminarStatus(formData, actor.id);
      revalidatePath('/admin/seminars');
      revalidatePath('/seminars');
      return { success: 'Seminar row updated.' };
    }
    throw new InlineAdminValidationError('Unsupported admin table.');
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'InlineAdminValidationError', 'NewsValidationError'].includes(error.name)) {
      return { error: error.message };
    }
    const eventId = Sentry.captureException(error, { tags: { area: 'admin-tables', operation: 'inline-update' } });
    console.error('Unexpected admin inline update failure', { eventId });
    return { error: `The row could not be updated. Error reference: ${eventId}` };
  }
}

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
    if (!BULK_NEWS_STATUSES.includes(status)) throw new InlineAdminValidationError('Choose a valid News/Blog status.');

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

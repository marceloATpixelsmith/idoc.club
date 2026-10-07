import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthorizationError } from '@/lib/membership/authorization';
import { SupportForm } from '@/components/support/support-form';
import { CATEGORY_LABELS, listOwnConversations, STATUS_LABELS, SUPPORT_CATEGORIES } from '@/lib/support/inbox';
import { createSupportConversation } from '@/app/(dashboard)/dashboard/support/actions';
import { formatDateTime } from '@/lib/format';

export async function MemberSupportHome() {
  let conversations;
  try {
    conversations = await listOwnConversations();
  } catch (error) {
    if (error instanceof AuthorizationError) redirect('/dashboard');
    throw error;
  }
  return <div className="mx-auto max-w-7xl space-y-8 px-5 py-10 lg:px-8"><header><h1 className="text-2xl font-semibold">Support</h1><p className="text-muted-foreground">Ask the IDOC team for help and follow your conversations.</p></header>
    <section className="rounded-lg border p-5"><h2 className="mb-4 text-lg font-bold uppercase tracking-wider text-gold">New conversation</h2>
      <SupportForm action={createSupportConversation} pendingLabel="Sending" submitLabel="Start conversation">
        <input name="idempotencyKey" type="hidden" value={randomUUID()} />
        <label className="block">Category<select className="mt-1 block w-auto min-w-56 max-w-full rounded border p-2" name="category" required>{SUPPORT_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
        <label className="block">Subject<input className="mt-1 block w-full rounded border p-2" maxLength={160} name="subject" required /></label>
        <label className="block">Message<textarea className="mt-1 block min-h-32 w-full rounded border p-2" maxLength={10000} name="body" required /></label>
      </SupportForm>
    </section>
    <section><h2 className="mb-3 text-lg font-semibold">Your conversations</h2>{conversations.length === 0 ? <p className="text-muted-foreground">You have no support conversations.</p> : <ul className="divide-y rounded-lg border">{conversations.map((row) => <li key={String(row.public_id)}><Link className="flex items-center justify-between gap-4 p-4 hover:bg-muted" href={`/contact/${row.public_id}`}><div><strong>{String(row.subject)}</strong><p className="text-sm text-muted-foreground">{CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS]} · {formatDateTime(String(row.updated_at))}{row.unread ? ' · New reply' : ''}</p></div><span className="inline-flex shrink-0 items-center justify-center rounded-full border border-dotted border-[var(--input)] bg-[var(--surface-raised)] px-3 py-1 text-sm font-bold text-gold">{STATUS_LABELS[String(row.status)]}</span></Link></li>)}</ul>}</section>
  </div>;
}

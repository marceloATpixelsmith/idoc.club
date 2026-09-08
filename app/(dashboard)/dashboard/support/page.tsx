import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { SupportForm } from '@/components/support/support-form';
import { CATEGORY_LABELS, listOwnConversations, STATUS_LABELS, SUPPORT_CATEGORIES } from '@/lib/support/inbox';
import { createSupportConversation } from './actions';

export default async function MemberSupportPage() {
  const conversations = await listOwnConversations();
  return <div className="space-y-8 py-6 px-5 lg:px-8"><header><h1 className="text-2xl font-semibold">Support</h1><p className="text-muted-foreground">Ask the IDOC team for help and follow your conversations.</p></header>
    <section className="rounded-lg border p-5"><h2 className="mb-4 text-lg font-semibold">New conversation</h2>
      <SupportForm action={createSupportConversation} pendingLabel="Sending" submitLabel="Start conversation">
        <input name="idempotencyKey" type="hidden" value={randomUUID()} />
        <label className="block">Category<select className="mt-1 block w-full rounded border p-2" name="category" required>{SUPPORT_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
        <label className="block">Subject<input className="mt-1 block w-full rounded border p-2" maxLength={160} name="subject" required /></label>
        <label className="block">Message<textarea className="mt-1 block min-h-32 w-full rounded border p-2" maxLength={10000} name="body" required /></label>
      </SupportForm>
    </section>
    <section><h2 className="mb-3 text-lg font-semibold">Your conversations</h2>{conversations.length === 0 ? <p className="text-muted-foreground">You have no support conversations.</p> : <ul className="divide-y rounded-lg border">{conversations.map((row) => <li key={String(row.public_id)}><Link className="block p-4 hover:bg-muted" href={`/dashboard/support/${row.public_id}`}><div className="flex items-center justify-between gap-4"><strong>{String(row.subject)}</strong><span className="text-sm">{STATUS_LABELS[String(row.status)]}</span></div><p className="text-sm text-muted-foreground">{CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS]} · {new Date(String(row.updated_at)).toLocaleString()}{row.unread ? ' · New reply' : ''}</p></Link></li>)}</ul>}</section>
  </div>;
}

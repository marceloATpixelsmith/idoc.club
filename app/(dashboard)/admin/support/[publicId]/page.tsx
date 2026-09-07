import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SupportForm } from '@/components/support/support-form';
import { CATEGORY_LABELS, getAdminConversation, listEligibleAdministrators, STATUS_LABELS } from '@/lib/support/inbox';
import { assignSupportConversation, changeSupportConversationStatus, replyToSupportAsAdmin } from '../actions';

export default async function AdminSupportThread({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { publicId } = await params; const query = await searchParams;
  const [conversation, administrators] = await Promise.all([getAdminConversation(publicId), listEligibleAdministrators()]); if (!conversation) notFound();
  // A repeated query key (?returnTo=a&returnTo=b) delivers an array here at runtime regardless of a
  // narrower type annotation -- resolve to its first value before calling a string method on it.
  const returnToParam = Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo;
  const returnTo = returnToParam?.startsWith('/admin/support') ? returnToParam : '/admin/support';
  return <main className="space-y-6 p-8"><Link className="underline" href={returnTo}>← Support inbox</Link><header><h1 className="text-2xl font-semibold">{String(conversation.subject)}</h1><p>{String(conversation.member_name)} · {String(conversation.member_email)} · {CATEGORY_LABELS[conversation.category as keyof typeof CATEGORY_LABELS]} · <strong>{STATUS_LABELS[String(conversation.status)]}</strong></p></header>
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]"><section><ol className="space-y-4">{conversation.messages.map((message, index) => <li className={`rounded-lg border p-4 ${message.author_side === 'admin' ? 'bg-muted' : ''}`} key={`${message.created_at}-${index}`}><p className="mb-2 text-sm font-semibold">{message.author_side === 'admin' ? 'Administrator' : 'Member'} · {new Date(String(message.created_at)).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{String(message.body)}</p></li>)}</ol>
      <div className="mt-6"><h2 className="mb-3 text-lg font-semibold">Reply</h2><SupportForm action={replyToSupportAsAdmin} pendingLabel="Sending" submitLabel="Send administrator reply"><input name="idempotencyKey" type="hidden" value={randomUUID()} /><input name="publicId" type="hidden" value={publicId} /><label>Message<textarea className="mt-1 block min-h-32 w-full rounded border p-2" maxLength={10000} name="body" required /></label></SupportForm></div></section>
      <aside className="space-y-6"><section className="rounded-lg border p-4"><h2 className="mb-3 font-semibold">Assignment</h2><SupportForm action={assignSupportConversation} submitLabel="Save assignment"><input name="publicId" type="hidden" value={publicId} /><label>Administrator<select className="mt-1 block w-full border p-2" defaultValue={String(conversation.assigned_admin_key ?? '')} name="administratorId"><option value="">Unassigned</option>{administrators.map((admin) => <option key={String(admin.assignment_key)} value={String(admin.assignment_key)}>{String(admin.display_name)}</option>)}</select></label></SupportForm></section>
      <section className="rounded-lg border p-4"><h2 className="mb-3 font-semibold">Workflow</h2><SupportForm action={changeSupportConversationStatus} submitLabel={conversation.status === 'closed' ? 'Reopen conversation' : 'Close conversation'}><input name="publicId" type="hidden" value={publicId} /><input name="operation" type="hidden" value={conversation.status === 'closed' ? 'reopen' : 'close'} /></SupportForm></section></aside></div>
  </main>;
}

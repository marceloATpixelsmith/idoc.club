import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { SupportForm } from '@/components/support/support-form';
import { CATEGORY_LABELS, getOwnConversation, STATUS_LABELS } from '@/lib/support/inbox';
import { closeOwnConversation, replyToSupportConversation } from '@/app/(dashboard)/dashboard/support/actions';
import { formatDateTime } from '@/lib/format';
import { BackLink } from '@/components/ui/back-link';

export async function MemberSupportThread({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  if (!conversation) notFound();
  return <div className="mx-auto max-w-7xl space-y-6 px-5 py-8 lg:px-8"><BackLink href="/contact">Back to My Support Tickets</BackLink><header><h1 className="text-2xl font-semibold">{String(conversation.subject)}</h1><p>{CATEGORY_LABELS[conversation.category as keyof typeof CATEGORY_LABELS]} · <strong>{STATUS_LABELS[String(conversation.status)]}</strong></p></header>
    <ol className="space-y-4">{conversation.messages.map((message, index) => <li className={`rounded-lg border p-4 ${message.author_side === 'admin' ? 'bg-muted' : ''}`} key={`${message.created_at}-${index}`}><p className="mb-2 text-sm font-semibold">{message.author_side === 'admin' ? 'IDOC Support' : 'You'} · {formatDateTime(String(message.created_at))}</p><p className="whitespace-pre-wrap break-words">{String(message.body)}</p></li>)}</ol>
    {conversation.status === 'closed' ? <p className="rounded border p-4 text-muted-foreground">This conversation is closed and remains available to read. An administrator can reopen it.</p> : <>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"><p className="text-sm text-muted-foreground">If this resolved your issue, you can close it out yourself.</p><SupportForm action={closeOwnConversation} submitLabel="Close conversation"><input name="publicId" type="hidden" value={publicId} /></SupportForm></section>
      <section><h2 className="mb-3 text-lg font-semibold">Reply</h2><SupportForm action={replyToSupportConversation} pendingLabel="Sending" submitLabel="Send reply"><input name="idempotencyKey" type="hidden" value={randomUUID()} /><input name="publicId" type="hidden" value={publicId} /><label className="block">Message<textarea className="mt-1 block min-h-32 w-full rounded border p-2" maxLength={10000} name="body" required /></label></SupportForm></section>
    </>}
  </div>;
}

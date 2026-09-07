import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SupportForm } from '@/components/support/support-form';
import { CATEGORY_LABELS, getOwnConversation, STATUS_LABELS } from '@/lib/support/inbox';
import { replyToSupportConversation } from '../actions';

export default async function MemberSupportThread({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params; const conversation = await getOwnConversation(publicId); if (!conversation) notFound();
  return <div className="space-y-6 p-6"><Link className="underline" href="/dashboard/support">← Support inbox</Link><header><h1 className="text-2xl font-semibold">{String(conversation.subject)}</h1><p>{CATEGORY_LABELS[conversation.category as keyof typeof CATEGORY_LABELS]} · <strong>{STATUS_LABELS[String(conversation.status)]}</strong></p></header>
    <ol className="space-y-4">{conversation.messages.map((message, index) => <li className={`rounded-lg border p-4 ${message.author_side === 'admin' ? 'bg-muted' : ''}`} key={`${message.created_at}-${index}`}><p className="mb-2 text-sm font-semibold">{message.author_side === 'admin' ? 'IDOC Support' : 'You'} · {new Date(String(message.created_at)).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{String(message.body)}</p></li>)}</ol>
    {conversation.status === 'closed' ? <p className="rounded border p-4 text-muted-foreground">This conversation is closed and remains available to read. An administrator can reopen it.</p> : <section><h2 className="mb-3 text-lg font-semibold">Reply</h2><SupportForm action={replyToSupportConversation} pendingLabel="Sending" submitLabel="Send reply"><input name="idempotencyKey" type="hidden" value={randomUUID()} /><input name="publicId" type="hidden" value={publicId} /><label className="block">Message<textarea className="mt-1 block min-h-32 w-full rounded border p-2" maxLength={10000} name="body" required /></label></SupportForm></section>}
  </div>;
}

import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { AuthorizationError } from '@/lib/membership/authorization';
import { SupportForm } from '@/components/support/support-form';
import { ReplyComposer, SupportBubble } from '@/components/support/member-support-chat';
import { CATEGORY_LABELS, getOwnConversation, STATUS_LABELS } from '@/lib/support/inbox';
import { closeOwnConversation, replyToSupportConversation } from '@/app/(dashboard)/dashboard/support/actions';
import { formatDateTime } from '@/lib/format';
import { BackLink } from '@/components/ui/back-link';

export async function MemberSupportThread({ publicId }: { publicId: string }) {
  let conversation;
  try {
    conversation = await getOwnConversation(publicId);
  } catch (error) {
    if (error instanceof AuthorizationError) redirect('/dashboard');
    throw error;
  }
  if (!conversation) notFound();
  return <div className="mx-auto max-w-7xl px-5 pb-10 lg:px-8"><div className="max-w-3xl"><BackLink href="/contact">Back to My Support Tickets</BackLink>
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
      <div><h1 className="text-2xl font-semibold">{String(conversation.subject)}</h1><p className="text-sm text-muted-foreground">{CATEGORY_LABELS[conversation.category as keyof typeof CATEGORY_LABELS]} · <strong className="text-gold">{STATUS_LABELS[String(conversation.status)]}</strong></p></div>
      {conversation.status === 'closed' ? null : <SupportForm action={closeOwnConversation} submitLabel="Close conversation"><input name="publicId" type="hidden" value={publicId} /></SupportForm>}
    </header>
    <ol className="space-y-5">{conversation.messages.map((message, index) => {
      const side = message.author_side === 'admin' ? 'admin' : 'member';
      return <SupportBubble author={side === 'admin' ? 'IDOC Support' : 'You'} key={`${message.created_at}-${index}`} side={side} time={formatDateTime(String(message.created_at))}>{String(message.body)}</SupportBubble>;
    })}</ol>
    {conversation.status === 'closed' ? <p className="mt-8 rounded-xl border p-4 text-muted-foreground">This conversation is closed and remains available to read. An administrator can reopen it.</p> :
      <section aria-label="Reply" className="sticky bottom-0 mt-8 border-t bg-background/95 pb-2 pt-4 backdrop-blur"><ReplyComposer action={replyToSupportConversation} idempotencyKey={randomUUID()} publicId={publicId} /></section>
    }
  </div></div>;
}

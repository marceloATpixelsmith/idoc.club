import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, MessageCircle, MessageSquarePlus } from 'lucide-react';
import { AuthorizationError } from '@/lib/membership/authorization';
import { Button } from '@/components/ui/button';
import { CATEGORY_LABELS, listOwnConversations, STATUS_LABELS } from '@/lib/support/inbox';
import { formatDateTime } from '@/lib/format';

export async function MemberSupportHome() {
  let conversations;
  try {
    conversations = await listOwnConversations();
  } catch (error) {
    if (error instanceof AuthorizationError) redirect('/dashboard');
    throw error;
  }
  return <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8"><div className="max-w-4xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-2xl font-semibold">Your conversations</h2><p className="text-muted-foreground">Most recent activity first.</p></div>
      <Button asChild><Link href="/contact/new"><MessageSquarePlus aria-hidden />New ticket</Link></Button>
    </header>
    {conversations.length === 0
      ? <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center"><MessageCircle aria-hidden className="size-8 text-gold" /><p className="font-medium">No support tickets yet</p><p className="text-sm text-muted-foreground">Select New ticket to ask the IDOC team for help.</p></div>
      : <ul className="space-y-3">{conversations.map((row) => {
        const status = String(row.status);
        return <li key={String(row.public_id)}><Link className="group flex items-center gap-4 rounded-xl border bg-surface-raised/40 p-4 transition-colors hover:border-gold/60 hover:bg-surface-raised" href={`/contact/${row.public_id}`}>
          <span aria-hidden className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-gold"><MessageCircle className="size-5" />{row.unread ? <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-gold ring-2 ring-background" /> : null}</span>
          <div className="min-w-0 flex-1">
            <p className={`truncate ${row.unread ? 'font-bold' : 'font-semibold'}`}>{String(row.subject)}</p>
            <p className="truncate text-sm text-muted-foreground">{CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS]} · {formatDateTime(String(row.updated_at))}{row.unread ? ' · New reply' : ''}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold ${status === 'closed' ? 'text-muted-foreground' : 'border-gold/40 text-gold'}`}>{STATUS_LABELS[status]}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link></li>;
      })}</ul>}
  </div></div>;
}

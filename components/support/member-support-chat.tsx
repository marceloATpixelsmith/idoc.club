'use client';

import { useActionState, useRef } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

type State = { error?: string; success?: string };
type Action = (state: State, data: FormData) => Promise<State>;
type Option = { label: string; value: string };

export function SupportAvatar({ side }: { side: 'admin' | 'member' }) {
  return <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${side === 'admin' ? 'bg-gold text-primary-foreground' : 'bg-surface-raised text-gold ring-1 ring-border'}`}>{side === 'admin' ? 'ID' : 'You'}</span>;
}

/** A single chat bubble: avatar, rounded bubble, then the author/time line -- the same shape in the thread page and
 * on the new-ticket page so a new ticket and an existing thread read as one conversation. */
export function SupportBubble({ author, children, side, time }: { author: string; children: React.ReactNode; side: 'admin' | 'member'; time?: string }) {
  const mine = side === 'member';
  return <li className={`flex items-end gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
    <SupportAvatar side={side} />
    <div className={`flex max-w-[85%] flex-col sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${mine ? 'rounded-br-md bg-gold text-primary-foreground' : 'rounded-bl-md bg-muted text-foreground'}`}>{children}</div>
      <p className="mt-1 px-1 text-xs text-muted-foreground"><span className="font-semibold">{author}</span>{time ? ` · ${time}` : ''}</p>
    </div>
  </li>;
}

function Composer({ action, children, idempotencyKey, label, placeholder, rows }: { action: Action; children?: React.ReactNode; idempotencyKey: string; label: string; placeholder: string; rows: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  return <form action={formAction} className="space-y-2" key={idempotencyKey} ref={form}>
    <CsrfField />
    <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
    <div className="rounded-2xl border bg-background p-2 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
      {children}
      <div className="flex items-end gap-2">
        <textarea aria-label="Message" className="max-h-48 min-h-11 w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground" maxLength={10000} name="body" onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.current?.requestSubmit(); } }} placeholder={placeholder} required rows={rows} />
        <Button aria-label={label} className="shrink-0 rounded-full" disabled={pending} size="icon" type="submit">{pending ? <Loader2 aria-hidden className="animate-spin" /> : <SendHorizontal aria-hidden />}</Button>
      </div>
    </div>
    <p className="px-1 text-xs text-muted-foreground">Press Ctrl/⌘ + Enter to send.</p>
    {state.error ? <p className="text-sm text-red-500" role="alert">{state.error}</p> : null}
  </form>;
}

export function ReplyComposer({ action, idempotencyKey, publicId }: { action: Action; idempotencyKey: string; publicId: string }) {
  return <Composer action={action} idempotencyKey={idempotencyKey} label="Send reply" placeholder="Write a reply…" rows={1}><input name="publicId" type="hidden" value={publicId} /></Composer>;
}

/** The first message of a new ticket: the same bubble conversation as a thread, with the category picked inside the
 * message box itself (radio pills, one must be chosen) rather than in a separate form or drawer. */
export function NewTicketChat({ action, categories, idempotencyKey }: { action: Action; categories: Option[]; idempotencyKey: string }) {
  return <div className="space-y-6">
    <ul><SupportBubble author="IDOC Support" side="admin">Hello! What can we help you with? Choose a topic below, write your message and send it. A member of the IDOC team will reply here.</SupportBubble></ul>
    <Composer action={action} idempotencyKey={idempotencyKey} label="Start conversation" placeholder="Describe how we can help…" rows={4}>
      <fieldset className="flex flex-wrap gap-2 border-b px-2 pb-3 pt-2">
        <legend className="sr-only">Topic</legend>
        {categories.map((option) => <label className="cursor-pointer" key={option.value}>
          <input className="peer sr-only" name="category" required type="radio" value={option.value} />
          <span className="inline-flex rounded-full border px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:border-gold/60 peer-checked:border-gold peer-checked:bg-gold peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-gold/50">{option.label}</span>
        </label>)}
      </fieldset>
    </Composer>
  </div>;
}

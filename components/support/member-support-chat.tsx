'use client';

import { useActionState, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Loader2, MessageSquarePlus, SendHorizontal, X } from 'lucide-react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

type State = { error?: string; success?: string };
type Action = (state: State, data: FormData) => Promise<State>;
type Option = { label: string; value: string };

export function SupportAvatar({ side }: { side: 'admin' | 'member' }) {
  return <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${side === 'admin' ? 'bg-gold text-primary-foreground' : 'bg-surface-raised text-gold ring-1 ring-border'}`}>{side === 'admin' ? 'ID' : 'You'}</span>;
}

/** A single chat bubble: avatar, rounded bubble, then the author/time line -- the same shape in the thread page and
 * in the new-ticket drawer's greeting so the two read as one conversation. */
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
  return <form action={formAction} className="space-y-3" key={idempotencyKey} ref={form}>
    <CsrfField />
    <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
    {children}
    <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
      <textarea aria-label="Message" className="max-h-48 min-h-11 w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground" maxLength={10000} name="body" onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.current?.requestSubmit(); } }} placeholder={placeholder} required rows={rows} />
      <Button aria-label={label} className="shrink-0 rounded-full" disabled={pending} size="icon" type="submit">{pending ? <Loader2 aria-hidden className="animate-spin" /> : <SendHorizontal aria-hidden />}</Button>
    </div>
    <p className="px-1 text-xs text-muted-foreground">Press Ctrl/⌘ + Enter to send.</p>
    {state.error ? <p className="text-sm text-red-500" role="alert">{state.error}</p> : null}
  </form>;
}

export function ReplyComposer({ action, idempotencyKey, publicId }: { action: Action; idempotencyKey: string; publicId: string }) {
  return <Composer action={action} idempotencyKey={idempotencyKey} label="Send reply" placeholder="Write a reply…" rows={1}><input name="publicId" type="hidden" value={publicId} /></Composer>;
}

export function NewTicketDrawer({ action, categories, idempotencyKey }: { action: Action; categories: Option[]; idempotencyKey: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><Button type="button"><MessageSquarePlus aria-hidden />New ticket</Button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l bg-background shadow-2xl outline-none sm:max-w-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <Dialog.Title className="text-2xl font-semibold text-gold">New support ticket</Dialog.Title>
          <Dialog.Close asChild><Button aria-label="Close" size="icon-sm" title="Close" type="button" variant="ghost"><X aria-hidden /></Button></Dialog.Close>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <ul><SupportBubble author="IDOC Support" side="admin">Hello! Tell us what you need help with and a member of the IDOC team will reply here.</SupportBubble></ul>
          <Composer action={action} idempotencyKey={idempotencyKey} label="Start conversation" placeholder="Describe how we can help…" rows={5}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">Category<select className="mt-1 block w-full rounded-md border bg-background p-2 text-base" name="category" required>{categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="block text-sm font-medium">Subject<input className="mt-1 block w-full rounded-md border bg-background p-2 text-base" maxLength={160} name="subject" required /></label>
            </div>
          </Composer>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

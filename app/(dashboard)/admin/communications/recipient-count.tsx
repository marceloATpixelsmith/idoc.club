'use client';

import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type CountRecipient = { email: string; member: string; profileId: number | null };

/** A non-delivered count that opens a list of the addresses behind it, one per line (docs/07 §13.2). Each address with a member
 * links to that member's timeline drawer so it can be investigated one by one. A zero is plain text. */
export function RecipientCount({ count, label, recipients }: { count: number | string; label: string; recipients: CountRecipient[] }) {
  if (typeof count === 'string' || count === 0 || recipients.length === 0) return <>{count}</>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label={`${count} — show the ${recipients.length} address${recipients.length === 1 ? '' : 'es'}: ${label}`} className="cursor-pointer font-semibold text-gold underline decoration-dotted underline-offset-4 hover:opacity-80" type="button">{count}</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[90vw] space-y-2 p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-gold">{label}</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {recipients.map((recipient, index) => (
            <li className="break-all" key={`${recipient.email}-${index}`}>
              {recipient.profileId
                ? <Link className="underline underline-offset-4" href={`/admin/members?timeline=${recipient.profileId}`} title={`Open ${recipient.member}'s timeline`}>{recipient.email}</Link>
                : recipient.email}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Select an address to open that member&apos;s timeline.</p>
      </PopoverContent>
    </Popover>
  );
}

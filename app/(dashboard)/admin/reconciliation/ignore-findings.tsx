'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { CsrfField } from '@/components/security/csrf-field';
import { ActionBarItem } from '@/components/ui/action-bar';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';

export type IgnoreState = { error?: string; success?: string };
type Action = (state: IgnoreState, formData: FormData) => Promise<IgnoreState>;

/** Selection-bar action: ignore specific issues so they stop appearing. Offered only while every selected row is ignorable and they are all the same Type; the server re-checks every finding. */
export function IgnoreFindings({ action, clearSelection, selected }: { action: Action; clearSelection: () => void; selected: ReadOnlyRow[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { alert, confirm, dialogs } = useBrandedDialogs();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<IgnoreState>({});
  // `ignorable` is set by the server per finding. An ignore applies to one specific kind of issue at a time: the selection must all be the same Type.
  const matching = selected.filter((row) => row.ignorable === 'yes');
  const types = new Set(selected.map((row) => row.kind));
  const mixedSelection = matching.length !== selected.length || types.size > 1;

  useEffect(() => {
    if (state.success) { alert(state.success); clearSelection(); router.refresh(); }
    else if (state.error) alert(state.error, 'Could not ignore');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (matching.length === 0) return null;
  const onSelect = async (event: Event) => {
    event.preventDefault();
    if (pending || mixedSelection || !formRef.current) return;
    const accepted = await confirm({
      confirmLabel: 'Ignore', title: 'Ignore these issues?',
      message: `You will stop seeing ${matching.length.toLocaleString('en-GB')} ${matching[0]?.kind ?? 'issue'} item(s) in the report, and the scan will leave them alone.\n\nUse this once you have dealt with them as far as you can (for example you contacted the member and they cannot or will not update their payment). An ignored issue returns only if you restore it from the Ignored issues list, or if it clears and later happens again.`,
    });
    if (!accepted) return;
    const formData = new FormData(formRef.current);
    for (const row of matching) formData.append('findingId', row.id);
    startTransition(async () => { setState(await action({}, formData)); });
  };

  return (
    <>
      <form ref={formRef}><CsrfField /></form>
      <ActionBarItem disabled={pending || mixedSelection} onSelect={onSelect} title={mixedSelection ? 'Select issues of one Type only to ignore them' : undefined}>
        {pending ? 'Saving…' : mixedSelection ? 'Ignore (select issues of one Type only)' : `Ignore ${matching.length.toLocaleString('en-GB')} selected issue${matching.length === 1 ? '' : 's'}`}
      </ActionBarItem>
      {dialogs}
    </>
  );
}

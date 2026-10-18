'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { CsrfField } from '@/components/security/csrf-field';
import { ActionBarItem } from '@/components/ui/action-bar';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';

export type MarkHandledState = { error?: string; success?: string };
type Action = (state: MarkHandledState, formData: FormData) => Promise<MarkHandledState>;

/** Selection-bar action for notices raised by Stripe notifications. Offered only while every selected row is such a notice; the server re-checks every finding. */
export function MarkFindingsHandled({ action, clearSelection, selected }: { action: Action; clearSelection: () => void; selected: ReadOnlyRow[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { alert, confirm, dialogs } = useBrandedDialogs();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<MarkHandledState>({});
  // `closable` is set by the server per finding (notification-raised notices only); a scan-raised finding clears itself and cannot be closed by hand.
  const matching = selected.filter((row) => row.closable === 'yes');
  const mixedSelection = matching.length !== selected.length;

  useEffect(() => {
    if (state.success) { alert(state.success); clearSelection(); router.refresh(); }
    else if (state.error) alert(state.error, 'Could not mark handled');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (matching.length === 0) return null;
  const onSelect = async (event: Event) => {
    event.preventDefault();
    if (pending || mixedSelection || !formRef.current) return;
    const accepted = await confirm({
      confirmLabel: 'Mark handled', title: 'Mark these notices handled?',
      message: `This removes ${matching.length.toLocaleString('en-GB')} notice(s) from the list. Close a notice once you have looked into it (and, for a payment, decided what to do); this only records that someone did.\\n\\nThe action is audit-logged.`,
    });
    if (!accepted) return;
    const formData = new FormData(formRef.current);
    for (const row of matching) formData.append('findingId', row.id);
    startTransition(async () => { setState(await action({}, formData)); });
  };

  return (
    <>
      <form ref={formRef}><CsrfField /></form>
      <ActionBarItem disabled={pending || mixedSelection} onSelect={onSelect} title={mixedSelection ? 'Select only notices raised by Stripe notifications to mark them handled' : undefined}>
        {pending ? 'Saving…' : mixedSelection ? 'Mark handled (select only notices raised by Stripe notifications)' : `Mark ${matching.length.toLocaleString('en-GB')} selected notice${matching.length === 1 ? '' : 's'} handled`}
      </ActionBarItem>
      {dialogs}
    </>
  );
}

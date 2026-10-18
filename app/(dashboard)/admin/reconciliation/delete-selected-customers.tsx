'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import type { ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { CsrfField } from '@/components/security/csrf-field';
import { ActionBarItem } from '@/components/ui/action-bar';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';
import type { CleanupCustomersState } from './cleanup-customers-form';

export const UNLINKED_CUSTOMER_LABEL = 'Unlinked Stripe Customer';
type Action = (state: CleanupCustomersState, formData: FormData) => Promise<CleanupCustomersState>;

/** Table selection-bar action: deletes the selected "Unlinked Stripe Customer" rows in Stripe. The server re-checks every customer
 * and only ever acts on customers that are current unlinked-customer findings, whatever the browser sends. */
export function DeleteSelectedCustomers({ action, clearSelection, selected }: { action: Action; clearSelection: () => void; selected: ReadOnlyRow[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { alert, confirm, dialogs } = useBrandedDialogs();
  const [state, run, pending, challenge] = useFreshStepUpAction<CleanupCustomersState>(action, {});
  // A bulk action belongs to one row Type: it is offered only while every selected row is that Type, never applied to a mixed selection.
  const matching = selected.filter((row) => row.kind === UNLINKED_CUSTOMER_LABEL && row.stripeId);
  const mixedSelection = matching.length !== selected.length;
  const customerIds = matching.map((row) => row.stripeId as string);

  useEffect(() => {
    if (state.success) { alert(state.success); clearSelection(); router.refresh(); }
    else if (state.error) alert(state.error, 'Could not delete');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (customerIds.length === 0) return null;
  const onSelect = async () => {
    if (pending || mixedSelection || !formRef.current) return;
    const accepted = await confirm({
      confirmLabel: 'Delete customers', destructive: true, title: 'Delete selected Stripe customers?',
      message: `This permanently deletes ${customerIds.length.toLocaleString('en-GB')} customer record(s) in Stripe that IDOC has no record of.\n\nAny with a live subscription, an open invoice or a charge in the last 90 days are skipped automatically.\n\nThis cannot be undone.`,
    });
    if (!accepted) return;
    const formData = new FormData(formRef.current);
    for (const id of customerIds) formData.append('customerId', id);
    run(formData);
  };

  return (
    <>
      <form ref={formRef}><CsrfField /></form>
      <ActionBarItem disabled={pending || mixedSelection} onSelect={onSelect} title={mixedSelection ? 'Select only Unlinked Stripe Customer rows to delete them' : undefined}>{pending ? 'Deleting…' : mixedSelection ? 'Delete Stripe customers (select only Unlinked Stripe Customer rows)' : `Delete ${customerIds.length.toLocaleString('en-GB')} selected Stripe customer${customerIds.length === 1 ? '' : 's'}`}</ActionBarItem>
      {challenge}
      {dialogs}
    </>
  );
}

'use client';

import { useEffect, useMemo, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';
import { Button } from '@/components/ui/button';

export type CleanupCustomersState = StepUpActionState & { csv?: string; error?: string; success?: string };
type Action = (state: CleanupCustomersState, formData: FormData) => Promise<CleanupCustomersState>;

/** Super Admin only, production only: removes the Stripe customers the last scan found with no IDOC billing account. */
export function CleanupCustomersForm({ action, count }: { action: Action; count: number }) {
  const router = useRouter();
  const { confirm, dialogs } = useBrandedDialogs();
  const [state, run, pending, challenge] = useFreshStepUpAction<CleanupCustomersState>(action, {});
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  const downloadUrl = useMemo(() => (state.csv ? URL.createObjectURL(new Blob([state.csv], { type: 'text/csv' })) : null), [state.csv]);
  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const accepted = await confirm({
      confirmLabel: 'Delete customers', destructive: true, title: 'Delete unlinked Stripe customers?',
      message: `This permanently deletes up to ${count.toLocaleString('en-GB')} customer record(s) in Stripe that IDOC has no record of.\n\nAny customer with a live subscription, an open invoice or a charge in the last 90 days is skipped automatically. A list of what was deleted is offered for download afterwards.\n\nThis cannot be undone.`,
    });
    if (accepted) run(new FormData(form));
  };

  return (
    <>
      <form className="mt-3 space-y-2" onSubmit={submit}>
        <CsrfField />
        <Button disabled={pending} type="submit" variant="destructive">{pending ? 'Deleting… this can take a few minutes' : `Delete ${count.toLocaleString('en-GB')} unlinked customer${count === 1 ? '' : 's'} in Stripe`}</Button>
        {state.error ? <p className="text-sm text-red-300" role="alert">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-emerald-200" role="status">{state.success}</p> : null}
        {downloadUrl ? <a className="text-sm text-primary underline underline-offset-4" download="stripe-customer-cleanup.csv" href={downloadUrl}>Download the list of customers processed (CSV)</a> : null}
      </form>
      {challenge}
      {dialogs}
    </>
  );
}

'use client';

import { useActionState, useEffect, useRef } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { useAdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';

type State = { error?: string; success?: string };
/** Mirrors components/support/support-form.tsx's generic action-state form wrapper -- same pattern,
 * kept as its own small copy so the News/Blog feature does not reach across into an unrelated
 * feature's directory for a shared UI primitive. */
export function NewsForm({ action, children, confirmMessage, pendingLabel = 'Saving', submitLabel }: { action: (state: State, data: FormData) => Promise<State>; children: React.ReactNode; confirmMessage?: string; pendingLabel?: string; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const closeDrawer = useAdminFormDrawer();
  const { confirm, dialogs } = useBrandedDialogs();
  const confirmed = useRef(false);
  useEffect(() => { if (state.success && closeDrawer) closeDrawer(); }, [state.success, closeDrawer]);
  return <form action={formAction} className="space-y-4" encType="multipart/form-data" onSubmit={(event) => {
    // The branded dialog is asynchronous: hold the submit, ask, then submit again (same button) once confirmed.
    if (!confirmMessage || confirmed.current) { confirmed.current = false; return; }
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    void confirm({ message: confirmMessage, confirmLabel: 'Continue', destructive: true }).then((accepted) => {
      if (!accepted) return;
      confirmed.current = true;
      form.requestSubmit(submitter);
    });
  }}><CsrfField />{children}
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
    {state.success ? <p className="text-sm text-green-700" role="status">{state.success}</p> : null}
    <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text={pendingLabel} /> : submitLabel}</Button>
    {dialogs}
  </form>;
}

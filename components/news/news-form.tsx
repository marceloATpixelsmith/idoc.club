'use client';

import { useActionState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

type State = { error?: string; success?: string };
/** Mirrors components/support/support-form.tsx's generic action-state form wrapper -- same pattern,
 * kept as its own small copy so the News/Blog feature does not reach across into an unrelated
 * feature's directory for a shared UI primitive. */
export function NewsForm({ action, children, pendingLabel = 'Saving', submitLabel }: { action: (state: State, data: FormData) => Promise<State>; children: React.ReactNode; pendingLabel?: string; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="space-y-4"><CsrfField />{children}
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
    {state.success ? <p className="text-sm text-green-700" role="status">{state.success}</p> : null}
    <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text={pendingLabel} /> : submitLabel}</Button>
  </form>;
}

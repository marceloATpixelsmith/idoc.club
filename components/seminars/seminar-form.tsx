'use client';

import { useActionState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

type State = { error?: string; success?: string };
/** Same generic action-state form wrapper as components/news/news-form.tsx and
 * components/support/support-form.tsx -- kept as its own small copy per feature rather than a
 * shared cross-feature import (see components/news/news-form.tsx's header comment). */
export function SeminarForm({ action, children, pendingLabel = 'Saving', submitLabel }: { action: (state: State, data: FormData) => Promise<State>; children: React.ReactNode; pendingLabel?: string; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="space-y-4"><CsrfField />{children}
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
    {state.success ? <p className="text-sm text-green-700" role="status">{state.success}</p> : null}
    <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text={pendingLabel} /> : submitLabel}</Button>
  </form>;
}

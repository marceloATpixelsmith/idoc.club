'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

export type RunScanState = { error?: string; success?: string };

/** Super Admin only: runs the same read-only comparison the daily job runs, so the page does not have to wait for 07:00 UTC. */
export function RunScanForm({ action }: { action: (state: RunScanState, formData: FormData) => Promise<RunScanState> }) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form action={run} className="mt-3 space-y-2">
      <CsrfField />
      <Button disabled={pending} type="submit" variant="outline">{pending ? 'Scanning Stripe… this can take a minute' : 'Run scan now'}</Button>
      {state.error ? <p className="text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-200" role="status">{state.success}</p> : null}
    </form>
  );
}

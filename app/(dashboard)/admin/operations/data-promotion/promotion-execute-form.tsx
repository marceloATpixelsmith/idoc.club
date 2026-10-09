'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

export type PromotionActionState = StepUpActionState & { error?: string; success?: string };

export function PromotionExecuteForm({
  action,
  planToken,
}: {
  action: (state: PromotionActionState, formData: FormData) => Promise<PromotionActionState>;
  planToken: string;
}) {
  const router = useRouter();
  const [state, run, pending, challenge] = useFreshStepUpAction<PromotionActionState>(action, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <>
      <form action={run}>
        <CsrfField />
        <input name="planToken" type="hidden" value={planToken} />
        <Button disabled={pending} type="submit">{pending ? 'Verifying…' : 'Promote to Production'}</Button>
      </form>
      {state.error ? <p className="mt-2 text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.success ? <p className="mt-2 text-sm text-emerald-300" role="status">{state.success}</p> : null}
      {challenge}
    </>
  );
}

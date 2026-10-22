'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Play } from 'lucide-react';

import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import type { ManualGithubWorkflow } from '@/lib/admin/manual-github-operations';

export type ManualGithubOperationActionState = StepUpActionState & { workflowUrl?: string };
type Action = (state: ManualGithubOperationActionState, formData: FormData) => Promise<ManualGithubOperationActionState>;

export function ManualGithubOperationForm({
  action,
  workflow,
  label,
}: {
  action: Action;
  workflow: ManualGithubWorkflow;
  label: string;
}) {
  const router = useRouter();
  const [state, run, pending, challenge] = useFreshStepUpAction<ManualGithubOperationActionState>(action, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <>
      <form action={run}>
        <CsrfField />
        <input name="workflow" type="hidden" value={workflow} />
        <Button disabled={pending} type="submit">
          <Play aria-hidden="true" className="size-4" />
          {pending ? 'Verifying…' : label}
        </Button>
      </form>
      {state.error ? <p className="mt-3 text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.success ? (
        <p className="mt-3 text-sm text-emerald-300" role="status">
          {state.success}{' '}
          {state.workflowUrl ? <a className="inline-flex items-center gap-1 underline" href={state.workflowUrl} rel="noreferrer" target="_blank">Open workflow runs <ExternalLink aria-hidden="true" className="size-3" /></a> : null}
        </p>
      ) : null}
      {challenge}
    </>
  );
}

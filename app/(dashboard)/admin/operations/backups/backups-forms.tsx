'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { FormToggle } from '@/components/ui/form-toggle';

export type BackupsActionState = StepUpActionState & { error?: string; success?: string };
type Action = (state: BackupsActionState, formData: FormData) => Promise<BackupsActionState>;

function Result({ state }: { state: BackupsActionState }) {
  return (
    <>
      {state.error ? <p className="mt-3 text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.success ? <p className="mt-3 text-sm text-emerald-300" role="status">{state.success}</p> : null}
    </>
  );
}

export function MaintenanceForm({ action, enabled, reason }: { action: Action; enabled: boolean; reason: string }) {
  const router = useRouter();
  const [state, run, pending, challenge] = useFreshStepUpAction<BackupsActionState>(action, {});
  const [on, setOn] = useState(enabled);
  const [text, setText] = useState(reason);
  useEffect(() => { setOn(enabled); }, [enabled]);
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  return (
    <>
      <form action={run} className="space-y-4">
        <CsrfField />
        <FormToggle checked={on} description="While on, everyone except a signed-in Super Admin sees the maintenance page. Stripe and background jobs are asked to retry later."
          id="maintenance-enabled" label="Maintenance mode" name="enabled" onChange={(event) => setOn(event.target.checked)} />
        <label className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          Reason (internal note, optional)
          <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" maxLength={200} name="reason" onChange={(event) => setText(event.target.value)} value={text} />
        </label>
        <Button disabled={pending} type="submit">{pending ? 'Verifying…' : on ? 'Turn maintenance mode ON' : 'Turn maintenance mode OFF'}</Button>
      </form>
      <Result state={state} />
      {challenge}
    </>
  );
}

export function DrillForm({ action, options, disabled }: { action: Action; options: Array<{ value: string; label: string }>; disabled: boolean }) {
  const router = useRouter();
  const [state, run, pending, challenge] = useFreshStepUpAction<BackupsActionState>(action, {});
  const [selection, setSelection] = useState(options[0]?.value ?? 'latest');
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  return (
    <>
      <form action={run} className="space-y-4">
        <CsrfField />
        <label className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          Backup to restore
          <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="selection" onChange={(event) => setSelection(event.target.value)} value={selection}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <Button disabled={pending || disabled} type="submit">{pending ? 'Verifying…' : 'Run restore drill'}</Button>
      </form>
      <Result state={state} />
      {challenge}
    </>
  );
}

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { SwitchoverGuide } from './switchover-guide';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { gatherFinalInputs, gatherSwitchoverInputs } from '@/lib/operations/switchover-checks';
import { evaluateFinal, evaluateSwitchover, type SwitchoverCheck } from '@/lib/operations/switchover-checks-core';
import { buildGuide } from '@/lib/operations/switchover-guide-core';

export const dynamic = 'force-dynamic';

const BADGE = { ok: 'text-emerald-300', todo: 'text-amber-200', warn: 'text-red-300' } as const;
const TEXT = { ok: 'Ready', todo: 'To do', warn: 'Check' } as const;

function CheckList({ checks, testId }: { checks: SwitchoverCheck[]; testId: string }) {
  return (
    <ul className="space-y-3 text-sm" data-testid={testId}>
      {checks.map((check) => (
        <li className="rounded-md border border-border p-3" key={check.id}>
          <p className="font-medium text-foreground">{check.label} · <span className={BADGE[check.status]}>{TEXT[check.status]}</span></p>
          <p className="text-muted-foreground">{check.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export default async function SwitchoverPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  const [inputs, finalInputs] = await Promise.all([gatherSwitchoverInputs(), gatherFinalInputs()]);
  const host = (await headers()).get('host')?.split(':')[0]?.toLowerCase() ?? null;
  const steps = buildGuide({ final: finalInputs, host, inputs });
  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations</p>
        <h1 className="text-3xl font-semibold text-gold">Production switchover</h1>
        <p className="max-w-3xl text-muted-foreground">
          The guided walkthrough for the move to idoc.club (docs/30), then the live checks behind it. It tells you which step is next and exactly what to change, and it verifies what the site can see after each step. It reads settings by presence and domain only, never value, and changes nothing. Run it on the production site for the real answer.
        </p>
      </header>
      <AdminFormSection description="Do the highlighted step, then press Re-check. Settings change only after a redeploy." title="Guided steps">
        <SwitchoverGuide steps={steps} />
      </AdminFormSection>
      <AdminFormSection description="The detailed state behind the steps. Settings change only after a redeploy, so reload after redeploying." title="Status">
        <CheckList checks={evaluateSwitchover(inputs)} testId="switchover-checks" />
      </AdminFormSection>
      <AdminFormSection description="Run this after the import, the event replay and the first reconciliation scan. It reports the end state of everything the switchover touched." title="Final verification">
        <CheckList checks={evaluateFinal(finalInputs)} testId="switchover-final" />
      </AdminFormSection>
      <p className="text-sm text-muted-foreground">Tools: <a className="underline" href="/admin/operations/legacy-import">Legacy import</a> · <a className="underline" href="/admin/operations/event-replay">Replay Stripe events</a> · <a className="underline" href="/admin/reconciliation">Stripe reconciliation</a></p>
    </main>
  );
}

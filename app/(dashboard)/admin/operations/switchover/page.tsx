import { notFound } from 'next/navigation';

import { AdminFormSection } from '@/components/admin/admin-form-section';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { runSwitchoverChecks } from '@/lib/operations/switchover-checks';

export const dynamic = 'force-dynamic';

const BADGE = { ok: 'text-emerald-300', todo: 'text-amber-200', warn: 'text-red-300' } as const;
const TEXT = { ok: 'Ready', todo: 'To do', warn: 'Check' } as const;

export default async function SwitchoverPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  const checks = await runSwitchoverChecks();
  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations</p>
        <h1 className="text-3xl font-semibold text-gold">Production switchover</h1>
        <p className="max-w-3xl text-muted-foreground">
          Read-only status of everything the switchover depends on, for the environment you are looking at. It reads settings by presence and domain only (never values) and changes nothing. Follow the ordered steps in docs/30; reload this page after each step.
        </p>
      </header>
      <AdminFormSection description="Run this on the production site. Settings change only after a redeploy, so reload after redeploying." title="Status">
        <ul className="space-y-3 text-sm" data-testid="switchover-checks">
          {checks.map((check) => (
            <li className="rounded-md border border-border p-3" key={check.id}>
              <p className="font-medium text-foreground">{check.label} · <span className={BADGE[check.status]}>{TEXT[check.status]}</span></p>
              <p className="text-muted-foreground">{check.detail}</p>
            </li>
          ))}
        </ul>
      </AdminFormSection>
      <p className="text-sm text-muted-foreground">Next tools: <a className="underline" href="/admin/operations/legacy-import">Legacy import</a> · <a className="underline" href="/admin/operations/event-replay">Replay Stripe events</a> · <a className="underline" href="/admin/reconciliation">Stripe reconciliation</a></p>
    </main>
  );
}

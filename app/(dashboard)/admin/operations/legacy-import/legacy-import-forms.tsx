'use client';

import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import type { DryRunResult } from '@/lib/legacy-import/dry-run';
import type { DryRunReport } from '@/lib/legacy-import/transform';

export type LegacyImportActionState = StepUpActionState & { error?: string; result?: DryRunResult };
type Action = (state: LegacyImportActionState, formData: FormData) => Promise<LegacyImportActionState>;

const fmt = (n: number) => n.toLocaleString('en-GB');
function Counts({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {entries.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
        <ul className="text-sm text-muted-foreground">{entries.map(([key, count]) => <li key={key}>{fmt(count)} · {key.replace(/_/g, ' ')}</li>)}</ul>
      )}
    </div>
  );
}

export function DryRunReportView({ report, files }: { report: DryRunReport; files: DryRunResult['files'] }) {
  return (
    <div className="space-y-5" data-testid="legacy-dry-run-report">
      <p className="text-sm text-muted-foreground">Dry run only — nothing was written. Counted as of {report.asOf}. Files: {files.map((file) => `${file.name} (${file.sha256.slice(0, 12)}…)`).join(', ')}</p>
      <p className="text-base text-foreground">
        {fmt(report.legacyUsers)} legacy users · {fmt(report.importable)} would be imported · {fmt(report.held)} held for review and not imported
      </p>
      <div className="grid gap-5 md:grid-cols-3">
        <Counts counts={report.membershipStatus} title="Membership status today (importable members)" />
        <Counts counts={report.classification} title="Membership product → roles" />
        <Counts counts={report.hashFormats} title="Password hash formats" />
        <Counts counts={{ complete: report.profile.complete, 'needs onboarding': report.profile.needsOnboarding }} title="Profile completeness" />
        <Counts counts={report.profile.missingFields} title="Missing required fields" />
        <Counts counts={report.notes} title="Automatic fills and defaults" />
        <Counts counts={{
          'with a stored Stripe customer': report.stripe.withCustomerId, 'with a live (newest active) subscription': report.stripe.withActiveSubscription,
          'active subscription but no customer ID': report.stripe.activeSubscriptionWithoutCustomer, 'customer ID but no active subscription': report.stripe.customerWithoutActiveSubscription,
        }} title="Stripe linkage (from the legacy data; not yet checked against Stripe)" />
        <Counts counts={report.subscriptionsByStatus} title="Legacy subscriptions by status" />
        <Counts counts={{ paid: report.payments.paid, refunded: report.payments.refunded, 'Stripe references': report.payments.stripe, 'manual (no Stripe ID)': report.payments.manual, 'ignored (failed or pending)': report.payments.ignoredFailedOrPending }} title="Payments to import" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">Exceptions (legacy user IDs only)</h3>
        {report.exceptions.length === 0 && report.orphans.paymentUsers === 0 && report.orphans.subscriptionUsers === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
          <ul className="space-y-2 text-sm">
            {report.exceptions.map((item) => (
              <li className="rounded-md border border-border p-3" key={item.code}>
                <p className="font-medium text-foreground">{fmt(item.count)} · {item.text}{item.held ? ' (held, not imported)' : ''}</p>
                <p className="break-words text-xs text-muted-foreground">{item.legacyUserIds.join(', ')}{item.count > item.legacyUserIds.length ? ', …' : ''}</p>
              </li>
            ))}
            {report.orphans.paymentUsers > 0 || report.orphans.subscriptionUsers > 0 ? (
              <li className="rounded-md border border-border p-3">
                <p className="font-medium text-foreground">{fmt(report.orphans.paymentUsers)} payment users and {fmt(report.orphans.subscriptionUsers)} subscription users have no account record (not imported)</p>
                <p className="break-words text-xs text-muted-foreground">Payment users: {report.orphans.paymentUserIds.join(', ') || 'none'}</p>
                <p className="break-words text-xs text-muted-foreground">Subscription users: {report.orphans.subscriptionUserIds.join(', ') || 'none'}</p>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}

export function DryRunForm({ action }: { action: Action }) {
  const [state, run, pending, challenge] = useFreshStepUpAction<LegacyImportActionState>(action, {});
  return (
    <>
      <form action={run} className="space-y-4">
        <CsrfField />
        <label className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          Users dump (WordPress users and usermeta tables)
          <input accept=".sql,text/plain" className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="usersFile" required type="file" />
        </label>
        <label className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          MemberPress dump (transactions and subscriptions tables)
          <input accept=".sql,text/plain" className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="meprFile" required type="file" />
        </label>
        <Button disabled={pending} type="submit">{pending ? 'Checking…' : 'Run dry run'}</Button>
      </form>
      {state.error ? <p className="mt-3 text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.result ? <div className="mt-6"><DryRunReportView files={state.result.files} report={state.result.report} /></div> : null}
      {challenge}
    </>
  );
}

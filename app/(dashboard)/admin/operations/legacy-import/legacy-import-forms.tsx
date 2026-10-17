'use client';

import { Download } from 'lucide-react';
import { useMemo } from 'react';

import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import type { DryRunResult } from '@/lib/legacy-import/dry-run';
import { toCsv } from '@/lib/admin/csv';
import { isNeededLegacyTable, reduceDumpText } from '@/lib/legacy-import/reduce-dump';
import type { DryRunReport, ReportGroup } from '@/lib/legacy-import/transform';

export type LegacyImportActionState = StepUpActionState & { error?: string; result?: Omit<DryRunResult, 'plan'> };
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

const STATUS_LABELS: Record<string, string> = {
  active: 'active (paid through a future date)',
  grace: 'grace (paid-through date passed within the last 5 days; still has full access)',
  expired: 'expired less than a year ago (imported; must pay to renew)',
  unknown: 'unknown (has a completed payment but no expiry date; see "Needs a decision")',
};
function labelled(counts: Record<string, number>, labels: Record<string, string>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [labels[key] ?? key, count]));
}

function downloadGroup(group: ReportGroup, asOf: string) {
  const blob = new Blob(['\ufeff', toCsv(group.rows, group.columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `legacy-import-${group.key}-${asOf}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function GroupList({ groups, asOf, empty }: { groups: ReportGroup[]; asOf: string; empty: string }) {
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {groups.map((group) => (
        <li className="flex items-start justify-between gap-3 rounded-md border border-border p-3" key={group.key}>
          <div className="space-y-1">
            <p className="font-medium text-foreground">{fmt(group.count)} · {group.text}{group.held ? ' — held, not imported' : ''}</p>
            {group.remedy ? <p className="text-muted-foreground">Remedy: {group.remedy}</p> : null}
          </div>
          <button aria-label={`Download CSV: ${group.text}`} className="shrink-0 rounded-md border border-border p-2 text-gold hover:bg-surface" onClick={() => downloadGroup(group, asOf)}
            title="Download a CSV with one row per person" type="button">
            <Download aria-hidden className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DryRunReportView({ report, files }: { report: DryRunReport; files: DryRunResult['files'] }) {
  return (
    <div className="space-y-6" data-testid="legacy-dry-run-report">
      <p className="text-sm text-muted-foreground">Dry run only — nothing was written. Counted as of {report.asOf}. Files: {files.map((file) => `${file.name} (${file.sha256.slice(0, 12)}…)`).join(', ')}</p>
      <p className="text-sm text-muted-foreground">
        Tables read: {report.sourceTables.filter((item) => item.used).map((item) => `${item.table} (${fmt(item.rows)} rows)`).join(', ')}.
        {report.sourceTables.some((item) => !item.used) ? ` Also found but not used (smaller): ${report.sourceTables.filter((item) => !item.used).map((item) => `${item.table} (${fmt(item.rows)} rows)`).join(', ')}.` : ''}
      </p>
      <p className="text-base text-foreground">
        {fmt(report.legacyUsers)} legacy users in the files → {fmt(report.removedByRules)} removed by the cleanup rules → {fmt(report.inScope)} remain, of which {fmt(report.held)} are held for review and {fmt(report.importable)} would be imported.
      </p>

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">Removed by the cleanup rules (not imported, and not counted anywhere below)</h3>
        <GroupList asOf={report.asOf} empty="None" groups={report.excluded} />
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">Figures for the {fmt(report.inScope)} members who remain</h3>
        <div className="grid gap-5 md:grid-cols-3">
          <Counts counts={labelled(report.membershipStatus, STATUS_LABELS)} title="Membership status today (would be imported)" />
          <Counts counts={report.classification} title="Membership product → roles" />
          <Counts counts={report.hashFormats} title="Password hash formats" />
          <Counts counts={{ complete: report.profile.complete, 'needs onboarding': report.profile.needsOnboarding }} title="Profile completeness (would be imported)" />
          <Counts counts={report.profile.missingFields} title="Missing required fields" />
          <Counts counts={{
            'with a stored Stripe customer': report.stripe.withCustomerId, 'with a live (newest active) subscription': report.stripe.withActiveSubscription,
            'active subscription but no customer ID': report.stripe.activeSubscriptionWithoutCustomer, 'customer ID but no active subscription': report.stripe.customerWithoutActiveSubscription,
          }} title="Stripe linkage (from the legacy data; compared with live Stripe below)" />
          <Counts counts={report.subscriptionsByStatus} title="Legacy subscriptions by status" />
          <Counts counts={{ paid: report.payments.paid, refunded: report.payments.refunded, 'Stripe references': report.payments.stripe, 'manual (no Stripe ID)': report.payments.manual, 'ignored (failed or pending)': report.payments.ignoredFailedOrPending }} title="Payments to import" />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">Expected — already handled, nothing for you to decide</h3>
        <GroupList asOf={report.asOf} empty="None" groups={report.expected} />
      </section>

      {report.stripeReconciliation ? (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Compared with live Stripe (read-only)</h3>
          {report.stripeReconciliation.message ? <p className="text-sm text-amber-200" role="status">{report.stripeReconciliation.message}</p> : null}
          {report.stripeReconciliation.state === 'ok' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Read {fmt(report.stripeReconciliation.fetched.subscriptions)} subscriptions, {fmt(report.stripeReconciliation.fetched.customers)} customers and {fmt(report.stripeReconciliation.fetched.charges)} charge references from live Stripe. Nothing was changed in Stripe.
              </p>
              <GroupList asOf={report.asOf} empty="No differences found between the legacy data and live Stripe." groups={report.stripeReconciliation.groups} />
            </>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-amber-200">Needs a decision from you</h3>
        <GroupList asOf={report.asOf} empty="Nothing needs review." groups={report.review} />
      </section>
    </div>
  );
}

/** Keeps only the four needed tables of each dump, in the browser, so unneeded data never leaves the computer and the upload stays small. */
async function trimUpload(formData: FormData): Promise<{ data: FormData; bytes: number }> {
  const data = new FormData();
  let bytes = 0;
  for (const [key, value] of formData.entries()) {
    if ((key === 'usersFile' || key === 'meprFile') && value instanceof File) {
      const trimmed = new File([reduceDumpText(await value.text(), isNeededLegacyTable)], value.name, { type: 'text/plain' });
      bytes += trimmed.size;
      data.append(key, trimmed);
    } else {
      data.append(key, value);
    }
  }
  return { data, bytes };
}

export function DryRunForm({ action }: { action: Action }) {
  const safeAction = useMemo<Action>(() => async (state, formData) => {
    let bytes = 0;
    try {
      const trimmed = await trimUpload(formData);
      bytes = trimmed.bytes;
      return await action(state, trimmed.data);
    } catch {
      // A step-up request returns normally; only a failure to send or read the response lands here.
      const megabytes = (bytes / 1_048_576).toFixed(1);
      return { error: `The files could not be sent to the server (${megabytes} MB after trimming to the tables the importer needs). Try again; if it keeps happening, tell your developer this size and the time.` };
    }
  }, [action]);
  const [state, run, pending, challenge] = useFreshStepUpAction<LegacyImportActionState>(safeAction, {});
  return (
    <>
      <form action={run} className="space-y-4">
        <CsrfField />
        <label className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          Users dump (WordPress users and usermeta tables)
          <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="usersFile" required type="file" />
        </label>
        <label className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          MemberPress dump (transactions and subscriptions tables)
          <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="meprFile" required type="file" />
        </label>
        <Button disabled={pending} type="submit">{pending ? 'Checking…' : 'Run dry run'}</Button>
      </form>
      {state.error ? <p className="mt-3 text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.result ? <div className="mt-6"><DryRunReportView files={state.result.files} report={state.result.report} /></div> : null}
      {challenge}
    </>
  );
}

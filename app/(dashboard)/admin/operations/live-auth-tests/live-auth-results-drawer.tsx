'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { LiveAuthReport } from '@/lib/admin/live-auth-reports';

type Run = { id: number; runNumber: number; runUrl: string; status: string; startedAt: string };
type Case = LiveAuthReport['results'][number];
type MatrixCase = { id: string; title: string; steps: string[]; passCriteria: string[] };

function statusColor(status: string) {
  if (status === 'pass') return 'text-emerald-300';
  if (status === 'partial') return 'text-amber-200';
  if (status === 'fail') return 'text-red-300';
  if (status === 'blocked') return 'text-amber-200';
  return 'text-muted-foreground';
}

export function LiveAuthResultsDrawer({ run, onClose, cases }: { run: Run | null; onClose: () => void; cases: MatrixCase[] }) {
  const [report, setReport] = useState<LiveAuthReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setReport(null);
    fetch(`/api/admin/live-auth-results/${run.id}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const payload = await response.json() as LiveAuthReport & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load this report.');
        return payload;
      })
      .then(setReport)
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load this report.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [run]);

  if (!run) return null;
  const matrixById = new Map(cases.map(item => [item.id, item]));
  const results = report?.results ?? [];
  const counts = Object.fromEntries(['pass','partial','fail','blocked','not-applicable'].map(status => [status, results.filter(item => item.status === status).length]));
  const executed = results.filter(item => item.status === 'pass' || item.status === 'partial' || item.status === 'fail');
  const unexecuted = results.filter(item => item.status === 'blocked' || item.status === 'not-applicable');
  const incomplete = (counts.partial ?? 0) + (counts.blocked ?? 0) > 0;
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <SheetHeader className="border-b border-border p-5 pr-14">
          <div className="space-y-1">
            <SheetTitle className="text-xl font-bold text-gold">Live Authentication Run #{run.runNumber}</SheetTitle>
            <SheetDescription>Started {new Date(run.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC · Workflow: {run.status}</SheetDescription>
          </div>
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto p-5">
          {loading ? <p role="status">Loading the saved GitHub test results…</p> : null}
          {error ? <p className="rounded border border-red-500/40 p-3 text-red-300" role="alert">{error} <a className="underline" href={run.runUrl} rel="noreferrer" target="_blank">Inspect GitHub run</a></p> : null}
          {report ? (
            <>
              <div className="space-y-1 text-sm">
                <p><strong>Target:</strong> {report.target.hostname}</p>
                <p><strong>Tested commit:</strong> <code className="break-all">{report.target.revision}</code></p>
                <p className="font-semibold text-amber-200">{run.status === 'success' && incomplete ? 'Browser journey passed; full authentication coverage is INCOMPLETE.' : run.status === 'success' ? 'GitHub browser journey completed successfully.' : 'The GitHub browser workflow did not complete successfully.'}</p>
                <p className="text-muted-foreground">This workflow executes one signup, OTP, login and logout journey. It is not a complete run of the 38-case authentication catalog.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([['pass','Passed'],['fail','Failed'],['blocked','Blocked / Untested'],['not-applicable','Not Applicable']] as const).map(([status,label]) => (
                  <div className="rounded-lg border border-border p-3" key={status}><p className={`text-2xl font-bold ${statusColor(status)}`}>{counts[status]}</p><p className="text-xs text-muted-foreground">{label}</p></div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Cases Exercised By This Run ({executed.length})</h3>
                {executed.map((item: Case) => (
                  <article className="space-y-1 rounded-lg border border-border p-3" key={item.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong className="text-sm">{item.id} — {matrixById.get(item.id)?.title ?? 'Authentication test case'}</strong>
                      <span className={`text-xs font-semibold uppercase ${statusColor(item.status)}`}>{item.status === 'partial' ? 'PARTIALLY EXERCISED' : item.status === 'blocked' ? 'NOT RUN' : item.status === 'not-applicable' ? 'NOT APPLICABLE' : item.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.summary || 'No additional details provided in the JSON report.'}</p>
                    <details className="pt-1 text-sm">
                      <summary className="cursor-pointer font-medium text-gold">What This Case Tests</summary>
                      <ol className="ml-5 mt-2 list-decimal space-y-1 text-muted-foreground">{(matrixById.get(item.id)?.steps ?? []).map((step, i) => <li key={i}>{step}</li>)}</ol>
                      <p className="mt-2 font-medium">Pass Criteria</p>
                      <ul className="ml-5 mt-1 list-disc space-y-1 text-muted-foreground">{(matrixById.get(item.id)?.passCriteria ?? []).map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>
                    </details>
                    {Array.isArray(item.evidence) && item.evidence.length > 0 ? <p className="text-xs text-muted-foreground">Evidence entries recorded: {item.evidence.length}. Open the GitHub artifact for supporting files.</p> : null}
                  </article>
                ))}
              </div>
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer font-semibold text-amber-200">Not Executed By This Run ({unexecuted.length}) — Expand Coverage Gaps</summary>
                <p className="mt-2 text-sm text-muted-foreground">These are catalog requirements, not failed browser assertions. No claim of a pass is made for them.</p>
                <div className="mt-3 space-y-2">
                  {unexecuted.map(item => <article className="rounded-md border border-border p-3 text-sm" key={item.id}>
                    <p className="font-semibold">{item.id} — {matrixById.get(item.id)?.title ?? 'Authentication test case'}</p>
                    <p className="mt-1 text-amber-200">{item.status === 'not-applicable' ? 'Not applicable' : 'Not implemented / not run'}</p>
                    <p className="mt-1 text-muted-foreground">{item.summary}</p>
                  </article>)}
                </div>
              </details>
            </>
          ) : null}
          <a className="inline-flex items-center gap-2 text-gold underline" href={run.runUrl} rel="noreferrer" target="_blank">View GitHub Logs And Evidence <ExternalLink className="size-4" /></a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

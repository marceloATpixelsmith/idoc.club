'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { LiveAuthReport } from '@/lib/admin/live-auth-reports';

type Run = { id: number; runNumber: number; runUrl: string; status: string; startedAt: string };
type Case = LiveAuthReport['results'][number];
type MatrixCase = { id: string; title: string };

function statusColor(status: string) {
  if (status === 'pass') return 'text-emerald-300';
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
  const titles = new Map(cases.map(item => [item.id, item.title]));
  const results = report?.results ?? [];
  const counts = Object.fromEntries(['pass','fail','blocked','not-applicable'].map(status => [status, results.filter(item => item.status === status).length]));
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
                <p className="text-muted-foreground">An overall green workflow does not mean blocked or unimplemented cases were tested.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([['pass','Passed'],['fail','Failed'],['blocked','Blocked / Untested'],['not-applicable','Not Applicable']] as const).map(([status,label]) => (
                  <div className="rounded-lg border border-border p-3" key={status}><p className={`text-2xl font-bold ${statusColor(status)}`}>{counts[status]}</p><p className="text-xs text-muted-foreground">{label}</p></div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Case-by-case results</h3>
                {results.map((item: Case) => (
                  <article className="space-y-1 rounded-lg border border-border p-3" key={item.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong className="text-sm">{item.id} — {titles.get(item.id) ?? 'Authentication test case'}</strong>
                      <span className={`text-xs font-semibold uppercase ${statusColor(item.status)}`}>{item.status === 'blocked' ? 'BLOCKED / NOT RUN' : item.status === 'not-applicable' ? 'NOT APPLICABLE' : item.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.summary || 'No additional details provided in the JSON report.'}</p>
                    {Array.isArray(item.evidence) && item.evidence.length > 0 ? <p className="text-xs text-muted-foreground">Evidence entries recorded: {item.evidence.length}. Open the GitHub artifact for supporting files.</p> : null}
                  </article>
                ))}
              </div>
            </>
          ) : null}
          <a className="inline-flex items-center gap-2 text-gold underline" href={run.runUrl} rel="noreferrer" target="_blank">View GitHub Logs And Evidence <ExternalLink className="size-4" /></a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

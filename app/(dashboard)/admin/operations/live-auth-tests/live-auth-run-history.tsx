'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { LiveAuthResultsDrawer } from './live-auth-results-drawer';

type Run = { id: number; runNumber: number; runUrl: string; status: string; startedAt: string; event: string };
type Case = { id: string; title: string; steps: string[]; passCriteria: string[] };

export function LiveAuthRunHistory({ runs, cases }: { runs: Run[]; cases: Case[] }) {
  const [selected, setSelected] = useState<Run | null>(null);
  const router = useRouter();
  const active = runs.some(run => run.status === 'queued' || run.status === 'in_progress');
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return <>
    {active ? <p className="text-sm text-muted-foreground" role="status">A live authentication test is running. This list refreshes every 15 seconds.</p> : null}
    {!runs.length ? <p className="text-muted-foreground">No recent live authentication runs found.</p> : (
      <ul className="space-y-2">
        {runs.map(run => <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3" key={run.id}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <strong className={run.status === 'success' ? 'text-emerald-300' : run.status === 'failure' ? 'text-red-300' : run.status === 'queued' || run.status === 'in_progress' ? 'text-amber-200' : 'text-muted-foreground'}>{run.status.toUpperCase()}</strong>
            <span>Run #{run.runNumber}</span>
            <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'} · {run.event === 'workflow_dispatch' ? 'Manual' : 'Automatic'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button className="rounded-md border border-dashed border-blue-400 px-3 py-1.5 font-semibold text-blue-200 hover:bg-blue-500/10" onClick={() => setSelected(run)} type="button">View Results</button>
            <a className="inline-flex items-center gap-1 text-gold underline" href={run.runUrl} rel="noreferrer" target="_blank">GitHub <ExternalLink className="size-3" /></a>
          </div>
        </li>)}
      </ul>
    )}
    <LiveAuthResultsDrawer cases={cases} onClose={() => setSelected(null)} run={selected}/>
  </>;
}

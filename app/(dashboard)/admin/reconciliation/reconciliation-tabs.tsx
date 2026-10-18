'use client';

import { useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FINDING_GUIDE, type FindingSummaryRow } from '@/lib/payments/reconciliation-guide';

const SEVERITY_LABEL = { act: 'Needs action', check: 'Worth checking' } as const;
const SEVERITY_CLASS = { act: 'border-red-400/50 bg-red-950/30 text-red-200', check: 'border-amber-400/50 bg-amber-950/20 text-amber-200' } as const;

/** Three views of the same findings: a summary by type, the full table, and a plain-language guide to each type. */
export function ReconciliationTabs({ summary, total, findingsTable }: { summary: FindingSummaryRow[]; total: number; findingsTable: ReactNode }) {
  const [tab, setTab] = useState('summary');
  const [guideKind, setGuideKind] = useState<string | null>(null);
  const needAction = summary.filter((row) => row.severity === 'act').reduce((sum, row) => sum + row.count, 0);
  const worthChecking = total - needAction;
  const biggest = Math.max(1, ...summary.map((row) => row.count));
  const membership = summary.filter((row) => row.area === 'Membership').reduce((sum, row) => sum + row.count, 0);

  const openGuide = (kind: string) => {
    setGuideKind(kind);
    setTab('guide');
    requestAnimationFrame(() => document.getElementById(`guide-${kind}`)?.scrollIntoView({ block: 'start' }));
  };

  return (
    <Tabs onValueChange={setTab} value={tab}>
      <TabsList aria-label="Reconciliation views">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="findings">All findings ({total})</TabsTrigger>
        <TabsTrigger value="guide">What each type means</TabsTrigger>
      </TabsList>

      <TabsContent value="summary">
        {total === 0 ? (
          <p className="rounded-lg border border-emerald-400/40 bg-emerald-950/20 p-4 text-sm text-emerald-200" role="status">Nothing to review: IDOC and Stripe agree as of the last run.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Total findings" value={total} />
              <Stat label="Need action" tone="act" value={needAction} />
              <Stat label="Worth checking" tone="check" value={worthChecking} />
            </div>
            <p className="text-sm text-muted-foreground">{membership.toLocaleString('en-GB')} are about membership billing and {(total - membership).toLocaleString('en-GB')} about seminar payments. Start with the red ones; the amber ones are often harmless.</p>
            <ul className="space-y-3">
              {summary.map((row) => (
                <li className="rounded-lg border border-border p-3" key={row.kind}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{row.label}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS[row.severity]}`}>{SEVERITY_LABEL[row.severity]}</span>
                    <span className="text-xs text-muted-foreground">{row.area}</span>
                    <span className="ml-auto text-lg font-semibold text-foreground">{row.count.toLocaleString('en-GB')}</span>
                  </div>
                  <div aria-hidden="true" className="mt-2 h-2 rounded bg-muted">
                    <div className={`h-2 rounded ${row.severity === 'act' ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${Math.max(2, Math.round((row.count / biggest) * 100))}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-foreground">{row.plain}</p>
                  <button className="mt-1 text-sm text-primary underline underline-offset-4 hover:opacity-80" onClick={() => openGuide(row.kind)} type="button">What this means and what to do</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TabsContent>

      <TabsContent value="findings">{findingsTable}</TabsContent>

      <TabsContent value="guide">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Every finding is a place where IDOC's records and Stripe's records disagree. The scan only reads Stripe; it never changes anything in Stripe or in member records. Each finding is replaced by the next daily scan, so one that you have fixed disappears by itself.</p>
          {FINDING_GUIDE.map((entry) => (
            <section className={`rounded-lg border p-4 ${guideKind === entry.kind ? 'border-primary' : 'border-border'}`} id={`guide-${entry.kind}`} key={entry.kind}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-foreground">{entry.label}</h3>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS[entry.severity]}`}>{SEVERITY_LABEL[entry.severity]}</span>
                <span className="text-xs text-muted-foreground">{entry.area}</span>
              </div>
              <p className="mt-2 text-sm text-foreground">{entry.plain}</p>
              <GuideList items={entry.why} title="Why it happens" />
              <GuideList items={entry.investigate} title="How to look into it" />
              <GuideList items={entry.resolve} title="What to do" />
            </section>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'act' | 'check' }) {
  return (
    <div className={`rounded-lg border p-3 ${tone ? SEVERITY_CLASS[tone] : 'border-border text-foreground'}`}>
      <div className="text-2xl font-semibold">{value.toLocaleString('en-GB')}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

function GuideList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gold">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

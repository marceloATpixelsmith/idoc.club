'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { currentStepId, type GuideStep } from '@/lib/operations/switchover-guide-core';

const STORAGE_KEY = 'idoc-switchover-ticks-v1';

function readTicks(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch { return new Set(); }
}

/** Inline `code` spans in the step text. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/g).map((part, index) => part.startsWith('`') ? <code className="rounded bg-muted px-1 text-[max(13px,0.85em)]" key={index}>{part.slice(1, -1)}</code> : part)}</>;
}

export function SwitchoverGuide({ steps }: { steps: GuideStep[] }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => { setTicked(readTicks()); }, []);
  function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setTicked(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ticks then last only for this page view */ }
  }
  const isDone = (step: GuideStep) => step.auto ? step.autoDone : ticked.has(step.id);
  const current = useMemo(() => currentStepId(steps, ticked), [steps, ticked]);
  const doneCount = steps.filter(isDone).length;
  return (
    <div className="space-y-6" data-testid="switchover-guide">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {doneCount} of {steps.length} steps done.{' '}
          {current ? <>Next: <strong className="text-foreground">{steps.find((step) => step.id === current)?.id} · {steps.find((step) => step.id === current)?.title}</strong></> : 'Everything is done.'}
        </p>
        <Button onClick={() => router.refresh()} type="button" variant="outline">Re-check now</Button>
      </div>
      {(['A', 'B'] as const).map((phase) => (
        <section className="space-y-3" key={phase}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-gold">{phase === 'A' ? 'A · Before Thursday (nothing here is visible to members)' : 'B · Switchover day, in this order'}</h3>
          <ol className="space-y-2">
            {steps.filter((step) => step.phase === phase).map((step) => {
              const done = isDone(step);
              const isCurrent = step.id === current;
              return (
                <li className={`rounded-md border p-3 ${isCurrent ? 'border-gold bg-gold/5' : 'border-border'}`} data-step={step.id} key={step.id}>
                  <details open={isCurrent}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      <span aria-hidden>{done ? '✅' : isCurrent ? '👉' : '⬜'}</span>
                      <span>{step.id} · {step.title}</span>
                      <span className="text-xs font-normal text-muted-foreground">{step.where}{step.auto ? ' · checked automatically' : ' · tick when done'}</span>
                    </summary>
                    <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                      <ul className="list-disc space-y-1 pl-5">{step.actions.map((action) => <li key={action}><Rich text={action} /></li>)}</ul>
                      {step.env.length > 0 ? (
                        <table className="w-full text-left text-xs">
                          <thead><tr className="text-foreground"><th className="py-1 pr-3">Variable</th><th className="py-1 pr-3">Scope</th><th className="py-1">What to do</th></tr></thead>
                          <tbody>{step.env.map((change) => <tr className="border-t border-border" key={`${change.name}-${change.scope}`}><td className="py-1 pr-3 font-mono">{change.name}</td><td className="py-1 pr-3">{change.scope}</td><td className="py-1">{change.action}</td></tr>)}</tbody>
                        </table>
                      ) : null}
                      {step.link ? <p><a className="underline" href={step.link.href}>{step.link.label}</a></p> : null}
                      {!step.auto ? (
                        <label className="flex items-center gap-2 text-foreground">
                          <input checked={ticked.has(step.id)} onChange={() => toggle(step.id)} type="checkbox" />
                          I have done this
                        </label>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Ticks are remembered in this browser only. Steps marked "checked automatically" are read from the live site and update when you re-check.</p>
    </div>
  );
}

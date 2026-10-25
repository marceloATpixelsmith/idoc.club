'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { Button } from '@/components/ui/button';
import type { MemberTimeline } from '@/lib/admin/member-timeline';
import { TIMELINE_ACTOR_LABELS, type TimelineActor, type TimelineEntry } from '@/lib/admin/member-timeline-core';
import { formatTableDate } from '@/lib/format';

const ACTOR_CLASS: Record<TimelineActor, string> = {
  administrator: 'border-purple-400/50 bg-purple-950/30 text-purple-200',
  server: 'border-slate-400/50 bg-slate-800/40 text-slate-200',
  user: 'border-sky-400/50 bg-sky-950/30 text-sky-200',
};
const ACTORS: TimelineActor[] = ['user', 'server', 'administrator'];
const time = (iso: string) => iso.slice(11, 19);

type State = { status: 'error'; message: string } | { status: 'loading' } | { data: MemberTimeline; status: 'ready' };

/** The member's whole history in one place, oldest first by default, every row marked as done by the member, the server on its
 * own, or an administrator. A separate drawer from the member form (docs/29); the date range lives in this component's state,
 * never in the URL. */
export function MemberTimelineDrawer({ profileId }: { profileId: number }) {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [shown, setShown] = useState<Record<TimelineActor, boolean>>({ administrator: true, server: true, user: true });
  const [newestFirst, setNewestFirst] = useState(false);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    const query = new URLSearchParams();
    if (range.from) query.set('from', range.from);
    if (range.to) query.set('to', range.to);
    fetch(`/api/admin/members/${profileId}/timeline?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'This member was not found.' : response.status === 401 ? 'You are not authorized to view this timeline.' : 'The timeline could not be loaded.');
        setState({ data: await response.json() as MemberTimeline, status: 'ready' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ message: error instanceof Error ? error.message : 'The timeline could not be loaded.', status: 'error' });
      });
    return () => controller.abort();
  }, [profileId, range]);

  const data = state.status === 'ready' ? state.data : null;
  const entries = useMemo(() => {
    const visible = (data?.entries ?? []).filter((entry) => shown[entry.actor]);
    return newestFirst ? [...visible].reverse() : visible;
  }, [data, newestFirst, shown]);
  const days = useMemo(() => {
    const groups: { day: string; items: TimelineEntry[] }[] = [];
    for (const entry of entries) {
      const day = entry.at.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(entry); else groups.push({ day, items: [entry] });
    }
    return groups;
  }, [entries]);
  const counts = useMemo(() => Object.fromEntries(ACTORS.map((actor) => [actor, (data?.entries ?? []).filter((entry) => entry.actor === actor).length])) as Record<TimelineActor, number>, [data]);

  return (
    <AdminFormDrawer closeHref="/admin/members" title="Member timeline" wide>
      <div className="space-y-5 px-5 pb-10 pt-4 lg:px-8">
        <div>
          <p className="text-xl font-semibold">{data?.member.name ?? 'Loading member…'}</p>
          {data ? <p className="text-sm text-muted-foreground">{data.member.email}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <DateRangeFilter from={range.from ?? data?.from} label="Date range" onChange={(from, to) => setRange({ from, to })} to={range.to ?? data?.to} />
          <Button onClick={() => setRange({})} size="sm" type="button" variant="outline">Last 30 days</Button>
          <Button onClick={() => setNewestFirst((value) => !value)} size="sm" type="button" variant="outline">{newestFirst ? 'Newest first' : 'Oldest first'}</Button>
          <div className="flex flex-wrap items-center gap-3 text-sm" role="group" aria-label="Who did it">
            {ACTORS.map((actor) => (
              <label className="inline-flex cursor-pointer items-center gap-1.5" key={actor}>
                <input checked={shown[actor]} onChange={() => setShown((current) => ({ ...current, [actor]: !current[actor] }))} type="checkbox" />
                <span className={`rounded-full border px-2 py-0.5 text-xs ${ACTOR_CLASS[actor]}`}>{TIMELINE_ACTOR_LABELS[actor]}</span>
                <span className="text-muted-foreground">{counts[actor]}</span>
              </label>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">Times are UTC. <strong>Member</strong> rows are things the member did (opening an email, clicking a link, signing in). <strong>Server</strong> rows are what the system did on its own (queuing and sending emails, issuing links, recording payments). <strong>Administrator</strong> rows are changes an administrator made. “via Brevo” rows come from Brevo’s delivery log.</p>

        {state.status === 'error' ? <p className="rounded-lg border border-red-400/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">{state.message}</p> : null}
        {data && !data.providerAvailable ? <p className="rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">Brevo’s delivery log could not be read, so email deliveries, opens and clicks are missing from this timeline. Everything recorded by IDOC itself is shown.</p> : null}
        {data?.truncated ? <p className="rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">Some sources hit the 500-row limit for this range; narrow the date range to see everything.</p> : null}

        {state.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading timeline" className="space-y-2">{Array.from({ length: 8 }, (_, index) => <div className="h-12 animate-pulse rounded-lg bg-muted" key={index} />)}</div>
        ) : data && entries.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Nothing was recorded for this member in this date range{Object.values(shown).some((value) => !value) ? ' with these filters' : ''}.</p>
        ) : (
          <div className="space-y-6">
            {days.map((group) => (
              <section key={group.day}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gold">{formatTableDate(`${group.day}T00:00:00.000Z`)}</h3>
                <ol className="space-y-2">
                  {group.items.map((entry) => (
                    <li className="grid grid-cols-[5.5rem_8.5rem_1fr] items-start gap-3 rounded-lg border p-3 text-sm" key={entry.id}>
                      <span className="font-mono text-muted-foreground">{time(entry.at)}</span>
                      <span className={`w-fit rounded-full border px-2 py-0.5 text-xs ${ACTOR_CLASS[entry.actor]}`}>{TIMELINE_ACTOR_LABELS[entry.actor]}{entry.source === 'brevo' ? ' · via Brevo' : ''}</span>
                      <span>
                        <span className="font-medium">{entry.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{entry.category}</span>
                        {entry.detail ? <span className="mt-0.5 block break-words text-muted-foreground">{entry.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminFormDrawer>
  );
}

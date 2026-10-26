'use client';

import { type ColumnDef, type SortingState, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { CalendarDays, CircleDot, CreditCard, LifeBuoy, LogIn, Mail, Pointer, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { persistTablePreferences } from '@/components/admin/table-preference-sync';
import { Button } from '@/components/ui/button';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import type { TablePreferenceState } from '@/lib/admin/table-preferences';
import type { MemberTimeline } from '@/lib/admin/member-timeline';
import { formatTimelineTime, TIMELINE_ACTOR_LABELS, type TimelineActor, type TimelineEntry } from '@/lib/admin/member-timeline-core';
import { formatTableDate } from '@/lib/format';

const ACTOR_CLASS: Record<TimelineActor, string> = {
  administrator: 'border-purple-400/50 bg-purple-950/30 text-purple-200',
  server: 'border-slate-400/50 bg-slate-800/40 text-slate-200',
  user: 'border-sky-400/50 bg-sky-950/30 text-sky-200',
};
const ACTORS: TimelineActor[] = ['user', 'server', 'administrator'];
const time = formatTimelineTime;
const SORT_COLUMN_IDS = ['time', 'who', 'type'];
// The Sort button is the standard one every admin table uses (multi-column, saved per administrator), driving a headless table over the rows.
const TIMELINE_COLUMNS: ColumnDef<TimelineEntry>[] = [
  { id: 'time', accessorFn: (entry) => Date.parse(entry.at), meta: { label: 'Time' } },
  { id: 'who', accessorFn: (entry) => TIMELINE_ACTOR_LABELS[entry.actor], meta: { label: 'Who' } },
  { id: 'type', accessorFn: (entry) => entry.category, meta: { label: 'Type' } },
];
// Tooltip text where it differs from the category name (the hand pointer reads "User Interaction").
const TYPE_LABELS: Record<string, string> = { Account: 'User Interaction' };
// One icon per kind of event; the Type column shows only the icon (its name is the tooltip and the screen-reader label).
const TYPE_ICONS: Record<string, LucideIcon> = { Account: Pointer, Billing: CreditCard, Email: Mail, Seminar: CalendarDays, 'Sign-in': LogIn, Support: LifeBuoy };
const ROW_COLUMNS = 'grid-cols-[7.5rem_6.5rem_2.5rem_1fr]';

function TypeIcon({ category }: { category: string }) {
  const Icon = TYPE_ICONS[category] ?? CircleDot;
  const label = TYPE_LABELS[category] ?? category;
  // The label sits on the icon itself: otherwise the site-wide icon tooltips fall back to the icon's code name (for example "User Round").
  return <span className="flex justify-center text-muted-foreground"><Icon aria-label={label} className="size-4" data-icon-tooltip={label} role="img" /></span>;
}

function EntryText({ entry }: { entry: TimelineEntry }) {
  return (
    <span>
      <span className="font-medium">{entry.segments ? entry.segments.map((segment, index) => (segment.bold ? <strong className="font-bold" key={index}>{segment.text}</strong> : <span key={index}>{segment.text}</span>)) : entry.title}</span>
      {entry.detail ? <span className="mt-0.5 block break-words font-normal text-muted-foreground">{entry.detail}</span> : null}
    </span>
  );
}

type State = { status: 'error'; message: string } | { status: 'loading' } | { data: MemberTimeline; status: 'ready' };

function TimelineRow({ entry, withDate = false }: { entry: TimelineEntry; withDate?: boolean }) {
  return (
    <li className={`grid ${ROW_COLUMNS} items-start gap-3 rounded-lg border p-3 text-sm`}>
      <span className="font-mono text-muted-foreground">{withDate ? <span className="block">{formatTableDate(entry.at)}</span> : null}{time(entry.at)}</span>
      <span className={`w-fit rounded-full border px-2 py-0.5 text-xs ${ACTOR_CLASS[entry.actor]}`}>{TIMELINE_ACTOR_LABELS[entry.actor]}</span>
      <TypeIcon category={entry.category} />
      <EntryText entry={entry} />
    </li>
  );
}

/** The member's whole history in one place, oldest first by default, every row marked as done by the member, the server on its
 * own, or an administrator. A separate drawer from the member form (docs/29); the date range lives in this component's state,
 * never in the URL. */
export function MemberTimelineDrawer({ initialPreferences, profileId }: { initialPreferences?: TablePreferenceState | null; profileId: number }) {
  // Empty = the default last 30 days; `all` = the date filter was cleared, so no date limit.
  const [range, setRange] = useState<{ all?: boolean; from?: string; to?: string }>(() => {
    if (initialPreferences?.all === '1') return { all: true };
    const from = typeof initialPreferences?.from === 'string' ? initialPreferences.from : undefined;
    const to = typeof initialPreferences?.to === 'string' ? initialPreferences.to : undefined;
    return from || to ? { from, to } : {};
  });
  const [shown, setShown] = useState<Record<TimelineActor, boolean>>(() => {
    const hidden = typeof initialPreferences?.hide === 'string' ? initialPreferences.hide.split(',') : [];
    return { administrator: !hidden.includes('administrator'), server: !hidden.includes('server'), user: !hidden.includes('user') };
  });
  const [sorting, setSorting] = useState<SortingState>(() => {
    if (typeof initialPreferences?.sort !== 'string') return [];
    try {
      const parsed: unknown = JSON.parse(initialPreferences.sort);
      return Array.isArray(parsed) ? parsed.filter((item): item is { desc: boolean; id: string } => Boolean(item) && typeof item === 'object' && SORT_COLUMN_IDS.includes((item as { id?: string }).id ?? '') && typeof (item as { desc?: unknown }).desc === 'boolean') : [];
    } catch { return []; }
  });
  // Every change is saved for this administrator (database, not the URL), like the filters of every table, so a refresh restores them.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const hidden = ACTORS.filter((actor) => !shown[actor]);
    const preferences: TablePreferenceState = {};
    if (range.all) preferences.all = '1';
    if (range.from) preferences.from = range.from;
    if (range.to) preferences.to = range.to;
    if (hidden.length > 0) preferences.hide = hidden.join(',');
    if (sorting.length > 0) preferences.sort = JSON.stringify(sorting);
    void persistTablePreferences('member_timeline', preferences).catch(() => undefined);
  }, [range, shown, sorting]);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    const query = new URLSearchParams();
    if (range.all) query.set('all', '1');
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
  const visibleEntries = useMemo(() => (data?.entries ?? []).filter((entry) => shown[entry.actor]), [data, shown]);
  const table = useReactTable({
    columns: TIMELINE_COLUMNS, data: visibleEntries, getCoreRowModel: getCoreRowModel(), getRowId: (entry) => entry.id,
    getSortedRowModel: getSortedRowModel(), onSortingChange: setSorting, state: { sorting },
  });
  // The data arrives oldest first, so rows that tie on a column keep time order. Day headings only make sense when time is the sort.
  const entries = table.getRowModel().rows.map((row) => row.original);
  const byTime = sorting.length === 0 || (sorting.length === 1 && sorting[0].id === 'time');
  const days = useMemo(() => {
    if (!byTime) return [];
    const groups: { day: string; items: TimelineEntry[] }[] = [];
    for (const entry of entries) {
      const day = entry.at.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(entry); else groups.push({ day, items: [entry] });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byTime, visibleEntries, sorting]);
  const counts = useMemo(() => Object.fromEntries(ACTORS.map((actor) => [actor, (data?.entries ?? []).filter((entry) => entry.actor === actor).length])) as Record<TimelineActor, number>, [data]);

  return (
    <AdminFormDrawer closeHref="/admin/members" title="Member timeline" wide>
      <div className="space-y-5 px-5 pb-10 pt-4 lg:px-8">
        <div>
          <p className="text-xl font-semibold">{data?.member.name ?? 'Loading member…'}</p>
          {data ? <p className="text-sm text-muted-foreground">{data.member.email}</p> : null}
        </div>

        {data ? (
          <section aria-label="Account history" className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gold">Account history</h3>
              <span className="rounded-full border px-2 py-0.5 text-xs">{data.accountStatus}</span>
              <span className="text-xs text-muted-foreground">Always shown, whatever the date range.</span>
            </div>
            <ol className="mt-3 space-y-2">
              {data.milestones.map((milestone) => (
                <li className={`grid ${ROW_COLUMNS} items-start gap-3 text-sm`} key={milestone.id}>
                  <span className="font-mono text-muted-foreground">{formatTableDate(milestone.at)}{milestone.id === 'milestone-registered-old-site' ? '' : <span className="block">{time(milestone.at)}</span>}</span>
                  <span className={`w-fit rounded-full border px-2 py-0.5 text-xs ${ACTOR_CLASS[milestone.actor]}`}>{TIMELINE_ACTOR_LABELS[milestone.actor]}</span>
                  <TypeIcon category={milestone.category} />
                  <EntryText entry={milestone} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <DateRangeFilter from={range.all ? undefined : range.from ?? data?.from} label="Date range" onChange={(from, to) => setRange(from || to ? { from, to } : { all: true })} to={range.all ? undefined : range.to ?? data?.to} />
          <DataTableSortList table={table} />
          {range.all ? <span className="text-sm text-muted-foreground">Showing all dates</span> : null}
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

        <p className="text-sm text-muted-foreground">Times are UTC, to the millisecond. <strong>Member</strong> rows are things the member did (signing in, opening or clicking an email, filling in a form). <strong>Server</strong> rows are what the system did on its own (queuing and sending emails, creating links, recording payments). <strong>Administrator</strong> rows are changes an administrator made. Hover an icon in the Type column for its name; the envelope marks email events, which Brevo, our email service, reports after we send each email.</p>

        {state.status === 'error' ? <p className="rounded-lg border border-red-400/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">{state.message}</p> : null}
        {data && !data.providerAvailable ? <p className="rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">Brevo’s delivery log could not be read, so email deliveries, opens and clicks are missing from this timeline. Everything recorded by IDOC itself is shown.</p> : null}
        {data && data.unavailableSources.length > 0 ? <p className="rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">Some sources could not be read and are missing from this timeline: {data.unavailableSources.join(', ')}. Everything else is shown. If this persists, an administrator should check that the latest database migration has been applied in this environment.</p> : null}
        {data?.truncated ? <p className="rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">Some sources hit the 500-row limit for this range; narrow the date range to see everything.</p> : null}

        {state.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading timeline" className="space-y-2">{Array.from({ length: 8 }, (_, index) => <div className="h-12 animate-pulse rounded-lg bg-muted" key={index} />)}</div>
        ) : data && entries.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Nothing was recorded for this member in this date range{Object.values(shown).some((value) => !value) ? ' with these filters' : ''}.</p>
        ) : (
          <div className="space-y-3">
            <div aria-hidden="true" className={`grid ${ROW_COLUMNS} gap-3 px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground`}>
              {([['time', 'Time (UTC)'], ['who', 'Who'], ['type', 'Type']] as const).map(([key, label]) => (
                <span className={key === 'type' ? 'text-center' : undefined} key={key}>{label}{table.getColumn(key)?.getIsSorted() === 'asc' ? ' ▲' : table.getColumn(key)?.getIsSorted() === 'desc' ? ' ▼' : ''}</span>
              ))}
              <span>What happened</span>
            </div>
            {byTime ? days.map((group) => (
              <section key={group.day}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gold">{formatTableDate(`${group.day}T00:00:00.000Z`)}</h3>
                <ol className="space-y-2">{group.items.map((entry) => <TimelineRow entry={entry} key={entry.id} />)}</ol>
              </section>
            )) : <ol className="space-y-2">{entries.map((entry) => <TimelineRow entry={entry} key={entry.id} withDate />)}</ol>}
          </div>
        )}
      </div>
    </AdminFormDrawer>
  );
}

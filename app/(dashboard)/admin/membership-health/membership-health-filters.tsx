'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { persistTablePreferences } from '@/components/admin/table-preference-sync';

export function MembershipHealthFilters({ from, to }: { from?: string; to?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useState({ from, to });
  const [resetSignal, setResetSignal] = useState(0);
  const [draftActive, setDraftActive] = useState(false);
  const [error, setError] = useState('');

  async function apply(start?: string, end?: string) {
    if (start && end && start > end) {
      setError('Start date must be on or before end date.');
      return;
    }
    setError('');
    const response = await persistTablePreferences('membership_health_range', { from: start, to: end });
    if (!response.ok) {
      setError('The date range could not be saved. Please try again.');
      return;
    }
    setRange({ from: start, to: end });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <DateRangeFilter from={range.from} to={range.to} label="Date range" onChange={(start, end) => { void apply(start, end); }} onDraftActiveChange={setDraftActive} resetSignal={resetSignal} />
      {(range.from || range.to || draftActive) && <button aria-label="Reset filters" className="bg-transparent text-sm font-normal normal-case tracking-normal text-muted-foreground underline hover:text-foreground" onClick={() => { setResetSignal((current) => current + 1); void apply(undefined, undefined); }} type="button">Reset filters</button>}
      {!range.from && !range.to && <span className="text-sm text-muted-foreground">All time</span>}
      {pending && <span role="status" className="animate-pulse text-sm text-muted-foreground">Updating report…</span>}
      {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

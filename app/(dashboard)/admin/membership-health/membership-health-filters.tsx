'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';

export function MembershipHealthFilters({ from, to }: { from?: string; to?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [resetSignal, setResetSignal] = useState(0);
  const [draftActive, setDraftActive] = useState(false);
  const apply = useCallback((start?: string, end?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (start) params.set('from', start);
    else params.delete('from');
    if (end) params.set('to', end);
    else params.delete('to');
    router.push('/admin/membership-health' + (params.size ? '?' + params.toString() : ''));
  }, [router, searchParams]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DateRangeFilter from={from} to={to} label="Date range" onChange={apply} onDraftActiveChange={setDraftActive} resetSignal={resetSignal} />
      {(from || to || draftActive) && <button aria-label="Reset filters" className="text-sm text-muted-foreground underline hover:text-foreground" onClick={() => { setResetSignal((current) => current + 1); apply(undefined, undefined); }} type="button">Reset filters</button>}
      {!from && !to && <span className="text-sm text-muted-foreground">All time</span>}
    </div>
  );
}

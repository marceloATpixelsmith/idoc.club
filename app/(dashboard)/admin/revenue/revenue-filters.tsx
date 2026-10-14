'use client';

import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/format';

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromDateKey(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const SOURCE_OPTIONS = [
  { label: 'All', value: 'all' }, { label: 'Stripe', value: 'stripe' },
  { label: 'Bank Transfer', value: 'bank_transfer' }, { label: 'Cash', value: 'cash' },
];

// Every control here -- the date-range trigger, the Payment source select, and Apply -- is left at its
// component's default (h-9) size so the row lines up evenly, rather than each picking its own height.
export function RevenueFilters({ from, source, to }: { from?: string; source?: string; to?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange>({ from: fromDateKey(from), to: fromDateKey(to) });
  const [sourceValue, setSourceValue] = useState(SOURCE_OPTIONS.some((option) => option.value === source) ? source! : 'all');

  // Re-sync when the committed props change without a remount -- e.g. browser Back/Forward
  // changing the URL's query params -- otherwise the controls keep showing a stale range/source
  // and Apply would push those stale values right back, undoing the navigation.
  useEffect(() => {
    setRange({ from: fromDateKey(from), to: fromDateKey(to) });
    setSourceValue(SOURCE_OPTIONS.some((option) => option.value === source) ? source! : 'all');
  }, [from, to, source]);

  function apply() {
    const params = new URLSearchParams();
    if (range.from) params.set('from', toDateKey(range.from));
    if (range.to) params.set('to', toDateKey(range.to));
    if (sourceValue !== 'all') params.set('source', sourceValue);
    router.push(`/admin/revenue${params.size ? `?${params}` : ''}`);
  }

  // react-day-picker's range mode adjusts an already-complete range (so a new *first* date could
  // never be picked once a range existed). A click on a complete range starts a fresh range instead.
  function onSelect(next: DateRange | undefined, trigger: Date) {
    if (range.from && range.to) setRange({ from: trigger, to: undefined });
    else setRange(next ?? { from: undefined, to: undefined });
  }

  const hasRange = Boolean(range.from || range.to);
  const dateText = !hasRange ? 'All time'
    : range.from && range.to && range.from.getTime() !== range.to.getTime()
      ? `${formatDate(range.from)} - ${formatDate(range.to)}`
      : formatDate(range.from ?? range.to);

  return (
    <div className="mt-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Date range
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button className="justify-start" data-idoc-table-control variant="outline">
              <CalendarIcon />
              {dateText}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar autoFocus captionLayout="dropdown" mode="range" onSelect={onSelect} selected={range} />
            <div className="flex justify-end border-t p-2">
              <Button disabled={!hasRange} onClick={() => setRange({ from: undefined, to: undefined })} size="sm" type="button" variant="ghost">Clear (all time)</Button>
            </div>
          </PopoverContent>
        </Popover>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Payment source
        <Select onValueChange={setSourceValue} value={sourceValue}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <Button onClick={apply}>Apply</Button>
    </div>
  );
}

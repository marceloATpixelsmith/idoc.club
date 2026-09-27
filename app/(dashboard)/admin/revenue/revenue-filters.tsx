'use client';

import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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

// Every control here -- the date-range trigger, the Origin select, and Apply -- is left at its
// component's default (h-9) size so the row lines up evenly, rather than each picking its own height.
export function RevenueFilters({ from, origin, to }: { from?: string; origin?: string; to?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange>({ from: fromDateKey(from), to: fromDateKey(to) });
  const [originValue, setOriginValue] = useState(origin ?? 'all');

  function apply() {
    const params = new URLSearchParams();
    if (range.from) params.set('from', toDateKey(range.from));
    if (range.to) params.set('to', toDateKey(range.to));
    if (originValue !== 'all') params.set('origin', originValue);
    router.push(`/admin/revenue${params.size ? `?${params}` : ''}`);
  }

  const dateText = range.from && range.to && range.from.getTime() !== range.to.getTime()
    ? `${formatDate(range.from)} - ${formatDate(range.to)}`
    : formatDate(range.from ?? range.to);

  return (
    <div className="mt-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Date range
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button className="justify-start font-normal" variant="outline">
              <CalendarIcon />
              {dateText}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar autoFocus captionLayout="dropdown" mode="range" onSelect={(next) => setRange(next ?? { from: undefined, to: undefined })} selected={range} />
          </PopoverContent>
        </Popover>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Origin
        <Select onValueChange={setOriginValue} value={originValue}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="stripe">Stripe</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <Button onClick={apply}>Apply</Button>
    </div>
  );
}

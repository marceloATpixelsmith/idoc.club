'use client';

import { CalendarIcon, XCircle } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/format';

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromDateKey(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * A DataTableDateFilter lookalike controlled by plain from/to props instead of a tanstack Column,
 * for date ranges the server reads as standalone query params rather than a per-column filter.
 */
export function DateRangeFilter({
  from, label, onChange, to,
}: {
  from?: string; label: string; onChange: (from: string | undefined, to: string | undefined) => void; to?: string;
}) {
  const range: DateRange = { from: fromDateKey(from), to: fromDateKey(to) };
  const hasValue = Boolean(range.from || range.to);

  function onSelect(next: DateRange | undefined) {
    onChange(next?.from ? toDateKey(next.from) : undefined, next?.to ? toDateKey(next.to) : undefined);
  }

  function onReset(event: React.MouseEvent) {
    event.stopPropagation();
    onChange(undefined, undefined);
  }

  const dateText = range.from && range.to && range.from.getTime() !== range.to.getTime()
    ? `${formatDate(range.from)} - ${formatDate(range.to)}`
    : formatDate(range.from ?? range.to);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button data-idoc-table-control variant="outline" className="border-dashed font-normal">
          {hasValue ? (
            <div
              aria-label={`Clear ${label} filter`}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={onReset}
              role="button"
              tabIndex={0}
            >
              <XCircle />
            </div>
          ) : (
            <CalendarIcon />
          )}
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {hasValue && (
              <>
                <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-4" />
                <span>{dateText}</span>
              </>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent data-idoc-table-panel className="w-auto p-0" align="start">
        <Calendar autoFocus captionLayout="dropdown" mode="range" onSelect={onSelect} selected={range} />
      </PopoverContent>
    </Popover>
  );
}

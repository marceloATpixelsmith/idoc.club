'use client';

import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { calendarDate, dateKey, isoToAdminDate } from '@/components/forms/us-date-input';

type DateRangePickerProps = {
  defaultFrom?: string;
  defaultTo?: string;
  id: string;
  fromName: string;
  toName: string;
  required?: boolean;
};

//A SINGLE FIELD CHOOSES BOTH DATES, WHILE EXISTING SERVER ACTIONS RECEIVE TWO ISO VALUES.
//THE FIRST CLICK STARTS A NEW RANGE; THE SECOND CLICK COMPLETES IT IN EITHER DIRECTION.
export function DateRangePicker({ defaultFrom, defaultTo, id, fromName, toName, required = true }: DateRangePickerProps) {
  const [range, setRange] = useState<DateRange>({
    from: calendarDate(defaultFrom),
    to: calendarDate(defaultTo),
  });
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [open, setOpen] = useState(false);
  const from = range.from ? dateKey(range.from) : '';
  const to = range.to ? dateKey(range.to) : '';
  const text = from && to ? `${isoToAdminDate(from)} – ${isoToAdminDate(to)}` : from ? `${isoToAdminDate(from)} – Select end date` : 'dd/mm/yyyy – dd/mm/yyyy';
  const currentYear = new Date().getFullYear();
  const initialYear = range.from?.getFullYear() ?? currentYear;

  function pickDate(_next: DateRange | undefined, selectedDay: Date) {
    if (!awaitingEnd || !range.from) {
      setRange({ from: selectedDay, to: undefined });
      setAwaitingEnd(true);
      return;
    }
    const first = selectedDay.getTime() < range.from.getTime() ? selectedDay : range.from;
    const last = selectedDay.getTime() < range.from.getTime() ? range.from : selectedDay;
    setRange({ from: first, to: last });
    setAwaitingEnd(false);
    setOpen(false);
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Choose start and end dates"
          aria-required={required}
          className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs hover:border-ring focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          id={id}
          type="button"
        >
          <CalendarIcon aria-hidden className="size-4 shrink-0" />
          <span className={from ? 'truncate' : 'truncate text-muted-foreground'}>{text}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          autoFocus
          captionLayout="dropdown"
          defaultMonth={range.from ?? new Date()}
          endMonth={new Date(Math.max(currentYear + 20, initialYear + 10), 11)}
          mode="range"
          onSelect={pickDate}
          selected={range}
          startMonth={new Date(Math.min(1900, initialYear - 20), 0)}
        />
      </PopoverContent>
      <input aria-hidden="true" className="sr-only" name={fromName} onChange={() => {}} onInvalid={() => setOpen(true)} required={required} tabIndex={-1} type="text" value={from} />
      <input aria-hidden="true" className="sr-only" name={toName} onChange={() => {}} onInvalid={() => setOpen(true)} required={required} tabIndex={-1} type="text" value={to} />
    </Popover>
  );
}

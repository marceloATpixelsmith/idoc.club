'use client';

import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const SLASH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

//PRESERVE LEGACY EXPORTS FOR CALLERS THAT SPECIFICALLY REQUEST US DATE CONVERSIONS.
export function isoToUsDate(iso: string | undefined | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

export function usDateToIso(value: string) {
  const match = SLASH_DATE.exec(value.trim());
  if (!match) return '';
  const [, month, day, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ? '' : `${year}-${month}-${day}`;
}

export function isoToAdminDate(iso: string | undefined | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function adminDateToIso(value: string) {
  const match = SLASH_DATE.exec(value.trim());
  if (!match) return '';
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ? '' : `${year}-${month}-${day}`;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDate(iso: string | undefined | null): Date | undefined {
  const match = ISO_DATE.exec(iso ?? '');
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dateKey(date) === iso ? date : undefined;
}

type SingleDatePickerProps = {
  defaultIso?: string;
  id: string;
  name: string;
  min?: string;
  max?: string;
  required?: boolean;
  value?: string;
  onChange?: (iso: string) => void;
};

//SHARED SINGLE-DATE PICKER FOR ADMIN AND MEMBER FORMS; THE FIELD ITSELF OPENS THE CALENDAR.
//THE SERVER CONTINUES TO RECEIVE A YYYY-MM-DD VALUE AND DISPLAY USES DD/MM/YYYY.
export function SingleDatePicker({ defaultIso, id, name, min, max, required = true, value, onChange }: SingleDatePickerProps) {
  const [internalIso, setInternalIso] = useState(defaultIso && calendarDate(defaultIso) ? defaultIso : '');
  const iso = value !== undefined ? value : internalIso;
  function updateIso(nextIso: string) {
    if (value === undefined) setInternalIso(nextIso);
    onChange?.(nextIso);
  }
  const [open, setOpen] = useState(false);
  const selected = calendarDate(iso);
  const minimum = calendarDate(min);
  const maximum = calendarDate(max);
  const currentYear = new Date().getFullYear();
  const initialYear = selected?.getFullYear() ?? currentYear;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`Choose ${id} date`}
          aria-required={required}
          data-idoc-table-control
          className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-transparent px-3 text-left text-sm shadow-xs transition-[color,box-shadow] hover:border-ring focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          id={id}
          type="button"
        >
          <CalendarIcon aria-hidden className="size-4 shrink-0" />
          <span className={iso ? 'truncate' : 'truncate text-muted-foreground'}>{iso ? isoToAdminDate(iso) : 'dd/mm/yyyy'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          autoFocus
          captionLayout="dropdown"
          defaultMonth={selected ?? minimum ?? new Date()}
          disabled={minimum || maximum ? [{ before: minimum ?? new Date(1900, 0, 1) }, { after: maximum ?? new Date(9999, 11, 31) }] : undefined}
          endMonth={new Date(Math.max(currentYear + 20, initialYear + 10), 11)}
          mode="single"
          onSelect={(next) => {
            if (!next) return;
            updateIso(dateKey(next));
            setOpen(false);
          }}
          selected={selected}
          startMonth={new Date(Math.min(1900, initialYear - 20), 0)}
        />
      </PopoverContent>
      <input
        aria-hidden="true"
        className="sr-only"
        name={name}
        onChange={() => {}}
        onInvalid={() => setOpen(true)}
        required={required}
        tabIndex={-1}
        type="text"
        value={iso}
      />
    </Popover>
  );
}

//KEEP THE EXISTING COMPONENT NAME WHILE MOVING ALL CALLERS TO THE SHARED PICKER.
export const UsDateInput = SingleDatePicker;

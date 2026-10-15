'use client';

import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

//KEEP LEGACY CONVERSION EXPORTS FOR EXISTING CALLERS; THE ADMIN FIELD BELOW USES DAY-FIRST DISPLAY.
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function isoToUsDate(iso: string | undefined | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

export function usDateToIso(value: string) {
  const match = US_DATE.exec(value.trim());
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
  const match = US_DATE.exec(value.trim());
  if (!match) return '';
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ? '' : `${year}-${month}-${day}`;
}

//SHOW A REAL CALENDAR PICKER AND AN EDITABLE DD/MM/YYYY INPUT WITHOUT CHANGING THE ISO FORM SUBMISSION.
export function UsDateInput({ defaultIso, id, name }: { defaultIso?: string; id: string; name: string }) {
  const [value, setValue] = useState(isoToAdminDate(defaultIso));
  const [open, setOpen] = useState(false);
  const iso = adminDateToIso(value);
  const selected = iso ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) : undefined;
  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <Input
          autoComplete="off"
          id={id}
          inputMode="numeric"
          maxLength={10}
          onChange={(event) => setValue(event.target.value)}
          pattern="\\d{2}/\\d{2}/\\d{4}"
          placeholder="dd/mm/yyyy"
          required
          title="Enter a date as dd/mm/yyyy"
          type="text"
          value={value}
        />
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button aria-label="Choose date" size="icon" type="button" variant="outline"><CalendarIcon aria-hidden /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              autoFocus
              captionLayout="dropdown"
              endMonth={new Date(new Date().getFullYear() + 10, 11)}
              mode="single"
              onSelect={(date) => {
                if (!date) return;
                setValue(`${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`);
                setOpen(false);
              }}
              selected={selected}
            />
          </PopoverContent>
        </Popover>
      </div>
      <input name={name} type="hidden" value={iso} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';

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

// A native date input shows the browser's locale format. Seminar schedule dates are entered as US mm/dd/yyyy
// (docs/02 §6) and submitted to the server as ISO yyyy-mm-dd through a hidden field of the given name.
export function UsDateInput({ defaultIso, id, name }: { defaultIso?: string; id: string; name: string }) {
  const [text, setText] = useState(isoToUsDate(defaultIso));
  return (
    <>
      <Input
        autoComplete="off" id={id} inputMode="numeric" maxLength={10} onChange={(event) => setText(event.target.value)}
        pattern="\d{2}/\d{2}/\d{4}" placeholder="mm/dd/yyyy" required title="Enter a date as mm/dd/yyyy" type="text" value={text}
      />
      <input name={name} type="hidden" value={usDateToIso(text)} />
    </>
  );
}
